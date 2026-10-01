import XCTest
@testable import IELTS

/// GPT-Live relay wire format: the messages we send and how relay messages become events (no network).
final class GPTLiveTests: XCTestCase {
    private func json(_ s: String) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: Data(s.utf8)) as! [String: Any]
    }

    func testRelayUrlIsTheServerHostOverWebSocketWithTheSessionId() {
        XCTAssertEqual(GPTLive.url(base: "https://ielts.soyebjim.me", sessionId: "abc").absoluteString, "wss://ielts.soyebjim.me/api/live/gpt-live/ws?sessionId=abc")
        XCTAssertEqual(GPTLive.url(base: "http://localhost:8787", sessionId: "x").absoluteString, "ws://localhost:8787/api/live/gpt-live/ws?sessionId=x")
    }

    func testClientMessages() {
        let a = GPTLive.audio(Data([104, 105]))
        XCTAssertEqual(a["type"] as? String, "session.input_audio.append")
        XCTAssertEqual(a["audio"] as? String, "aGk=")
        XCTAssertEqual(GPTLive.mute(true)["type"] as? String, "session.input_audio.mute")
        XCTAssertEqual(GPTLive.mute(false)["type"] as? String, "session.input_audio.unmute")
        XCTAssertEqual(GPTLive.cue("part2") as? [String: String], ["type": "app.cue", "cue": "part2"])
        XCTAssertEqual(GPTLive.close["type"] as? String, "session.close")
    }

    func testEvents() {
        XCTAssertEqual(GPTLive.parse(json(#"{"type":"session.started","session":{"id":"s"}}"#)), .started)
        XCTAssertEqual(GPTLive.parse(json(#"{"type":"session.output_audio.delta","audio":"aGk="}"#)), .audio(Data([104, 105])))
        XCTAssertEqual(GPTLive.parse(json(#"{"type":"session.output_audio.delta","delta":"aGk="}"#)), .audio(Data([104, 105])))
        XCTAssertEqual(GPTLive.parse(json(#"{"type":"session.output_transcript.delta","delta":"Hello."}"#)), .outText("Hello."))
        XCTAssertEqual(GPTLive.parse(json(#"{"type":"session.input_transcript.delta","delta":" Sam"}"#)), .inText(" Sam"))
        XCTAssertEqual(GPTLive.parse(json(#"{"type":"session.closed","reason":"expired"}"#)), .closed("expired"))
        XCTAssertEqual(GPTLive.parse(json(#"{"type":"error","error":{"message":"bad"}}"#)), .error("bad"))
        XCTAssertNil(GPTLive.parse(json(#"{"type":"session.usage.updated"}"#)))
    }
}
