import XCTest
@testable import IELTS

/// Gemini Live wire format: the messages we send and how server messages become events (no network).
final class GeminiLiveTests: XCTestCase {
    private func json(_ s: String) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: Data(s.utf8)) as! [String: Any]
    }

    func testEphemeralTokensUseTheConstrainedEndpointWithAccessToken() {
        let url = GeminiLive.url(token: "auth_tokens/abc").absoluteString
        XCTAssertTrue(url.hasPrefix("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?"))
        XCTAssertTrue(url.hasSuffix("access_token=auth_tokens/abc"))
    }

    func testSetupOnlyCarriesModelAndResumption() {
        let first = GeminiLive.setup(model: "gemini-3.8-live", handle: nil)["setup"] as! [String: Any]
        XCTAssertEqual(first["model"] as? String, "models/gemini-3.8-live")
        XCTAssertEqual((first["sessionResumption"] as? [String: Any])?.count, 0)
        let again = GeminiLive.setup(model: "gemini-3.8-live", handle: "h1")["setup"] as! [String: Any]
        XCTAssertEqual((again["sessionResumption"] as? [String: String])?["handle"], "h1")
    }

    func testAudioIsBase64Pcm16At16kHz() {
        let m = GeminiLive.audio(Data([104, 105]))["realtimeInput"] as! [String: Any]
        let a = m["audio"] as! [String: String]
        XCTAssertEqual(a["data"], "aGk=")
        XCTAssertEqual(a["mimeType"], "audio/pcm;rate=16000")
    }

    func testCueIsAPrefixedUserTurnThatCompletesTheTurn() {
        let c = GeminiLive.cue("Begin the test.")["clientContent"] as! [String: Any]
        XCTAssertEqual(c["turnComplete"] as? Bool, true)
        let turn = (c["turns"] as! [[String: Any]])[0]
        XCTAssertEqual(turn["role"] as? String, "user")
        XCTAssertEqual(((turn["parts"] as! [[String: String]])[0])["text"], "[APP CUE] Begin the test.")
    }

    func testContentMessageBecomesEventsInterruptionFirst() {
        let m = json("""
        {"serverContent":{"interrupted":true,"inputTranscription":{"text":"my name"},
         "modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"aGk="}},{"inlineData":{"mimeType":"image/png","data":"aGk="}}]},
         "outputTranscription":{"text":"Hello"},"generationComplete":true,"turnComplete":true}}
        """)
        XCTAssertEqual(GeminiLive.parse(m), [.interrupted, .inText("my name"), .audio(Data([104, 105])), .outText("Hello"), .generationComplete, .turnComplete])
    }

    func testSetupGoAwayAndResumptionUpdates() {
        XCTAssertEqual(GeminiLive.parse(json(#"{"setupComplete":{}}"#)), [.setupComplete])
        XCTAssertEqual(GeminiLive.parse(json(#"{"goAway":{"timeLeft":"50s"}}"#)), [.goAway(seconds: 50)])
        XCTAssertEqual(GeminiLive.parse(json(#"{"goAway":{"timeLeft":"1.5s"}}"#)), [.goAway(seconds: 1.5)])
        XCTAssertEqual(GeminiLive.parse(json(#"{"sessionResumptionUpdate":{"newHandle":"h2","resumable":true}}"#)), [.resume("h2")])
        XCTAssertEqual(GeminiLive.parse(json(#"{"sessionResumptionUpdate":{"newHandle":"","resumable":false}}"#)), [])
        XCTAssertEqual(GeminiLive.parse(json(#"{"serverContent":{}}"#)), [])
    }

    func testOnceFiresOnlyOnce() {
        let o = Once()
        XCTAssertTrue(o.fire())
        XCTAssertFalse(o.fire())
    }
}
