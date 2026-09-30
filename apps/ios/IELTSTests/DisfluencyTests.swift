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
}
