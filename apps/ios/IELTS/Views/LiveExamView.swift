import AVFoundation
import Observation
import SwiftUI

/// Live examiner session. Turn-based: server drives phases via /api/live/turn (examiner TTS ↔ candidate turns ended by VAD).
/// Realtime: OpenAI Realtime over WebSocket with client-timed part changes. Both record one m4a per part → /api/live/finish.
@MainActor @Observable
final class LiveExam {
    enum Stage: Equatable { case ready, running, uploading, finished([String]), failed(String) }

    var stage: Stage = .ready
    var phase = "intro"
    var phaseStarted = Date()
    var caption = ""
    var level = 0.0
    var listening = false
    var thinking = false
    var examinerTalking = false
    var cueCard: Prompt?
    var prepLeft = 0
    var micDenied = false

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let audio = LiveAudio()
    @ObservationIgnored private let player = Player()
    @ObservationIgnored private var socket: RealtimeSocket?
    @ObservationIgnored private var run: Task<Void, Never>?
    @ObservationIgnored private var vad = VAD()
    @ObservationIgnored private var turnEnded: CheckedContinuation<Void, Never>?
    @ObservationIgnored private var sessionId = ""
    @ObservationIgnored private var test: SpeakingTest?
    @ObservationIgnored private var currentPart: Int?
    @ObservationIgnored private var recordings: [Int: LiveAudio.PartRecording] = [:]
    @ObservationIgnored private var ending = false

    init(api: APIClient) { self.api = api }

    var phaseLabel: String {
        switch phase {
        case "intro": return "Introduction"
        case "p1": return "Part 1 · Interview"
        case "p2-prep": return "Part 2 · Preparation"
        case "p2-talk": return "Part 2 · Long turn"
        case "p2-follow": return "Part 2 · Rounding off"
        case "p3": return "Part 3 · Discussion"
        default: return "End of test"
        }
    }

    /// Mic check on the pre-screen.
    func prepare() async {
        guard await AVAudioApplication.requestRecordPermission() else { micDenied = true; return }
        do {
            audio.onLevel = { [weak self] l, dt in Task { @MainActor in self?.onLevel(l, dt) } }
            try audio.start()
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    func start(realtime: Bool) {
        guard audio.running else { micDenied = true; return }
        stage = .running
        run = Task { if realtime { await runRealtime() } else { await runTurnBased() } }
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
        examinerTalking = player.isPlaying || audio.examinerSpeaking
        if listening && vad.feed(level: l, dt: dt) { endTurn() }
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
            var reply: LiveReply = try await api.send("POST", "/api/live/start", [String: String]())
            sessionId = reply.sessionId ?? ""
            test = reply.test
            while !Task.isCancelled {
                setPhase(reply.phase)
                if let card = reply.cueCard { cueCard = card }
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
            if !ending && !(error is CancellationError) { stage = .failed(error.localizedDescription); return }
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
        listening = true
        let limit = Task { try? await Task.sleep(for: .seconds(maxSeconds)); self.endTurn() }
        await withCheckedContinuation { turnEnded = $0 }
        limit.cancel()
        listening = false
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

    // MARK: Realtime

    private func runRealtime() async {
        do {
            let s: LiveReply = try await api.send("POST", "/api/live/start", [String: String]())
            sessionId = s.sessionId ?? ""
            test = s.test
            let token: RealtimeToken = try await api.send("POST", "/api/live/realtime-token", ["sessionId": sessionId])
            let sock = RealtimeSocket()
            socket = sock
            sock.onEvent = { [weak self] type, event in self?.handle(type, event) }
            sock.onClose = { [weak self] err in
                guard let err else { return }
                Task { @MainActor in if self?.stage == .running && self?.ending == false { self?.caption = "Connection lost: \(err.localizedDescription)" } }
            }
            audio.onPCM16 = { [weak sock] pcm in sock?.appendAudio(pcm) }
            sock.connect(ephemeralKey: token.value, model: token.model ?? "gpt-realtime")
            sock.send(["type": "response.create"]) // examiner opens the test

            let card = test?.part2
            setPhase("p1")
            try await Task.sleep(for: .seconds(270))

            setPhase("p2-prep")
            cueCard = card
            sock.instruct("Move to Part 2 now. Read the candidate this cue card and tell them they have one minute to prepare, then stay silent: \(card.map { "\($0.title). You should say: \(($0.bullets ?? []).joined(separator: "; "))" } ?? "describe a memorable experience")")
            try await Task.sleep(for: .seconds(8))
            await countdown(60)
            try Task.checkCancellation()

            setPhase("p2-talk")
            sock.instruct("Preparation time is over. Ask the candidate to start talking now. Do not interrupt them for two minutes.")
            try await Task.sleep(for: .seconds(125))

            setPhase("p3")
            sock.instruct("Time is up. Thank the candidate, then begin Part 3: a discussion of abstract questions related to \(card?.topic ?? card?.title ?? "the Part 2 topic"). Ask one question at a time.")
            try await Task.sleep(for: .seconds(270))

            setPhase("closing")
            sock.instruct("Close the test now: say \"Thank you, that is the end of the speaking test.\"")
            try await Task.sleep(for: .seconds(6))
        } catch {
            if !ending && !(error is CancellationError) { stage = .failed(error.localizedDescription); return }
        }
        await finish()
    }

    nonisolated private func handle(_ type: String, _ event: [String: Any]) {
        switch type {
        case "response.output_audio.delta", "response.audio.delta":
            if let b64 = event["delta"] as? String, let d = Data(base64Encoded: b64) {
                Task { @MainActor in self.audio.playPCM16(d) }
            }
        case "response.created":
            Task { @MainActor in self.caption = "" }
        case "response.output_audio_transcript.delta", "response.audio_transcript.delta":
            if let t = event["delta"] as? String { Task { @MainActor in self.caption += t } }
        case "error":
            let msg = (event["error"] as? [String: Any])?["message"] as? String ?? "Realtime error"
            Task { @MainActor in self.caption = msg }
        default: break
        }
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
            stage = .failed(error.localizedDescription)
        }
    }
}

struct LiveExamView: View {
    @Environment(APIClient.self) private var api
    @State private var exam: LiveExam?
    @State private var showCaptions = false

    private var realtime: Bool { api.me?.settings.liveProvider == "openai-realtime" && api.me?.realtimeAvailable == true }

    var body: some View {
        Group {
            if let exam {
                content(exam)
                    .micDeniedAlert(Binding(get: { exam.micDenied }, set: { exam.micDenied = $0 }))
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Live examiner")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(exam?.stage == .running || exam?.stage == .uploading)
        .toolbar(.hidden, for: .tabBar)
        .task {
            if exam == nil {
                let e = LiveExam(api: api)
                exam = e
                await e.prepare()
            }
        }
        .onDisappear { exam?.teardown() }
    }

    @ViewBuilder
    private func content(_ exam: LiveExam) -> some View {
        switch exam.stage {
        case .ready: ready(exam)
        case .running: running(exam)
        case .uploading: ProgressView("Uploading your recordings…").frame(maxHeight: .infinity)
        case let .finished(ids): ResultView(ids: ids)
        case let .failed(msg):
            ContentUnavailableView { Label("The test stopped", systemImage: "exclamationmark.triangle") } description: { Text(msg) } actions: {
                if exam.hasRecordings { Button("Score what was recorded") { exam.scoreRecorded() }.buttonStyle(.borderedProminent) }
            }
        }
    }

    private func ready(_ exam: LiveExam) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: "person.wave.2.fill").font(.system(size: 56)).foregroundStyle(.brand).padding(.top, 20)
                Text("A full speaking test with an AI examiner").font(.title2.bold()).multilineTextAlignment(.center)
                VStack(alignment: .leading, spacing: 10) {
                    Label(realtime ? "OpenAI Realtime — natural back-and-forth" : "Turn-based — the examiner waits until you finish",
                          systemImage: realtime ? "bolt.fill" : "arrow.left.arrow.right")
                    Label("About 11–14 minutes: Parts 1, 2 and 3", systemImage: "clock")
                    Label("Use headphones or a quiet room", systemImage: "headphones")
                    Label("You'll get a full band report per part at the end", systemImage: "chart.bar")
                }
                .card()
                VStack(alignment: .leading, spacing: 6) {
                    Text("Mic check — say something").font(.subheadline).foregroundStyle(.secondary)
                    ProgressView(value: exam.level).tint(exam.level > 0.3 ? Color.good : Color.secondary)
                }
                .card()
                Button { exam.start(realtime: realtime) } label: { Text("Start test").bold().frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).controlSize(.large)
            }
            .padding()
        }
        .background(.canvas)
    }

    private func running(_ exam: LiveExam) -> some View {
        VStack(spacing: 20) {
            HStack {
                Text(exam.phaseLabel).font(.headline)
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    Text(clock(Int(ctx.date.timeIntervalSince(exam.phaseStarted)))).font(.headline.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            ZStack {
                Circle().fill(.brand.opacity(0.12)).frame(width: 200, height: 200)
                    .scaleEffect(exam.examinerTalking ? 1.12 : 1)
                    .animation(exam.examinerTalking ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : .default, value: exam.examinerTalking)
                Circle().fill(.brand).frame(width: 130, height: 130)
                Image(systemName: "person.fill").font(.system(size: 56)).foregroundStyle(.white)
            }
            .accessibilityLabel(exam.examinerTalking ? "Examiner speaking" : "Examiner")
            Group {
                if exam.thinking { Label("Examiner is thinking…", systemImage: "ellipsis") }
                else if exam.examinerTalking { Label("Examiner speaking", systemImage: "speaker.wave.2.fill") }
                else if exam.phase == "p2-prep" { Label("Prepare: \(clock(exam.prepLeft))", systemImage: "timer") }
                else if exam.listening { Label("Your turn — speak now", systemImage: "mic.fill").foregroundStyle(.good) }
                else { Label("Listening", systemImage: "mic") }
            }
            .font(.headline)
            ProgressView(value: exam.level).tint(Color.good).frame(maxWidth: 220)
            if let card = exam.cueCard, exam.phase.hasPrefix("p2") { CueCardView(prompt: card) }
            if showCaptions && !exam.caption.isEmpty {
                Text(exam.caption).font(.body).multilineTextAlignment(.center).padding().frame(maxWidth: .infinity).background(.surface, in: RoundedRectangle(cornerRadius: 12))
            }
            Spacer(minLength: 0)
            HStack(spacing: 12) {
                Toggle(isOn: $showCaptions) { Label("Captions", systemImage: "captions.bubble") }.toggleStyle(.button)
                if exam.listening { Button("I'm done") { exam.endTurn() }.buttonStyle(.borderedProminent) }
                Button("End test", role: .destructive) { exam.endTest() }.buttonStyle(.bordered)
            }
            .controlSize(.large)
        }
        .padding()
        .background(.canvas)
    }
}
