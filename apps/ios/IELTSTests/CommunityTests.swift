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
        XCTAssertEqual(CommunityText.resetWhen(d("2026-10-03T19:00:10Z"), now: now, calendar: utc), "in a moment")
        XCTAssertEqual(CommunityText.resetWhen(d("2026-10-03T19:01:30Z"), now: now, calendar: utc), "in 2 min")
        XCTAssertEqual(CommunityText.resetWhen(d("2026-10-03T23:20:00Z"), now: now, calendar: utc), "in 4 h") // hours round to the nearest, like web and Android
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
        XCTAssertEqual(CommunityText.left(sq(limit: 5, window: "month"), now: now, calendar: utc), "5 tests left this month")
        XCTAssertEqual(CommunityText.left(sq(limit: nil, window: nil), now: now), "Unlimited")
        XCTAssertEqual(CommunityText.left(sq(blocked: "community_balance_exhausted")), "Scoring is paused, try again later")
    }

    func testFairUseBodyForCommunityAndGuest() {
        let community = Quota(tier: "community", speaking: sq(), writing: sq(), live: true)
        let body = CommunityText.fairUseBody(skill: "speaking", quota: community)
        XCTAssertTrue(body.contains("You have 1 speaking test left today."))
        XCTAssertTrue(body.hasSuffix("today."), "no sign-up line for an account")
        let guest = Quota(tier: "guest", speaking: sq(window: "week"), writing: sq(window: "week"), live: true)
        let g = CommunityText.fairUseBody(skill: "writing", quota: guest)
        XCTAssertTrue(g.contains("1 writing test left this week."))
        XCTAssertTrue(g.hasSuffix("Create a free account for more tests."))
    }

    func testQuotaDecodesNewAndUnknownTiers() throws {
        let s = #"{"used":0,"limit":null,"remaining":null,"resetAt":null,"window":null,"blocked":null}"#
        let q = try JSONDecoder().decode(Quota.self, from: Data(#"{"tier":"some-new-tier","speaking":\#(s),"writing":\#(s),"examiner":\#(s),"live":true}"#.utf8))
        XCTAssertEqual(q.tier, "some-new-tier")
        XCTAssertNotNil(q.examiner)
        let old = try JSONDecoder().decode(Quota.self, from: Data(#"{"tier":"unlimited","speaking":\#(s),"writing":\#(s),"live":false}"#.utf8))
        XCTAssertNil(old.examiner)
        XCTAssertEqual(old.liveQuota, old.speaking)
    }

    func testErrorCodesMapToIssues() {
        let quota = CommunityIssue(APIError(status: 429, message: "x", code: "quota_exceeded", skill: "speaking", resetAt: "2026-10-05T00:00:00.000Z", tier: "guest"))
        XCTAssertEqual(quota?.kind, .quota)
        XCTAssertEqual(quota?.primary, .createAccount)
        XCTAssertEqual(quota?.title, "You've used all your speaking tests for now")
        let community = CommunityIssue(APIError(status: 429, message: "x", code: "quota_exceeded", skill: "writing", resetAt: nil, tier: "community"))
        XCTAssertNil(community?.primary, "an account has no way out but waiting")
        XCTAssertEqual(CommunityIssue(APIError(status: 402, message: "x", code: "community_balance_exhausted"))?.kind, .paused)
        XCTAssertEqual(CommunityIssue(APIError(status: 503, message: "x", code: "community_busy"))?.primary, .retry)
        XCTAssertEqual(CommunityIssue(APIError(status: 429, message: "x", code: "too_many_requests"))?.kind, .tooFast)
        XCTAssertNil(CommunityIssue(APIError(status: 400, message: "x", code: "validation_error")))
    }

    func testPanelBodiesMatchTheWebCopy() {
        let day = CommunityIssue(kind: .quota, skill: "speaking", resetAt: d("2026-10-04T00:00:00Z"), tier: "community")
        XCTAssertEqual(day.message(now: d("2026-10-03T19:00:00Z")), "Your next one frees up in 5 h.")
        let guest = CommunityIssue(kind: .quota, skill: "examiner", resetAt: nil, tier: "guest")
        XCTAssertEqual(guest.title, "You've used all your live sessions for now")
        XCTAssertEqual(guest.message(), "Your next one frees up soon. Create a free account for more.")
        let paused = CommunityIssue(kind: .paused, tier: "guest")
        XCTAssertEqual(paused.title, "Scoring is paused for now")
        XCTAssertEqual(paused.message(), "Scoring is paused for a short while. Please try again later.")
        XCTAssertEqual(paused.primary, .retry)
    }

    func testFairUseKeyIsPerUserAndPerUtcDay() {
        let a = FairUse.key(user: "u1", now: d("2026-10-03T23:59:00Z"))
        XCTAssertEqual(a, "ielts.fairUse.u1.2026-10-03")
        XCTAssertNotEqual(a, FairUse.key(user: "u1", now: d("2026-10-04T00:01:00Z")))
        XCTAssertEqual(FairUse.key(user: nil, now: d("2026-10-03T12:00:00Z")), "ielts.fairUse.guest.2026-10-03")
    }
}
