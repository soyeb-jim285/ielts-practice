import Foundation

/// What the live exam needs from a duplex provider (GPT-Live through our relay, or Gemini Live).
protocol DuplexSocket: AnyObject {
    /// PCM16 mono mic audio at the rate LiveAudio.setPCMRate was given.
    func appendAudio(_ pcm: Data)
    /// Interrupt the examiner and give it an instruction. `key` names the script moment (GPT-Live: the server owns the wording and ignores `text`).
    /// `heard`: it should take in the candidate's audio since the last hear(false, fresh: true).
    func cue(_ text: String, key: String, heard: Bool)
    /// false: the examiner must not hear the candidate (preparation); `fresh` marks where the long turn starts.
    /// GPT-Live mutes only for the preparation minute: it hears the long turn and is told to stay silent.
    func hear(_ on: Bool, fresh: Bool)
    func close()
}

/// GPT-Live relay wire format (docs/live-examiner.md, "Native relay"). Pure builders and a parser, so they can be unit-tested without a network.
/// Audio is PCM16 mono little-endian at 24 kHz in both directions.
enum GPTLive {
    static let rate = 24000.0

    /// wss://<server>/api/live/gpt-live/ws?sessionId=...; the bearer token goes in the Authorization header.
    static func url(base: String, sessionId: String) -> URL {
        var c = URLComponents(string: "ws" + String(base.dropFirst(4)) + "/api/live/gpt-live/ws")! // http(s) -> ws(s)
        c.queryItems = [URLQueryItem(name: "sessionId", value: sessionId)]
        return c.url!
    }

    static func audio(_ pcm: Data) -> [String: Any] { ["type": "session.input_audio.append", "audio": pcm.base64EncodedString()] }
    static func mute(_ on: Bool) -> [String: Any] { ["type": on ? "session.input_audio.mute" : "session.input_audio.unmute"] }
    /// begin | part2 | talk | follow | follow-timeup | closing
    static func cue(_ key: String) -> [String: Any] { ["type": "app.cue", "cue": key] }
    static let close: [String: Any] = ["type": "session.close"]

    enum Event: Equatable {
        case started
        case audio(Data) // PCM16 24 kHz
        case inText(String), outText(String)
        case closed(String)
        case error(String)
    }

    /// One relay message -> an event (nil: nothing the app acts on).
    static func parse(_ m: [String: Any]) -> Event? {
        switch m["type"] as? String {
        case "session.started": return .started
        case "session.output_audio.delta":
            guard let b64 = (m["audio"] as? String) ?? (m["delta"] as? String), let d = Data(base64Encoded: b64) else { return nil }
            return .audio(d)
        case "session.input_transcript.delta":
            return (m["delta"] as? String).map { .inText($0) }
        case "session.output_transcript.delta":
            return (m["delta"] as? String).map { .outText($0) }
        case "session.closed": return .closed((m["reason"] as? String) ?? "")
        case "error": return .error(((m["error"] as? [String: Any])?["message"] as? String) ?? "")
        default: return nil
        }
    }
}

/// GPT-Live over OUR relay (the OpenAI key, model, voice and instructions stay on the server). URLSessionWebSocketTask with the bearer header.
final class GPTLiveSocket: DuplexSocket {
    /// Called on a background queue.
    var onEvent: ((GPTLive.Event) -> Void)?
    var onLost: (() -> Void)?

    private let lock = NSLock()
    private var task: URLSessionWebSocketTask?
    private var closed = false
    private var started = false
    private var onStart: ((Error?) -> Void)?

    /// Resolves when the relay reports session.started; throws if the socket fails first or nothing happens in 15 s.
    func connect(base: String, token: String, sessionId: String) async throws {
        var req = URLRequest(url: GPTLive.url(base: base, sessionId: sessionId))
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let t = URLSession.shared.webSocketTask(with: req)
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let once = Once()
            let finish: (Error?) -> Void = { err in
                guard once.fire() else { return }
                if let err { cont.resume(throwing: err) } else { cont.resume() }
            }
            lock.withLock { task = t; onStart = finish }
            t.resume()
            receive(t)
            DispatchQueue.global().asyncAfter(deadline: .now() + 15) {
                finish(APIError(status: 0, message: "The GPT-Live examiner did not answer."))
            }
        }
        send(GPTLive.cue("begin")) // the examiner opens with the introduction
    }

    func appendAudio(_ pcm: Data) { if lock.withLock({ started }) { send(GPTLive.audio(pcm)) } }
    func cue(_ text: String, key: String, heard: Bool) { send(GPTLive.cue(key)) }
    func hear(_ on: Bool, fresh: Bool) { send(GPTLive.mute(!on && !fresh)) }

    func close() {
        let t = lock.withLock { () -> URLSessionWebSocketTask? in closed = true; defer { task = nil }; return task }
        if t != nil { send(GPTLive.close, on: t) }
        // let session.close go out before the socket does
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.4) { t?.cancel(with: .normalClosure, reason: nil) }
    }

    private func send(_ m: [String: Any], on t: URLSessionWebSocketTask? = nil) {
        guard let d = try? JSONSerialization.data(withJSONObject: m), let s = String(data: d, encoding: .utf8) else { return }
        (t ?? lock.withLock { task })?.send(.string(s)) { _ in }
    }

    private func receive(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            guard let self, self.lock.withLock({ self.task === t }) else { return }
            switch result {
            case let .success(message):
                var data: Data?
                switch message {
                case let .string(s): data = Data(s.utf8)
                case let .data(d): data = d
                @unknown default: break
                }
                if let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let ev = GPTLive.parse(obj) {
                    if ev == .started {
                        let finish = self.lock.withLock { () -> ((Error?) -> Void)? in self.started = true; defer { self.onStart = nil }; return self.onStart }
                        finish?(nil)
                    }
                    self.onEvent?(ev)
                }
                self.receive(t)
            case let .failure(error):
                let (finish, closed) = self.lock.withLock { () -> (((Error?) -> Void)?, Bool) in self.started = false; defer { self.onStart = nil }; return (self.onStart, self.closed) }
                if let finish { finish(error) } else if !closed { self.onLost?() }
            }
        }
    }
}
