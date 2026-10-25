import AVFoundation
import Observation
import SwiftUI

/// Live examiner session over LiveKit (web live/livekit.ts + duplex.ts): the worker runs the script, client timers drive the part changes
/// with cues, and the app records one m4a per part from LiveKit's mic audio. Each part goes to /api/live/part as soon as it ends, so its
/// analysis runs during the test (web live/turn.ts); /api/live/finish sends whatever is left and closes the session.
@MainActor @Observable
final class LiveExam {
    enum Stage: Equatable { case ready, running, uploading, finished([String]), failed(String) }

    var stage: Stage = .ready
    var phase = "intro"
    var phaseStarted = Date()
    var caption = ""
    var level = 0.0
    var listening = false
    var examinerTalking = false
    var cueCard: Prompt?
    var prepLeft = 0
    var micDenied = false
    var micReady = false // the mic check is running (permission granted, engine started)
    var micChecking = false
    var micHeard = false // enough speech-level input during the mic check to say "we can hear you"
    var micError: String?
    var testStarted = Date()

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let audio = LiveAudio()
    @ObservationIgnored private var examiner: LiveKitExaminer?
    @ObservationIgnored private var run: Task<Void, Never>?
    @ObservationIgnored private var turnEnded: CheckedContinuation<Void, Never>?
    @ObservationIgnored private var sessionId = ""
    @ObservationIgnored private var test: SpeakingTest?
    @ObservationIgnored private var currentPart: Int?
    @ObservationIgnored private var recordings: [Int: LiveAudio.PartRecording] = [:]
    @ObservationIgnored private var keys: [Int: String] = [:] // upload keys, so a part is uploaded once
    @ObservationIgnored private var sent: [Int: Task<Bool, Never>] = [:] // parts sent with /live/part during the test: true once accepted
    @ObservationIgnored private var ending = false
    @ObservationIgnored private var lost = false // the room dropped: the run stops without scoring
    @ObservationIgnored private var micLoudSeconds = 0.0
    @ObservationIgnored private var talkTimeUp = false
    @ObservationIgnored private var answeredFlag = false // the candidate finished an answer

    /// Set when this is the Speaking section of a full mock test: the server uses the mock's test, and the finished session is attached to it.
    @ObservationIgnored private let mockId: String?

    init(api: APIClient, mockId: String? = nil) {
        self.api = api
        self.mockId = mockId
    }

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

    func start() {
        guard audio.running else { micDenied = true; return }
        testStarted = Date()
        stage = .running
        run = Task { await runLive() }
    }

    /// After a dropped connection or a failed start with nothing recorded: the same session again (the server limits reconnects).
    func retry() {
        lost = false
        ending = false
        stage = .running
        run = Task { await runLive() }
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
    }

    func teardown() {
        run?.cancel()
        endTurn()
        examiner?.close()
        audio.stop()
    }

    private func onLevel(_ l: Double, _ dt: Double) {
        level = l
        if stage == .ready, !micHeard {
            if l > 0.25 { micLoudSeconds += dt }
            micHeard = micLoudSeconds >= 0.6
        }
    }

    private func setPhase(_ p: String) {
        if p != phase { phaseStarted = Date() }
        phase = p
        let part: Int? = ["p1": 1, "p2-talk": 2, "p2-follow": 2, "p3": 3][p]
        guard part != currentPart else { return }
        closePart()
        if let part {
            audio.beginPart(tmp("live-\(sessionId)-p\(part).m4a"))
            currentPart = part
        }
    }

    private func closePart() {
        if let p = currentPart, let r = audio.endPart() { recordings[p] = r; keys[p] = nil; send(p) }
        currentPart = nil
    }

    /// The /live body of one part, uploading its recording first if that has not happened yet.
    private func partBody(_ part: Int, _ r: LiveAudio.PartRecording) async throws -> [String: Any] {
        let key: String
        if let k = keys[part] { key = k } else { key = try await uploadFile(r.url); keys[part] = key }
        return ["part": part, "audioKey": key, "durationMs": r.durationMs, "energy": Array(r.energy.prefix(20000))]
    }

    /// Sends a finished part now, so its analysis runs while the test goes on. Best effort: a failure leaves it to finish().
    private func send(_ part: Int) {
        guard !sessionId.isEmpty, let r = recordings[part], sent[part] == nil else { return }
        let sid = sessionId
        sent[part] = Task {
            struct Sent: Decodable { let attemptId: String }
            guard let body = try? await partBody(part, r) else { return false }
            let res: Sent? = try? await api.send("POST", "/api/live/part", ["sessionId": sid, "part": body] as [String: Any])
            return res != nil
        }
    }

    private func tmp(_ name: String) -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(name) }

    private func uploadFile(_ url: URL) async throws -> String {
        let t: UploadTarget = try await api.send("POST", "/api/live/upload-url", ["sessionId": sessionId, "audioContentType": "audio/mp4"])
        try await api.upload(t.uploadUrl, file: url, contentType: "audio/mp4")
        return t.key
    }

    // MARK: Test flow

    private func runLive() async {
        do {
            if sessionId.isEmpty {
                var startBody: [String: Any] = [:]
                if let source = QuestionSource.speaking(api) { startBody["source"] = source }
                if let mockId { startBody["mockId"] = mockId }
                startBody["localHour"] = Calendar.current.component(.hour, from: Date()) // the examiner greets by time of day
                let s: LiveStarted = try await api.send("POST", "/api/live/start", startBody)
                sessionId = s.sessionId
                test = s.test
            }
            let room: LiveKitStart = try await api.send("POST", "/api/live/livekit/start", ["sessionId": sessionId])
            let x = LiveKitExaminer()
            x.onEvent = { [weak self] ev in MainActor.assumeIsolated { self?.handle(ev) } }
            x.onLost = { [weak self] in MainActor.assumeIsolated { self?.connectionLost() } }
            x.onMic = { [audio] buf in audio.feed(buf) }
            examiner = x
            audio.stop() // LiveKit owns the mic from here: its echo-cancelled input feeds the level meter and the part recordings
            try await x.connect(url: room.url, token: room.token) // sends "start": the examiner opens with the introduction

            setPhase("p1")
            try await Task.sleep(for: .seconds(270))

            setPhase("p2-prep")
            cueCard = test?.part2
            x.configure(2)
            x.listen(false)
            x.cue("part2")
            try await Task.sleep(for: .seconds(8))
            await countdown(60)
            try Task.checkCancellation()

            setPhase("p2-talk")
            x.listen(false, fresh: true)
            x.cue("talk")
            let timeUp = await waitTalk(125)
            try Task.checkCancellation()

            setPhase("p2-follow")
            x.cue(timeUp ? "follow-timeup" : "follow")
            x.listen(true)
            try await waitAnswered(45)

            setPhase("p3") // the examiner moves from the rounding-off answer into Part 3 by itself
            x.configure(3)
            try await Task.sleep(for: .seconds(270))

            setPhase("closing")
            x.cue("closing")
            try await Task.sleep(for: .seconds(8))
        } catch {
            if lost { return }
            if !ending && !(error is CancellationError) { stage = .failed(CommunityIssue.summary(error)); return }
        }
        await finish()
    }

    private func handle(_ ev: LiveKitWire.Event) {
        switch ev {
        case let .caption(t, append): caption = append ? caption + " " + t : t
        case let .speaking(on):
            examinerTalking = on
            audio.examinerSpeaking = on
        case .answered: answeredFlag = true
        default: break
        }
    }

    /// No fallback examiner: the test stops, and what was recorded can still be scored.
    private func connectionLost() {
        guard stage == .running, !ending, !lost else { return }
        lost = true
        run?.cancel()
        endTurn()
        examiner = nil
        closePart()
        examinerTalking = false
        audio.examinerSpeaking = false
        stage = .failed("The connection to the examiner dropped. The parts you recorded are safe.")
    }

    private func countdown(_ seconds: Int) async {
        prepLeft = seconds
        while prepLeft > 0 && !Task.isCancelled {
            try? await Task.sleep(for: .seconds(1))
            prepLeft -= 1
        }
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

    // MARK: Finish

    /// Link the finished live session to the mock (a few tries: the attempts are already saved, only the link would be missing).
    private func attach(_ mockId: String) async {
        for _ in 0..<3 {
            if (try? await api.attachMockSession(mockId, sessionId: sessionId)) != nil { return }
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func finish() async {
        closePart()
        examiner?.close()
        audio.stop()
        stage = .uploading
        do {
            guard !recordings.isEmpty else { stage = .failed("Nothing was recorded, so there's nothing to score."); return }
            // Only the parts not already accepted by /live/part (the list may be empty); finish returns every attempt of the session.
            var parts: [[String: Any]] = []
            for (part, r) in recordings.sorted(by: { $0.key < $1.key }) {
                if let job = sent[part], await job.value { continue }
                sent[part] = nil // a failed send is retried here, so a later finish() does not skip it
                parts.append(try await partBody(part, r))
            }
            let res: FinishResult = try await api.send("POST", "/api/live/finish", ["sessionId": sessionId, "parts": parts] as [String: Any])
            if let mockId { await attach(mockId) }
            stage = .finished(res.attemptIds)
        } catch {
            stage = .failed(CommunityIssue.summary(error))
        }
    }
}

struct LiveExamView: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    /// Set for the Speaking section of a full mock test: finishing returns to the mock instead of showing the result.
    var mockId: String? = nil
    @State private var exam: LiveExam?
    @State private var showCaptions = false
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
                let e = LiveExam(api: api, mockId: mockId)
                exam = e
                await e.prepare()
            }
        }
        .onDisappear { exam?.teardown() }
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
        case let .finished(ids):
            if mockId != nil { Color.canvas.ignoresSafeArea().onAppear { dismiss() } } else { ResultView(ids: ids) }
        case let .failed(msg):
            ContentUnavailableView {
                Label("The test stopped", systemImage: "exclamationmark.triangle")
            } description: {
                Text(msg)
            } actions: {
                if exam.hasRecordings {
                    Button("Score what was recorded") { exam.scoreRecorded() }.primaryButton()
                } else {
                    Button("Try again") { exam.retry() }.primaryButton()
                }
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
                    if exam.micReady { exam.start() } else { Task { await exam.prepare() } }
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

                if showCaptions && !exam.caption.isEmpty {
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
