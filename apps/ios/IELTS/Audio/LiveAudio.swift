import AVFoundation

/// Live-mode audio: the pre-test mic check on its own AVAudioEngine, then (once LiveKit owns the mic) its echo-cancelled
/// input fed in through `feed`: mic level and one m4a per part, paused while the examiner speaks.
final class LiveAudio {
    struct PartRecording { let url: URL; let durationMs: Int; let energy: [Int] }

    /// Called on an audio thread with (level 0…1, seconds covered).
    var onLevel: ((Double, Double) -> Void)?

    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var partURL: URL?
    private var partFile: AVAudioFile?
    private var partFrames: AVAudioFramePosition = 0
    private var partEnergy: [Int] = []
    private var energySum: Float = 0, energyCount = 0 // the 50 ms energy frame in progress (LiveKit buffers are 10 ms)
    private var examinerOn = false
    private(set) var running = false

    /// True while the examiner's voice plays: the part recording skips it.
    var examinerSpeaking: Bool {
        get { lock.withLock { examinerOn } }
        set { lock.withLock { examinerOn = newValue } }
    }

    /// The mic check before the test.
    func start() throws {
        guard !running else { return }
        try Recorder.configureSession()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw APIError(status: 0, message: "No microphone input available.") }
        input.installTap(onBus: 0, bufferSize: 2400, format: format) { [weak self] buf, _ in self?.process(buf) }
        try engine.start()
        running = true
    }

    func stop() {
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        running = false
    }

    /// LiveKit's processed mic audio (Int16, non-interleaved): channel 0 as Float32 into the level meter and the part file.
    func feed(_ buf: AVAudioPCMBuffer) {
        guard let src = buf.int16ChannelData?[0], buf.frameLength > 0,
              let fmt = AVAudioFormat(standardFormatWithSampleRate: buf.format.sampleRate, channels: 1),
              let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: buf.frameLength), let dst = out.floatChannelData?[0] else { return }
        out.frameLength = buf.frameLength
        for i in 0..<Int(buf.frameLength) { dst[i] = Float(src[i]) / 32768 }
        process(out)
    }

    /// The file is created with the first buffer's format (LiveKit's rate is only known once audio flows).
    func beginPart(_ url: URL) {
        lock.withLock { partURL = url; partFile = nil; partFrames = 0; partEnergy = []; energySum = 0; energyCount = 0 }
    }

    func endPart() -> PartRecording? {
        lock.withLock {
            defer { partFile = nil; partURL = nil }
            guard let f = partFile, partFrames > 0 else { return nil }
            return PartRecording(url: f.url, durationMs: Int(Double(partFrames) / f.processingFormat.sampleRate * 1000), energy: partEnergy)
        }
    }

    private static func rms(_ p: UnsafePointer<Float>, _ from: Int, _ count: Int) -> Double {
        guard count > 0 else { return 0 }
        var sum: Float = 0
        for i in from..<(from + count) { sum += p[i] * p[i] }
        return Double(sqrt(sum / Float(count)))
    }

    /// UI level 0…1 on a -60…0 dBFS scale.
    private static func level(_ p: UnsafePointer<Float>, _ from: Int, _ count: Int) -> Double {
        let db = 20 * log10(max(rms(p, from, count), 1e-6))
        return max(0, min(1, (db + 60) / 60))
    }

    private func process(_ buf: AVAudioPCMBuffer) {
        guard let ch = buf.floatChannelData?[0] else { return }
        let n = Int(buf.frameLength)
        onLevel?(Self.level(ch, 0, n), Double(n) / buf.format.sampleRate)

        lock.withLock {
            guard !examinerOn, let url = partURL else { return }
            if partFile == nil {
                partFile = try? AVAudioFile(forWriting: url, settings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: buf.format.sampleRate,
                    AVNumberOfChannelsKey: buf.format.channelCount,
                ], commonFormat: .pcmFormatFloat32, interleaved: false)
            }
            guard let f = partFile else { return }
            try? f.write(from: buf)
            partFrames += AVAudioFramePosition(n)
            let frame = max(1, Int(buf.format.sampleRate * 0.05)) // 50 ms energy frames
            for i in 0..<n {
                energySum += ch[i] * ch[i]
                energyCount += 1
                if energyCount == frame {
                    partEnergy.append(Recorder.energyByte(rms: Double(sqrt(energySum / Float(frame)))))
                    energySum = 0
                    energyCount = 0
                }
            }
        }
    }
}
