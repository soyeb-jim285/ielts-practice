import XCTest
@testable import IELTS

/// Same cases as web components/dashboard/overall.test.ts.
final class DashboardTests: XCTestCase {
    func testAverageBandUsesLastFive() {
        XCTAssertNil(DashboardMath.averageBand([]).band)
        let r = DashboardMath.averageBand([4, 9, 6, 6, 6, 6, 7])
        XCTAssertEqual(r.n, 5)
        XCTAssertEqual(r.band, 6) // 6.2 rounds to 6
        XCTAssertEqual(DashboardMath.averageBand([6, 6.5]).band, 6.5) // 6.25 rounds up to 6.5
    }

    func testOverallNeedsTwoSkills() {
        XCTAssertNil(DashboardMath.overallEstimate([7, nil, nil, nil]).value)
        let r = DashboardMath.overallEstimate([7, nil, 6, nil])
        XCTAssertEqual(r.value, 6.5)
        XCTAssertEqual(r.count, 2)
    }

    func testChangeAndWeakest() {
        XCTAssertNil(DashboardMath.changeSinceFirst([6]))
        XCTAssertEqual(DashboardMath.changeSinceFirst([5.5, 6, 6.5]), 1)
        XCTAssertEqual(DashboardMath.changeText([6, 7]), "+1.0 since your first")
        XCTAssertEqual(DashboardMath.changeText([6.5, 6]), "−0.5 since your first")
        XCTAssertEqual(DashboardMath.changeText([6, 6]), "Same as your first")
        XCTAssertNil(DashboardMath.weakestSkill([6, nil, nil, nil]))
        XCTAssertEqual(DashboardMath.weakestSkill([6, 5.5, nil, 5.5]), 1)
    }
}
