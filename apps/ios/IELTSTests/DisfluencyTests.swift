import XCTest
@testable import IELTS

/// metrics.fluency.events is the server's fused disfluency list (core fuseDisfluencies); the kinds must match what FluencyView groups by.
final class DisfluencyTests: XCTestCase {
    func testDecodesFusedEvents() throws {
        let json = #"{"events":[{"kind":"filled","start":1.5,"end":1.9,"sources":["voiced","audio"]},{"kind":"repair","start":4,"end":4,"sources":["stt"]}],"composite":0.3}"#
        let f = try JSONDecoder().decode(FluencyDetail.self, from: Data(json.utf8))
        XCTAssertEqual(f.events.map(\.kind), ["filled", "repair"])
        XCTAssertEqual(f.events[0].sources, ["voiced", "audio"])
        XCTAssertTrue(f.events.allSatisfy { e in Disfluency.kinds.contains { $0.key == e.kind } })
    }

    func testDecodesNewKindsAndProfile() throws {
        let json = #"{"events":[{"kind":"false_start","start":2,"end":2,"sources":["rule"]},{"kind":"partial","start":3,"end":3,"sources":["stt"]},{"kind":"prolongation","start":5,"end":5.6,"sources":["rule"]}],"profile":{"byKind":{"partial":{"n":1,"perMin":2,"per100w":1.5}},"total":{"n":3,"perMin":6,"per100w":4},"meanRunLength":10,"midClauseShare":0.3}}"#
        let f = try JSONDecoder().decode(FluencyDetail.self, from: Data(json.utf8))
        XCTAssertTrue(f.events.allSatisfy { e in Disfluency.kinds.contains { $0.key == e.kind } })
        XCTAssertEqual(f.profile?.byKind["partial"]?.n, 1)
        XCTAssertEqual(Disfluency.kinds.map(\.key), ["filled", "repetition", "repair", "false_start", "partial", "prolongation"])
        XCTAssertTrue(Disfluency.kinds.allSatisfy { $0.rate.count == 2 && $0.rate[0] < $0.rate[1] })
        let old = try JSONDecoder().decode(FluencyDetail.self, from: Data(#"{"events":[]}"#.utf8))
        XCTAssertNil(old.profile)
    }
}
