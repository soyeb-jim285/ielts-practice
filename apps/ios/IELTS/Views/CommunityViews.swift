import SwiftUI

// Community mode UI (docs/community.md): balance meter, quota label, blocked panel, fair-use sheet, and the gates in front of tests.
// Teal is for "act here", so the meter and the info states are neutral; only the buttons that do something are teal.

/// "Community balance $12.40 of $20" with a thin neutral bar that turns amber under 10 %. Hidden while the balance is unknown or unlimited.
struct BalanceMeter: View {
    let balance: CommunityBalance?

    var body: some View {
        if let b = balance, let remaining = b.remaining, let limit = b.limit, limit > 0 {
            let fraction = min(1, max(0, remaining / limit))
            let low = fraction < 0.10
            let text = "\(CommunityText.money(remaining)) of \(CommunityText.limit(limit))"
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Label("Community balance", systemImage: "person.2").font(.subheadline).foregroundStyle(.ink)
                    Spacer(minLength: 8)
                    Text(text).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(low ? Color.warnText : Color.ink)
                }
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.surface2)
                        Capsule().fill(low ? Color.warn : Color.muted).frame(width: max(6, fraction * g.size.width))
                    }
                }
                .frame(height: 6)
                .accessibilityHidden(true)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Community balance")
            .accessibilityValue("\(CommunityText.money(remaining)) left of \(CommunityText.limit(limit))\(low ? ", running low" : "")")
        }
    }
}

/// The line under a Start button: "1 test left today", "No tests left. Resets Monday 6:00", "Unlimited with your key".
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
            case .createAccount: api.requestSignIn("Create an account for 1 test a day.", signUp: true)
            case .addKey, .addOpenRouterKey: onDismiss?(); api.openKeys()
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
    var balance: CommunityBalance?
    var onRetry: (() -> Void)?
    var onDismiss: (() -> Void)?

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: issue.kind == .liveKey ? "lock" : "hourglass")
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
                if issue.showsBalance { BalanceMeter(balance: balance).card() }
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

/// "You're using the community balance", shown once a day before a test paid from the shared balance.
struct FairUseSheet: View {
    let skill: String
    let quota: Quota
    let onStart: () -> Void
    let onOwnKey: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "person.2")
                    .font(.title2)
                    .foregroundStyle(.ink)
                    .frame(width: 52, height: 52)
                    .background(Color.surface2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                Text("You're using the community balance")
                    .font(.display(.title2, weight: .semibold)).foregroundStyle(.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(CommunityText.fairUseBody(skill: skill, quota: quota)).foregroundStyle(.ink)
                BalanceMeter(balance: quota.communityBalance).card()
                VStack(spacing: 12) {
                    Button(action: onStart) { Text("Start test").frame(maxWidth: .infinity, minHeight: 28) }
                        .primaryButton().controlSize(.large)
                    Button(action: onOwnKey) { Text(quota.tier == "guest" ? "Create an account" : "Use my own key").frame(maxWidth: .infinity, minHeight: 28) }
                        .secondaryButton().controlSize(.large)
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
        }
    }

    @ViewBuilder private var screen: some View {
        switch phase {
        case let .blocked(issue):
            IssuePanel(issue: issue, balance: api.quota?.communityBalance, onRetry: { check += 1 }, onDismiss: { dismiss() })
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
                    if let q = api.quota { FairUseSheet(skill: skill, quota: q, onStart: { Task { await begin() } }, onOwnKey: ownKey) }
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
            phase = .failed("Can't reach IELTS Practice. Check your internet connection and try again.")
            return
        }
        let sq = CommunityText.skillQuota(q, skill)
        if let issue = CommunityIssue(blocked: sq.blocked, skill: skill, quota: sq, tier: q.tier) { phase = .blocked(issue); return }
        if q.tier != "own-key" && !FairUse.acknowledged(user: userKey) { phase = .fairUse; return }
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

    /// "Use my own key" (or "Create an account" for a guest): leave the test, then open Settings or the sign-up sheet.
    private func ownKey() {
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            api.openKeys()
        }
    }
}

/// In front of the live examiner: it never runs on the community balance, so it needs the user's own key.
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
                if q.liveProviders.isEmpty {
                    IssuePanel(issue: CommunityIssue(kind: .liveKey, tier: q.tier), onRetry: nil, onDismiss: { dismiss() })
                } else if let issue = CommunityIssue(blocked: q.speaking.blocked, skill: "speaking", quota: q.speaking, tier: q.tier) {
                    IssuePanel(issue: issue, balance: q.communityBalance, onRetry: { check += 1 }, onDismiss: { dismiss() })
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

/// Settings: the balance everyone shares, and what is left of this person's tests.
struct CommunitySection: View {
    @Environment(APIClient.self) private var api

    var body: some View {
        Section {
            if let q = api.quota {
                BalanceMeter(balance: q.communityBalance).padding(.vertical, 4)
                LabeledContent("Speaking", value: CommunityText.left(q.speaking))
                LabeledContent("Writing", value: CommunityText.left(q.writing))
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        } header: {
            Text("Your tests")
        } footer: {
            Text(api.quota?.tier == "own-key" ? "Your own key pays for your tests."
                 : api.quota?.tier == "guest" ? "Guests get 1 speaking and 1 writing test a week. Create an account for 1 of each a day. Tests are paid from a balance everyone shares, so please don't abuse it."
                 : "Tests are paid from a balance the whole community shares. Please don't abuse it.")
        }
        .id("community")
    }
}

/// Home: the shared balance and what is left of this person's tests, in one compact card.
struct CommunityCard: View {
    @Environment(APIClient.self) private var api

    var body: some View {
        if let q = api.quota {
            VStack(alignment: .leading, spacing: 12) {
                BalanceMeter(balance: q.communityBalance)
                if q.communityBalance.remaining != nil { Divider() }
                row("mic", "Speaking", q.speaking)
                row("pencil.line", "Writing", q.writing)
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
