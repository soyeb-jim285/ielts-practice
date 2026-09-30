import Foundation

/// OpenAI Realtime over WebSocket (GA event names). The server mints the ephemeral key with the examiner instructions.
final class RealtimeSocket {
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

    /// Out-of-band instruction to the examiner, then ask it to speak.
    func instruct(_ text: String) {
        let item: [String: Any] = ["type": "message", "role": "system", "content": [["type": "input_text", "text": text]]]
        send(["type": "conversation.item.create", "item": item])
        send(["type": "response.create"])
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
