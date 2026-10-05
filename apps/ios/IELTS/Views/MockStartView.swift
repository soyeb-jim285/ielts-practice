import SwiftUI

/// Start screen of the full mock test (web: components/mock/MockStart.tsx): test type, where the questions come from, the rules,
/// the writing and speaking allowance, and the way back into an open mock.
struct MockStartView: View {
    @Environment(APIClient.self) private var api
    @AppStorage("ielts.mock.variant") private var variant = "academic"
    @State private var options: MockOptions?
    @State private var open: MockExam?
    @State private var cambridge = false
    @State private var pick: String? // nil = the default (lowest test not started)
    @State private var loadError: String?
    @State private var starting = false
    @State private var issue: CommunityIssue?
    @State private var startError: String?
    @State private var confirmNew = false
    @State private var started: String?

    private static let ruleLines = [
        "Order: Listening, Reading, Writing, then Speaking.",
        "Times: Listening about 30 minutes plus a 2-minute check, Reading 60, Writing 60 for both tasks, Speaking 11 to 14.",
        "No pausing inside a timed section, as in the real test. The clock runs only inside a section.",
        "If you leave, you resume with the time already used kept.",
        "Speaking can wait: the mock stays open for 7 days.",
    ]

    private var refs: [MockOptions.Cambridge] { options?.cambridge ?? [] }
    private var useCambridge: Bool { cambridge && !refs.isEmpty }
    private var ref: String? {
        guard useCambridge else { return nil }
        if let pick, refs.contains(where: { $0.ref == pick }) { return pick }
        return MockFlow.defaultRef(refs)
    }
    private var noSet: Bool { options.map { !$0.own && $0.cambridge.isEmpty } ?? false }
    /// Writing or Speaking is used up now: refuse before anything starts (the server checks again).
    private var blocker: CommunityIssue? {
        guard let q = api.quota, let o = options else { return nil }
        return CommunityIssue(blocked: o.quota.writing.blocked, skill: "writing", quota: o.quota.writing, tier: q.tier)
            ?? CommunityIssue(blocked: o.quota.speaking.blocked, skill: "speaking", quota: o.quota.speaking, tier: q.tier)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("The whole test in one sitting, like test day: Listening, Reading, Writing, then Speaking, with one overall band.")
                    .font(.subheadline).foregroundStyle(.muted)
                if let open { resume(open) }
                setup
                rules
                allowance
                if let issue {
                    IssueNotice(issue: issue, kept: "") { Task { await start(replace: false) } }
                } else if let startError {
                    ErrorLine(message: startError)
                }
                Button { begin() } label: {
                    Text(starting ? "Starting…" : "Start the mock test").frame(maxWidth: .infinity, minHeight: 28)
                }
                .primaryButton().controlSize(.large)
                .disabled(starting || options == nil || noSet || blocker != nil)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color.canvas)
        .navigationTitle("Full mock test")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $started) { MockHubView(id: $0) }
        .confirmationDialog("Start a new mock test?", isPresented: $confirmNew, titleVisibility: .visible) {
            Button("Discard the open one and start", role: .destructive) { Task { await start(replace: true) } }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("Only one mock test can be open. The open one is removed; sections you already took stay in your history.")
        }
        .task { await api.loadQuota(force: true) }
        .task(id: variant) { await loadOptions() }
        .onAppear { Task { open = try? await api.mockCurrent() } }
        .refreshable { await loadOptions(); open = try? await api.mockCurrent() }
    }

    // MARK: Parts

    private func resume(_ m: MockExam) -> some View {
        NavigationLink(value: Route.mockHub(id: m.id)) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Continue your mock test").font(.display(.title3)).foregroundStyle(.ink)
                    Text("\(m.next.map { MockFlow.label($0) + " next." } ?? "Open.") Started \(ShellDate.date(m.startedAt)).")
                        .font(.subheadline).foregroundStyle(.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .card()
        }
        .buttonStyle(.plain)
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Test type").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                Picker("Test type", selection: $variant) {
                    Text("Academic").tag("academic")
                    Text("General Training").tag("general")
                }
                .pickerStyle(.segmented)
            }
            if let loadError {
                ErrorLine(message: loadError)
                Button("Try again") { Task { await loadOptions() } }.secondaryButton()
            } else if options == nil {
                ProgressView().frame(maxWidth: .infinity)
            } else if noSet {
                Text("There is no complete set of tests for this test type yet.").font(.subheadline).foregroundStyle(.muted)
            } else if !refs.isEmpty && api.me?.cambridgeAccess == true {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Questions").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                    Picker("Questions", selection: $cambridge) {
                        Text("Cambridge complete test").tag(true)
                        if options?.own == true { Text("Our own tests").tag(false) }
                    }
                    .pickerStyle(.segmented)
                    if useCambridge {
                        Picker("Test", selection: Binding(get: { ref ?? "" }, set: { pick = $0 })) {
                            ForEach(refs, id: \.ref) { Text($0.bookTest + ($0.started ? " (started)" : "")).tag($0.ref) }
                        }
                        .pickerStyle(.menu)
                        Button { pick = refs.randomElement()?.ref } label: { Label("Surprise me", systemImage: "shuffle") }
                            .font(.subheadline.weight(.medium))
                    }
                }
            } else {
                Text("The server picks one Listening test, one Reading test, a Writing Task 1 and Task 2 and a Speaking test from our own tests.")
                    .font(.subheadline).foregroundStyle(.muted)
            }
        }
        .card()
    }

    private var rules: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("How it works")
            ForEach(Self.ruleLines, id: \.self) { r in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("•").foregroundStyle(.muted).accessibilityHidden(true)
                    Text(r).font(.subheadline).foregroundStyle(.ink)
                }
            }
        }
        .card()
    }

    @ViewBuilder private var allowance: some View {
        if let o = options {
            VStack(alignment: .leading, spacing: 4) {
                if let blocker {
                    IssueNotice(issue: blocker, kept: "", onRetry: { Task { await api.loadQuota(force: true); await loadOptions() } })
                } else {
                    Text("Writing: \(CommunityText.left(o.quota.writing))").font(.caption).foregroundStyle(.muted)
                    Text("Speaking: \(CommunityText.left(o.quota.speaking))").font(.caption).foregroundStyle(.muted)
                }
            }
        }
    }

    // MARK: Actions

    private func loadOptions() async {
        loadError = nil
        do {
            let o = try await api.mockOptions(variant: variant)
            options = o
            pick = nil
            cambridge = !o.cambridge.isEmpty && api.me?.cambridgeAccess == true
        } catch is CancellationError {
        } catch {
            options = nil
            loadError = error.localizedDescription
        }
    }

    /// A new mock replaces an open one only after a confirm.
    private func begin() {
        if open?.isOpen == true { confirmNew = true } else { Task { await start(replace: false) } }
    }

    private func start(replace: Bool) async {
        starting = true
        issue = nil
        startError = nil
        defer { starting = false }
        do {
            let m = try await api.createMock(variant: variant, source: useCambridge ? "cambridge" : "generated", ref: ref, replace: replace)
            open = m
            started = m.id
        } catch is CancellationError {
        } catch let e as APIError {
            if let i = CommunityIssue(e) { issue = i } else { startError = e.message }
        } catch {
            startError = error.localizedDescription
        }
    }
}
