import XCTest
@testable import IELTS

/// Mirrors packages/core/src/band.test.ts.
final class BandTests: XCTestCase {
    func testRoundBandTable() {
        let table: [(Double, Double)] = [(6, 6), (6.1, 6), (6.25, 6.5), (6.4, 6.5), (6.5, 6.5), (6.74, 6.5), (6.75, 7), (6.9, 7), (8.875, 9)]
        for (x, y) in table { XCTAssertEqual(Band.round(x), y, "\(x)") }
    }

    func testSpeakingOverall() {
        let o = Band.speakingOverall(fc: 7, lr: 6, gra: 6, p: 6)
        XCTAssertEqual(o.raw, 6.25)
        XCTAssertEqual(o.band, 6.5)
    }

    func testWritingWeightsTask2Double() {
        let a = Band.writingOverall(t1: 6, t2: 7)
        XCTAssertEqual(a.raw, 20.0 / 3, accuracy: 1e-9)
        XCTAssertEqual(a.band, 6.5)
        let b = Band.writingOverall(t1: nil, t2: 7)
        XCTAssertEqual(b.raw, 7)
        XCTAssertEqual(b.band, 7)
    }

    func testVadEndsOneTurnAfterSilence() {
        var vad = VAD()
        var ends = 0
        for _ in 0..<6 { if vad.feed(level: 0.8, dt: 0.05) { ends += 1 } } // 0.3 s speech
        for _ in 0..<26 { if vad.feed(level: 0.05, dt: 0.05) { ends += 1 } } // 1.3 s silence
        XCTAssertEqual(ends, 1)
    }

    func testMistakeLogAndAttemptPageDecode() throws {
        let log = #"{"groups":[{"category":"grammar.articles","count":2}],"items":[{"id":"m1","attemptId":"a1","skill":"writing","part":2,"promptTitle":"P","category":"grammar.articles","original":"a apple","correction":"an apple","explanation":"vowel","time":null,"inDeck":false,"createdAt":"2026-09-30T00:00:00.000Z"}],"total":1,"page":1,"pageSize":30}"#
        let m = try JSONDecoder().decode(MistakeLog.self, from: Data(log.utf8))
        XCTAssertEqual(m.groups.first?.count, 2)
        XCTAssertEqual(m.items.first?.correction, "an apple")
        XCTAssertNil(m.items.first?.time)
        let page = #"{"items":[{"id":"a1","promptId":"p","promptTitle":"P","skill":"speaking","part":1,"mode":"practice","sessionId":null,"status":"analyzing","durationMs":null,"overall":null,"createdAt":"2026-09-30T00:00:00.000Z"}],"page":1,"pageSize":30,"total":31}"#
        let a = try JSONDecoder().decode(AttemptPage.self, from: Data(page.utf8))
        XCTAssertEqual(a.total, 31)
        XCTAssertEqual(a.items.first?.status, "analyzing")
    }

    func testChartSpecDecodesTableWithMixedCells() throws {
        let json = #"{"kind":"table","title":"T","columns":["a","b"],"rows":[["x",1.5],["y",2]]}"#
        guard case let .table(_, columns, rows) = try JSONDecoder().decode(ChartSpec.self, from: Data(json.utf8)) else { return XCTFail("not a table") }
        XCTAssertEqual(columns, ["a", "b"])
        XCTAssertEqual(rows[0][1], "1.5")
        XCTAssertEqual(rows[1][1], "2")
    }
}
