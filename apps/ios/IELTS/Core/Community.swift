import Foundation

// Community mode (docs/community.md): quota labels, reset times, the fair-use text and the error-code UX. Pure logic, no views.

enum CommunityText {
    /// ISO instants arrive with or without fractional seconds.
    static func date(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    /// "$12.40"
    static func money(_ v: Double) -> String { String(format: "$%.2f", v) }

    /// "$20" for a whole limit, "$12.50" otherwise.
    static func limit(_ v: Double) -> String { v.rounded() == v ? String(format: "$%.0f", v) : money(v) }

    /// "in 40 min", "in 5 h" (under a day) or "Monday 6:00", always in the viewer's local time.
    static func resetWhen(_ d: Date, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let s = d.timeIntervalSince(now)
        // Same rounding and wording as the web and Android: minutes round up, hours to the nearest.
        if s <= 60 { return "in a moment" }
        let minutes = Int(ceil(s / 60))
        if minutes < 60 { return "in \(minutes) min" }
        if s < 86400 { return "in \(max(1, Int((Double(minutes) / 60).rounded()))) h" }
        let f = DateFormatter()
        f.calendar = calendar
        f.locale = locale
        f.timeZone = calendar.timeZone
        f.dateFormat = "EEEE H:mm"
        return f.string(from: d)
    }

    /// "Resets in 5 h" / "Resets Monday 6:00"
    static func resets(_ d: Date, now: Date = Date(), calendar: Calendar = .current) -> String { "Resets " + resetWhen(d, now: now, calendar: calendar) }

    /// The line under a Start button.
    static func left(_ q: SkillQuota, now: Date = Date(), calendar: Calendar = .current) -> String {
        if q.blocked == "community_balance_exhausted" { return "The community balance is used up for now" }
        if q.blocked == "community_busy" { return "Busy right now, try again in a few minutes" }
        guard q.limit != nil, let remaining = q.remaining else { return "Unlimited with your key" }
        let when = q.window == "week" ? "this week" : "today"
        if remaining > 0 { return "\(remaining) \(remaining == 1 ? "test" : "tests") left \(when)" }
        if let d = date(q.resetAt) { return "No tests left. " + resets(d, now: now, calendar: calendar) }
        return "No tests left \(when)"
    }

    static func skillQuota(_ q: Quota, _ skill: String) -> SkillQuota { skill == "speaking" ? q.speaking : q.writing }

    /// Body of the fair-use dialog (the same words on every platform).
    static func fairUseBody(skill: String, quota q: Quota) -> String {
        let sq = skillQuota(q, skill)
        var out = "This test is paid from a shared balance that everyone uses. Please don't abuse it: no spamming tests and no automated use."
        if let n = sq.remaining {
            out += "\n\nYou have \(n) \(skill) \(n == 1 ? "test" : "tests") left \(sq.window == "week" ? "this week" : "today")."
        }
        // The balance itself is the meter under this text; saying it twice only makes the paragraph longer.
        out += q.tier == "guest" ? "\n\nCreate an account for 1 test a day." : "\n\nWant unlimited tests and the live examiner? Add your own API key in Settings."
        return out
    }
}

enum IssueAction { case createAccount, addKey, addOpenRouterKey, retry }

/// A community error code, ready to show: friendly title and message plus the way out (never the raw server text).
struct CommunityIssue: Equatable {
    enum Kind: Equatable { case quota, balance, busy, liveKey, tooFast }
    let kind: Kind
    var skill: String? = nil
    var resetAt: Date? = nil
    var tier: String? = nil

    var isGuest: Bool { tier == "guest" }

    init(kind: Kind, skill: String? = nil, resetAt: Date? = nil, tier: String? = nil) {
        self.kind = kind
        self.skill = skill
        self.resetAt = resetAt
        self.tier = tier
    }

    init?(_ e: APIError) {
        switch e.code {
        case "quota_exceeded": self.init(kind: .quota, skill: e.skill, resetAt: CommunityText.date(e.resetAt), tier: e.tier)
        case "community_balance_exhausted": self.init(kind: .balance)
        case "community_busy": self.init(kind: .busy)
        case "too_many_requests": self.init(kind: .tooFast)
        case "live_requires_own_key": self.init(kind: .liveKey, tier: e.tier)
        default: return nil
        }
    }

    /// From a `blocked` value of GET /api/quota.
    init?(blocked: String?, skill: String, quota q: SkillQuota, tier: String) {
        switch blocked {
        case "quota_exceeded": self.init(kind: .quota, skill: skill, resetAt: CommunityText.date(q.resetAt), tier: tier)
        case "community_balance_exhausted": self.init(kind: .balance, skill: skill, tier: tier)
        case "community_busy": self.init(kind: .busy, skill: skill, tier: tier)
        default: return nil
        }
    }

    var title: String {
        switch kind {
        case .quota: return isGuest ? "You've used this week's free test" : "You've used today's free test"
        case .balance: return "The community balance is used up for now"
        case .busy: return "A lot of people are practising right now"
        case .liveKey: return "The live examiner runs on your own key"
        case .tooFast: return "You're going a bit fast"
        }
    }

    func message(now: Date = Date()) -> String {
        switch kind {
        case .quota:
            return resetAt.map { "It resets " + CommunityText.resetWhen($0, now: now) + "." } ?? "It resets soon."
        case .balance:
            return "Free tests are paid from one shared balance, and it has run out. " + (isGuest ? "Create an account, then add" : "Add") + " your own OpenRouter key to keep practising, or try again later."
        case .busy: return "Try again in a few minutes."
        case .liveKey:
            return isGuest ? "Create an account, then add your own OpenAI or Gemini key in Settings."
                : "Add your own key in Settings: OpenRouter for the turn-based examiner, OpenAI for GPT-Live, Gemini for Gemini Live."
        case .tooFast: return "Try again in a moment."
        }
    }

    var primary: IssueAction? {
        switch kind {
        case .quota: return isGuest ? .createAccount : .addKey
        case .balance: return isGuest ? .createAccount : .addOpenRouterKey
        case .liveKey: return isGuest ? .createAccount : .addKey
        case .busy, .tooFast: return .retry
        }
    }

    /// Whether the shared balance meter belongs in the panel.
    var showsBalance: Bool { kind == .balance }

    func label(_ a: IssueAction) -> String {
        switch a {
        case .createAccount: return kind == .quota ? "Create an account for 1 test a day" : "Create an account"
        case .addKey: return "Add your own key"
        case .addOpenRouterKey: return "Add your own OpenRouter key"
        case .retry: return "Try again"
        }
    }

    /// One-line summary for places with no room for a panel (an upload that was refused).
    static func summary(_ error: Error) -> String {
        if let e = error as? APIError, let i = CommunityIssue(e) { return i.title + ". " + i.message() }
        return error.localizedDescription
    }
}

/// "Seen the fair-use dialog": once per user per UTC day (per device for a guest).
enum FairUse {
    static func key(user: String?, now: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return "ielts.fairUse.\(user ?? "guest").\(f.string(from: now))"
    }

    static func acknowledged(user: String?) -> Bool {
        // Screenshots: every demo screen skips the dialog except the ones that show it.
        if Demo.on { return !(Demo.screen ?? "").hasSuffix("fair-use") }
        return UserDefaults.standard.bool(forKey: key(user: user))
    }

    static func acknowledge(user: String?) {
        if !Demo.on { UserDefaults.standard.set(true, forKey: key(user: user)) }
    }
}
