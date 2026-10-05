import XCTest
@testable import IELTS

final class MockTests: XCTestCase {
    private func section(_ skill: String, _ state: String, band: Double? = nil, elapsed: Int? = nil, limit: Int? = nil, mode: String? = nil) -> MockSection {
        MockSection(skill: skill, state: state, band: band, attemptId: nil, sessionId: nil, elapsedS: elapsed, limitS: limit, mode: mode)
    }

    private func mock(next: String?, status: String = "in_progress", overall: Double? = nil, states: [String] = ["todo", "todo", "todo", "todo"]) -> MockExam {
        MockExam(id: "m1", variant: "academic", source: "generated", ref: nil, status: status, startedAt: "2026-10-01T10:00:00.000Z",
                 expiresAt: "2026-10-08T10:00:00.000Z", completedAt: nil, next: next, overall: overall,
                 sections: zip(MockFlow.skills, states).map { section($0, $1) })
    }

    func testDecodesTheServerShape() throws {
        let json = """
        {"id":"m1","variant":"general","source":"cambridge","ref":"C19 T2","status":"in_progress","startedAt":"2026-10-01T10:00:00.000Z",
         "expiresAt":"2026-10-08T10:00:00.000Z","completedAt":null,"next":"reading","overall":null,
         "sections":[{"skill":"listening","state":"done","band":6.5,"attemptId":"a1","sessionId":null,"elapsedS":1800,"limitS":1800,"mode":null},
                     {"skill":"reading","state":"in_progress","band":null,"attemptId":"a2","sessionId":null,"elapsedS":600,"limitS":3600,"mode":null},
                     {"skill":"writing","state":"todo","band":null,"attemptId":null,"sessionId":null,"elapsedS":null,"limitS":3600,"mode":null},
                     {"skill":"speaking","state":"todo","band":null,"attemptId":null,"sessionId":null,"elapsedS":null,"limitS":null,"mode":null}]}
        """
        let m = try JSONDecoder().decode(MockExam.self, from: Data(json.utf8))
        XCTAssertEqual(m.ref, "C19 T2")
        XCTAssertTrue(m.isOpen)
        XCTAssertEqual(m.next, "reading")
        XCTAssertNil(m.overall)
        XCTAssertEqual(m.section("listening")?.band, 6.5)
        XCTAssertEqual(m.section("speaking")?.limitS, nil)
        XCTAssertEqual(m.sections.count, 4)
    }

    func testDecodesOptionsAndChoice() throws {
        let q = #"{"used":0,"limit":1,"remaining":1,"resetAt":null,"window":"day","blocked":null}"#
        let o = try JSONDecoder().decode(MockOptions.self, from: Data(#"{"cambridge":[{"ref":"C17 T2","bookTest":"C17 T2","started":true}],"own":true,"quota":{"writing":\#(q),"speaking":\#(q)}}"#.utf8))
        XCTAssertEqual(o.cambridge.first?.ref, "C17 T2")
        XCTAssertTrue(o.own)
        XCTAssertEqual(o.quota.writing.remaining, 1)
        let c = try JSONDecoder().decode(MockSpeakingChosen.self, from: Data(#"{"mode":"live","source":"cambridge","ref":null}"#.utf8))
        XCTAssertEqual(c.mode, "live")
        XCTAssertNil(c.test)
    }

    func testTransitionNamesTheFinishedAndNextSection() {
        XCTAssertEqual(MockFlow.transition(next: "listening")?.title, "Ready for Listening?")
        XCTAssertEqual(MockFlow.transition(next: "reading")?.title, "Listening finished.")
        XCTAssertEqual(MockFlow.transition(next: "reading")?.body, "Next: Reading, 60 minutes. Nothing is running. The clock starts when you press Start.")
        XCTAssertEqual(MockFlow.transition(next: "writing")?.title, "Reading finished.")
        XCTAssertTrue(MockFlow.transition(next: "writing")?.body.contains("60 minutes for both tasks") == true)
    }

    func testSpeakingAndFinishedMocksHaveNoTransition() {
        XCTAssertNil(MockFlow.transition(next: "speaking")) // the choice screen takes over
        XCTAssertNil(MockFlow.transition(next: nil))
    }

    func testRowStatusPerState() {
        XCTAssertEqual(MockFlow.status(section("speaking", "todo")).text, "Not taken yet")
        XCTAssertEqual(MockFlow.status(section("reading", "todo")).text, "Not started")
        XCTAssertEqual(MockFlow.status(section("writing", "marking")).text, "Being marked")
        XCTAssertEqual(MockFlow.status(section("writing", "failed")).text, "Marking failed, retry")
        XCTAssertEqual(MockFlow.status(section("speaking", "skipped")).text, "Skipped")
        XCTAssertEqual(MockFlow.status(section("listening", "done")).tone, .good)
    }

    func testOnlySubmittedSectionsLinkToAResult() {
        for s in ["submitted", "marking", "done", "failed"] { XCTAssertTrue(MockFlow.isFinished(section("writing", s)), s) }
        for s in ["todo", "in_progress", "skipped"] { XCTAssertFalse(MockFlow.isFinished(section("writing", s)), s) }
    }

    func testMetaShowsTimeUsedOrTheSpeakingMode() {
        XCTAssertEqual(MockFlow.meta(section("reading", "in_progress", elapsed: 750, limit: 3600)), "12 min used of 60")
        XCTAssertNil(MockFlow.meta(section("reading", "in_progress", elapsed: 0, limit: 3600)))
        XCTAssertEqual(MockFlow.meta(section("speaking", "done", mode: "live")), "Live examiner")
        XCTAssertEqual(MockFlow.meta(section("speaking", "marking", mode: "recorded")), "Recorded test")
        XCTAssertNil(MockFlow.meta(section("speaking", "skipped", mode: "live")))
    }

    func testOverallNote() {
        XCTAssertTrue(MockFlow.overallNote(mock(next: nil, status: "completed", overall: 6.5), target: 7).hasPrefix("Mean of your four section bands"))
        XCTAssertTrue(MockFlow.overallNote(mock(next: nil, status: "closed"), target: 7).contains("without Speaking"))
        XCTAssertTrue(MockFlow.overallNote(mock(next: nil, states: ["done", "done", "marking", "done"]), target: 7).contains("Marking takes about a minute"))
        XCTAssertEqual(MockFlow.overallNote(mock(next: "reading"), target: 7), "Overall appears when all four sections are marked.")
    }

    func testContinueLine() {
        XCTAssertEqual(MockFlow.continueLine(mock(next: "reading")), "Continue your mock test, Reading next")
    }

    func testDefaultRefIsTheLowestNotStarted() {
        func c(_ r: String, _ started: Bool) -> MockOptions.Cambridge { MockOptions.Cambridge(ref: r, bookTest: r, started: started) }
        XCTAssertEqual(MockFlow.defaultRef([c("C19 T2", false), c("C17 T4", true), c("C17 T10", false), c("C17 T9", false)]), "C17 T9")
        XCTAssertEqual(MockFlow.defaultRef([c("C18 T1", true), c("C17 T3", true)]), "C17 T3") // all started: the lowest again
        XCTAssertNil(MockFlow.defaultRef([]))
    }
}
