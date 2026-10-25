import AVFoundation

/// Reads an examiner line with the device's British English voice when the line has no rendered recording (most generated prompts and every
/// Cambridge prompt, 2026-10-26). `speak` returns when the line ends, is stopped, or after a length-based timeout, so the test never waits on it.
@MainActor
final class DeviceVoice: NSObject, AVSpeechSynthesizerDelegate {
    private let synth = AVSpeechSynthesizer()
    private var finish: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        synth.delegate = self
    }

    func speak(_ text: String) async {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        stop()
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "en-GB") ?? AVSpeechSynthesisVoice(language: "en-US")
        let timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2 + Double(text.count) * 0.09))
            self?.stop()
        }
        await withCheckedContinuation { c in
            finish = c
            synth.speak(u)
        }
        timeout.cancel()
    }

    func stop() {
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        done()
    }

    private func done() {
        finish?.resume()
        finish = nil
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.done() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.done() }
    }
}
