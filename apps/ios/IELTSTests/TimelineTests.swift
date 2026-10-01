import XCTest
@testable import IELTS

/// Port of web lib/timeline.test.ts: markers by category prefix, question segments, long pauses, wpmAt and wordIndexAt.
final class TimelineTests: XCTestCase {
    private func result(errors: String = "[]", questions: String = "[]", unclear: String = "[]", events: String = "[]", pauses: String = "[]") throws -> AnalysisResult {
        let words = (0..<8).map { #"{"w":"w\#($0)","start":\#(Double($0) * 2),"end":\#(Double($0) * 2 + 1.5)}"# }.joined(separator: ",")
        let json = """
        {"skill":"speaking","overall":6,"overallRaw":6,"range":[5,7],"criteria":{},"topFixes":[],"errors":\(errors),
         "rewrite":{"text":"","note":""},"words":[\(words)],"questions":\(questions),
         "metrics":{"durationS":16,"wordCount":8,"speechRate":100,"articulationRate":120,"phonationRatio":0.8,"pauseRatio":0.2,"mlr":5,
           "pauses":\(pauses),"longPauses":0,"midClausePauses":0,"fillers":[],"fillersPerMin":0,"repetitions":[],"selfCorrections":[],
           "unclear":\(unclear),"wpmSeries":[{"t":0,"wpm":100},{"t":5,"wpm":140}],"wpmStdDev":10,
           "fluency":{"events":\(events)}}}
        """
        return try JSONDecoder().decode(AnalysisResult.self, from: Data(json.utf8))
    }

    private func err(_ id: String, _ cat: String, start: Int = 1, time: String = "null") -> String {
        #"{"id":"\#(id)","category":"\#(cat)","severity":"minor","start":\#(start),"end":\#(start + 1),"original":"a","correction":"b","explanation":"x","time":\#(time)}"#
    }

    func testCategoryPrefixMapping() {
        XCTAssertEqual(MarkerType.of(category: "grammar.article"), .grammar)
        XCTAssertEqual(MarkerType.of(category: "lexis.collocation"), .vocabulary)
        XCTAssertEqual(MarkerType.of(category: "vocabulary.collocation"), .vocabulary)
        XCTAssertEqual(MarkerType.of(category: "pronunciation.stress"), .pronunciation)
        XCTAssertEqual(MarkerType.of(category: "fluency.filler"), .fluency)
        XCTAssertNil(MarkerType.of(category: "task.relevance"))
        XCTAssertNil(MarkerType.of(category: "cohesion.linker"))
    }

    func testMarkersFromErrorsEventsAndUnclear() throws {
        let r = try result(errors: "[\(err("e1", "grammar.tense", start: 3)),\(err("e2", "task.relevance")),\(err("e3", "lexis.word", start: 1, time: "9.5"))]",
                           unclear: #"[{"wordIdx":0,"w":"w0","conf":0.4,"tier":2}]"#,
                           events: #"[{"kind":"filled","start":4.2,"end":4.6,"sources":["stt"]}]"#)
        let tl = Timeline(r)
        XCTAssertEqual(tl.markers.map(\.id), ["u0", "d0", "e1", "e3"]) // sorted by time; the task note has no marker
        XCTAssertEqual(tl.markers.map(\.type), [.pronunciation, .fluency, .grammar, .vocabulary])
        XCTAssertEqual(tl.markers[2].t, 6) // no time: the start word's start
        XCTAssertEqual(tl.markers[3].t, 9.5) // explicit time wins
        XCTAssertEqual(tl.markers[2].label, "a → b")
        XCTAssertEqual(tl.markers[1].label, "filler")
        XCTAssertEqual(tl.count(.grammar), 1)
    }

    func testQuestionSegmentsAndLongPauses() throws {
        let pauses = #"[{"start":1.5,"end":2.4,"dur":0.9,"kind":"between","midClause":false,"voiced":false},{"start":3.5,"end":4.8,"dur":1.3,"kind":"between","midClause":false,"voiced":false}]"#
        let r = try result(questions: #"[{"text":"Q one","startWord":0},{"text":"Q two","startWord":4}]"#, pauses: pauses)
        let tl = Timeline(r)
        XCTAssertEqual(tl.questions, [QuestionSegment(idx: 0, start: 0, end: 8, text: "Q one"), QuestionSegment(idx: 1, start: 8, end: 16, text: "Q two")])
        XCTAssertEqual(tl.pauses, [TimelinePause(start: 3.5, end: 4.8)]) // 0.9 s is not long
        XCTAssertEqual(tl.durationS, 16)
    }

    func testWpmAtInterpolatesAlongTheLine() {
        let s = [WpmPoint(t: 0, wpm: 100), WpmPoint(t: 10, wpm: 140)] // plotted at 5 and 15
        XCTAssertEqual(wpmAt(s, 0), 100)
        XCTAssertEqual(wpmAt(s, 10), 120, accuracy: 1e-9)
        XCTAssertEqual(wpmAt(s, 99), 140)
        XCTAssertEqual(wpmAt([], 3), 0)
    }

    func testWordIndexAt() {
        let w = [Word(w: "a", start: 1, end: 2, conf: nil), Word(w: "b", start: 3, end: 4, conf: nil)]
        XCTAssertEqual(wordIndexAt(w, 0.5), -1)
        XCTAssertEqual(wordIndexAt(w, 1), 0)
        XCTAssertEqual(wordIndexAt(w, 2.9), 0)
        XCTAssertEqual(wordIndexAt(w, 3), 1)
        XCTAssertEqual(wordIndexAt(w, 99), 1)
    }
}
