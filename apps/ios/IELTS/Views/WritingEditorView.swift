import SwiftUI
import UIKit

/// Exam-mode writing: countdown (amber ≤ 5 min, red ≤ 1 min), live word count, optional T2 plan pad,
/// auto-submit at 0 (setting) or overtime, draft autosave. Full test = T1 + T2 sharing one 60-minute timer.
struct WritingEditorView: View {
    let mode: WritingMode

    private enum Stage: Equatable { case loading, writing, submitting, failed(String), done }

    @Environment(APIClient.self) private var api
    @State private var prompts: [Prompt] = []
    @State private var texts: [String: String] = [:]
    @State private var plan = ""
    @State private var showPlan = false
    @State private var showPrompt = true
    @State private var task = 0
    @State private var elapsed = 0
    @State private var stage: Stage = .loading
    @State private var submitError: String?
    @State private var confirmSubmit = false
    @State private var pasteToast = false
    @State private var ids: [String] = []
    @State private var parent: String?
    @State private var sessionId = newSessionId()
    @State private var submitted: Set<String> = []

    private var seconds: Int {
        if prompts.count > 1 { return 3600 }
        return prompts.first?.part == 1 ? 1200 : 2400
    }
    private var left: Int { seconds - elapsed }
    private var settings: AppSettings? { api.me?.settings }
    private var current: Prompt? { prompts.indices.contains(task) ? prompts[task] : nil }

    var body: some View {
        Group {
            switch stage {
            case .loading: ProgressView("Loading task…").task { await load() }
            case let .failed(msg):
                ContentUnavailableView { Label("Couldn't load the task", systemImage: "exclamationmark.triangle") } description: { Text(msg) } actions: {
                    Button("Try again") { stage = .loading }.buttonStyle(.borderedProminent)
                }
            case .done: ResultView(ids: ids)
            default: if let p = current { editor(p) }
            }
        }
        .navigationTitle(stage == .done ? "Results" : prompts.count > 1 ? "Writing test" : current.map { "Task \($0.part)" } ?? "Writing")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(stage == .writing || stage == .submitting)
        .toolbar(stage == .done ? .visible : .hidden, for: .tabBar)
        .toolbar {
            if stage == .writing || stage == .submitting {
                ToolbarItem(placement: .topBarLeading) { timer }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Submit") { confirmSubmit = true }.bold().disabled(stage == .submitting)
                }
            }
        }
        .confirmationDialog("Submit for scoring?", isPresented: $confirmSubmit, titleVisibility: .visible) {
            Button("Submit") { Task { await submit() } }
            Button("Keep writing", role: .cancel) {}
        } message: {
            Text(wordSummary)
        }
    }

    private var wordSummary: String {
        prompts.map { "Task \($0.part): \(wordCount(texts[$0.id] ?? "")) words" }.joined(separator: " · ")
    }

    private func load() async {
        do {
            func pick(_ query: [String: String?]) async throws -> Prompt { try await api.get("/api/prompts/random", query: query) }
            switch mode {
            case .full:
                let t1 = try await pick(["skill": "writing", "part": "1", "variant": "academic"])
                let t2 = try await pick(["skill": "writing", "part": "2"])
                prompts = [t1, t2]
            case let .task1(variant):
                let t = try await pick(["skill": "writing", "part": "1", "variant": variant])
                prompts = [t]
            case .task2:
                let t = try await pick(["skill": "writing", "part": "2"])
                prompts = [t]
            case let .prompt(id, parentId):
                let t: Prompt = try await api.get("/api/prompts/\(id)")
                prompts = [t]
                parent = parentId
            }
            for p in prompts { texts[p.id] = UserDefaults.standard.string(forKey: "draft:\(p.id)") ?? "" }
            stage = .writing
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    // MARK: Editor

    private func editor(_ p: Prompt) -> some View {
        VStack(spacing: 0) {
            if prompts.count > 1 {
                Picker("Task", selection: $task) {
                    ForEach(Array(prompts.enumerated()), id: \.offset) { i, p in Text("Task \(p.part)").tag(i) }
                }
                .pickerStyle(.segmented)
                .padding([.horizontal, .top])
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    DisclosureGroup(isExpanded: $showPrompt) {
                        promptView(p).padding(.top, 8)
                    } label: {
                        Text(p.part == 1 ? "Task 1" + (p.variant == "general" ? " · Letter" : "") : "Task 2 · Essay").font(.headline)
                    }
                    .card()
                    if p.part == 2 {
                        DisclosureGroup("Plan (5 min, not graded)", isExpanded: $showPlan) {
                            ExamTextEditor(text: $plan, blockPaste: settings?.blockPaste ?? true, minHeight: 120) { pasteBlocked() }
                        }
                        .card()
                    }
                    ExamTextEditor(text: binding(for: p), blockPaste: settings?.blockPaste ?? true, minHeight: 380) { pasteBlocked() }
                        .card(padding: 8)
                    if let submitError { ErrorLine(message: submitError) }
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            wordBar(p)
        }
        .background(.canvas)
        .overlay(alignment: .top) {
            if pasteToast {
                Label("Pasting is disabled in exam mode", systemImage: "doc.on.clipboard")
                    .font(.subheadline.weight(.semibold)).padding(12)
                    .background(.thinMaterial, in: Capsule()).padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: pasteToast)
        .overlay { if stage == .submitting { ProgressView("Submitting…").padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)) } }
        .task {
            while !Task.isCancelled && stage != .done {
                try? await Task.sleep(for: .seconds(1))
                guard stage == .writing else { continue }
                elapsed += 1
                if left == 0 && settings?.writingAutoSubmit != false { await submit() }
            }
        }
    }

    private func binding(for p: Prompt) -> Binding<String> {
        Binding(get: { texts[p.id] ?? "" }, set: { v in
            texts[p.id] = v
            UserDefaults.standard.set(v, forKey: "draft:\(p.id)") // autosave draft
        })
    }

    @ViewBuilder
    private func promptView(_ p: Prompt) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(p.body).font(.system(.body, design: .serif))
            if let bullets = p.bullets, !bullets.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("In your letter:").foregroundStyle(.secondary)
                    ForEach(bullets, id: \.self) { Text("• \($0)") }
                }
            }
            if let chart = p.chartSpec { ChartView(spec: chart) }
            if let img = p.imageUrl, let url = URL(string: img) {
                AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { ProgressView().frame(height: 200) }
            }
            Text(p.part == 1 ? "Write at least 150 words." : "Write at least 250 words.").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var timer: some View {
        let color: Color = left <= 60 ? .bad : left <= 300 ? .warn : .primary
        return Label(left >= 0 ? clock(left) : "+\(clock(-left)) overtime", systemImage: "timer")
            .font(.headline.monospacedDigit())
            .foregroundStyle(color)
            .accessibilityLabel(left >= 0 ? "\(left / 60) minutes left" : "Overtime")
    }

    private func wordBar(_ p: Prompt) -> some View {
        let n = wordCount(texts[p.id] ?? "")
        let min = p.part == 1 ? 150 : 250
        return HStack {
            Text("\(n) words").font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(n < min ? Color.bad : Color.good)
            Text("/ \(min) minimum").font(.subheadline).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal).padding(.vertical, 10)
        .background(.bar)
    }

    private func pasteBlocked() {
        pasteToast = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            pasteToast = false
        }
    }

    // MARK: Submit

    private func submit() async {
        guard stage == .writing else { return }
        let filled = prompts.filter { !(texts[$0.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        // An auto-submit with nothing written still scores (Band 1) so the timer can't be gamed.
        let toSend = filled.isEmpty ? Array(prompts.suffix(1)) : filled
        stage = .submitting
        submitError = nil
        do {
            for p in toSend where !submitted.contains(p.id) {
                var body: [String: Any] = ["promptId": p.id, "skill": "writing", "part": p.part, "mode": prompts.count > 1 ? "exam" : "practice",
                                           "sessionId": sessionId, "text": texts[p.id] ?? ""]
                if let parent { body["parentAttemptId"] = parent }
                let created: Created = try await api.send("POST", "/api/attempts", body)
                var submit: [String: Any] = ["durationMs": elapsed * 1000, "overtime": left < 0, "text": texts[p.id] ?? ""]
                if p.part == 2 && !plan.isEmpty { submit["plan"] = plan }
                let _: Empty = try await api.send("POST", "/api/attempts/\(created.id)/submit", submit)
                ids.append(created.id)
                submitted.insert(p.id)
                UserDefaults.standard.removeObject(forKey: "draft:\(p.id)")
            }
            stage = .done
        } catch {
            // Text stays in the editor (and the saved draft) so nothing is lost.
            submitError = error.localizedDescription
            stage = .writing
        }
    }
}

func wordCount(_ s: String) -> Int {
    s.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).filter { $0.contains(where: \.isLetter) || $0.contains(where: \.isNumber) }.count
}

/// UITextView with every assist off (autocorrect, spellcheck, smart punctuation, predictions, Writing Tools) and paste blocked.
struct ExamTextEditor: UIViewRepresentable {
    @Binding var text: String
    var blockPaste: Bool
    var minHeight: CGFloat
    var onPasteBlocked: () -> Void

    final class NoPasteTextView: UITextView {
        var blockPaste = true
        var onPasteBlocked: (() -> Void)?

        override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
            if blockPaste && [#selector(paste(_:)), #selector(pasteAndMatchStyle(_:)), #selector(pasteAndGo(_:)),
                              #selector(pasteAndSearch(_:)), #selector(captureTextFromCamera(_:))].contains(action) {
                return false
            }
            return super.canPerformAction(action, withSender: sender)
        }

        override func paste(_ sender: Any?) {
            if blockPaste { onPasteBlocked?() } else { super.paste(sender) }
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate, UITextDropDelegate {
        var parent: ExamTextEditor
        init(_ parent: ExamTextEditor) { self.parent = parent }

        func textViewDidChange(_ textView: UITextView) { parent.text = textView.text }

        func textDroppableView(_ textDroppableView: UIView & UITextDroppable, proposalForDrop drop: UITextDropRequest) -> UITextDropProposal {
            parent.blockPaste ? UITextDropProposal(operation: .cancel) : UITextDropProposal(operation: .copy)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> NoPasteTextView {
        let tv = NoPasteTextView()
        tv.delegate = context.coordinator
        tv.textDropDelegate = context.coordinator
        tv.autocorrectionType = .no
        tv.spellCheckingType = .no
        tv.autocapitalizationType = .none
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        tv.smartInsertDeleteType = .no
        tv.inlinePredictionType = .no
        tv.textContentType = nil
        if #available(iOS 18.0, *) {
            tv.writingToolsBehavior = .none
            tv.mathExpressionCompletionType = .no
        }
        tv.font = UIFont(descriptor: UIFontDescriptor.preferredFontDescriptor(withTextStyle: .body).withDesign(.serif) ?? UIFontDescriptor.preferredFontDescriptor(withTextStyle: .body), size: 0)
        tv.adjustsFontForContentSizeCategory = true
        tv.backgroundColor = .clear
        tv.isScrollEnabled = false
        tv.textContainerInset = UIEdgeInsets(top: 8, left: 4, bottom: 8, right: 4)
        tv.accessibilityLabel = "Answer"
        return tv
    }

    func updateUIView(_ tv: NoPasteTextView, context: Context) {
        context.coordinator.parent = self
        tv.blockPaste = blockPaste
        tv.onPasteBlocked = onPasteBlocked
        if tv.text != text { tv.text = text }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: NoPasteTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 320
        let h = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        return CGSize(width: width, height: max(minHeight, h))
    }
}
