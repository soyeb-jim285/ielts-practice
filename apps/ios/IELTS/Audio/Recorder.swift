import AVFoundation
import Observation

/// Practice recorder: AAC 16 kHz mono m4a with metering sampled every 50 ms → 0-255 energy timeline.
/// Energy uses the web scale (byte = √rms·255) so the server's single voiceThreshold (60) means the same on both platforms.
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

    nonisolated static let voice = 60 // matches web VOICE and core computeSpeechMetrics voiceThreshold

    /// dBFS → 0-255 energy byte on the web scale (√rms·255).
    nonisolated static func energyByte(db: Double) -> Int { energyByte(rms: pow(10, db / 20)) }
    nonisolated static func energyByte(rms: Double) -> Int { Int(min(255, (sqrt(max(0, rms)) * 255).rounded())) }

    /// Syllable-like energy peaks in the last 10 s → rough words/min. Mirrors web estimateWpm.
    /// ponytail: a pacing hint, not a measurement.
    nonisolated static func estimateWpm(_ energy: [Int]) -> Int {
        let win = Array(energy.suffix(200))
        guard win.count >= 40 else { return 0 }
        var peaks = 0, last = -10
        for i in 1..<(win.count - 1) where win[i] >= voice && win[i] > win[i - 1] && win[i] >= win[i + 1] && i - last >= 3 {
            peaks += 1
            last = i
        }
        return Int((Double(peaks) / 1.5 * (200 / Double(win.count)) * 6).rounded())
    }

    nonisolated static func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try s.setActive(true)
    }

    /// `paused`: open the file but hold the clock until `resume()` (the examiner is still asking). Returns false when mic permission is denied.
    func start(to url: URL, paused startPaused: Bool = false) async throws -> Bool {
        #if DEBUG
        if DemoTour.name != nil { return startScripted() }
        #endif
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
        if startPaused { r.pause() }
        recorder = r
        energy = []
        silence = 0
        elapsed = 0 // a second recording must not start with the previous one's clock
        liveWpm = 0
        levels = Array(repeating: 0, count: 48)
        isRecording = true
        loop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                self?.tick()
            }
        }
        return true
    }

    #if DEBUG
    /// Demo tour only (no microphone on a CI simulator): a scripted voice of about 140 wpm with a short pause every few seconds,
    /// so the timer, waveform and live pace chip move.
    private func startScripted() -> Bool {
        energy = []
        silence = 0
        elapsed = 0
        liveWpm = 0
        levels = Array(repeating: 0, count: 48)
        isRecording = true
        let t0 = Date()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                guard let self else { return }
                let i = self.energy.count
                let burst: [Double] = [70, 110, 190, 120, 80]
                let swell: Double = 0.8 + 0.2 * sin(Double(i) / 9)
                let paused = i % 130 >= 100 && i % 130 < 115
                let e: Int = paused ? 12 : Int(burst[i % 5] * swell)
                let l = min(1, Double(e) / 255 * 1.15)
                self.energy.append(e)
                self.level = l
                self.elapsed = Date().timeIntervalSince(t0)
                self.silence = l < 0.3 ? self.silence + 0.05 : 0
                self.levels.removeFirst()
                self.levels.append(l)
                self.liveWpm = Self.estimateWpm(self.energy)
            }
        }
        return true
    }
    #endif

    private func tick() {
        guard let r = recorder, r.isRecording else { return }
        r.updateMeters()
        let db = Double(r.averagePower(forChannel: 0))
        let l = max(0, min(1, (db + 60) / 60))
        level = l
        energy.append(Self.energyByte(db: db))
        elapsed = r.currentTime
        silence = l < 0.3 ? silence + 0.05 : 0
        levels.removeFirst()
        levels.append(l)
        liveWpm = Self.estimateWpm(energy)
    }

    /// The recording clock in seconds: it stands still while paused, so it matches the audio and the energy frames.
    var clock: TimeInterval { recorder?.currentTime ?? elapsed }

    func pause() { recorder?.pause() }
    func resume() { _ = recorder?.record() }

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
