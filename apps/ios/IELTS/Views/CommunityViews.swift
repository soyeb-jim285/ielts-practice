import SwiftUI

// Plans and limits UI (docs/community.md): quota label, blocked panel, fair-use sheet, and the gates in front of tests.
// Teal is for "act here", so the info states are neutral; only the buttons that do something are teal.

/// The line under a Start button: "1 test left today", "No tests left. Resets Monday 6:00", "Unlimited".
struct QuotaLabel: View {
    @Environment(APIClient.self) private var api
    let skill: String

    var body: some View {
        if let q = api.quota {
            let sq = CommunityText.skillQuota(q, skill)
            let out = sq.blocked != nil || sq.remaining == 0
            Text(CommunityText.left(sq))
                .font(.caption)
                .foregroundStyle(out ? Color.warnText : Color.muted)
                .accessibilityLabel(CommunityText.left(sq))
        }
    }
}

/// Primary and secondary buttons for an issue.
private struct IssueButtons: View {
    @Environment(APIClient.self) private var api
    let issue: CommunityIssue
    var onRetry: (() -> Void)?
    var onDismiss: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            if let a = issue.primary { button(a) }
            if let onDismiss, issue.kind != .busy, issue.kind != .tooFast {
                Button("Not now", action: onDismiss).secondaryButton().controlSize(.large)
            }
        }
    }

    private func button(_ a: IssueAction) -> some View {
        Button {
            switch a {
            case .createAccount: api.requestSignIn("Create a free account for more tests.", signUp: true)
            case .retry: onRetry?()
            }
        } label: {
            Text(issue.label(a)).frame(maxWidth: .infinity, minHeight: 28)
        }
        .primaryButton().controlSize(.large)
    }
}

/// Full-screen "you can't start this test now" state: why, when it resets, and the way out.
struct IssuePanel: View {
    let issue: CommunityIssue
    var onRetry: (() -> Void)?
    var onDismiss: (() -> Void)?

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: issue.kind == .liveOff ? "mic.slash" : "hourglass")
                    .font(.title)
                    .foregroundStyle(.ink)
                    .frame(width: 64, height: 64)
                    .background(Color.surface2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .accessibilityHidden(true)
                VStack(spacing: 6) {
                    Text(issue.title).font(.display(.title2, weight: .semibold)).foregroundStyle(.ink).multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                    Text(issue.message()).foregroundStyle(.muted).multilineTextAlignment(.center)
                }
                IssueButtons(issue: issue, onRetry: onRetry, onDismiss: onDismiss).padding(.top, 4)
            }
            .frame(maxWidth: 420)
            .padding(.horizontal, 24)
            .padding(.top, 56)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
        .background(Color.canvas)
    }
}

/// Mid-test notice (a second tab used the test, the window rolled over): the work stays on screen.
struct IssueNotice: View {
    let issue: CommunityIssue
    let kept: String
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(issue.title).font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
            Text(issue.message() + " " + kept).font(.subheadline).foregroundStyle(.muted)
            IssueButtons(issue: issue, onRetry: onRetry, onDismiss: nil)
        }
        .card(padding: 12)
    }
}

/// "Before you start", shown once a day before a free test (guest and free account).
struct FairUseSheet: View {
    let skill: String
    let quota: Quota
    let onStart: () -> Void
    let onCreateAccount: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "person.2")
                    .font(.title2)
                    .foregroundStyle(.ink)
                    .frame(width: 52, height: 52)
                    .background(Color.surface2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                Text("Before you start")
                    .font(.display(.title2, weight: .semibold)).foregroundStyle(.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(CommunityText.fairUseBody(skill: skill, quota: quota)).foregroundStyle(.ink)
                VStack(spacing: 12) {
                    Button(action: onStart) { Text("Start test").frame(maxWidth: .infinity, minHeight: 28) }
                        .primaryButton().controlSize(.large)
                    if quota.tier == "guest" {
                        Button(action: onCreateAccount) { Text("Create a free account").frame(maxWidth: .infinity, minHeight: 28) }
                            .secondaryButton().controlSize(.large)
                    }
                }
                .padding(.top, 4)
            }
            .padding(24)
        }
        .background(Color.canvas)
        .presentationDetents([.fraction(0.75), .large])
    }
}

/// In front of a speaking or writing test: checks the quota (so nobody writes an essay they can't submit), shows the fair-use dialog once a day,
/// and only then starts a guest session if there is none. The test content is built after all that.
struct StartGate<Content: View>: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    let skill: String
    let content: () -> Content

    private enum Phase: Equatable { case checking, blocked(CommunityIssue), fairUse, failed(String), ready }
    @State private var phase = Phase.checking
    @State private var check = 0

    init(skill: String, @ViewBuilder content: @escaping () -> Content) {
        self.skill = skill
        self.content = content
    }

    var body: some View {
        if phase == .ready {
            content()
        } else {
            screen
                .navigationTitle(skill == "speaking" ? "Speaking" : "Writing")
                .navigationBarTitleDisplayMode(.inline)
                .task(id: check) { await run() }
                .onChange(of: api.isSignedIn) { _, signedIn in if signedIn { check += 1 } } // an account changes the limits
                .onDemoTour { if $0 == "start", phase == .fairUse { Task { await begin() } } } // demo auto-tour (Demo/DemoTour.swift)
        }
    }

    @ViewBuilder private var screen: some View {
        switch phase {
        case let .blocked(issue):
            IssuePanel(issue: issue, onRetry: { check += 1 }, onDismiss: { dismiss() })
        case let .failed(message):
            ContentUnavailableView {
                Label("Couldn't start the test", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { check += 1 }.primaryButton()
            }
        case .fairUse:
            Color.canvas.ignoresSafeArea()
                .sheet(isPresented: Binding(get: { phase == .fairUse }, set: { if !$0 && phase == .fairUse { dismiss() } })) {
                    if let q = api.quota { FairUseSheet(skill: skill, quota: q, onStart: { Task { await begin() } }, onCreateAccount: createAccount) }
                }
        default:
            ProgressView("Checking your tests").frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.canvas)
        }
    }

    private var userKey: String? { api.isSignedIn ? api.me?.user.id : nil }

    private func run() async {
        phase = .checking
        await api.loadQuota(force: true)
        guard let q = api.quota else {
            phase = .failed("Can't reach NextBand. Check your internet connection and try again.")
            return
        }
        let sq = CommunityText.skillQuota(q, skill)
        if let issue = CommunityIssue(blocked: sq.blocked, skill: skill, quota: sq, tier: q.tier) { phase = .blocked(issue); return }
        if (q.tier == "guest" || q.tier == "community") && !FairUse.acknowledged(user: userKey) { phase = .fairUse; return }
        await begin()
    }

    private func begin() async {
        phase = .checking
        FairUse.acknowledge(user: userKey)
        do {
            try await api.ensureSession()
            phase = .ready
        } catch let e as APIError {
            phase = CommunityIssue(e).map { Phase.blocked($0) } ?? Phase.failed(e.message)
        } catch is CancellationError {
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// "Create a free account" (guests): leave the test, then open the sign-up sheet.
    private func createAccount() {
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            api.requestSignIn("Create a free account for more tests.", signUp: true)
        }
    }
}

/// In front of the live examiner: the server must offer it, and it counts against the plan's live sessions (`examiner`).
struct LiveGate<Content: View>: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    let content: () -> Content

    @State private var loaded = false
    @State private var check = 0

    init(@ViewBuilder content: @escaping () -> Content) { self.content = content }

    var body: some View {
        Group {
            if let q = api.quota, loaded {
                if !q.live {
                    IssuePanel(issue: CommunityIssue(kind: .liveOff, tier: q.tier), onRetry: { check += 1 }, onDismiss: { dismiss() })
                } else if let issue = CommunityIssue(blocked: q.liveQuota.blocked, skill: q.examiner == nil ? "speaking" : "examiner", quota: q.liveQuota, tier: q.tier) {
                    IssuePanel(issue: issue, onRetry: { check += 1 }, onDismiss: { dismiss() })
                } else {
                    content()
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.canvas)
            }
        }
        .navigationTitle("Live examiner")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: check) {
            await api.loadQuota(force: true)
            loaded = true
        }
        .onChange(of: api.isSignedIn) { _, _ in check += 1 }
    }
}

/// Settings: what is left of this person's tests on their plan.
struct CommunitySection: View {
    @Environment(APIClient.self) private var api

    var body: some View {
        Section {
            if let q = api.quota {
                LabeledContent("Speaking", value: CommunityText.left(q.speaking))
                LabeledContent("Writing", value: CommunityText.left(q.writing))
                if q.live, let e = q.examiner { LabeledContent("Live examiner", value: CommunityText.left(e)) }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        } header: {
            Text("Your tests")
        } footer: {
            Text(api.quota?.tier == "guest" ? "Try speaking and writing tests as a guest. Create a free account for more tests. Listening and Reading are free."
                 : api.quota?.tier == "unlimited" ? "Your account has no test limits."
                 : "Your plan sets how many tests you can take. Please practise fairly.")
        }
    }
}

/// Home: what is left of this person's tests, in one compact card.
struct CommunityCard: View {
    @Environment(APIClient.self) private var api

    var body: some View {
        if let q = api.quota {
            VStack(alignment: .leading, spacing: 12) {
                row("mic", "Speaking", q.speaking)
                row("pencil.line", "Writing", q.writing)
                if q.live, let e = q.examiner { row("bubble.left.and.bubble.right", "Live examiner", e) }
            }
            .card()
            .accessibilityElement(children: .contain)
        }
    }

    private func row(_ icon: String, _ title: String, _ sq: SkillQuota) -> some View {
        let out = sq.blocked != nil || sq.remaining == 0
        return HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(.muted).frame(width: 22).accessibilityHidden(true)
            Text(title).font(.subheadline).foregroundStyle(.ink)
            Spacer(minLength: 8)
            Text(CommunityText.left(sq)).font(.caption).foregroundStyle(out ? Color.warnText : Color.muted).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}
