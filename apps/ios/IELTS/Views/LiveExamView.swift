import AVFoundation
import Observation
import SwiftUI

/// Live examiner session. Turn-based: server drives phases via /api/live/turn (examiner TTS ↔ candidate turns ended by VAD).
/// Duplex: GPT-Live (through our WebSocket relay) or Gemini Live, with client-timed part changes. All record one m4a per part → /api/live/finish.
enum Examiner { case turn, gptLive, gemini }

@MainActor @Observable
final class LiveExam {
    enum Stage: Equatable { case ready, running, uploading, finished([String]), failed(String) }

    var stage: Stage = .ready
    var phase = "intro"
    var phaseStarted = Date()
    var caption = ""
    var voiceError: String? // examiner TTS failed: captions are forced on and a banner explains why
    var level = 0.0
    var listening = false
    var thinking = false
    var examinerTalking = false
    var cueCard: Prompt?
    var prepLeft = 0
    var micDenied = false
    var micReady = false // the mic check is running (permission granted, engine started)
    var micChecking = false
    var micHeard = false // enough speech-level input during the mic check to say "we can hear you"
    var micError: String?
    var fellBack = false // the duplex provider couldn't connect, so the turn-based examiner runs instead
    var testStarted = Date()

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let audio = LiveAudio()
    @ObservationIgnored private let player = Player()
    @ObservationIgnored private var socket: DuplexSocket?
    @ObservationIgnored private var run: Task<Void, Never>?
    @ObservationIgnored private var vad = VAD()
    @ObservationIgnored private var turnEnded: CheckedContinuation<Void, Never>?
    @ObservationIgnored private var sessionId = ""
    @ObservationIgnored private var test: SpeakingTest?
    @ObservationIgnored private var currentPart: Int?
    @ObservationIgnored private var recordings: [Int: LiveAudio.PartRecording] = [:]
    @ObservationIgnored private var ending = false
    @ObservationIgnored private var micLoudSeconds = 0.0
    @ObservationIgnored private var vadOn = false // turn-based turns end on silence; the Part 2 long turn never does
    @ObservationIgnored private var talkTimeUp = false
    @ObservationIgnored private var answeredFlag = false // the candidate finished an answer (duplex)
    @ObservationIgnored private var heardFlag = false // duplex: the candidate spoke since the last cue or answer
    @ObservationIgnored private var lastOut = Date.distantPast // GPT-Live has no turn boundaries: a 2.5 s gap in the examiner's output starts a new turn
    @ObservationIgnored private var freshTurn = true // duplex: the next examiner output starts a new turn

    init(api: APIClient) { self.api = api }

    /// Web LiveStage PHASE_LABEL.
    var phaseLabel: String {
        switch phase {
        case "intro": return "Introduction"
        case "p1": return "Part 1: Introduction and interview"
        case "p2-prep": return "Part 2: Preparation"
        case "p2-talk", "p2-follow": return "Part 2: Long turn"
        case "p3": return "Part 3: Discussion"
        default: return "End of the test"
        }
    }

    /// Web LiveStage STATUS_TEXT, derived from what the examiner and the mic are doing.
    var statusText: String {
        if stage == .uploading { return "Uploading your recordings" }
        if thinking { return "The examiner is thinking" }
        if examinerTalking { return "The examiner is speaking" }
        if phase == "p2-prep" { return "Use this minute to prepare" }
        if listening { return "Your turn. Answer when you are ready" }
        return caption.isEmpty ? "Connecting to your examiner" : ""
    }

    /// Mic check on the pre-screen: asks for the microphone on entry so the level meter is already running. Safe to call again to retry.
    func prepare() async {
        guard !micReady, !micChecking else { return }
        if Demo.on { micReady = true; return } // screenshots must not wait on a permission prompt
        micChecking = true
        micError = nil
        defer { micChecking = false }
        guard await AVAudioApplication.requestRecordPermission() else { micDenied = true; return }
        do {
            audio.onLevel = { [weak self] l, dt in Task { @MainActor in self?.onLevel(l, dt) } }
            try audio.start()
            micReady = true
        } catch {
            micError = (error as? APIError)?.message ?? "The microphone couldn't start. Close other apps that use it and try again."
        }
    }

    func start(_ kind: Examiner) {
        guard audio.running else { micDenied = true; return }
        testStarted = Date()
        stage = .running
        run = Task { if kind == .turn { await runTurnBased() } else { await runDuplex(kind) } }
    }

    /// "I'm done" — end the candidate's turn now.
    func endTurn() {
        turnEnded?.resume()
        turnEnded = nil
    }

    var hasRecordings: Bool { !recordings.isEmpty || currentPart != nil }

    /// After a failure: upload and score whatever parts were recorded.
    func scoreRecorded() { Task { await finish() } }

    func endTest() {
        ending = true
        run?.cancel()
        endTurn()
        player.stop()
    }

    func teardown() {
        run?.cancel()
        endTurn()
        player.stop()
        socket?.close()
        audio.stop()
    }

    private func onLevel(_ l: Double, _ dt: Double) {
        level = l
        if stage == .ready, !micHeard {
            if l > 0.25 { micLoudSeconds += dt }
            micHeard = micLoudSeconds >= 0.6
        }
        examinerTalking = player.isPlaying || audio.examinerSpeaking
        if listening && vadOn && vad.feed(level: l, dt: dt) { endTurn() }
    }

    private func setPhase(_ p: String) {
        if p != phase { phaseStarted = Date() }
        phase = p
        let part: Int? = ["p1": 1, "p2-talk": 2, "p2-follow": 2, "p3": 3][p]
        guard part != currentPart else { return }
        closePart()
        if let part {
            try? audio.beginPart(tmp("live-\(sessionId)-p\(part).m4a"))
            currentPart = part
        }
    }

    private func closePart() {
        if let p = currentPart, let r = audio.endPart() { recordings[p] = r }
        currentPart = nil
    }

    private func tmp(_ name: String) -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(name) }

    private func uploadFile(_ url: URL) async throws -> String {
        let t: UploadTarget = try await api.send("POST", "/api/live/upload-url", ["sessionId": sessionId, "audioContentType": "audio/mp4"])
        try await api.upload(t.uploadUrl, file: url, contentType: "audio/mp4")
        return t.key
    }

    // MARK: Turn-based

    private func runTurnBased() async {
        do {
            var reply: LiveReply = try await api.send("POST", "/api/live/start", ["source": QuestionSource.speaking(api)].compactMapValues { $0 })
            sessionId = reply.sessionId ?? ""
            test = reply.test
            while !Task.isCancelled {
                setPhase(reply.phase)
                if let card = reply.cueCard { cueCard = card }
                voiceError = reply.audioUrl == nil ? reply.voiceError : nil
                await speak(reply.examinerText, reply.audioUrl)
                if Task.isCancelled || reply.phase == "done" || reply.phase == "closing" { break }
                if reply.phase == "p2-prep" {
                    await countdown(reply.prepSeconds ?? 60)
                    if Task.isCancelled { break }
                    reply = try await api.send("POST", "/api/live/turn", ["sessionId": sessionId, "skipped": true] as [String: Any])
                    continue
                }
                let key = try await recordTurn(maxSeconds: reply.phase == "p2-talk" ? 120 : 90, endAfter: reply.phase == "p2-talk" ? 3 : 1.2)
                if Task.isCancelled { break }
                thinking = true
                var turn: [String: Any] = ["sessionId": sessionId]
                if let key { turn["audioKey"] = key } else { turn["skipped"] = true }
                reply = try await api.send("POST", "/api/live/turn", turn)
                thinking = false
            }
        } catch {
            if !ending && !(error is CancellationError) { stage = .failed(CommunityIssue.summary(error)); return }
        }
        await finish()
    }

    private func speak(_ text: String, _ audioUrl: String?) async {
        caption = text
        audio.capturing = false
        defer { audio.capturing = true }
        if let audioUrl, let data = try? await api.download(audioUrl) {
            await player.playToEnd(data)
        } else {
            try? await Task.sleep(for: .seconds(2))
        }
    }

    /// Records one candidate turn until VAD silence, "I'm done", or the time limit. Returns the uploaded key (nil if silent).
    private func recordTurn(maxSeconds: Double, endAfter: Double) async throws -> String? {
        let url = tmp("turn-\(UUID().uuidString).m4a")
        try audio.beginTurn(url)
        vad = VAD()
        vad.endAfter = endAfter
        vadOn = true
        listening = true
        let limit = Task { try? await Task.sleep(for: .seconds(maxSeconds)); self.endTurn() }
        await withCheckedContinuation { turnEnded = $0 }
        limit.cancel()
        listening = false
        vadOn = false
        let heard = vad.heardSpeech
        guard let file = audio.endTurn(), heard, !Task.isCancelled else { return nil }
        return try await uploadFile(file)
    }

    private func countdown(_ seconds: Int) async {
        prepLeft = seconds
        audio.capturing = false
        defer { audio.capturing = true }
        while prepLeft > 0 && !Task.isCancelled {
            try? await Task.sleep(for: .seconds(1))
            prepLeft -= 1
        }
    }

    // MARK: Duplex (GPT-Live, Gemini Live)

    private func runDuplex(_ kind: Examiner) async {
        do {
            var startBody: [String: Any] = ["skipTts": true]
            if let source = QuestionSource.speaking(api) { startBody["source"] = source }
            let s: LiveReply = try await api.send("POST", "/api/live/start", startBody)
            sessionId = s.sessionId ?? ""
            test = s.test
            do {
                socket = try await connectDuplex(kind)
            } catch {
                if ending || error is CancellationError { throw error }
                // The provider couldn't connect (token, network, key): the turn-based examiner runs the same test.
                fellBack = true
                audio.onPCM16 = nil
                await runTurnBased()
                return
            }
            guard let sock = socket else { return }

            let card = test?.part2
            setPhase("p1")
            try await Task.sleep(for: .seconds(270))

            setPhase("p2-prep")
            cueCard = card
            sock.hear(false, fresh: false)
            cue("Part 1 is over. Move to Part 2 now: give the Part 2 instructions and the topic, then stay silent while the candidate prepares.", key: "part2")
            try await Task.sleep(for: .seconds(8))
            await countdown(60)
            try Task.checkCancellation()

            setPhase("p2-talk")
            sock.hear(false, fresh: true)
            cue("The preparation minute is over. Ask the candidate to start speaking now, then stay silent until you are told the talk is over.", key: "talk")
            let timeUp = await waitTalk(125)

            setPhase("p2-follow")
            cue(timeUp ? "The two minutes are up. Say \"Thank you. That's the end of your time.\" and ask the rounding-off question."
                       : "The candidate has finished their talk. Say \"Thank you.\" and ask the rounding-off question.", key: timeUp ? "follow-timeup" : "follow", heard: true)
            sock.hear(true, fresh: false)
            try await waitAnswered(45)

            setPhase("p3") // the examiner moves from the rounding-off answer into Part 3 by itself
            try await Task.sleep(for: .seconds(270))

            setPhase("closing")
            cue("The test is over. Say the closing line now and nothing more.", key: "closing")
            try await Task.sleep(for: .seconds(8))
        } catch {
            if !ending && !(error is CancellationError) { stage = .failed(CommunityIssue.summary(error)); return }
        }
        await finish()
    }

    private func connectDuplex(_ kind: Examiner) async throws -> DuplexSocket {
        if kind == .gemini {
            let token: GeminiToken = try await api.send("POST", "/api/live/gemini-token", ["sessionId": sessionId])
            let sock = GeminiLiveSocket()
            sock.onEvent = { [weak self] ev in self?.handleGemini(ev) }
            sock.onLost = { [weak self] in Task { @MainActor in self?.connectionLost() } }
            audio.setPCMRate(16000)
            audio.onPCM16 = { [weak sock] pcm in sock?.appendAudio(pcm) }
            do {
                try await sock.connect(token: token.value, model: token.model ?? "gemini-3.8-live")
            } catch {
                sock.close()
                throw error
            }
            sock.cue("Begin the test.", key: "begin", heard: false) // the examiner opens with the introduction
            return sock
        }
        let sock = GPTLiveSocket()
        sock.onEvent = { [weak self] ev in self?.handleGPTLive(ev) }
        sock.onLost = { [weak self] in Task { @MainActor in self?.connectionLost() } }
        audio.setPCMRate(GPTLive.rate)
        audio.onPCM16 = { [weak sock] pcm in sock?.appendAudio(pcm) }
        do {
            try await sock.connect(base: api.baseURL, token: api.token ?? "", sessionId: sessionId) // sends the "begin" cue once session.started arrives
        } catch {
            sock.close()
            throw error
        }
        return sock
    }

    private func connectionLost() {
        if stage == .running && !ending { caption = "The connection to the examiner was lost. End the test to score what you have recorded." }
    }

    /// Cuts the examiner off locally (the provider interrupts its own generation) and gives it an instruction.
    private func cue(_ text: String, key: String, heard: Bool = false) {
        audio.stopPlayback()
        heardFlag = false
        freshTurn = true
        socket?.cue(text, key: key, heard: heard)
    }

    /// The Part 2 long turn: ends at the time limit or on "I'm done", never on a pause. True if the time ran out.
    private func waitTalk(_ seconds: Double) async -> Bool {
        if Task.isCancelled { return false }
        talkTimeUp = false
        listening = true
        let limit = Task { if (try? await Task.sleep(for: .seconds(seconds))) != nil { self.talkTimeUp = true; self.endTurn() } }
        await withCheckedContinuation { turnEnded = $0 }
        limit.cancel()
        listening = false
        return talkTimeUp
    }

    /// Waits for the candidate to finish answering the rounding-off question (or the timeout).
    private func waitAnswered(_ timeout: Double) async throws {
        answeredFlag = false
        let end = Date().addingTimeInterval(timeout)
        while !answeredFlag && Date() < end { try await Task.sleep(for: .milliseconds(250)) }
    }

    /// GPT-Live (through the relay): audio and captions stream without turn boundaries; the examiner's words after the candidate spoke are the reply to an answer.
    nonisolated private func handleGPTLive(_ ev: GPTLive.Event) {
        Task { @MainActor in
            switch ev {
            case let .audio(d):
                self.gptLiveOutput()
                self.audio.playPCM16(d)
            case let .outText(t):
                self.gptLiveOutput()
                self.caption += t
            case .inText:
                self.heardFlag = true
            case .error:
                // ponytail: the provider's detail is for the server logs, not the candidate.
                self.caption = "The examiner had trouble responding. Wait a moment, or end the test to score what you have recorded."
            case .closed:
                self.connectionLost()
            case .started: break
            }
        }
    }

    private func gptLiveOutput() {
        if Date().timeIntervalSince(lastOut) > 2.5 { freshTurn = true }
        lastOut = Date()
        examinerTurn()
    }

    /// Gemini Live: examiner audio and captions arrive per turn; a new turn after the candidate spoke is the examiner replying to an answer.
    nonisolated private func handleGemini(_ ev: GeminiLive.Event) {
        Task { @MainActor in
            switch ev {
            case let .audio(d):
                self.examinerTurn()
                self.audio.playPCM16(d)
            case let .outText(t):
                self.examinerTurn()
                self.caption += t
            case .inText:
                self.heardFlag = true
            case .interrupted:
                self.audio.stopPlayback()
                self.freshTurn = true
            case .turnComplete:
                self.freshTurn = true
            default: break
            }
        }
    }

    private func examinerTurn() {
        guard freshTurn else { return }
        freshTurn = false
        caption = ""
        if heardFlag { heardFlag = false; answeredFlag = true }
    }

    // MARK: Finish

    private func finish() async {
        closePart()
        socket?.close()
        audio.stop()
        player.stop()
        stage = .uploading
        do {
            var parts: [[String: Any]] = []
            for (part, r) in recordings.sorted(by: { $0.key < $1.key }) {
                let key = try await uploadFile(r.url)
                parts.append(["part": part, "audioKey": key, "durationMs": r.durationMs, "energy": Array(r.energy.prefix(20000))])
            }
            guard !parts.isEmpty else { stage = .failed("Nothing was recorded, so there's nothing to score."); return }
            let res: FinishResult = try await api.send("POST", "/api/live/finish", ["sessionId": sessionId, "parts": parts] as [String: Any])
            stage = .finished(res.attemptIds)
        } catch {
            stage = .failed(CommunityIssue.summary(error))
        }
    }
}

struct LiveExamView: View {
    @Environment(APIClient.self) private var api
    @State private var exam: LiveExam?
    @State private var showCaptions = false
    @State private var showSettings = false
    @State private var confirmEnd = false
    @State private var notes = ""
    @FocusState private var notesFocused: Bool

    private struct Step: Identifiable {
        let part: Int
        let time: String
        let text: String
        var id: Int { part }
    }
    private static let steps = [
        Step(part: 1, time: "4-5 min", text: "Questions about you and familiar topics."),
        Step(part: 2, time: "3-4 min", text: "One minute to prepare from a cue card, then speak for up to two minutes."),
        Step(part: 3, time: "4-5 min", text: "A discussion of broader ideas linked to Part 2."),
    ]

    private var provider: String { api.me?.settings.liveProvider ?? "turn" }
    /// The examiner that runs: the chosen duplex provider when the server offers it, else turn-based.
    private var examiner: Examiner {
        if provider == "gpt-live", allowed.contains("gpt-live") { return .gptLive }
        if provider == "gemini-live", allowed.contains("gemini-live") { return .gemini }
        if allowed.contains("turn") { return .turn }
        if allowed.contains("gpt-live") { return .gptLive }
        if allowed.contains("gemini-live") { return .gemini }
        return .turn
    }
    /// Live examiners this user may run: only those whose own key they have set (LiveGate keeps everyone else out).
    private var allowed: Set<String> {
        if let q = api.quota { return Set(q.liveProviders) }
        var s: Set<String> = []
        if api.me?.gptLiveAvailable == true { s.insert("gpt-live") }
        if api.me?.geminiLiveAvailable == true { s.insert("gemini-live") }
        return s
    }
    /// Same labels as Settings, Live examiner.
    private var styleLabel: String {
        switch examiner {
        case .turn: return "Examiner waits for you to finish"
        case .gptLive: return "Natural conversation (GPT-Live)"
        case .gemini: return "Natural conversation (Gemini)"
        }
    }
    /// The chosen examiner needs a key the user hasn't added: another one they can run takes its place.
    private var fallback: Bool { !allowed.contains(provider) }

    var body: some View {
        Group {
            if let exam {
                content(exam)
                    .micDeniedAlert(Binding(get: { exam.micDenied }, set: { exam.micDenied = $0 }))
            } else {
                ProgressView()
            }
        }
        .background(Color.canvas)
        .navigationTitle("Live examiner")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(exam?.stage == .running || exam?.stage == .uploading)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            if let exam, exam.stage == .running {
                ToolbarItem(placement: .topBarTrailing) {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        let elapsed = clock(Int(ctx.date.timeIntervalSince(exam.testStarted)))
                        Text(elapsed)
                            .font(.subheadline.weight(.medium).monospacedDigit())
                            .accessibilityLabel("Elapsed \(elapsed)")
                    }
                }
            }
        }
        .task {
            if exam == nil {
                let e = LiveExam(api: api)
                exam = e
                await e.prepare()
            }
        }
        .onDisappear { exam?.teardown() }
        // A sheet keeps the exam alive (pushing a view would fire onDisappear and tear it down); new models apply from the next turn.
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView().appRoutes()
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showSettings = false } } }
            }
        }
        .confirmationDialog("End the test now?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End test", role: .destructive) { exam?.endTest() }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text("The parts you've already recorded will be scored. You can't resume this test.")
        }
    }

    @ViewBuilder
    private func content(_ exam: LiveExam) -> some View {
        switch exam.stage {
        case .ready: ready(exam)
        case .running: running(exam)
        case .uploading: ProgressView("Uploading your recordings").frame(maxHeight: .infinity)
        case let .finished(ids): ResultView(ids: ids)
        case let .failed(msg):
            ContentUnavailableView {
                Label("The test stopped", systemImage: "exclamationmark.triangle")
            } description: {
                Text(msg)
            } actions: {
                if exam.hasRecordings { Button("Score what was recorded") { exam.scoreRecorded() }.primaryButton() }
            }
        }
    }

    // MARK: Pre-screen

    private func ready(_ exam: LiveExam) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("A full speaking test with a voice examiner. About 11-14 minutes, like the real thing.")
                    .foregroundStyle(.muted)

                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle("Microphone check")
                    VStack(alignment: .leading, spacing: 16) {
                        Label {
                            Text("Headphones work best, so the examiner's voice doesn't reach your microphone. Find a quiet room.")
                        } icon: {
                            Image(systemName: "headphones").foregroundStyle(.muted)
                        }
                        micMeter(exam)
                    }
                    .card()
                }

                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle("How it runs")
                    VStack(spacing: 0) {
                        ForEach(Self.steps) { s in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Part \(s.part)").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                                    Spacer()
                                    Text(s.time).font(.caption.monospacedDigit()).foregroundStyle(.muted)
                                }
                                Text(s.text)
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityElement(children: .combine)
                            if s.id != Self.steps.last?.id { Divider() }
                        }
                    }
                    .card(padding: 0)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("Examiner style: \(styleLabel).")
                            .foregroundStyle(.muted)
                        Button("Change") { showSettings = true }
                            .frame(minHeight: 44)
                    }
                    .font(.subheadline)
                    if fallback {
                        notice("That examiner needs your own key",
                               "The style you chose isn't set up, so \"\(styleLabel)\" runs instead. It's the same test. Add keys in Settings.")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .demoScroll()
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                // Always enabled: before the mic is ready a press retries the permission check instead of starting.
                if !exam.micReady && !exam.micChecking {
                    Text("Allow microphone access, then press again to begin.").font(.footnote).foregroundStyle(.muted)
                }
                Button {
                    if exam.micReady { exam.start(examiner) } else { Task { await exam.prepare() } }
                } label: {
                    Text(exam.micReady ? "Start test" : "Check microphone and start").frame(maxWidth: .infinity, minHeight: 28)
                }
                .primaryButton()
                .controlSize(.large)
                .disabled(exam.micChecking)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private func micMeter(_ exam: LiveExam) -> some View {
        if exam.micReady {
            VStack(alignment: .leading, spacing: 8) {
                ProgressView(value: min(1, max(0, exam.level * 1.8)))
                    .tint(exam.micHeard ? Color.good : Color.brand)
                    .accessibilityLabel("Microphone level")
                Text(exam.micHeard ? "We can hear you clearly." : "Say a few words, like your name.")
                    .font(.subheadline.weight(exam.micHeard ? .medium : .regular))
                    .foregroundStyle(exam.micHeard ? Color.goodText : Color.muted)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    Task { await exam.prepare() }
                } label: {
                    if exam.micChecking { ProgressView() } else { Label("Test microphone", systemImage: "mic") }
                }
                .secondaryButton()
                .disabled(exam.micChecking)
                if let e = exam.micError { ErrorLine(message: e) }
            }
        }
    }

    private func notice(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label {
                Text(title).font(.headline).foregroundStyle(.ink)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.warn)
            }
            Text(text).font(.subheadline).foregroundStyle(.muted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.warn.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: Running

    private func running(_ exam: LiveExam) -> some View {
        let part2 = exam.phase == "p2-prep" || exam.phase == "p2-talk"
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(exam.phaseLabel)
                    .font(.display(.title2, weight: .bold))
                    .foregroundStyle(.ink)
                    .accessibilityAddTraits(.isHeader)

                VStack(spacing: 12) {
                    VoiceBars(speaking: exam.examinerTalking, listening: exam.listening, level: exam.level)
                    Text(exam.statusText.isEmpty ? " " : exam.statusText)
                        .font(.body.weight(.medium))
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .card(padding: 24)
                .accessibilityElement(children: .combine)

                if exam.fellBack {
                    notice("Natural conversation couldn't connect", "Your examiner will wait for you to finish each answer instead. It runs the same test.")
                }
                if exam.voiceError != nil {
                    // ponytail: the server's detail (model id, Settings hint) is for logs, not the candidate.
                    notice("The examiner's voice isn't available right now", "Questions will appear as text below. The test carries on as normal.")
                }
                if (showCaptions || exam.voiceError != nil) && !exam.caption.isEmpty {
                    Text(exam.caption)
                        .font(.system(.body, design: .serif))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Color.surface2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }

                if part2, let card = exam.cueCard {
                    CueCardView(prompt: card)
                    if exam.phase == "p2-prep" { prepTimer(exam) } else if exam.listening { talkTimer(exam) }
                    notesField(exam)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .demoScroll()
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: exam.phase) { notesFocused = false } // notes are read-only once the long turn starts
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 12) {
                Button { showCaptions.toggle() } label: {
                    Image(systemName: showCaptions ? "captions.bubble.fill" : "captions.bubble").frame(minWidth: 28, minHeight: 28)
                }
                .secondaryButton()
                .accessibilityLabel(showCaptions ? "Hide captions" : "Show captions")
                .accessibilityAddTraits(showCaptions ? .isSelected : [])
                if exam.listening {
                    Button { exam.endTurn() } label: {
                        Label("I'm done", systemImage: "checkmark").frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .primaryButton()
                } else {
                    Spacer(minLength: 0)
                }
                Button("End test", role: .destructive) { confirmEnd = true }
                    .secondaryButton()
            }
            .controlSize(.large)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func prepTimer(_ exam: LiveExam) -> some View {
        let low = exam.prepLeft <= 10
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Preparation time").font(.subheadline)
                Spacer()
                Text(clock(max(0, exam.prepLeft))).font(.display(.title3).monospacedDigit()).foregroundStyle(low ? Color.warnText : Color.ink)
            }
            ProgressView(value: min(60, max(0, Double(60 - exam.prepLeft))), total: 60)
                .tint(low ? Color.warn : Color.brand)
                .accessibilityLabel("Preparation time")
            Text("Preparation. The examiner will ask you to start when the minute is up.").font(.caption).foregroundStyle(.muted)
        }
        .card()
    }

    private func talkTimer(_ exam: LiveExam) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let s = min(120, max(0, Int(ctx.date.timeIntervalSince(exam.phaseStarted))))
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Long turn").font(.subheadline)
                    Spacer()
                    Text("\(clock(s)) of 2:00").font(.display(.title3).monospacedDigit()).foregroundStyle(.ink)
                }
                ProgressView(value: Double(s), total: 120).accessibilityLabel("Speaking time")
            }
            .card()
        }
    }

    private func notesField(_ exam: LiveExam) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Notes").font(.subheadline.weight(.medium))
            ZStack(alignment: .topLeading) {
                TextEditor(text: $notes)
                    .focused($notesFocused)
                    .scrollContentBackground(.hidden)
                    .font(.system(.body, design: .serif))
                    .padding(8)
                    .frame(minHeight: 140)
                    .background(Color.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .allowsHitTesting(exam.phase == "p2-prep")
                    .accessibilityLabel("Notes")
                if notes.isEmpty {
                    Text("Key words, examples").foregroundStyle(.muted).padding(.horizontal, 13).padding(.vertical, 16).allowsHitTesting(false)
                }
            }
            Text("Only you see these.").font(.caption).foregroundStyle(.muted)
        }
    }
}

/// Examiner presence as a row of bars: they move while the examiner speaks, follow your voice while you answer and rest at a low line
/// otherwise. Under Reduce Motion the speaking state is a still, raised shape.
private struct VoiceBars: View {
    let speaking: Bool
    let listening: Bool
    let level: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let bars = 13

    var body: some View {
        TimelineView(.periodic(from: .now, by: speaking && !reduceMotion ? 0.16 : 1)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            HStack(spacing: 6) {
                ForEach(0..<bars, id: \.self) { i in
                    bar(i, t)
                }
            }
            .frame(height: 72)
        }
        .accessibilityHidden(true)
    }

    private func bar(_ i: Int, _ t: Double) -> some View {
        let half = Double(bars - 1) / 2
        let mid = 1 - abs(Double(i) - half) / half // 0 at the edges, 1 in the middle
        let rest = 0.1 + 0.08 * mid
        let scale: Double
        if listening {
            scale = min(1, rest + level * (0.7 + 1.1 * mid))
        } else if speaking {
            scale = reduceMotion ? 0.3 + 0.4 * mid : 0.18 + 0.82 * mid * abs(sin(t * 5.6 + Double(i) * 1.7))
        } else {
            scale = rest
        }
        return Capsule()
            .fill(listening ? Color.ink.opacity(0.7) : Color.brand)
            .frame(width: 6, height: 8 + 64 * scale)
    }
}
