import Foundation

/// What the live exam needs from a Realtime provider (OpenAI Realtime or Gemini Live).
protocol DuplexSocket: AnyObject {
    /// PCM16 mono mic audio at the rate LiveAudio.setPCMRate was given.
    func appendAudio(_ pcm: Data)
    /// Interrupt the examiner and give it an instruction. `heard`: it should take in the candidate's audio since the last hear(false, fresh: true).
    func cue(_ text: String, heard: Bool)
    /// false: the examiner must stay silent (preparation, long turn); `fresh` marks where the long turn starts.
    func hear(_ on: Bool, fresh: Bool)
    func close()
}

/// OpenAI Realtime over WebSocket (GA event names). The server mints the ephemeral client secret with the examiner instructions and turn detection.
/// A client secret works as the Bearer token on wss://api.openai.com/v1/realtime (browsers pass it as a subprotocol instead; a native client can set headers).
final class RealtimeSocket: DuplexSocket {
    /// Called on a background queue with (event type, full event JSON).
    var onEvent: ((String, [String: Any]) -> Void)?
    var onClose: ((Error?) -> Void)?
    private var task: URLSessionWebSocketTask?

    func connect(ephemeralKey: String, model: String) {
        var comps = URLComponents(string: "wss://api.openai.com/v1/realtime")!
        comps.queryItems = [URLQueryItem(name: "model", value: model)]
        var req = URLRequest(url: comps.url!)
        req.setValue("Bearer \(ephemeralKey)", forHTTPHeaderField: "Authorization")
        let t = URLSession.shared.webSocketTask(with: req)
        task = t
        t.resume()
        receive()
    }

    func send(_ event: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: event), let s = String(data: d, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }

    func appendAudio(_ pcm16: Data) { send(["type": "input_audio_buffer.append", "audio": pcm16.base64EncodedString()]) }

    /// Cancels what the examiner is saying, gives it a system instruction and asks it to speak. The caller stops local playback.
    func cue(_ text: String, heard: Bool) {
        if heard { send(["type": "input_audio_buffer.commit"]) } // the long turn becomes one user message the examiner can answer
        send(["type": "response.cancel"])
        let item: [String: Any] = ["type": "message", "role": "system", "content": [["type": "input_text", "text": text]]]
        send(["type": "conversation.item.create", "item": item])
        send(["type": "response.create"])
    }

    func hear(_ on: Bool, fresh: Bool) {
        let detection: Any = on ? ["type": "semantic_vad", "eagerness": "low"] : NSNull()
        send(["type": "session.update", "session": ["type": "realtime", "audio": ["input": ["turn_detection": detection]]] as [String: Any]])
        if fresh { send(["type": "input_audio_buffer.clear"]) }
    }

    func close() {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(message):
                var data: Data?
                switch message {
                case let .string(s): data = Data(s.utf8)
                case let .data(d): data = d
                @unknown default: break
                }
                if let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = obj["type"] as? String {
                    self.onEvent?(type, obj)
                }
                self.receive()
            case let .failure(error):
                self.onClose?(error)
            }
        }
    }
}
