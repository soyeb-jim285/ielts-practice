import XCTest
@testable import IELTS

final class CommunityTests: XCTestCase {
    private var utc: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
    private func d(_ iso: String) -> Date { CommunityText.date(iso)! }
    private func sq(used: Int = 0, limit: Int? = 1, window: String? = "day", resetAt: String? = nil, blocked: String? = nil) -> SkillQuota {
        SkillQuota(used: used, limit: limit, remaining: limit.map { max(0, $0 - used) }, resetAt: resetAt, window: window, blocked: blocked)
    }

    func testResetWhenUnderADayCountsHoursAndMinutes() {
        let now = d("2026-10-03T19:00:00Z")
        XCTAssertEqual(CommunityText.resetWhen(d("2026-10-04T00:00:00Z"), now: now, calendar: utc), "in 5 h")
        XCTAssertEqual(CommunityText.resetWhen(d("2026-10-03T19:40:00Z"), now: now, calendar: utc), "in 40 min")
        XCTAssertEqual(CommunityText.resetWhen(d("2026-10-03T19:00:10Z"), now: now, calendar: utc), "in a minute")
    }

    func testResetWhenAWeekNamesTheLocalWeekday() {
        let now = d("2026-10-01T10:00:00Z")
        let text = CommunityText.resetWhen(d("2026-10-05T06:00:00Z"), now: now, calendar: utc, locale: Locale(identifier: "en_US_POSIX"))
        XCTAssertEqual(text, "Monday 6:00")
    }

    func testLeftLabels() {
        let now = d("2026-10-03T19:00:00Z")
        XCTAssertEqual(CommunityText.left(sq(), now: now, calendar: utc), "1 test left today")
        XCTAssertEqual(CommunityText.left(sq(window: "week"), now: now, calendar: utc), "1 test left this week")
        XCTAssertEqual(CommunityText.left(sq(limit: 3, window: "week"), now: now, calendar: utc), "3 tests left this week")
        XCTAssertEqual(CommunityText.left(sq(used: 1, resetAt: "2026-10-04T00:00:00Z"), now: now, calendar: utc), "No tests left. Resets in 5 h")
        XCTAssertEqual(CommunityText.left(sq(limit: nil, window: nil), now: now), "Unlimited with your key")
        XCTAssertEqual(CommunityText.left(sq(blocked: "community_balance_exhausted")), "The community balance is used up for now")
    }

    func testMoneyFormatting() {
        XCTAssertEqual(CommunityText.money(12.4), "$12.40")
        XCTAssertEqual(CommunityText.limit(20), "$20")
        XCTAssertEqual(CommunityText.limit(12.5), "$12.50")
    }

    func testFairUseBodyForCommunityAndGuest() {
        let balance = CommunityBalance(limit: 20, used: 7.6, remaining: 12.4, updatedAt: "2026-10-03T10:00:00Z")
        let community = Quota(tier: "community", speaking: sq(), writing: sq(), liveProviders: [], communityBalance: balance)
        let body = CommunityText.fairUseBody(skill: "speaking", quota: community)
        XCTAssertTrue(body.contains("You have 1 speaking test left today."))
        XCTAssertTrue(body.contains("The community balance has $12.40 left."))
        XCTAssertTrue(body.hasSuffix("Add your own API key in Settings."))
        let guest = Quota(tier: "guest", speaking: sq(window: "week"), writing: sq(window: "week"), liveProviders: [], communityBalance: balance)
        let g = CommunityText.fairUseBody(skill: "writing", quota: guest)
        XCTAssertTrue(g.contains("1 writing test left this week."))
        XCTAssertTrue(g.hasSuffix("Create an account for 1 test a day."))
    }

    func testErrorCodesMapToIssues() {
        let quota = CommunityIssue(APIError(status: 429, message: "x", code: "quota_exceeded", skill: "speaking", resetAt: "2026-10-05T00:00:00.000Z", tier: "guest"))
        XCTAssertEqual(quota?.kind, .quota)
        XCTAssertEqual(quota?.primary, .createAccount)
        XCTAssertEqual(quota?.title, "You've used this week's free test")
        let community = CommunityIssue(APIError(status: 429, message: "x", code: "quota_exceeded", skill: "writing", resetAt: nil, tier: "community"))
        XCTAssertEqual(community?.primary, .addKey)
        XCTAssertEqual(CommunityIssue(APIError(status: 402, message: "x", code: "community_balance_exhausted"))?.kind, .balance)
        XCTAssertEqual(CommunityIssue(APIError(status: 503, message: "x", code: "community_busy"))?.primary, .retry)
        XCTAssertEqual(CommunityIssue(APIError(status: 403, message: "x", code: "live_requires_own_key", tier: "community"))?.kind, .liveKey)
        XCTAssertEqual(CommunityIssue(APIError(status: 429, message: "x", code: "too_many_requests"))?.kind, .tooFast)
        XCTAssertNil(CommunityIssue(APIError(status: 400, message: "x", code: "invalid_key")))
    }

    func testFairUseKeyIsPerUserAndPerUtcDay() {
        let a = FairUse.key(user: "u1", now: d("2026-10-03T23:59:00Z"))
        XCTAssertEqual(a, "ielts.fairUse.u1.2026-10-03")
        XCTAssertNotEqual(a, FairUse.key(user: "u1", now: d("2026-10-04T00:01:00Z")))
        XCTAssertEqual(FairUse.key(user: nil, now: d("2026-10-03T12:00:00Z")), "ielts.fairUse.guest.2026-10-03")
    }
}
