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

    func testMultiBlankQuestion() {
        XCTAssertEqual(Lr.numberGapParts("from {{7}} to {{7}}, {{8}}"), "from {{7:0:2}} to {{7:1:2}}, {{8}}")
        XCTAssertEqual(Lr.parseContent("from {{7}} to {{7}}").first, Lr.Block.p([.text("from "), .gap(7, part: 0, of: 2), .text(" to "), .gap(7, part: 1, of: 2)]))
        var v = Lr.setGapPart("", 1, 2, "4.30")
        XCTAssertEqual(v, " / 4.30")
        v = Lr.setGapPart(v, 0, 2, "10 ")
        XCTAssertEqual([Lr.gapPart(v, 0), Lr.gapPart(v, 1)], ["10 ", "4.30"])
        XCTAssertEqual(Lr.setGapPart(" / x", 1, 2, ""), "")
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

    func testAudioResumePosition() {
        XCTAssertEqual(LrAudioState.resumePosition(205.5, duration: 600), 205.5)
        XCTAssertEqual(LrAudioState.resumePosition(598, duration: 600), 0)
        XCTAssertEqual(LrAudioState.resumePosition(0.5, duration: 600), 0)
        XCTAssertEqual(LrAudioState.resumePosition(50, duration: .nan), 0)
    }

    func testAudioCleanedAndStore() {
        let c = LrAudioState(pos: ["1": 12.34, "2": .nan, "3": -4, "4": 9999, "x": 1], rate: 2).cleaned
        XCTAssertEqual(c.pos, ["1": 12.3, "3": 0, "4": 3600])
        XCTAssertNil(c.rate)
        let d = UserDefaults(suiteName: "lr-audio-test")!
        d.removePersistentDomain(forName: "lr-audio-test")
        XCTAssertEqual(LrAudioState.load("a", server: LrAudioState(pos: ["1": 30], rate: 0.75), defaults: d), LrAudioState(pos: ["1": 30], rate: 0.75))
        LrAudioState(pos: ["1": 40, "3": 7], rate: 1).saveLocal("a", defaults: d)
        XCTAssertEqual(LrAudioState.load("a", server: LrAudioState(pos: ["1": 30]), defaults: d), LrAudioState(pos: ["1": 40, "3": 7], rate: 1))
        XCTAssertNil(LrAudioState.load("b", server: nil, defaults: d))
    }
}
