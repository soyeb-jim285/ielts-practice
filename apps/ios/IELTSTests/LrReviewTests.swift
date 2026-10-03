import XCTest
@testable import IELTS

/// Mirrors packages/core/src/lr-review.test.ts (locating evidence, word timings, dictation).
final class LrReviewTests: XCTestCase {
    private func q(answer: [String]? = nil, evidence: String? = nil, at: Double? = nil) -> LrQuestion {
        LrQuestion(n: 1, text: nil, options: nil, answer: answer, review: (evidence != nil || at != nil) ? LrQuestionReview(evidence: evidence, at: at) : nil)
    }
    private func slice(_ s: String, _ sp: LrReview.Span) -> String { (s as NSString).substring(with: NSRange(location: sp.s, length: sp.e - sp.s)) }

    private let paras = ["The museum opened in 1895. It was designed by a local architect, who later moved abroad.", "Visitors can park behind the library on Fridays. Entry is free."]

    func testExactIgnoringCaseAndPunctuation() {
        let sp = LrReview.evidenceSpan(paras, q(evidence: "it was designed by a local architect"), gap: false)!
        XCTAssertEqual(sp.p, 0)
        XCTAssertEqual(slice(paras[0], sp).lowercased(), "it was designed by a local architect")
    }

    func testFragmentsThenClosestSentence() {
        let f = LrReview.evidenceSpan(paras, q(evidence: "The museum opened in 1895 ... who later moved abroad"), gap: false)!
        XCTAssertTrue(slice(paras[f.p], f).contains("abroad"))
        let n = LrReview.evidenceSpan(paras, q(evidence: "Visitors are able to park behind the library on Friday. Entry is free."), gap: false)!
        XCTAssertEqual(n.p, 1)
    }

    func testGapSentenceAroundAnswer() {
        let sp = LrReview.evidenceSpan(paras, q(answer: ["(the) library"]), gap: true)!
        XCTAssertEqual(slice(paras[1], sp), "Visitors can park behind the library on Fridays.")
        XCTAssertNil(LrReview.answerSentence(paras, ["nowhere"]))
        XCTAssertNil(LrReview.evidenceSpan(paras, q(answer: ["B"]), gap: false))
    }

    private let t: [LrWord] = ([(String, Double, Double)]([("The", 0, 0.2), ("tour", 0.3, 0.6), ("starts", 0.7, 1), ("at", 1.1, 1.2), ("half", 1.3, 1.5), ("past", 1.6, 1.8), ("six,", 1.9, 2.3), ("not", 2.5, 2.7), ("seven.", 2.8, 3.2), ("Please", 6, 6.4), ("bring", 6.5, 6.8), ("a", 6.9, 7), ("coat.", 7.1, 7.6)])).map { LrWord(w: $0.0, s: $0.1, e: $0.2) }

    func testLocatePhrase() {
        XCTAssertEqual(LrReview.locatePhrase(t, "half past six")?.start, 1.3)
        XCTAssertEqual(LrReview.locatePhrase(t, "half past six")?.end, 2.3)
        XCTAssertEqual(LrReview.locatePhrase(t, "Seven")?.start, 2.8)
        let fuzzy = LrReview.locatePhrase(t, "The tour starts at half-past six, not seven")
        XCTAssertEqual(fuzzy?.start, 0)
        XCTAssertEqual(fuzzy?.end, 3.2)
        XCTAssertNil(LrReview.locatePhrase(t, "elephant"))
        XCTAssertNil(LrReview.locatePhrase(nil, "six"))
        XCTAssertNil(LrReview.locatePhrase([], "six"))
    }

    func testAudioWindow() {
        let a = LrReview.audioWindow(t, q(evidence: "Please bring a coat"))!
        XCTAssertEqual(a.from, 4); XCTAssertEqual(a.to, 8.1, accuracy: 1e-9); XCTAssertEqual(a.start, 6); XCTAssertEqual(a.end, 7.6); XCTAssertTrue(a.exact)
        let b = LrReview.audioWindow(t, q(answer: ["coat"]))!
        XCTAssertTrue(b.exact); XCTAssertEqual(b.from, 5.1, accuracy: 1e-9)
        let c = LrReview.audioWindow(nil, q(at: 1))!
        XCTAssertEqual(c.from, 0); XCTAssertEqual(c.to, 7); XCTAssertFalse(c.exact)
        XCTAssertNil(LrReview.audioWindow(nil, q(answer: ["x"])))
    }

    func testQuestionMoments() {
        func qq(_ n: Int, _ answer: [String], at: Double? = nil) -> LrQuestion {
            LrQuestion(n: n, text: nil, options: nil, answer: answer, review: at.map { LrQuestionReview(evidence: nil, at: $0) })
        }
        let g = LrGroup(from: 1, to: 4, type: "gap", instructions: "", wordLimit: nil, title: nil, content: nil, options: nil, reusable: nil, image: nil,
                        questions: [qq(2, ["coat"]), qq(3, ["x"], at: 20), qq(4, ["y"])])
        let m = LrReview.questionMoments(t, [g])
        XCTAssertEqual(m.map(\.n), [2, 3]) // 4 cannot be located; ordered by time
        XCTAssertEqual(m[0].at, 7.1, accuracy: 1e-9); XCTAssertTrue(m[0].exact)
        XCTAssertEqual(m[1].at, 20); XCTAssertFalse(m[1].exact)
    }

    func testDictationDiff() {
        XCTAssertTrue(LrReview.dictationDiff("half past six", "Half past six.").allSatisfy { $0.status == .correct })
        let ops = LrReview.dictationDiff("the tour start at six now", "The tour starts at half past six")
        XCTAssertEqual(ops.map { "\($0.word):\($0.status)" }, ["The:correct", "tour:correct", "starts:wrong", "at:correct", "half:missing", "past:missing", "six:correct", ":extra"])
        let s = LrReview.dictationScore(ops)
        XCTAssertEqual(s.right, 4); XCTAssertEqual(s.total, 7)
        XCTAssertEqual(LrReview.dictationDiff("", "a b").map(\.status), [.missing, .missing])
    }

    func testExpandAndWrongNote() {
        XCTAssertEqual(LrReview.expandAnswer("(the) old (town) hall").sorted(), ["old hall", "old town hall", "the old hall", "the old town hall"])
        let qq = LrQuestion(n: 4, text: nil, options: nil, answer: ["FALSE"], review: LrQuestionReview(wrong: ["TRUE": "too strong"]))
        XCTAssertEqual(LrReview.wrongNote(qq, given: "true"), "too strong")
        XCTAssertEqual(LrReview.wrongNote(qq, given: "T"), "too strong")
        XCTAssertNil(LrReview.wrongNote(qq, given: ""))
    }
}
