import Foundation

/// Gemini Live wire format (ai.google.dev/api/live). Pure builders and a parser, so they can be unit-tested without a network.
enum GeminiLive {
    /// Same prefix the server's instructions tell the model to treat as an app cue (ai/examiner.ts CUE_PREFIX).
    static let cuePrefix = "[APP CUE] "

    /// Ephemeral tokens connect to the "Constrained" endpoint, on v1beta, with the token as access_token.
    static func url(token: String) -> URL {
        var c = URLComponents(string: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained")!
        c.queryItems = [URLQueryItem(name: "access_token", value: token)]
        return c.url!
    }

    /// First message. Model, voice, instructions, VAD, transcription and compression are locked into the token on the server; only resumption is ours.
    static func setup(model: String, handle: String?) -> [String: Any] {
        ["setup": ["model": "models/\(model)", "sessionResumption": handle.map { ["handle": $0] } ?? [String: String]()] as [String: Any]]
    }

    /// PCM16 little-endian mono at 16 kHz.
    static func audio(_ pcm: Data) -> [String: Any] {
        ["realtimeInput": ["audio": ["data": pcm.base64EncodedString(), "mimeType": "audio/pcm;rate=16000"]]]
    }

    /// Flushes audio the server still holds when the mic stops streaming.
    static let audioEnd: [String: Any] = ["realtimeInput": ["audioStreamEnd": true]]

    /// An instruction from the app. turnComplete interrupts whatever the examiner is saying and makes it answer now (Gemini 3.8 Live).
    static func cue(_ text: String) -> [String: Any] {
        let turn: [String: Any] = ["role": "user", "parts": [["text": cuePrefix + text]]]
        return ["clientContent": ["turns": [turn], "turnComplete": true] as [String: Any]]
    }

    enum Event: Equatable {
        case setupComplete, interrupted, generationComplete, turnComplete
        case audio(Data) // PCM16 24 kHz
        case outText(String), inText(String)
        case goAway(seconds: Double)
        case resume(String)
    }

    /// One server message → events, in the order the app should act on them (an interruption first, so audio after it is the new answer).
    static func parse(_ m: [String: Any]) -> [Event] {
        var out: [Event] = []
        if m["setupComplete"] != nil { out.append(.setupComplete) }
        if let c = m["serverContent"] as? [String: Any] {
            if c["interrupted"] as? Bool == true { out.append(.interrupted) }
            if let t = (c["inputTranscription"] as? [String: Any])?["text"] as? String, !t.isEmpty { out.append(.inText(t)) }
            let parts = ((c["modelTurn"] as? [String: Any])?["parts"] as? [[String: Any]]) ?? []
            for p in parts {
                guard let d = p["inlineData"] as? [String: Any], let b64 = d["data"] as? String,
                      ((d["mimeType"] as? String) ?? "audio/").hasPrefix("audio/"), let bytes = Data(base64Encoded: b64) else { continue }
                out.append(.audio(bytes))
            }
            if let t = (c["outputTranscription"] as? [String: Any])?["text"] as? String, !t.isEmpty { out.append(.outText(t)) }
            if c["generationComplete"] as? Bool == true { out.append(.generationComplete) }
            if c["turnComplete"] as? Bool == true { out.append(.turnComplete) }
        }
        if let g = m["goAway"] as? [String: Any] {
            // protobuf Duration JSON: "50s", "1.5s"
            let s = ((g["timeLeft"] as? String) ?? "0s").trimmingCharacters(in: CharacterSet(charactersIn: "s"))
            out.append(.goAway(seconds: Double(s) ?? 0))
        }
        if let r = m["sessionResumptionUpdate"] as? [String: Any], r["resumable"] as? Bool == true, let h = r["newHandle"] as? String, !h.isEmpty {
            out.append(.resume(h))
        }
        return out
    }
}

/// Gemini Live over URLSessionWebSocketTask. A connection lives ~10 minutes; session resumption carries the test across it,
/// so a dropped socket reconnects with the latest handle (up to 3 failed attempts in a row, then onLost).
final class GeminiLiveSocket: DuplexSocket {
    /// Called on a background queue (everything except the setup handshake).
    var onEvent: ((GeminiLive.Event) -> Void)?
    var onLost: (() -> Void)?

    private let lock = NSLock()
    private var task: URLSessionWebSocketTask?
    private var token = ""
    private var model = ""
    private var resumeHandle: String?
    private var ready = false
    private var closed = false
    private var hearing = true
    private var failures = 0
    private var queuedCue: String?
    private var onSetup: ((Error?) -> Void)?

    /// Resolves when the server has accepted the setup (setupComplete); throws if the socket closes first or nothing happens in 15 s.
    func connect(token: String, model: String) async throws {
        self.token = token
        self.model = model
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let once = Once()
            let finish: (Error?) -> Void = { err in
                guard once.fire() else { return }
                if let err { cont.resume(throwing: err) } else { cont.resume() }
            }
            lock.withLock { onSetup = finish }
            open()
            DispatchQueue.global().asyncAfter(deadline: .now() + 15) {
                finish(APIError(status: 0, message: "The Gemini examiner did not answer."))
            }
        }
    }

    func appendAudio(_ pcm: Data) { if lock.withLock({ ready && hearing }) { send(GeminiLive.audio(pcm)) } }

    func cue(_ text: String, heard: Bool) {
        if lock.withLock({ ready }) { send(GeminiLive.cue(text)) } else { lock.withLock { queuedCue = text } }
    }

    func hear(_ on: Bool, fresh: Bool) {
        lock.withLock { hearing = on }
        if !on { send(GeminiLive.audioEnd) }
    }

    func close() {
        let t = lock.withLock { () -> URLSessionWebSocketTask? in closed = true; defer { task = nil }; return task }
        t?.cancel(with: .normalClosure, reason: nil)
    }

    private func send(_ m: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: m), let s = String(data: d, encoding: .utf8) else { return }
        lock.withLock { () -> URLSessionWebSocketTask? in task }?.send(.string(s)) { _ in }
    }

    private func open() {
        let t = URLSession.shared.webSocketTask(with: GeminiLive.url(token: token))
        let h = lock.withLock { () -> String? in task = t; ready = false; return resumeHandle }
        t.resume()
        // The setup must be the first message; URLSession queues it until the socket is open.
        if let d = try? JSONSerialization.data(withJSONObject: GeminiLive.setup(model: model, handle: h)), let s = String(data: d, encoding: .utf8) {
            t.send(.string(s)) { _ in }
        }
        receive(t)
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
                if let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    for ev in GeminiLive.parse(obj) { self.process(ev) }
                }
                self.receive(t)
            case let .failure(error):
                self.dropped(error)
            }
        }
    }

    private func process(_ ev: GeminiLive.Event) {
        switch ev {
        case .setupComplete:
            let (cue, finish) = lock.withLock { () -> (String?, ((Error?) -> Void)?) in
                ready = true
                failures = 0
                defer { queuedCue = nil; onSetup = nil }
                return (queuedCue, onSetup)
            }
            finish?(nil)
            if let cue { send(GeminiLive.cue(cue)) }
        case let .resume(h):
            lock.withLock { resumeHandle = h }
        default:
            onEvent?(ev)
        }
    }

    private func dropped(_ error: Error) {
        let (finish, retry, lost) = lock.withLock { () -> (((Error?) -> Void)?, Bool, Bool) in
            ready = false
            if closed { return (nil, false, false) }
            if let f = onSetup { onSetup = nil; return (f, false, false) } // never got going: connect() throws
            failures += 1
            return (nil, failures <= 3 && resumeHandle != nil, failures > 3 || resumeHandle == nil)
        }
        if let finish { finish(error) }
        if retry { DispatchQueue.global().asyncAfter(deadline: .now() + 0.5 * Double(failures)) { [weak self] in self?.open() } }
        if lost { onLost?() }
    }
}

/// Runs a closure at most once, from any thread.
final class Once {
    private let lock = NSLock()
    private var done = false
    func fire() -> Bool { lock.withLock { defer { done = true }; return !done } }
}
