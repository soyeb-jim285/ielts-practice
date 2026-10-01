import AVFoundation

/// Live-mode audio on one AVAudioEngine: mic level, per-turn and per-part m4a files, a PCM16 mono stream
/// for the Realtime providers (24 kHz for OpenAI, 16 kHz for Gemini Live), and PCM16 24 kHz playback of the examiner's voice.
/// ponytail: half-duplex — the mic is ignored while the examiner speaks (no echo cancellation, no barge-in).
/// Enable inputNode voice processing if barge-in is ever needed.
final class LiveAudio {
    struct PartRecording { let url: URL; let durationMs: Int; let energy: [Int] }

    /// Called on the audio thread with (level 0…1, seconds covered).
    var onLevel: ((Double, Double) -> Void)?
    /// Called on the audio thread with PCM16 mono little-endian audio at the rate set by setPCMRate (Realtime input).
    var onPCM16: ((Data) -> Void)?

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var pcm16 = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!
    private let playFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
    private var converter: AVAudioConverter?
    private let lock = NSLock()
    private var turnFile: AVAudioFile?
    private var partFile: AVAudioFile?
    private var partFrames: AVAudioFramePosition = 0
    private var partEnergy: [Int] = []
    private var pendingBuffers = 0
    private var gate = true
    private(set) var running = false

    /// False while the examiner audio plays (turn mode) or during P2 prep.
    var capturing: Bool {
        get { lock.withLock { gate } }
        set { lock.withLock { gate = newValue } }
    }
    var examinerSpeaking: Bool { lock.withLock { pendingBuffers > 0 } }

    func start() throws {
        guard !running else { return }
        try Recorder.configureSession()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw APIError(status: 0, message: "No microphone input available.") }
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: playFormat)
        lock.withLock { converter = AVAudioConverter(from: format, to: pcm16) }
        input.installTap(onBus: 0, bufferSize: 2400, format: format) { [weak self] buf, _ in self?.process(buf) }
        try engine.start()
        running = true
    }

    /// Sample rate of the PCM16 stream passed to onPCM16: 24 kHz (default, OpenAI Realtime) or 16 kHz (Gemini Live). Safe while running.
    func setPCMRate(_ rate: Double) {
        guard let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true) else { return }
        let input = engine.inputNode.outputFormat(forBus: 0)
        lock.withLock {
            pcm16 = fmt
            converter = AVAudioConverter(from: input, to: fmt)
        }
    }

    func stop() {
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        playerNode.stop()
        engine.stop()
        running = false
        lock.withLock { turnFile = nil; partFile = nil; pendingBuffers = 0 }
    }

    private func newFile(_ url: URL) throws -> AVAudioFile {
        let f = engine.inputNode.outputFormat(forBus: 0)
        return try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: f.sampleRate,
            AVNumberOfChannelsKey: f.channelCount,
        ], commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func beginTurn(_ url: URL) throws {
        let f = try newFile(url)
        lock.withLock { turnFile = f }
    }

    /// Closes the turn file (released → finalized) and returns its URL.
    func endTurn() -> URL? { lock.withLock { defer { turnFile = nil }; return turnFile?.url } }

    func beginPart(_ url: URL) throws {
        let f = try newFile(url)
        lock.withLock { partFile = f; partFrames = 0; partEnergy = [] }
    }

    func endPart() -> PartRecording? {
        lock.withLock {
            defer { partFile = nil }
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

    /// UI/VAD level 0…1 on a -60…0 dBFS scale.
    private static func level(_ p: UnsafePointer<Float>, _ from: Int, _ count: Int) -> Double {
        let db = 20 * log10(max(rms(p, from, count), 1e-6))
        return max(0, min(1, (db + 60) / 60))
    }

    private func process(_ buf: AVAudioPCMBuffer) {
        guard let ch = buf.floatChannelData?[0] else { return }
        let n = Int(buf.frameLength)
        onLevel?(Self.level(ch, 0, n), Double(n) / buf.format.sampleRate)

        let open = lock.withLock { gate && pendingBuffers == 0 }
        guard open else { return }
        lock.withLock {
            try? turnFile?.write(from: buf)
            if let f = partFile {
                try? f.write(from: buf)
                partFrames += AVAudioFramePosition(n)
                let frame = max(1, Int(buf.format.sampleRate * 0.05)) // 50 ms energy frames
                var i = 0
                while i < n { let c = min(frame, n - i); partEnergy.append(Recorder.energyByte(rms: Self.rms(ch, i, c))); i += c }
            }
        }
        let (conv, outFormat) = lock.withLock { (self.converter, self.pcm16) }
        guard let onPCM16, let converter = conv else { return }
        let cap = AVAudioFrameCount(Double(n) * outFormat.sampleRate / buf.format.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        converter.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buf
        }
        if err == nil, out.frameLength > 0, let p = out.int16ChannelData?[0] {
            onPCM16(Data(bytes: p, count: Int(out.frameLength) * 2))
        }
    }

    /// Queue PCM16 mono 24 kHz audio from the examiner.
    func playPCM16(_ data: Data) {
        let frames = data.count / 2
        guard running, frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(frames)),
              let dst = buf.floatChannelData?[0] else { return }
        buf.frameLength = AVAudioFrameCount(frames)
        data.withUnsafeBytes { raw in
            for i in 0..<frames { dst[i] = Float(raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self)) / 32768 }
        }
        lock.withLock { pendingBuffers += 1 }
        playerNode.scheduleBuffer(buf) { [weak self] in
            guard let self else { return }
            self.lock.withLock { self.pendingBuffers = max(0, self.pendingBuffers - 1) }
        }
        if !playerNode.isPlaying { playerNode.play() }
    }

    func stopPlayback() {
        playerNode.stop()
        lock.withLock { pendingBuffers = 0 }
    }
}
