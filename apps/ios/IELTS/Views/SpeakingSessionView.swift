import SwiftUI

/// Practice flow (web: components/speaking/SessionFlow.tsx): one recording per prompt (P1 topic / P2 card / P3 set) with
/// "Next question" marks, P2 one minute of prep then a 2 min talk with a hard stop. Each recording is kept on disk
/// (PendingStore), uploaded in the background while you continue, and becomes an attempt sharing a sessionId.
struct SpeakingSessionView: View {
    let mode: SpeakingMode

    private enum Examiner { case idle, asking, cue }
    private enum Phase: Equatable { case loading, ready, prep, recording, finishing, empty, failed(String) }
    private struct UploadItem: Identifiable { let id: String; let label: String }

    private static let prepSeconds = 60
    private static let p2Max = 120.0

    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    @AppStorage("ielts.micHintSeen") private var hintSeen = false
    @State private var items: [Prompt] = []
    @State private var index = 0
    @State private var question = 0
    /// Which question's text the candidate chose to read ("part:q"); a spoken question is heard, not read, as in the real test.
    @State private var shownQ = ""
    @State private var questionStart: TimeInterval = 0
    @State private var windows: [AnswerWindow] = []
    @State private var examinerState: Examiner = .idle
    @State private var examinerPlayer = Player()
    @State private var askGen = 0
    @State private var introduced = -1
    @State private var phase: Phase = .loading
    @State private var recorder = Recorder()
    @State private var micRecorder = Recorder()
    @State private var prepEnd = Date()
    @State private var prepLeft = SpeakingSessionView.prepSeconds
    @State private var notes = ""
    @State private var recId = newSessionId()
    @State private var uploads: [UploadItem] = []
    @State private var sessionId = newSessionId()
    @State private var parent: String?
    @State private var starting = false
    @State private var startError: String?
    @State private var micDenied = false
    @State private var exitOpen = false
    @State private var earlyOpen = false

    private var store: PendingStore { .shared }
    private var current: Prompt? { items.indices.contains(index) ? items[index] : nil }
    private var recording: Bool { phase == .recording }
    private var asking: Bool { examinerState == .asking }
    private var isFull: Bool {
        switch mode {
        case .full: return true
        default: return false
        }
    }

    private func uploadState(_ u: UploadItem) -> UploadState { store.states[u.id] ?? .uploading }
    private func isDone(_ u: UploadItem) -> Bool {
        if case .done = uploadState(u) { return true }
        return false
    }
    private func isFailed(_ u: UploadItem) -> Bool {
        if case .failed = uploadState(u) { return true }
        return false
    }
    private var doneIds: [String] {
        uploads.compactMap { u -> String? in
            if case let .done(id) = uploadState(u) { return id }
            return nil
        }
    }
    private var allDone: Bool { phase == .finishing && !items.isEmpty && uploads.count == items.count && doneIds.count == uploads.count }
    private var notDone: Bool { uploads.contains { !isDone($0) } }
    private var anyFailed: Bool { uploads.contains { isFailed($0) } }

    var body: some View {
        Group {
            if allDone { ResultView(ids: doneIds) } else { content }
        }
        .navigationTitle(navTitle)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(!allDone)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                if !allDone {
                    Button("Exit") {
                        if recording || phase == .prep || index > 0 || notDone { exitOpen = true } else { leave() }
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if items.count > 1 && (phase == .ready || phase == .prep || phase == .recording) {
                    Text("\(index + 1)/\(items.count)").font(.caption.monospacedDigit()).foregroundStyle(.muted)
                        .accessibilityLabel("Part \(index + 1) of \(items.count)")
                }
            }
        }
        .toolbar(allDone ? .visible : .hidden, for: .tabBar)
        .confirmationDialog("Leave this test?", isPresented: $exitOpen, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { leave() }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text(exitMessage)
        }
        .micDeniedAlert($micDenied)
        .onDisappear { discardLive() }
        .onDemoTour { s in // demo auto-tour (Demo/DemoTour.swift)
            switch s {
            case "prep" where phase == .ready:
                prepLeft = Self.prepSeconds
                prepEnd = Date().addingTimeInterval(Double(Self.prepSeconds))
                phase = .prep
            case "record": Task { await startRecording() }
            case "next" where phase == .recording: nextQuestion()
            default: if s.hasPrefix("n:") { notes += String(s.dropFirst(2)) }
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView("Loading questions").frame(maxWidth: .infinity, maxHeight: .infinity).task { await load() }
        case .empty:
            ContentUnavailableView {
                Label("No questions available yet", systemImage: "mic.slash")
            } description: {
                Text("The prompt bank has no speaking prompts for this part. Seed the bank, then try again.")
            } actions: {
                Button("Back to speaking") { dismiss() }.secondaryButton()
            }
        case let .failed(message):
            ContentUnavailableView {
                Label("Couldn't load the questions", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { phase = .loading }.primaryButton()
            }
        case .finishing:
            finishing
        default:
            if let p = current { exam(p) }
        }
    }

    private var navTitle: String {
        if allDone { return "Results" }
        switch phase {
        case .finishing: return "Saving your answers"
        case .loading, .empty, .failed: return "Speaking"
        default: return label(index)
        }
    }

    /// "Part 1, 2 of 3" for a Part 1 topic in a multi-topic test, else "Part N".
    private func label(_ i: Int) -> String {
        guard items.indices.contains(i) else { return "Speaking" }
        let p1Count = items.filter { $0.part == 1 }.count
        if items[i].part == 1 && p1Count > 1 {
            return "Part 1, \(items.prefix(i + 1).filter { $0.part == 1 }.count) of \(p1Count)"
        }
        return "Part \(items[i].part)"
    }

    private var exitMessage: String {
        let parts: [String?] = [
            recording ? "The answer you are recording now will be discarded." : nil,
            notDone ? "Recordings that have not uploaded stay on this device. Upload them from the Speaking page." : nil,
            "Answers already uploaded are still analysed.",
        ]
        return parts.compactMap { $0 }.joined(separator: " ")
    }

    private func load() async {
        do {
            switch mode {
            case .full:
                let t: SpeakingTest = try await api.get("/api/speaking/test")
                items = t.part1 + [t.part2, t.part3]
            case let .part(n):
                let p: Prompt = try await api.get("/api/prompts/random", query: ["skill": "speaking", "part": String(n)])
                items = [p]
            case let .prompt(id, parentId):
                let p: Prompt = try await api.get("/api/prompts/\(id)")
                items = [p]
                parent = parentId
            }
            phase = .ready
        } catch is CancellationError {
        } catch let e as APIError where e.status == 404 {
            phase = .empty
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    // MARK: Exam screen

    @ViewBuilder
    private func exam(_ p: Prompt) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if p.part == 2 { CueCardView(prompt: p) } else { questionHeader(p) }
                if let startError { ErrorLine(message: startError) }
                switch phase {
                case .recording: recordingPanel(p)
                case .prep: prepPanel
                default: readyPanel(p)
                }
                if index == 0 && phase == .ready { MicCheckStep(mic: micRecorder, denied: $micDenied) }
                if anyFailed {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("An earlier answer didn't upload", systemImage: "exclamationmark.triangle.fill")
                            .font(.headline).foregroundStyle(Color.warnText)
                        Text("Keep going. You can retry it at the end.").font(.subheadline).foregroundStyle(.muted)
                    }
                    .card()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
        .demoScroll()
        .scrollDismissesKeyboard(.interactively)
        .background(Color.canvas)
        .safeAreaInset(edge: .bottom) { controls(p) }
        // Part 2 is introduced as soon as its screen shows; Part 1 and 3 after the first start by themselves (the mic tap of the first part is the gesture).
        .task(id: "\(index)-\(phase == .ready)") {
            guard phase == .ready, introduced != index, index > 0 || p.part == 2 else { return }
            introduced = index
            // unstructured: this task is cancelled when the phase changes, which must not cut the examiner off
            Task { if p.part == 2 { await ask([p.audio?.lead, line(p, p.questions[0])], resume: false) } else { await startRecording() } }
        }
        .onChange(of: recorder.elapsed) { _, e in
            // P2 hard stop at 2:00; 15 min caps the energy timeline (20k × 50 ms) for any part.
            guard phase == .recording, let cur = current else { return }
            if (cur.part == 2 && e >= Self.p2Max) || e >= 900 { finishPart() }
        }
    }

    private func questionText(_ p: Prompt) -> String {
        p.questions.indices.contains(question) ? p.questions[question] : (p.questions.last ?? p.title)
    }

    /// Part 3 rows carry two sub-topic headings in bullets; the first half of the questions sits under the first.
    private func subTopic(_ p: Prompt) -> String? {
        guard p.part == 3, let b = p.bullets, b.count == 2, !p.questions.isEmpty else { return nil }
        return b[min(1, question * 2 / p.questions.count)]
    }

    private func questionHeader(_ p: Prompt) -> some View {
        let n = p.questions.count
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text(subTopic(p) ?? p.topic ?? p.title).font(.caption.weight(.medium)).foregroundStyle(.ink)
                Spacer(minLength: 8)
                if n > 1 {
                    VStack(alignment: .trailing, spacing: 6) {
                        Text("Question \(question + 1) of \(n)").font(.caption.monospacedDigit()).foregroundStyle(.muted)
                        HStack(spacing: 4) {
                            ForEach(0..<n, id: \.self) { i in
                                RoundedRectangle(cornerRadius: 2).fill(segmentColor(i)).frame(width: 20, height: 4)
                            }
                        }
                        .accessibilityHidden(true)
                    }
                }
            }
            if line(p, questionText(p))?.url != nil && shownQ != "\(index):\(question)" {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Listen to the examiner", systemImage: "speaker.wave.2.fill")
                        .font(.display(.title))
                        .foregroundStyle(.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityLabel(questionText(p))
                        .accessibilityAddTraits(.isHeader)
                    Button { shownQ = "\(index):\(question)" } label: {
                        Text("Show the question").underline().font(.subheadline.weight(.medium)).foregroundStyle(.brand)
                    }
                }
            } else {
                Text(questionText(p))
                    .font(.display(.title))
                    .foregroundStyle(.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }

    private func segmentColor(_ i: Int) -> Color {
        i < question ? Color.ink.opacity(0.6) : i == question ? Color.brand : Color.muted.opacity(0.35)
    }

    // MARK: Ready

    @ViewBuilder
    private func readyPanel(_ p: Prompt) -> some View {
        if p.part == 2 {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 40) {
                    stat("Preparation", clock(Self.prepSeconds))
                    stat("Speaking", "up to \(clock(Int(Self.p2Max)))")
                }
                Text("Talk for 1 to 2 minutes about the card. You get 1 minute to prepare and can make notes. Recording stops at 2:00.")
                    .foregroundStyle(.muted)
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 20) {
                    Button { Task { await startRecording() } } label: {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 34, weight: .semibold))
                            .frame(width: 88, height: 88)
                            .foregroundStyle(Color.onBrand)
                            .modifier(RecordFill())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Start recording")
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Press to start recording").font(.headline)
                        Text(p.part == 1
                             ? "Short answers about you. The examiner reads each question aloud, then you speak. Press Next question when you have answered."
                             : "A discussion linked to Part 2. The examiner reads each question aloud. Develop each answer with reasons and examples, then press Next question.")
                            .font(.caption).foregroundStyle(.muted)
                    }
                }
                if !hintSeen {
                    Label("Tap to start, your whole Part \(p.part) is one recording.", systemImage: "info.circle")
                        .font(.caption).foregroundStyle(.brand)
                }
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.muted)
            Text(value).font(.display(.title3)).foregroundStyle(.ink)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Prep (Part 2)

    private var prepPanel: some View {
        HStack(alignment: .top, spacing: 20) {
            ring(Double(prepLeft) / Double(Self.prepSeconds), tone: prepLeft <= 10 ? Color.warn : Color.brand, size: 96, line: 6) {
                Text(clock(prepLeft)).font(Font.system(.title3, design: .default, weight: .semibold).monospacedDigit())
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Preparation time left")
            .accessibilityValue(clock(prepLeft))
            VStack(alignment: .leading, spacing: 6) {
                Text("Notes").font(.subheadline.weight(.medium))
                TextEditor(text: $notes)
                    .font(.system(.callout, design: .serif))
                    .frame(minHeight: 120)
                    .scrollContentBackground(.hidden)
                    .autocorrectionDisabled()
                    .padding(8)
                    .background(Color.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.line))
                Text("Only you see these. Recording starts automatically when the minute is up.")
                    .font(.caption).foregroundStyle(.muted)
            }
        }
        .task {
            // Wall clock, so a backgrounded or throttled app still ends prep on time.
            while phase == .prep {
                prepLeft = max(0, Int(ceil(prepEnd.timeIntervalSinceNow)))
                if prepLeft == 0 { await startRecording(); return }
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
        }
    }

    // MARK: Recording

    @ViewBuilder
    private func recordingPanel(_ p: Prompt) -> some View {
        if examinerState == .asking {
            Label("The examiner is asking the question", systemImage: "speaker.wave.2.fill")
                .font(.headline).foregroundStyle(Color.brand)
                .accessibilityAddTraits(.updatesFrequently)
        } else {
            recordingBody(p)
        }
    }

    private func recordingBody(_ p: Prompt) -> some View {
        let seconds = max(0, p.part == 2 ? recorder.elapsed : recorder.elapsed - questionStart)
        let whole = Int(seconds)
        let maxSeconds: Double = p.part == 2 ? Self.p2Max : p.part == 3 ? 60 : 40
        return VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 8) {
                Circle().fill(Color.bad).frame(width: 10, height: 10)
                Text("Recording").font(.subheadline.weight(.medium)).foregroundStyle(Color.bad)
                if examinerState == .cue { Chip(text: "Speak now", color: .goodText) }
            }
            .accessibilityElement(children: .combine)

            HStack(alignment: .center, spacing: 20) {
                ring(seconds / maxSeconds, tone: zoneTone(p.part, seconds), size: 112, line: 6) {
                    Text(clock(whole)).font(Font.display(.title).monospacedDigit())
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Answer time")
                .accessibilityValue(clock(whole))
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .center, spacing: 3) {
                        ForEach(Array(recorder.levels.suffix(30).enumerated()), id: \.offset) { _, l in
                            Capsule().fill(Color.brand.opacity(0.75)).frame(width: 3, height: 4 + 36 * l)
                        }
                    }
                    .frame(height: 40)
                    .accessibilityHidden(true)
                    HStack(spacing: 6) {
                        paceChip
                        if p.part == 2 { Chip(text: "Stops at \(clock(Int(Self.p2Max)))", color: .ink) }
                    }
                }
            }

            Text(zoneHint(p.part, whole)).font(.caption).foregroundStyle(.muted).accessibilityAddTraits(.updatesFrequently)

            // Keeps its height so the layout does not jump when it appears.
            Label("Keep going. Add a reason or an example.", systemImage: "lightbulb")
                .font(.subheadline.weight(.medium)).foregroundStyle(.brand)
                .opacity(recorder.silence >= 3 ? 1 : 0)
                .accessibilityHidden(recorder.silence < 3)

            if p.part == 2 && !notes.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your notes").font(.caption).foregroundStyle(.muted)
                    Text(notes).font(.system(.callout, design: .serif))
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    /// Rough live pace from energy peaks (web WpmPill). Waits for a few seconds of confident speech.
    @ViewBuilder private var paceChip: some View {
        let wpm = recorder.liveWpm
        if recorder.elapsed < 5 || wpm == 0 {
            Chip(text: "Measuring pace…", color: .ink)
        } else if wpm >= 120 && wpm <= 170 {
            Chip(text: "~\(wpm) wpm, steady", color: .goodText)
        } else {
            Chip(text: "~\(wpm) wpm, \(wpm < 120 ? "slow" : "fast")", color: .warnText)
        }
    }

    private func ring<C: View>(_ value: Double, tone: Color, size: CGFloat, line: CGFloat, @ViewBuilder center: () -> C) -> some View {
        ZStack {
            Circle().stroke(Color.muted.opacity(0.25), lineWidth: line)
            Circle().trim(from: 0, to: max(0, min(1, value)))
                .stroke(tone, style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(-90))
            center()
        }
        .frame(width: size, height: size)
    }

    /// Ring colour by the part's target zone (web zoneTone; P2 is only green from 1:30). Teal = keep going, green = in zone, amber = long.
    private func zoneTone(_ part: Int, _ s: Double) -> Color {
        switch part {
        case 2: return s < 60 ? Color.brand : s < 90 ? Color.warn : s <= 120 ? Color.good : Color.warn
        case 3: return s < 30 ? Color.brand : s <= 60 ? Color.good : Color.warn
        default: return s < 15 ? Color.brand : s <= 40 ? Color.good : Color.warn
        }
    }

    private func zoneHint(_ part: Int, _ s: Int) -> String {
        let lo = part == 2 ? 60 : part == 3 ? 30 : 15
        let hi = part == 2 ? 120 : part == 3 ? 60 : 40
        if s < lo { return "Aim for \(lo)-\(hi) s" }
        if part == 2 && s < 90 { return "Good. Keep going to 1:30 or more" }
        return s <= hi ? "In the target zone" : "Time to wrap up"
    }

    // MARK: Floating controls

    @ViewBuilder
    private func controls(_ p: Prompt) -> some View {
        switch phase {
        case .recording:
            if p.part != 2 && question + 1 < p.questions.count {
                controlBar {
                    Button { earlyOpen = true } label: { Text("Finish part early").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                        .disabled(asking)
                        .confirmationDialog("Finish with \(question + 1) of \(p.questions.count) answered?", isPresented: $earlyOpen, titleVisibility: .visible) {
                            Button("Finish now") { finishPart() }
                            Button("Keep going", role: .cancel) {}
                        } message: {
                            let left = p.questions.count - question - 1
                            Text("Your whole Part \(p.part) is one recording, so finishing now ends it and skips the last \(left) \(left == 1 ? "question" : "questions").")
                        }
                    Button { nextQuestion() } label: { Text("Next question").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                        .disabled(asking)
                }
            } else {
                controlBar {
                    Button { finishPart() } label: {
                        Label(index + 1 < items.count ? "Finish and continue" : "Finish", systemImage: "checkmark").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(asking)
                }
            }
        case .prep:
            controlBar {
                Button { Task { await startRecording() } } label: { Text("Start speaking now").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
            }
        case .ready where p.part == 2:
            controlBar {
                Button {
                    prepLeft = Self.prepSeconds
                    prepEnd = Date().addingTimeInterval(Double(Self.prepSeconds))
                    phase = .prep
                } label: { Text("Start 1-minute preparation").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    .disabled(asking)
            }
        default:
            EmptyView()
        }
    }

    /// Floating recorder controls: solid buttons on one glass capsule (never glass on glass).
    private func controlBar<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        HStack(spacing: 8) { content() }
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .padding(6)
            .glassBar(Capsule())
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
    }

    // MARK: Saving your answers

    private var finishing: some View {
        let total = items.count
        let failed = uploads.filter { isFailed($0) }
        let done = doneIds.count
        let progress = !failed.isEmpty
            ? "\(done) of \(total) uploaded, \(failed.count) failed"
            : done == total ? "\(total) of \(total) uploaded" : "Uploading \(min(done + 1, total)) of \(total)"
        return ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(failed.isEmpty ? "Uploading your answers" : "Some answers need another try")
                        .font(.display(.title)).foregroundStyle(.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(failed.isEmpty ? "Analysis starts as soon as each of the \(total) recordings arrives." : "Your recordings are still here. Retry to send them.")
                        .foregroundStyle(.muted)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text(progress).font(.caption.monospacedDigit()).foregroundStyle(.muted)
                    ProgressView(value: Double(done), total: Double(max(total, 1)))
                        .tint(failed.isEmpty ? Color.brand : Color.warn)
                        .accessibilityLabel("\(done) of \(total) recordings uploaded")
                }
                VStack(spacing: 0) {
                    ForEach(Array(uploads.enumerated()), id: \.element.id) { i, u in
                        if i > 0 { Divider() }
                        uploadRow(u)
                    }
                }
                .card(padding: 0)
                if !failed.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Upload failed", systemImage: "exclamationmark.triangle.fill").font(.headline).foregroundStyle(.bad)
                        Text("Your recording is saved on this device. If it keeps failing, leave and upload it later from the Speaking page, even after a restart.")
                            .font(.subheadline).foregroundStyle(.muted)
                        Button("Retry upload") { failed.forEach { retry($0) } }.primaryButton()
                    }
                    .card()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
        .demoScroll()
        .background(Color.canvas)
    }

    private func uploadRow(_ u: UploadItem) -> some View {
        let state = uploadState(u)
        return HStack(spacing: 12) {
            switch state {
            case .done:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.goodText).accessibilityLabel("Uploaded")
            case .failed:
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.bad).accessibilityLabel("Failed")
            case .uploading:
                ProgressView().accessibilityLabel("Uploading")
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(u.label).font(.subheadline).lineLimit(2)
                if case .uploading = state { Text("Uploading…").font(.caption).foregroundStyle(.muted) }
                if case let .failed(message) = state { Text(message).font(.caption).foregroundStyle(.bad) }
            }
            Spacer(minLength: 8)
            if case .failed = state {
                Button { retry(u) } label: { Label("Retry", systemImage: "arrow.clockwise") }.secondaryButton()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
    }

    private func retry(_ u: UploadItem) {
        if let rec = store.items.first(where: { $0.id == u.id }) { store.start(rec, api: api) }
    }

    // MARK: Actions

    private func startRecording() async {
        guard (phase == .ready || phase == .prep), !starting else { return }
        starting = true
        defer { starting = false }
        startError = nil
        if micRecorder.isRecording { _ = micRecorder.stop() }
        store.prepare()
        do {
            guard try await recorder.start(to: store.audioURL(recId), paused: current?.part != 2) else {
                micDenied = true
                phase = .ready
                return
            }
            hintSeen = true
            windows = []
            question = 0
            questionStart = 0
            phase = .recording
            guard let p = current else { return }
            if p.part == 2 {
                examinerState = .cue // the card was introduced before the preparation minute
                Task { try? await Task.sleep(for: .seconds(2.5)); if examinerState == .cue { examinerState = .idle } }
            } else {
                let greeting = index == 0 && p.part == 1 && items.count > 1 ? p.audio?.intro : nil
                await ask([greeting, p.audio?.lead, line(p, p.questions[0])])
            }
        } catch {
            startError = error.localizedDescription
            phase = .ready
        }
    }

    private func nextQuestion() {
        guard !asking, let p = current else { return }
        windows.append(AnswerWindow(q: question, startMs: Int(questionStart * 1000), endMs: Int(recorder.clock * 1000)))
        question += 1
        let next = line(p, p.questions[min(question, p.questions.count - 1)])
        Task { await ask([next]) }
    }

    private func line(_ p: Prompt, _ text: String) -> AudioLine? { p.audio?.questions?.first { $0.text == text } }

    /// The examiner reads `lines` (microphone held meanwhile, so the recording holds only the candidate), then the answer window opens
    /// with a "Speak now" cue. No pause, seek or speed. A line without audio, a failed download or a bad file never blocks the test.
    private func ask(_ lines: [AudioLine?], resume: Bool = true) async {
        askGen += 1
        let gen = askGen
        examinerPlayer.stop()
        let urls = lines.compactMap { $0?.url }.compactMap(URL.init(string:))
        if !urls.isEmpty {
            examinerState = .asking
            recorder.pause()
            for u in urls {
                guard gen == askGen else { return }
                if let (data, _) = try? await URLSession.shared.data(from: u) { await examinerPlayer.playToEnd(data) }
            }
        }
        guard gen == askGen else { return }
        guard resume else { examinerState = .idle; return }
        recorder.resume()
        questionStart = recorder.clock
        examinerState = .cue
        try? await Task.sleep(for: .seconds(2.5))
        if gen == askGen, examinerState == .cue { examinerState = .idle }
    }

    /// Stops, keeps the recording on disk, uploads it in the background and moves on.
    private func finishPart() {
        guard phase == .recording, !asking, let p = current else { return }
        windows.append(AnswerWindow(q: question, startMs: Int(questionStart * 1000), endMs: Int(recorder.clock * 1000)))
        askGen += 1
        examinerState = .idle
        let r = recorder.stop()
        let rec = PendingRecording(id: recId, promptId: p.id, part: p.part,
                                   label: "\(label(index)): \((p.topic ?? p.title).trimmingCharacters(in: CharacterSet(charactersIn: ".")))", createdAt: Date(),
                                   durationMs: r.durationMs, energy: Array(r.energy.prefix(20000)), marks: Array(windows.map(\.startMs).prefix(200)), segments: windows,
                                   sessionId: isFull ? sessionId : nil, parentAttemptId: parent)
        store.add(rec)
        uploads.append(UploadItem(id: rec.id, label: rec.label))
        store.start(rec, api: api)
        if index + 1 < items.count {
            index += 1
            question = 0
            notes = ""
            recId = newSessionId()
            phase = .ready
        } else {
            phase = .finishing
        }
    }

    /// Drop a recording in progress (it was never kept) and the mic test.
    private func discardLive() {
        askGen += 1
        examinerPlayer.stop()
        examinerState = .idle
        if recorder.isRecording {
            _ = recorder.stop()
            try? FileManager.default.removeItem(at: store.audioURL(recId))
        }
        if micRecorder.isRecording { _ = micRecorder.stop() }
    }

    private func leave() {
        discardLive()
        dismiss()
    }
}

/// Brand-tinted glass on iOS 26 (a floating control), solid brand before.
private struct RecordFill: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular.tint(Color.brand).interactive(), in: Circle())
        } else {
            content.background(Color.brand, in: Circle())
        }
    }
}

/// Optional mic check before the first recording, on its own recorder (web MicCheck): says "clearly" only after ~1 s of speech-level input.
private struct MicCheckStep: View {
    let mic: Recorder
    @Binding var denied: Bool
    @State private var loud = 0
    @State private var soft = 0
    @State private var opening = false

    private static let segments = 24

    private var verdict: (text: String, color: Color) {
        if loud >= 20 { return ("We can hear you clearly.", Color.goodText) }
        if soft >= 20 { return ("Very quiet. Move closer to the microphone or speak up.", Color.warnText) }
        return ("Say a few words, like your name.", Color.muted)
    }

    private var barColor: Color { loud >= 20 ? Color.good : soft >= 20 ? Color.warn : Color.brand }

    var body: some View {
        if mic.isRecording {
            let v = verdict
            let lit = Int((min(1, mic.level * 1.8) * Double(Self.segments)).rounded())
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(0..<Self.segments, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(i < lit ? barColor : Color.surface2)
                            .frame(height: 24 * (0.4 + 0.6 * Double(i) / Double(Self.segments)))
                    }
                }
                .frame(height: 24)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Microphone level")
                .accessibilityValue("\(Int(mic.level * 100)) percent")
                Text(v.text).font(.subheadline.weight(loud >= 20 || soft >= 20 ? .medium : .regular)).foregroundStyle(v.color)
                Button("Looks good") { _ = mic.stop() }.secondaryButton()
            }
            .card()
            .onChange(of: mic.elapsed) { _, _ in
                let e = mic.energy.last ?? 0
                if e > Recorder.voice { loud += 1 } else if e > 30 { soft += 1 }
            }
        } else {
            Button {
                Task { await start() }
            } label: {
                Label("Check your microphone first", systemImage: "mic")
            }
            .secondaryButton()
            .disabled(opening)
        }
    }

    private func start() async {
        opening = true
        defer { opening = false }
        loud = 0
        soft = 0
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mic-check.m4a")
        if let ok = try? await mic.start(to: url), !ok { denied = true }
    }
}

/// Part 2 cue card, set as reading material: the topic in the serif, the prompt text, and the "You should say" bullets.
struct CueCardView: View {
    let prompt: Prompt

    private var bullets: [String] { prompt.bullets ?? [] }

    /// The server's body repeats the title and ends with a "You should say:" lead; the bullets get their own heading, so drop both.
    private var intro: String {
        var text = prompt.body
        if text.hasPrefix(prompt.title) { text = String(text.dropFirst(prompt.title.count)) }
        let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return lines.filter { line in
            guard !bullets.isEmpty else { return true }
            return line.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ": ")) != "you should say"
        }.joined(separator: "\n")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Cue card").font(.caption).foregroundStyle(.muted)
            Text(prompt.title).font(.display(.title3)).foregroundStyle(.ink)
            if !bullets.isEmpty {
                Text("You should say:").font(.subheadline.weight(.medium)).padding(.top, 6)
                ForEach(Array(bullets.enumerated()), id: \.offset) { _, b in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("•").foregroundStyle(.muted)
                        Text(b).font(.system(.body, design: .serif))
                    }
                }
            }
            // Cambridge layout: the "and explain ..." line closes the card, then the standard instruction.
            if !intro.isEmpty { Text(intro).font(.system(.body, design: .serif)).foregroundStyle(.ink).padding(.top, 2) }
            if !prompt.body.contains("You will have to talk") {
                Text("You will have to talk about the topic for one to two minutes. You have one minute to think about what you are going to say. You can make some notes to help you if you wish.")
                    .font(.caption).foregroundStyle(.muted).padding(.top, 4)
            }
        }
        .card(padding: 20)
    }
}
