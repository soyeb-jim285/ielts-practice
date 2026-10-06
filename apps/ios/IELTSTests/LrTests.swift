import XCTest
@testable import IELTS

final class LrTests: XCTestCase {
    func testCheckEndsAtDecodesAndDefaults() throws {
        let t = try JSONDecoder().decode(LrTest.self, from: Data(#"{"slug":"s","skill":"listening","variant":"academic","source":"cambridge","ref":"C10 T1","title":"T","sections":[],"checkEndsAt":996}"#.utf8))
        XCTAssertEqual(t.checkEndsAt, 996)
        let old = try JSONDecoder().decode(LrTest.self, from: Data(#"{"slug":"s","skill":"listening","variant":"academic","source":"generated","ref":"G1","title":"T","sections":[]}"#.utf8))
        XCTAssertNil(old.checkEndsAt)
    }

    @MainActor func testReviewFallsBackToTwoMinutesWithoutDurations() {
        XCTAssertEqual(LrExamPlaylist(urls: [], startElapsed: 0, checkEndsAt: 996).reviewSeconds, Double(Lr.listeningReviewSeconds))
    }

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

    func testPartialAttempts() {
        XCTAssertEqual(Lr.readingLimit(nil), 3600)
        XCTAssertEqual(Lr.readingLimit([2]), 1200)
        XCTAssertEqual(Lr.partsLabel("listening", [3]), "Part 3")
        XCTAssertEqual(Lr.partsLabel("reading", [1, 3]), "Passages 1, 3")
        XCTAssertEqual(Lr.partsLabel("reading", nil), "Full test")
        let item = try! JSONDecoder().decode(LrTestItem.self, from: Data(#"{"id":"t","slug":"s","skill":"reading","variant":"academic","source":"generated","ref":"G1","title":"T","total":13,"status":"in_progress","attemptId":"a","mode":"exam","parts":[2],"answered":1,"bestBand":null,"attempts":0}"#.utf8))
        XCTAssertEqual(item.parts, [2])
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

    // MARK: Exam fidelity

    func testHighlightMergeAndNotes() {
        let t = "The quick brown fox jumps"
        var m = LrMarkOps.addHighlight([], region: "passage:1:0", p: 0, s: 4, e: 9, text: t, id: "a")
        m = LrMarkOps.addHighlight(m, region: "passage:1:0", p: 0, s: 7, e: 15, text: t, id: "b")
        XCTAssertEqual(m.count, 1)
        XCTAssertEqual([m[0].s, m[0].e], [4, 15])
        XCTAssertEqual(m[0].ex, "quick brown")
        m = LrMarkOps.addHighlight(m, region: "passage:1:1", p: 1, s: 4, e: 9, text: t, id: "c")
        XCTAssertEqual(m.count, 2) // other region: no merge
        m = LrMarkOps.addNote(m, region: "passage:1:0", p: 0, s: 0, e: 3, text: t, note: "  first word  ", id: "n")
        XCTAssertEqual(LrMarkOps.inRegion(m, "passage:1:0").first { $0.id == "n" }?.note, "first word")
        // a range over a noted mark never merges: highlighting is a no-op, adding a note edits it
        XCTAssertEqual(LrMarkOps.addHighlight(m, region: "passage:1:0", p: 0, s: 1, e: 2, text: t), m)
        let edited = LrMarkOps.addNote(m, region: "passage:1:0", p: 0, s: 1, e: 2, text: t, note: "changed")
        XCTAssertEqual(edited.count, m.count)
        XCTAssertEqual(edited.first { $0.id == "n" }?.note, "changed")
        XCTAssertNil(LrMarkOps.setNote(m, id: "n", note: "   ").first { $0.id == "n" }?.note)
        XCTAssertEqual(LrMarkOps.cleanNote(String(repeating: "x", count: 600))?.count, 500)
        XCTAssertEqual(LrMarkOps.remove(m, id: "n").count, m.count - 1)
    }

    func testMarkStoreRoundTrip() {
        let d = UserDefaults(suiteName: "lr-marks-test")!
        d.removePersistentDomain(forName: "lr-marks-test")
        let store = LrMarkStore(attemptId: "att", defaults: d)
        store.highlight(.init(region: "q:5:text", p: 0, s: 0, e: 4, text: "Which place"))
        store.note(.init(region: "q:5:text", p: 0, s: 6, e: 11, text: "Which place"))
        guard let ed = store.editor else { return XCTFail("note editor should open") }
        store.save(ed, note: "check")
        XCTAssertEqual(store.marks.count, 2)
        let again = LrMarkStore(attemptId: "att", defaults: d)
        XCTAssertEqual(again.marks, store.marks)
        XCTAssertEqual(again.marks.compactMap(\.note), ["check"])
        LrMarkStore.clear("att", defaults: d)
        XCTAssertTrue(LrMarkStore(attemptId: "att", defaults: d).marks.isEmpty)
    }

    func testMarkRegions() {
        XCTAssertEqual(LrMarkOps.place("passage:2:3"), "Passage 2, paragraph 4")
        XCTAssertEqual(LrMarkOps.place("passage:2:3.1"), "Passage 2, paragraph 4")
        XCTAssertEqual(LrMarkOps.place("q:14:opt:B"), "Question 14")
        XCTAssertEqual(LrMarkOps.question("grp:7:w2"), 7)
        XCTAssertNil(LrMarkOps.question("passage:1:0"))
    }

    func testNoteMarkerOffsets() {
        let ins = [5, 5, 9] // markers sit at display 5, 6 and 11
        XCTAssertEqual(LrOffsets.dispStart(5, ins), 7)
        XCTAssertEqual(LrOffsets.dispEnd(5, ins), 5)
        XCTAssertEqual(LrOffsets.plain(7, ins), 5)
        XCTAssertEqual(LrOffsets.plain(12, ins), 9)
        XCTAssertEqual(LrOffsets.plain(3, ins), 3)
        for p in 0...14 { XCTAssertEqual(LrOffsets.plain(LrOffsets.dispStart(p, ins), ins), p) }
    }

    func testSettingsStore() {
        let d = UserDefaults(suiteName: "lr-settings-test")!
        d.removePersistentDomain(forName: "lr-settings-test")
        XCTAssertEqual(LrSettings.load(d), LrSettings())
        LrSettings(size: .xl, scheme: .yb).save(d)
        XCTAssertEqual(d.string(forKey: "lr.settings"), #"{"scheme":"yb","size":"xl"}"#)
        XCTAssertEqual(LrSettings.load(d), LrSettings(size: .xl, scheme: .yb))
        d.set(#"{"size":"huge"}"#, forKey: "lr.settings")
        XCTAssertEqual(LrSettings.load(d), LrSettings())
        let s = LrSettingsStore(defaults: d)
        s.value.scheme = .cream
        s.value = LrSettings()
        XCTAssertEqual(LrSettings.load(d), LrSettings())
        XCTAssertEqual(LrStyle.make(.std).inputBorder, 1)
        XCTAssertEqual(LrStyle.make(.bw).inputBorder, 2)
    }

    func testReadingClockRules() {
        XCTAssertEqual(LrClockRule.tone(left: 601, limit: 3600), .neutral)
        XCTAssertEqual(LrClockRule.tone(left: 600, limit: 3600), .warn)
        XCTAssertEqual(LrClockRule.tone(left: 301, limit: 3600), .warn)
        XCTAssertEqual(LrClockRule.tone(left: 300, limit: 3600), .strong)
        XCTAssertEqual(LrClockRule.tone(left: 100, limit: 600), .neutral) // limit not above 10 minutes
        XCTAssertEqual(LrClockRule.crossed(prev: 601, now: 600, limit: 1200), 600)
        XCTAssertEqual(LrClockRule.crossed(prev: 301, now: 300, limit: 1200), 300)
        XCTAssertNil(LrClockRule.crossed(prev: 600, now: 599, limit: 1200))
        XCTAssertNil(LrClockRule.crossed(prev: 601, now: 600, limit: 600))
        XCTAssertEqual(LrClockRule.announcement(600), "10 minutes remaining")
        XCTAssertEqual(LrClockRule.announcement(300), "5 minutes remaining")
    }
}
