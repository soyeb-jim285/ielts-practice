import AVFoundation
import Observation

/// AVAudioPlayer wrapper with observable progress, seek, and await-until-finished playback.
@MainActor @Observable
final class Player: NSObject, AVAudioPlayerDelegate {
    private(set) var isPlaying = false
    private(set) var currentTime: Double = 0
    private(set) var duration: Double = 0
    private(set) var isLoaded = false

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var finished: CheckedContinuation<Void, Never>?

    func load(_ data: Data) throws {
        stop()
        let p = try AVAudioPlayer(data: data)
        p.delegate = self
        p.prepareToPlay()
        player = p
        duration = p.duration
        currentTime = 0
        isLoaded = true
    }

    func play() {
        guard let p = player else { return }
        try? Recorder.configureSession()
        p.play()
        isPlaying = true
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard let self, let p = self.player else { return }
                self.currentTime = p.currentTime
            }
        }
    }

    func pause() {
        player?.pause()
        isPlaying = false
        ticker?.cancel()
    }

    func toggle() { isPlaying ? pause() : play() }

    func seek(to t: Double, play shouldPlay: Bool = true) {
        guard let p = player else { return }
        p.currentTime = max(0, min(t, p.duration))
        currentTime = p.currentTime
        if shouldPlay { play() }
    }

    func stop() {
        player?.stop()
        isPlaying = false
        ticker?.cancel()
        finished?.resume()
        finished = nil
    }

    /// Plays `data` from the start and returns when playback ends (or `stop()` is called).
    func playToEnd(_ data: Data) async {
        do { try load(data) } catch { return }
        play()
        await withCheckedContinuation { finished = $0 }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlaying = false
            self.ticker?.cancel()
            self.currentTime = self.duration
            self.finished?.resume()
            self.finished = nil
        }
    }
}
