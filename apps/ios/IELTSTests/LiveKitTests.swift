import XCTest
@testable import IELTS

/// LiveKit worker data-channel protocol: the messages we send and how worker packets become events (no room).
final class LiveKitTests: XCTestCase {
    private func ev(_ s: String) -> LiveKitWire.Event? { LiveKitWire.parse(Data(s.utf8)) }

    func testClientMessages() {
        XCTAssertEqual(LiveKitWire.start as? [String: String], ["type": "start"])
        XCTAssertEqual(LiveKitWire.configure(2)["part"] as? Int, 2)
        let cue = LiveKitWire.cue("closing")
        XCTAssertEqual(cue["type"] as? String, "cue")
        XCTAssertEqual(cue["key"] as? String, "closing")
        XCTAssertEqual(cue["text"] as? String, "The test is over. Say the closing line now and nothing more.")
        let listen = LiveKitWire.listen(false, fresh: true)
        XCTAssertEqual(listen["on"] as? Bool, false)
        XCTAssertEqual(listen["fresh"] as? Bool, true)
    }

    /// The worker refuses any cue text that isn't in packages/core CUE_TEXT (read from the repo checkout the tests were built from).
    func testCueTextsMatchCore() throws {
        let core = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../packages/core/src/livekit.ts")
        guard let src = try? String(contentsOf: core, encoding: .utf8) else { throw XCTSkip("packages/core not reachable from the test host") }
        for (key, text) in LiveKitWire.cueText { XCTAssertTrue(src.contains(text), key) }
        XCTAssertEqual(LiveKitWire.cueText.count, 5)
    }

    func testEvents() {
        XCTAssertEqual(ev(#"{"type":"ready"}"#), .ready)
        XCTAssertEqual(ev(#"{"type":"caption","text":"Good morning."}"#), .caption("Good morning.", append: false))
        XCTAssertEqual(ev(#"{"type":"caption","text":"Next.","append":true}"#), .caption("Next.", append: true))
        XCTAssertNil(ev(#"{"type":"caption","text":""}"#))
        XCTAssertEqual(ev(#"{"type":"answered","eot":0.4,"stt":0.2}"#), .answered)
        XCTAssertEqual(ev(#"{"type":"speaking","on":true}"#), .speaking(true))
        XCTAssertEqual(ev(#"{"type":"pending","on":false}"#), .pending(false))
        XCTAssertEqual(ev(#"{"type":"heard","text":"My name is Sam"}"#), .heard("My name is Sam"))
        XCTAssertEqual(ev(#"{"type":"error","message":"boom"}"#), .error("boom"))
        XCTAssertNil(ev(#"{"type":"cost","usd":0.01}"#))
        XCTAssertNil(ev("not json"))
    }

    func testStartAndQuotaDecode() throws {
        let start = #"{"sessionId":"s1","test":{"part1":[],"part2":{"id":"p2","skill":"speaking","part":2,"title":"T","body":"B"},"part3":{"id":"p3","skill":"speaking","part":3,"title":"T","body":"B"}},"examinerText":"Hi","phase":"intro"}"#
        XCTAssertEqual(try JSONDecoder().decode(LiveStarted.self, from: Data(start.utf8)).sessionId, "s1")
        let room = #"{"url":"wss://lk.example","token":"t","roomName":"r","participantIdentity":"u"}"#
        XCTAssertEqual(try JSONDecoder().decode(LiveKitStart.self, from: Data(room.utf8)).url, "wss://lk.example")
    }
}
