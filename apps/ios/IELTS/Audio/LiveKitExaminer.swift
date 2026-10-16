import AVFoundation
import Foundation
import LiveKit

/// The LiveKit worker's data-channel protocol (web live/livekit.ts). Pure builders and a parser, so they can be unit-tested without a room.
enum LiveKitWire {
    /// The only cue texts the worker accepts (packages/core/src/livekit.ts CUE_TEXT, word for word).
    static let cueText: [String: String] = [
        "part2": "Part 1 is over. Move to Part 2 now: give the Part 2 instructions and the topic, then stay silent while the candidate prepares.",
        "talk": "The preparation minute is over. Ask the candidate to start speaking now, then stay silent until you are told the talk is over.",
        "follow-timeup": "The two minutes are up. Say \"Thank you. That's the end of your time.\" and ask the rounding-off question.",
        "follow": "The candidate has finished their talk. Say \"Thank you.\" and ask the rounding-off question.",
        "closing": "The test is over. Say the closing line now and nothing more.",
    ]

    static let start: [String: Any] = ["type": "start"]
    static func configure(_ part: Int) -> [String: Any] { ["type": "configure", "part": part] }
    static func cue(_ key: String) -> [String: Any] { ["type": "cue", "text": cueText[key] ?? "", "key": key] }
    static func listen(_ on: Bool, fresh: Bool) -> [String: Any] { ["type": "listen", "on": on, "fresh": fresh] }

    enum Event: Equatable {
        case ready
        case caption(String, append: Bool) // no append: a new examiner line
        case heard(String)
        case pending(Bool)
        case answered
        case speaking(Bool)
        case error(String)
    }

    /// One "ielts.events" packet -> an event (nil: nothing the app acts on, e.g. turn timings and cost).
    static func parse(_ data: Data) -> Event? {
        guard let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        switch m["type"] as? String {
        case "ready": return .ready
        case "caption":
            guard let t = m["text"] as? String, !t.isEmpty else { return nil }
            return .caption(t, append: m["append"] as? Bool ?? false)
        case "heard": return (m["text"] as? String).map { .heard($0) }
        case "pending": return (m["on"] as? Bool).map { .pending($0) }
        case "answered": return .answered
        case "speaking": return (m["on"] as? Bool).map { .speaking($0) }
        case "error": return .error(m["message"] as? String ?? "")
        default: return nil
        }
    }
}

/// The examiner in a LiveKit room: our mic is published, the agent's voice plays through the SDK, and the test is driven over data packets.
/// Callbacks arrive on the main thread, in order.
final class LiveKitExaminer: NSObject, RoomDelegate, AudioRenderer, @unchecked Sendable {
    var onEvent: ((LiveKitWire.Event) -> Void)?
    /// The connection dropped or the worker failed (never after close()).
    var onLost: (() -> Void)?
    /// LiveKit's processed mic audio, on an audio thread.
    var onMic: ((AVAudioPCMBuffer) -> Void)?

    private let room = Room()
    private var ready = false
    private var closed = false
    private var lostFlag = false
    private var sends: Task<Void, Never>?

    /// Joins the room, publishes the mic, waits for the worker (30 s) and starts the test: the examiner opens with the introduction.
    @MainActor
    func connect(url: String, token: String) async throws {
        room.add(delegate: self)
        do {
            try await room.connect(url: url, token: token)
            AudioManager.shared.add(localAudioRenderer: self)
            try await room.localParticipant.setMicrophone(enabled: true)
            let end = Date().addingTimeInterval(30)
            while !ready {
                if lostFlag || closed { throw APIError(status: 0, message: "The examiner couldn't connect. Try again.") }
                if Date() > end { throw APIError(status: 0, message: "The examiner didn't start in time. Try again.") }
                try await Task.sleep(for: .milliseconds(100))
            }
            send(LiveKitWire.start)
        } catch {
            close()
            throw error
        }
    }

    @MainActor func configure(_ part: Int) { send(LiveKitWire.configure(part)) }
    @MainActor func cue(_ key: String) { send(LiveKitWire.cue(key)) }
    @MainActor func listen(_ on: Bool, fresh: Bool = false) { send(LiveKitWire.listen(on, fresh: fresh)) }

    /// Reliable and in order, like the web's command chain; a failed send loses the session.
    @MainActor
    private func send(_ message: [String: Any]) {
        guard !closed, let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        let prev = sends
        sends = Task { @MainActor in
            await prev?.value
            guard !self.closed else { return }
            do {
                try await self.room.localParticipant.publish(data: data, options: DataPublishOptions(topic: "ielts.control", reliable: true))
            } catch {
                self.lost()
            }
        }
    }

    @MainActor
    func close() {
        guard !closed else { return }
        closed = true
        AudioManager.shared.remove(localAudioRenderer: self)
        Task { await self.room.disconnect() }
    }

    @MainActor
    private func lost() {
        guard !closed, !lostFlag else { return }
        lostFlag = true
        close()
        onLost?()
    }

    // MARK: RoomDelegate, AudioRenderer (any thread)

    func room(_ room: Room, participant: RemoteParticipant?, didReceiveData data: Data, forTopic topic: String, encryptionType: EncryptionType) {
        guard topic == "ielts.events", participant?.kind == .agent, let ev = LiveKitWire.parse(data) else { return }
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                guard !self.closed else { return }
                switch ev {
                case .ready: self.ready = true
                case .error: self.lost() // ponytail: the worker's message is for the server logs, not the candidate
                default: self.onEvent?(ev)
                }
            }
        }
    }

    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        DispatchQueue.main.async { MainActor.assumeIsolated { self.lost() } }
    }

    func render(pcmBuffer: AVAudioPCMBuffer) { onMic?(pcmBuffer) }
}
