import SwiftUI
import UIKit

/// Exam-mode writing (web: WritingExam.tsx, WritingEditor.tsx). Wall-clock countdown (amber at 5 min, red at 1 min),
/// toasts at 5 and 1 minutes, auto-submit at 0 (setting) or overtime, essay and plan autosaved per prompt,
/// paste blocked. Full test = Task 1 + Task 2 sharing one 60-minute clock.
struct WritingEditorView: View {
    let mode: WritingMode

    private enum Stage: Equatable { case loading, writing, submitting, failed(String), done }

    private struct Toast: Equatable {
        let id = UUID()
        let text: String
        let tint: Color
    }

    private struct Draft: Codable {
        var text = ""
        var plan = ""
    }

    /// Below this many words a manual submit is refused (web SUBMIT_FLOOR); the server rates 20 words or fewer Band 1 anyway.
    private let submitFloor = 21
    private let planPlaceholder = "Position: …\nBody 1: idea + example\nBody 2: idea + example\nConclusion: …"
    private let answerPlaceholder = "Start writing here. Your draft saves on this device as you type."

    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var prompts: [Prompt] = []
    @State private var texts: [String: String] = [:]
    @State private var plans: [String: String] = [:]
    @State private var showPlan = false
    @State private var showPrompt = true
    @State private var task = 0
    @State private var startedAt = Date()
    @State private var left = 0
    @State private var autoFired = false
    @State private var stage: Stage = .loading
    @State private var submitError: String?
    @State private var submitIssue: CommunityIssue? // no test left, balance used up, busy: the draft stays and the notice says so
    @State private var showSubmit = false
    @State private var showExit = false
    @State private var toast: Toast?
    @State private var ids: [String] = []
    @State private var created: [String: String] = [:] // promptId to attemptId, so a retried submit never duplicates attempts
    @State private var parent: String?
    @State private var sessionId = newSessionId()

    private var multi: Bool { prompts.count > 1 }
    private var seconds: Int {
        if prompts.count > 1 { return 3600 }
        return prompts.first?.part == 1 ? 1200 : 2400
    }
    private var settings: AppSettings? { api.me?.settings }
    private var blockPaste: Bool { settings?.blockPaste ?? true }
    private var autoSubmit: Bool { settings?.writingAutoSubmit != false }
    private var current: Prompt? { prompts.indices.contains(task) ? prompts[task] : nil }

    private func minWords(_ p: Prompt) -> Int { p.part == 1 ? 150 : 250 }
    private func words(_ p: Prompt) -> Int { wordCount(texts[p.id] ?? "") }
    private func taskLabel(_ p: Prompt) -> String { p.part == 2 ? "Task 2" : "Task 1 \(p.variant == "general" ? "General" : "Academic")" }
    private func plural(_ n: Int) -> String { n == 1 ? "1 word" : "\(n) words" }
    private var tooShort: Bool { prompts.contains { words($0) < submitFloor } }
    private var underPrompt: Prompt? { prompts.first { words($0) < minWords($0) } }

    var body: some View {
        Group {
            switch stage {
            case .loading: ProgressView("Loading task…").task { await load() }
            case let .failed(msg):
                ContentUnavailableView { Label("Couldn't load the task", systemImage: "exclamationmark.triangle") } description: { Text(msg) } actions: {
                    Button("Try again") { stage = .loading }.primaryButton()
                }
            case .done: ResultView(ids: ids)
            default: if let p = current { editor(p) }
            }
        }
        .navigationTitle(navTitle)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(stage == .writing || stage == .submitting)
        .onDemoTour { s in // demo auto-tour (Demo/DemoTour.swift): types the essay
            guard s.hasPrefix("t:"), stage == .writing, let p = current else { return }
            textBinding(p).wrappedValue += String(s.dropFirst(2))
        }
        .toolbar(stage == .done ? .visible : .hidden, for: .tabBar)
        .toolbar {
            if stage == .writing || stage == .submitting {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Exit") { showExit = true }.disabled(stage == .submitting)
                }
                ToolbarItem(placement: .principal) { timer }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Submit") { showSubmit = true }.bold().disabled(stage == .submitting)
                }
            }
        }
        .confirmationDialog("Leave this test?", isPresented: $showExit, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { dismiss() }
            Button("Stay", role: .cancel) {}
        } message: {
            Text("Your draft stays saved on this device. The timer restarts when you come back.")
        }
        .sheet(isPresented: $showSubmit) {
            SubmitSheet(
                title: multi ? "Submit both tasks?" : "Submit your answer?",
                rows: prompts.map { SubmitRow(id: $0.id, label: taskLabel($0), words: words($0), min: minWords($0)) },
                note: submitNote,
                tooShort: tooShort,
                underMinimum: underPrompt != nil,
                onKeep: { showSubmit = false },
                onSubmit: {
                    showSubmit = false
                    Task { await submit() }
                }
            )
            .presentationDetents([.medium, .large])
        }
    }

    private var navTitle: String {
        if stage == .done { return "Results" }
        if multi { return "Writing, full test" }
        if let c = current { return "Writing, \(taskLabel(c))" }
        return "Writing"
    }

    private var submitNote: String? {
        if tooShort {
            let each = multi ? " for each task" : ""
            return "Write at least a paragraph\(each) before submitting."
        }
        guard let u = underPrompt else { return nil }
        let marks = u.part == 1 ? "Task Achievement" : "Task Response"
        let more = left > 0 ? ". You have \(clock(left)) left to add more" : ""
        return "Under \(minWords(u)) words costs \(marks) marks\(more)."
    }

    // MARK: Loading and drafts

    private func load() async {
        do {
            func pick(_ query: [String: String?]) async throws -> Prompt { try await api.get("/api/prompts/random", query: query) }
            switch mode {
            case let .full(variant):
                let t1 = try await pick(["skill": "writing", "part": "1", "variant": variant])
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
            for p in prompts {
                let d = loadDraft(p.id)
                texts[p.id] = d.text
                plans[p.id] = d.plan
            }
            showPlan = prompts.contains { !(plans[$0.id] ?? "").isEmpty } // plan opens by itself when it has content
            showPrompt = (texts[prompts[0].id] ?? "").isEmpty // an answer already under way starts with the question folded
            task = 0
            startedAt = Date()
            left = seconds
            autoFired = false
            stage = .writing
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    /// Essay and plan live under one key per prompt as JSON; an older plain-text draft is read as the essay.
    private func loadDraft(_ id: String) -> Draft {
        guard let raw = UserDefaults.standard.string(forKey: "draft:\(id)") else { return Draft() }
        if let d = try? JSONDecoder().decode(Draft.self, from: Data(raw.utf8)) { return d }
        return Draft(text: raw, plan: "")
    }

    private func saveDraft(_ id: String, text: String, plan: String) {
        guard let data = try? JSONEncoder().encode(Draft(text: text, plan: plan)), let s = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(s, forKey: "draft:\(id)")
    }

    private func textBinding(_ p: Prompt) -> Binding<String> {
        Binding(get: { texts[p.id] ?? "" }, set: { v in
            // First keystroke: fold the question into a one-line summary.
            if (texts[p.id] ?? "").isEmpty && !v.isEmpty && showPrompt { withAnimation(reduceMotion ? nil : .snappy) { showPrompt = false } }
            texts[p.id] = v
            saveDraft(p.id, text: v, plan: plans[p.id] ?? "")
        })
    }

    private func planBinding(_ p: Prompt) -> Binding<String> {
        Binding(get: { plans[p.id] ?? "" }, set: { v in
            plans[p.id] = v
            saveDraft(p.id, text: texts[p.id] ?? "", plan: v)
        })
    }

    // MARK: Editor

    private func editor(_ p: Prompt) -> some View {
        VStack(spacing: 12) {
            VStack(spacing: 12) {
                if multi {
                    Picker("Task", selection: $task) {
                        ForEach(Array(prompts.enumerated()), id: \.offset) { i, q in
                            Text("\(q.part == 1 ? "Task 1" : "Task 2"), \(plural(words(q)))").tag(i)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                if !showPrompt { questionToggle(p).card(padding: 12) } // folded: stays pinned above the answer
                if let submitIssue {
                    IssueNotice(issue: submitIssue, kept: "Your draft is saved on this device.") { Task { await submit() } }
                }
                if let submitError {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Submit failed").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                        ErrorLine(message: submitError)
                    }
                    .card(padding: 12)
                }
            }
            .padding(.horizontal, 16)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if showPrompt {
                        VStack(alignment: .leading, spacing: 8) {
                            questionToggle(p)
                            promptView(p)
                        }
                        .card()
                    }
                    if p.part == 2 { planPad(p) }
                    ExamTextEditor(text: textBinding(p), blockPaste: blockPaste, minHeight: 380, label: "Your answer to \(p.part == 1 ? "Task 1" : "Task 2")") { pasteBlocked() }
                        .id(p.id)
                        .overlay(alignment: .topLeading) {
                            if (texts[p.id] ?? "").isEmpty { placeholder(answerPlaceholder) }
                        }
                        .card(padding: 8)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .demoScroll()
        }
        .padding(.top, 8)
        .allowsHitTesting(stage != .submitting)
        .safeAreaInset(edge: .bottom, spacing: 0) { wordBar(p) }
        .background(.canvas)
        .overlay(alignment: .top) {
            if let toast {
                HStack(spacing: 8) {
                    Image(systemName: "clock.fill").foregroundStyle(toast.tint).accessibilityHidden(true)
                    Text(toast.text).font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .glassBar(Capsule())
                .padding(.top, 8).padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity))
                .accessibilityElement(children: .combine)
            }
        }
        .animation(reduceMotion ? nil : .snappy, value: toast)
        .overlay {
            if stage == .submitting {
                ProgressView("Submitting…").padding(24).glassBar(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .onChange(of: task) { _, new in
            if prompts.indices.contains(new) { showPrompt = (texts[prompts[new].id] ?? "").isEmpty }
        }
        .onChange(of: left) { old, new in timeChanged(old, new) }
        .task {
            // Wall clock, not ticks: the deadline is startedAt + seconds, so backgrounding or a throttled run loop can't drift it.
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                let l = Int(ceil(Double(seconds) - Date().timeIntervalSince(startedAt)))
                if l != left { left = l }
            }
        }
    }

    private func placeholder(_ text: String) -> some View {
        Text(text)
            .font(.system(.body, design: .serif)).foregroundStyle(.muted)
            .padding(.top, 8).padding(.leading, 9)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func questionToggle(_ p: Prompt) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy) { showPrompt.toggle() }
        } label: {
            HStack(spacing: 8) {
                Text("Question").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                if !showPrompt { Text(p.title).font(.subheadline).foregroundStyle(.muted).lineLimit(1) }
                Spacer(minLength: 8)
                Text(showPrompt ? "Hide" : "Show").font(.subheadline).foregroundStyle(.muted)
                Image(systemName: "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.muted)
                    .rotationEffect(.degrees(showPrompt ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(showPrompt ? "Expanded" : "Collapsed")
    }

    private func planPad(_ p: Prompt) -> some View {
        DisclosureGroup(isExpanded: $showPlan) {
            ExamTextEditor(text: planBinding(p), blockPaste: blockPaste, minHeight: 120, label: "Essay plan") { pasteBlocked() }
                .overlay(alignment: .topLeading) {
                    if (plans[p.id] ?? "").isEmpty { placeholder(planPlaceholder) }
                }
                .padding(.top, 8)
        } label: {
            Label {
                Text("Plan \(Text("(about 5 minutes, not graded)").foregroundStyle(Color.muted))").font(.subheadline.weight(.medium))
            } icon: {
                Image(systemName: "note.text").foregroundStyle(.muted)
            }
        }
        .card()
    }

    private func promptView(_ p: Prompt) -> some View {
        let chart = p.chartSpec
        let titleStem = p.title.hasSuffix("…") ? String(p.title.dropLast()) : p.title
        // Seeded titles are the body's first sentence and the figure repeats its own title: don't print either twice.
        let showTitle = !p.body.hasPrefix(titleStem) && chart?.title != p.title
        let minimum = minWords(p)
        return VStack(alignment: .leading, spacing: 16) {
            Text("\(taskLabel(p)). You should spend about \(p.part == 1 ? 20 : 40) minutes on this task.").font(.caption).foregroundStyle(.muted)
            if showTitle { Text(p.title).font(.display(.title3)).foregroundStyle(.ink) }
            Text(p.body).font(.system(.body, design: .serif)).foregroundStyle(.ink).fixedSize(horizontal: false, vertical: true)
            if let bullets = p.bullets, !bullets.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("In your letter").font(.system(.body, design: .serif)).foregroundStyle(.ink)
                    ForEach(bullets, id: \.self) { b in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•").foregroundStyle(.muted)
                            Text(b).font(.system(.body, design: .serif)).foregroundStyle(.ink)
                        }
                    }
                }
            }
            if let chart {
                ChartView(spec: chart)
            } else if let img = p.imageUrl, let url = URL(string: img) {
                // Raster exam figures are drawn on white, so the frame stays white in dark mode on purpose.
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFit().accessibilityLabel("Figure for: \(p.title)")
                    case .failure:
                        Label("Couldn't load the figure", systemImage: "photo").font(.footnote).foregroundStyle(.muted)
                    default:
                        ProgressView().frame(maxWidth: .infinity, minHeight: 160)
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            Divider()
            Text("Write at least \(minimum) words.").font(.caption).foregroundStyle(.muted)
            if p.part == 1, p.variant == "general", !p.body.localizedCaseInsensitiveContains("Begin your letter") {
                // Cambridge's closing lines: formal letters open "Dear Sir or Madam,", the rest leave the name blank.
                VStack(alignment: .leading, spacing: 4) {
                    Text("You do NOT need to write any addresses.")
                    Text("Begin your letter as follows:")
                    Text(p.type == "letter-formal" ? "Dear Sir or Madam," : "Dear ..............,")
                }
                .font(.system(.body, design: .serif)).foregroundStyle(.ink)
            }
        }
    }

    private var timer: some View {
        let tint: Color = left <= 60 ? .bad : left <= 300 ? .warnText : .ink
        return Label {
            Text(left < 0 ? "+\(clock(-left)) over" : clock(left))
        } icon: {
            Image(systemName: "timer")
        }
        .font(.headline.monospacedDigit())
        .foregroundStyle(tint)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(left < 0 ? "Overtime \(clock(-left))" : "\(clock(left)) left")
        .accessibilityAddTraits(.updatesFrequently)
    }

    private func wordBar(_ p: Prompt) -> some View {
        let n = words(p)
        let need = minWords(p)
        let under = n < need
        // Neutral at zero, amber near the minimum, green once reached. Never red: an empty page is not an error.
        let tint: Color = !under ? .goodText : Double(n) >= Double(need) * 0.9 ? .warnText : .muted
        let hint = !under ? "\(need)-word minimum reached" : n > 0 ? "\(need - n) more to reach \(need)" : "Minimum \(need) words"
        return VStack(spacing: 8) {
            HStack {
                Text("\(n) / \(need)").font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(tint)
                    .accessibilityLabel(plural(n))
                Spacer()
                Text(hint).font(.subheadline.monospacedDigit()).foregroundStyle(.muted)
            }
            ProgressView(value: Double(min(n, need)), total: Double(need))
                .tint(under ? Color.brand : Color.good)
                .accessibilityLabel("Progress to the minimum word count")
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .glassBar(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16).padding(.bottom, 8)
        .accessibilityElement(children: .combine)
    }

    // MARK: Time and toasts

    private func show(_ text: String, tint: Color = .muted) {
        let t = Toast(text: text, tint: tint)
        toast = t
        AccessibilityNotification.Announcement(text).post()
        Task {
            try? await Task.sleep(for: .seconds(3.5))
            if toast == t { toast = nil }
        }
    }

    private func pasteBlocked() { show("Pasting is disabled in exam mode", tint: .bad) }

    private func timeChanged(_ old: Int, _ new: Int) {
        guard stage == .writing else { return }
        if old > 300 && new <= 300 && new > 60 { show("5 minutes left", tint: .warn) }
        if old > 60 && new <= 60 && new > 0 { show("1 minute left", tint: .bad) }
        if old > 0 && new <= 0 {
            if autoSubmit {
                guard !autoFired else { return }
                autoFired = true
                showSubmit = false
                show("Time is up. Submitting your answer…", tint: .bad)
                Task { await submit() }
            } else {
                show("Time is up. You can keep writing; the result will be marked overtime.", tint: .bad)
            }
        }
    }

    // MARK: Submit

    private func submit() async {
        guard stage == .writing else { return }
        stage = .submitting
        submitError = nil
        submitIssue = nil
        let overtime = left < 0
        // Editor time, split across the tasks of a full test so weekly minutes don't count it twice.
        let durationMs = Int(Double(max(0, seconds - left)) * 1000 / Double(prompts.count))
        do {
            var done: [String] = []
            for p in prompts {
                let text = texts[p.id] ?? ""
                let plan = plans[p.id] ?? ""
                if created[p.id] == nil {
                    var body: [String: Any] = ["promptId": p.id, "skill": "writing", "part": p.part, "mode": multi ? "exam" : "practice", "text": text]
                    if multi { body["sessionId"] = sessionId }
                    if let parent { body["parentAttemptId"] = parent }
                    let c: Created = try await api.send("POST", "/api/attempts", body)
                    created[p.id] = c.id
                }
                guard let id = created[p.id] else { continue }
                var payload: [String: Any] = ["text": text, "overtime": overtime, "durationMs": durationMs]
                if p.part == 2 && !plan.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { payload["plan"] = plan }
                do {
                    let _: Empty = try await api.send("POST", "/api/attempts/\(id)/submit", payload)
                } catch let e as APIError where e.status == 409 {
                    // Already submitted on an earlier try.
                }
                done.append(id)
            }
            ids = done
            for p in prompts { UserDefaults.standard.removeObject(forKey: "draft:\(p.id)") }
            stage = .done
        } catch {
            // Text stays in the editor (and the saved draft) so nothing is lost.
            if let e = error as? APIError, let issue = CommunityIssue(e) { submitIssue = issue } else { submitError = error.localizedDescription }
            stage = .writing
        }
    }
}

private struct SubmitRow: Identifiable {
    let id: String
    let label: String
    let words: Int
    let min: Int
}

/// Submit confirmation (web Dialog): per-task word counts, a warning under the minimum, blocked under the floor.
private struct SubmitSheet: View {
    let title: String
    let rows: [SubmitRow]
    let note: String?
    let tooShort: Bool
    let underMinimum: Bool
    let onKeep: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(.display(.title2)).foregroundStyle(.ink)
            Text("You can't edit after submitting. Analysis takes about a minute.").font(.subheadline).foregroundStyle(.muted)
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                    if i > 0 { Divider() }
                    HStack(alignment: .firstTextBaseline) {
                        Text(r.label).font(.subheadline.weight(.medium)).foregroundStyle(.ink)
                        Spacer(minLength: 8)
                        Text(count(r)).font(.subheadline.monospacedDigit())
                            .foregroundStyle(r.words < r.min ? Color.warnText : Color.goodText)
                    }
                    .padding(.vertical, 12)
                }
            }
            .padding(.horizontal, 16)
            .background(.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            if let note {
                Text(note).font(.subheadline).foregroundStyle(tooShort ? Color.muted : Color.warnText)
            }
            Spacer(minLength: 0)
            HStack(spacing: 12) {
                action("Keep writing", emphasised: underMinimum, run: onKeep)
                action("Submit", emphasised: !underMinimum, disabled: tooShort, run: onSubmit)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.canvas)
    }

    private func count(_ r: SubmitRow) -> String {
        let w = r.words == 1 ? "1 word" : "\(r.words) words"
        return r.words < r.min ? "\(w), under \(r.min)" : w
    }

    @ViewBuilder
    private func action(_ title: String, emphasised: Bool, disabled: Bool = false, run: @escaping () -> Void) -> some View {
        if emphasised {
            Button(action: run) { Text(title).frame(maxWidth: .infinity) }.primaryButton().controlSize(.large).disabled(disabled)
        } else {
            Button(action: run) { Text(title).frame(maxWidth: .infinity) }.secondaryButton().controlSize(.large).disabled(disabled)
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
    var label = "Answer"
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
        return tv
    }

    func updateUIView(_ tv: NoPasteTextView, context: Context) {
        context.coordinator.parent = self
        tv.blockPaste = blockPaste
        tv.onPasteBlocked = onPasteBlocked
        tv.accessibilityLabel = label
        if tv.text != text { tv.text = text }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: NoPasteTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 320
        let h = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        return CGSize(width: width, height: max(minHeight, h))
    }
}
