import SwiftUI

/// Practice flow: one recording per prompt (P1 topic / P2 card / P3 set) with "next question" marks,
/// P2 60 s prep then a 2 min talk with a hard stop. Each recording becomes an attempt sharing a sessionId.
struct SpeakingSessionView: View {
    let mode: SpeakingMode

    private enum Stage: Equatable { case loading, ready, prep, recording, uploading, uploadFailed(String), failed(String), done }

    @Environment(APIClient.self) private var api
    @State private var items: [Prompt] = []
    @State private var index = 0
    @State private var question = 0
    @State private var questionStart: TimeInterval = 0
    @State private var marks: [Int] = []
    @State private var stage: Stage = .loading
    @State private var recorder = Recorder()
    @State private var prepLeft = 60
    @State private var notes = ""
    @State private var ids: [String] = []
    @State private var sessionId = newSessionId()
    @State private var parent: String?
    @State private var pending: (durationMs: Int, energy: [Int])?
    @State private var micDenied = false

    private var current: Prompt? { items.indices.contains(index) ? items[index] : nil }
    private var fileURL: URL { FileManager.default.temporaryDirectory.appendingPathComponent("speaking-\(sessionId)-\(index).m4a") }

    var body: some View {
        Group {
            switch stage {
            case .loading: ProgressView("Preparing your test…").task { await load() }
            case let .failed(msg):
                ContentUnavailableView { Label("Something went wrong", systemImage: "exclamationmark.triangle") } description: { Text(msg) } actions: {
                    Button("Try again") { stage = .loading }.buttonStyle(.borderedProminent)
                }
            case .done: ResultView(ids: ids)
            default: if let p = current { exam(p) }
            }
        }
        .navigationTitle(stage == .done ? "Results" : title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(stage == .recording || stage == .uploading || stage == .prep)
        .toolbar(stage == .done ? .visible : .hidden, for: .tabBar)
        .micDeniedAlert($micDenied)
        .onDisappear { if recorder.isRecording { _ = recorder.stop() } }
    }

    private var title: String {
        guard let p = current else { return "Speaking" }
        let p1Count = items.filter { $0.part == 1 }.count
        if p.part == 1 && p1Count > 1 { return "Part 1 · Topic \(index + 1) of \(p1Count)" }
        return ["Part 1 · Interview", "Part 2 · Long turn", "Part 3 · Discussion"][max(0, min(2, p.part - 1))]
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
            stage = .ready
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    // MARK: Exam screen

    @ViewBuilder
    private func exam(_ p: Prompt) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                if p.part == 2 {
                    CueCardView(prompt: p)
                } else if stage == .recording {
                    Text(p.questions[min(question, p.questions.count - 1)])
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .card(padding: 24)
                        .id(question)
                        .transition(.push(from: .trailing))
                    Text("Question \(question + 1) of \(p.questions.count)").font(.subheadline).foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        if let topic = p.topic { Chip(text: topic.capitalized, color: .brand) }
                        Text(p.part == 1 ? "The examiner will ask about familiar topics. Answer naturally in 2–4 sentences."
                             : "Discussion questions on broader, abstract ideas. Develop each answer with reasons and examples.")
                            .foregroundStyle(.secondary)
                        Text("\(p.questions.count) question\(p.questions.count == 1 ? "" : "s") · one recording, tap Next between questions.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .card()
                }
                switch stage {
                case .ready: startButton(p)
                case .prep: prep
                case .recording: recording(p)
                case .uploading: ProgressView("Uploading your answer…").padding(.top, 30)
                case let .uploadFailed(msg):
                    VStack(spacing: 12) {
                        ErrorLine(message: msg)
                        Button("Retry upload") { Task { await upload() } }.buttonStyle(.borderedProminent)
                    }
                default: EmptyView()
                }
            }
            .padding()
            .animation(.snappy, value: question)
        }
        .background(.canvas)
    }

    private func startButton(_ p: Prompt) -> some View {
        VStack(spacing: 12) {
            Button {
                if p.part == 2 { prepLeft = 60; stage = .prep } else { Task { await startRecording() } }
            } label: {
                Image(systemName: p.part == 2 ? "timer" : "mic.fill")
                    .font(.system(size: 40, weight: .semibold))
                    .frame(width: 110, height: 110)
                    .background(.brand, in: Circle())
                    .foregroundStyle(.white)
            }
            .accessibilityLabel(p.part == 2 ? "Start one minute preparation" : "Start recording")
            Text(p.part == 2 ? "Start 1-minute preparation" : "Tap to start recording").foregroundStyle(.secondary)
        }
        .padding(.top, 20)
    }

    private var prep: some View {
        VStack(spacing: 12) {
            Text(clock(prepLeft)).font(.system(size: 48, weight: .bold, design: .rounded).monospacedDigit())
            Text("Preparation — make notes, recording starts automatically.").font(.subheadline).foregroundStyle(.secondary)
            TextEditor(text: $notes)
                .frame(minHeight: 140)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(alignment: .topLeading) {
                    if notes.isEmpty { Text("Notes (not graded)").foregroundStyle(.tertiary).padding(14).allowsHitTesting(false) }
                }
            Button("Start speaking now") { Task { await startRecording() } }.buttonStyle(.bordered)
        }
        .task {
            while prepLeft > 0 && stage == .prep {
                try? await Task.sleep(for: .seconds(1))
                guard stage == .prep else { return }
                prepLeft -= 1
            }
            if stage == .prep { await startRecording() }
        }
    }

    private func recording(_ p: Prompt) -> some View {
        let total = recorder.elapsed
        let t = p.part == 2 ? total : total - questionStart
        let zone = zoneColor(part: p.part, t: t)
        let maxT: Double = [40, 120, 60][max(0, min(2, p.part - 1))]
        return VStack(spacing: 18) {
            ZStack {
                Circle().stroke(zone.opacity(0.15), lineWidth: 12)
                Circle().trim(from: 0, to: min(1, t / maxT)).stroke(zone, style: StrokeStyle(lineWidth: 12, lineCap: .round)).rotationEffect(.degrees(-90))
                VStack(spacing: 2) {
                    Text(clock(Int(t))).font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
                    Text(zoneHint(p.part)).font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(width: 180, height: 180)
            .animation(.linear(duration: 0.1), value: t)
            .accessibilityElement(children: .combine)

            HStack(alignment: .center, spacing: 3) {
                ForEach(Array(recorder.levels.enumerated()), id: \.offset) { _, l in
                    Capsule().fill(.brand.opacity(0.7)).frame(width: 3, height: 4 + 40 * l)
                }
            }
            .frame(height: 48)
            .accessibilityHidden(true)

            HStack {
                Chip(text: "~\(recorder.liveWpm) wpm", color: .secondary)
                if recorder.silence >= 3 { Chip(text: "Keep going…", color: .warn).transition(.opacity) }
            }
            .animation(.easeInOut, value: recorder.silence >= 3)

            HStack(spacing: 12) {
                if p.part != 2 && question + 1 < p.questions.count {
                    Button {
                        marks.append(Int(recorder.elapsed * 1000))
                        questionStart = recorder.elapsed
                        question += 1
                    } label: { Label("Next question", systemImage: "arrow.right").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                }
                Button { Task { await finishPart() } } label: {
                    Label(index + 1 < items.count ? "Finish part" : "Finish", systemImage: "stop.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.bad)
            }
            .controlSize(.large)
        }
        .onChange(of: recorder.elapsed) { _, e in
            if p.part == 2 && e >= 120 { Task { await finishPart() } } // hard stop like the real test
            else if e >= 900 { Task { await finishPart() } } // energy timeline cap (20k × 50 ms)
        }
    }

    private func zoneColor(part: Int, t: Double) -> Color {
        switch part {
        case 2: return t < 60 ? .bad : t < 90 ? .warn : .good
        case 3: return t < 30 ? .warn : t <= 60 ? .good : .bad
        default: return t < 15 ? .warn : t <= 40 ? .good : .bad
        }
    }

    private func zoneHint(_ part: Int) -> String { ["Aim 15–40 s", "Aim 1:30–2:00", "Aim 30–60 s"][max(0, min(2, part - 1))] }

    // MARK: Actions

    private func startRecording() async {
        do {
            guard try await recorder.start(to: fileURL) else { micDenied = true; stage = .ready; return }
            marks = [0]
            question = 0
            questionStart = 0
            stage = .recording
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    private func finishPart() async {
        guard stage == .recording else { return }
        pending = recorder.stop()
        await upload()
    }

    private func upload() async {
        guard let p = current, let r = pending else { return }
        stage = .uploading
        do {
            let id = try await api.submitSpeaking(prompt: p, sessionId: sessionId, parentAttemptId: parent, file: fileURL,
                                                  durationMs: r.durationMs, energy: r.energy, marks: marks)
            ids.append(id)
            pending = nil
            notes = ""
            if index + 1 < items.count { index += 1; question = 0; stage = .ready } else { stage = .done }
        } catch {
            stage = .uploadFailed(error.localizedDescription)
        }
    }
}

struct CueCardView: View {
    let prompt: Prompt
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Cue card").font(.caption.weight(.bold)).textCase(.uppercase).foregroundStyle(.brand)
            Text(prompt.title).font(.title3.weight(.semibold))
            if let bullets = prompt.bullets, !bullets.isEmpty {
                Text("You should say:").foregroundStyle(.secondary)
                ForEach(bullets, id: \.self) { b in
                    HStack(alignment: .firstTextBaseline, spacing: 8) { Text("•"); Text(b) }
                }
            }
            if !prompt.body.isEmpty && prompt.body != prompt.title { Text(prompt.body).foregroundStyle(.secondary) }
        }
        .card(padding: 20)
    }
}
