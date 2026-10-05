import SwiftUI

/// One screen for the whole run (web: routes/_app/mock/$id.tsx): the transition between sections, the Speaking choice, and once nothing is
/// left to take, the result. Each section opens the normal runner and returns here; the clock never runs on this screen.
struct MockHubView: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    let id: String

    private enum Confirm: Identifiable { case close, abandon; var id: Self { self } }

    @State private var mock: MockExam?
    @State private var loadError: String?
    @State private var busy = false
    @State private var actionError: String?
    @State private var issue: CommunityIssue?
    @State private var confirm: Confirm?
    @State private var lrId: String?
    @State private var showWriting = false
    @State private var recorded: MockSpeakingRun?
    @State private var showRecorded = false
    @State private var showLive = false
    @State private var resultIds: [String]?

    private var target: Double { api.me?.settings.targetBand ?? 7 }
    private var marking: Bool { mock?.sections.contains { $0.state == "marking" } ?? false }

    var body: some View {
        Group {
            if let m = mock {
                content(m)
            } else if let loadError {
                ContentUnavailableView {
                    Label("This mock test is not available", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Try again") { Task { await load() } }.primaryButton()
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.canvas)
        .navigationTitle(mock?.isOpen == false ? "Mock result" : "Full mock test")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(); await api.loadQuota() } // runs again each time a section returns here
        .task(id: marking) { // marking runs in the background: look again while any section is being marked
            while marking, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if !Task.isCancelled { await load() }
            }
        }
        .refreshable { await load() }
        .navigationDestination(item: $lrId) { LrAttemptScreen(id: $0, mockId: id) }
        .navigationDestination(isPresented: $showWriting) {
            StartGate(skill: "writing") { WritingEditorView(mode: .full(variant: mock?.variant ?? "academic"), mockId: id) }
        }
        .navigationDestination(isPresented: $showRecorded) {
            if let r = recorded { StartGate(skill: "speaking") { SpeakingSessionView(mode: .full, mock: r) } }
        }
        .navigationDestination(isPresented: $showLive) { LiveGate { LiveExamView(mockId: id) } }
        .navigationDestination(item: $resultIds) { ResultView(ids: $0) }
        .confirmationDialog(confirm == .close ? "Finish without Speaking?" : "Abandon this mock test?",
                            isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            if confirm == .close {
                Button("Finish") { Task { await closeMock() } }
            } else {
                Button("Abandon", role: .destructive) { Task { await abandon() } }
            }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text(confirm == .close
                 ? "The mock closes with Speaking skipped and no overall band. Your other sections stay in your history."
                 : "The mock is removed. Sections you already took stay in your history as normal practice.")
        }
    }

    // MARK: Content

    private func content(_ m: MockExam) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 8) {
                    Chip(text: m.variant == "academic" ? "Academic" : "General Training", color: .muted)
                    if let ref = m.ref { Chip(text: ref, color: .sky) }
                    if m.status == "closed" { Chip(text: "Finished without Speaking", color: .warnText) }
                }
                if let actionError { ErrorLine(message: actionError) }
                if m.isOpen, m.next == "speaking" {
                    speakingChoice
                } else if m.isOpen, let next = m.next {
                    transitionCard(m, next)
                } else {
                    result(m)
                }
                sections(m)
                if m.isOpen {
                    if marking { Text("Marking runs in the background. This page updates by itself.").font(.caption).foregroundStyle(.muted) }
                    VStack(alignment: .leading, spacing: 0) {
                        if m.next == "speaking" {
                            Button("Finish without Speaking") { confirm = .close }.frame(minHeight: 44)
                        }
                        Button("Abandon this mock test", role: .destructive) { confirm = .abandon }.frame(minHeight: 44)
                    }
                    .font(.subheadline.weight(.medium))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func transitionCard(_ m: MockExam, _ next: String) -> some View {
        let copy = MockFlow.transition(next: next)
        let resuming = m.section(next)?.state == "in_progress"
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Full mock test").font(.caption.weight(.medium)).foregroundStyle(.brand)
                Text(copy?.title ?? "").font(.display(.title2)).foregroundStyle(.ink)
                Text(resuming ? "\(MockFlow.label(next)) is already under way. You resume with the time you have used." : copy?.body ?? "")
                    .foregroundStyle(.muted)
            }
            if let issue { IssueNotice(issue: issue, kept: "", onRetry: nil) }
            Button { Task { await start(next) } } label: {
                Text("\(resuming ? "Continue" : "Start") \(MockFlow.label(next))").frame(maxWidth: .infinity, minHeight: 28)
            }
            .primaryButton().controlSize(.large).disabled(busy)
        }
        .card()
    }

    private var speakingChoice: some View {
        let live = !(api.quota?.liveProviders.isEmpty ?? true)
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Last section").font(.caption.weight(.medium)).foregroundStyle(.brand)
                Text("Writing finished. Choose how to do Speaking.").font(.display(.title2)).foregroundStyle(.ink)
                Text("Speaking has no countdown, so you can take it now or later this week. Your overall band appears once it is marked.").foregroundStyle(.muted)
            }
            if let issue { IssueNotice(issue: issue, kept: "", onRetry: nil) }
            VStack(alignment: .leading, spacing: 8) {
                Text("Recorded test, 11 to 14 min").font(.headline).foregroundStyle(.ink)
                Text("The examiner reads the questions. You record each answer at your own pace.").font(.subheadline).foregroundStyle(.muted)
                Button { Task { await chooseRecorded() } } label: { Text("Start recorded test").frame(maxWidth: .infinity, minHeight: 28) }
                    .primaryButton().controlSize(.large).disabled(busy)
                QuotaLabel(skill: "speaking")
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text("Live examiner, 11 to 14 min").font(.headline).foregroundStyle(live ? Color.ink : Color.muted)
                Text("An AI examiner asks the questions aloud and follows up on what you say.").font(.subheadline).foregroundStyle(.muted)
                Button { Task { await chooseLive() } } label: { Text("Start live examiner").frame(maxWidth: .infinity, minHeight: 28) }
                    .secondaryButton().controlSize(.large).disabled(busy || !live)
                if !live {
                    HStack(spacing: 6) {
                        Label("Needs your own OpenAI or Gemini key.", systemImage: "lock").font(.caption).foregroundStyle(.muted)
                        Button("Add your own key") { api.openKeys() }.font(.caption.weight(.medium))
                    }
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text("Do it later").font(.headline).foregroundStyle(.ink)
                Text("Your mock stays open until \(ShellDate.date(mock?.expiresAt ?? "")). Come back from the dashboard when you are ready.").font(.subheadline).foregroundStyle(.muted)
                Button { dismiss() } label: { Text("Back").frame(maxWidth: .infinity, minHeight: 28) }.secondaryButton().controlSize(.large)
            }
        }
        .card()
    }

    private func result(_ m: MockExam) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Overall band").font(.caption.weight(.medium)).foregroundStyle(.brand)
                Text(MockFlow.overallNote(m, target: target)).font(.subheadline).foregroundStyle(.muted)
                Text([m.ref, m.variant == "academic" ? "Academic" : "General Training", "started \(ShellDate.date(m.startedAt))"].compactMap { $0 }.joined(separator: ", "))
                    .font(.caption).foregroundStyle(.muted)
            }
            Spacer(minLength: 8)
            if let o = m.overall {
                Text(fmt(o)).font(.system(size: 52, weight: .bold, design: .serif).monospacedDigit()).foregroundStyle(bandTextColor(o, target))
                    .accessibilityLabel("Overall band \(fmt(o))")
            } else {
                Text("-").font(.system(size: 52, weight: .bold, design: .serif)).foregroundStyle(.muted).accessibilityLabel("No overall band yet")
            }
        }
        .card()
    }

    private func sections(_ m: MockExam) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(m.sections.enumerated()), id: \.element.id) { i, s in
                if i > 0 { Divider().padding(.leading, 56) }
                if MockFlow.isFinished(s), let first = s.attemptId {
                    if s.skill == "listening" || s.skill == "reading" {
                        NavigationLink(value: Route.lrAttempt(id: first)) { row(s, chevron: true) }.buttonStyle(.plain)
                    } else {
                        Button { Task { await openResult(s, first: first) } } label: { row(s, chevron: true) }.buttonStyle(.plain)
                    }
                } else {
                    row(s, chevron: false)
                }
            }
        }
        .card(padding: 0)
    }

    private func row(_ s: MockSection, chevron: Bool) -> some View {
        let st = MockFlow.status(s)
        let tone = Self.color(st.tone)
        return HStack(spacing: 12) {
            Image(systemName: ["listening": "headphones", "reading": "book", "writing": "pencil.line", "speaking": "mic"][s.skill] ?? "circle")
                .foregroundStyle(.muted).frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(MockFlow.label(s.skill)).font(.body.weight(.medium)).foregroundStyle(.ink)
                if let meta = MockFlow.meta(s) { Text(meta).font(.caption).foregroundStyle(.muted) }
                Chip(text: st.text, color: tone)
            }
            Spacer(minLength: 8)
            if let b = s.band {
                Text(fmt(b)).font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(bandTextColor(b, target)).accessibilityLabel("Band \(fmt(b))")
            } else {
                Text("-").foregroundStyle(.muted).accessibilityHidden(true)
            }
            if chevron { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true) }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private static func color(_ t: MockFlow.Tone) -> Color {
        switch t {
        case .good: return Color.goodText
        case .bad: return Color.bad
        case .accent: return Color.brand
        case .neutral: return Color.muted
        }
    }

    // MARK: Actions

    private func load() async {
        do {
            mock = try await api.mock(id)
            loadError = nil
        } catch is CancellationError {
        } catch {
            if mock == nil { loadError = error.localizedDescription }
        }
    }

    /// Listening and Reading: the exam-mode attempt (new, or the one in progress). Writing opens its own screen.
    private func start(_ next: String) async {
        busy = true
        actionError = nil
        issue = nil
        defer { busy = false }
        do {
            if next == "writing" { showWriting = true } else { lrId = try await api.startMockSection(id, skill: next) }
        } catch is CancellationError {
        } catch let e as APIError {
            if let i = CommunityIssue(e) { issue = i } else { actionError = e.message }
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func chooseRecorded() async {
        busy = true
        actionError = nil
        issue = nil
        defer { busy = false }
        do {
            let c = try await api.chooseMockSpeaking(id, mode: "recorded")
            guard let t = c.test, let s = c.sessionId else { actionError = "The server didn't return the speaking test."; return }
            recorded = MockSpeakingRun(mockId: id, sessionId: s, test: t)
            showRecorded = true
        } catch is CancellationError {
        } catch let e as APIError {
            if let i = CommunityIssue(e) { issue = i } else { actionError = e.message }
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func chooseLive() async {
        busy = true
        actionError = nil
        issue = nil
        defer { busy = false }
        do {
            _ = try await api.chooseMockSpeaking(id, mode: "live")
            showLive = true
        } catch is CancellationError {
        } catch let e as APIError {
            if let i = CommunityIssue(e) { issue = i } else { actionError = e.message }
        } catch {
            actionError = error.localizedDescription
        }
    }

    /// Writing and Speaking open every attempt of the session, found in the attempt list (Listening and Reading link straight to their result).
    private func openResult(_ s: MockSection, first: String) async {
        struct Page: Decodable { struct Item: Decodable { let id: String; let sessionId: String? }; let items: [Item] }
        let page: Page? = try? await api.get("/api/attempts", query: ["skill": s.skill])
        let ids = s.sessionId.map { sid in (page?.items ?? []).filter { $0.sessionId == sid }.map(\.id) } ?? []
        resultIds = ids.isEmpty ? [first] : ids
    }

    private func closeMock() async {
        do { try await api.closeMock(id); await load() } catch { actionError = error.localizedDescription }
    }

    private func abandon() async {
        do { try await api.abandonMock(id); dismiss() } catch { actionError = error.localizedDescription }
    }
}
