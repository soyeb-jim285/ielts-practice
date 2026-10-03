import XCTest
@testable import IELTS

final class LrTests: XCTestCase {
    func testParseInline() {
        XCTAssertEqual(Lr.parseInline("Fee £{{4}} per **week**"), [.text("Fee £"), .gap(4), .text(" per "), .bold("week")])
    }

    func testParseTable() {
        let md = "| Item | Detail |\n|---|---|\n| Surname | {{1}} |\n| Day | {{2}} evenings |"
        guard case let .table(head, rows) = Lr.parseContent(md).first else { return XCTFail("no table") }
        XCTAssertEqual(head.count, 2)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[1][1], [.gap(2), .text(" evenings")])
    }

    func testParseRef() {
        XCTAssertEqual(Lr.parseRef("C17 T2")?.book, 17)
        XCTAssertEqual(Lr.parseRef("C17 T2")?.test, 2)
        XCTAssertNil(Lr.parseRef("Dev L1"))
    }

    func testMultiPicks() {
        let q = { (n: Int) in LrQuestion(n: n, text: nil, options: nil, answer: nil) }
        let g = LrGroup(from: 11, to: 12, type: "mcq-multi", instructions: "", wordLimit: nil, title: nil, content: nil, options: nil, reusable: nil, image: nil, questions: [q(11), q(12)])
        let r = Lr.setMultiPicks(g, [:], ["B", "D"])
        XCTAssertEqual(r, ["11": "B", "12": "D"])
        XCTAssertEqual(Lr.multiPicks(g, Lr.setMultiPicks(g, r, ["D"])), ["D"])
    }
}
