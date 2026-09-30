import AVFoundation
import Observation

/// Practice recorder: AAC 16 kHz mono m4a with metering sampled every 50 ms → 0-255 energy timeline.
@MainActor @Observable
final class Recorder {
    private(set) var isRecording = false
    private(set) var level = 0.0 // 0…1
    private(set) var elapsed: TimeInterval = 0
    private(set) var silence: TimeInterval = 0
    private(set) var levels: [Double] = Array(repeating: 0, count: 48) // waveform history
    private(set) var liveWpm = 0

    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private(set) var energy: [Int] = []

    static func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try s.setActive(true)
    }

    /// Returns false when mic permission is denied.
    func start(to url: URL) async throws -> Bool {
        guard await AVAudioApplication.requestRecordPermission() else { return false }
        try Self.configureSession()
        let r = try AVAudioRecorder(url: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ])
        r.isMeteringEnabled = true
        guard r.record() else { throw APIError(status: 0, message: "Couldn't start recording. Is another app using the microphone?") }
        recorder = r
        energy = []
        silence = 0
        isRecording = true
        loop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                self?.tick()
            }
        }
        return true
    }

    private func tick() {
        guard let r = recorder, r.isRecording else { return }
        r.updateMeters()
        let db = Double(r.averagePower(forChannel: 0))
        let l = max(0, min(1, (db + 60) / 60))
        level = l
        energy.append(Int(l * 255))
        elapsed = r.currentTime
        silence = l < 0.3 ? silence + 0.05 : 0
        levels.removeFirst()
        levels.append(l)
        // ponytail: rough syllable estimate from energy peaks over the last 10 s — a pacing hint only.
        let recent = energy.suffix(200)
        var peaks = 0, prev = 0
        for e in recent { if e >= 110 && prev < 110 { peaks += 1 }; prev = e }
        liveWpm = Int(Double(peaks) / 1.5 * 6 * (200 / Double(max(recent.count, 1))))
    }

    /// Stops and returns the duration in ms and the energy timeline.
    func stop() -> (durationMs: Int, energy: [Int]) {
        let d = recorder?.currentTime ?? elapsed
        loop?.cancel()
        recorder?.stop()
        recorder = nil
        isRecording = false
        level = 0
        return (Int(d * 1000), energy)
    }
}
