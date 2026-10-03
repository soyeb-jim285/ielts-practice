import AVFoundation
import Observation

/// Streams a recording from its presigned URL (AVPlayer supports Range requests). Playback category so the silent switch does not mute it.
@MainActor
private func activatePlayback() {
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    try? AVAudioSession.sharedInstance().setActive(true)
}

/// Practice / review player: play, scrub, ±5 s, speed 0.75-1.25x, replay the part.
@MainActor @Observable
final class LrPracticePlayer {
    private(set) var time: Double = 0
    private(set) var duration: Double = 0
    private(set) var playing = false
    private(set) var failed = false
    var rate: Float = 1 { didSet { if playing { player?.rate = rate } } }
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var observer: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?

    func load(_ url: URL?) {
        teardown()
        guard let url else { failed = true; return }
        failed = false
        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        player = p
        observer = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] t in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.time = t.seconds.isFinite ? t.seconds : 0
                let d = item.duration.seconds
                if d.isFinite, d > 0 { self.duration = d }
                self.failed = item.status == .failed
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.playing = false }
        }
    }

    func toggle() {
        guard let p = player else { return }
        if playing { p.pause(); playing = false } else { activatePlayback(); p.rate = rate; playing = true }
    }

    func seek(to t: Double) {
        let target = max(0, duration > 0 ? min(t, duration) : t)
        time = target
        player?.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func skip(_ s: Double) { seek(to: time + s) }

    func replay() {
        seek(to: 0)
        guard let p = player else { return }
        activatePlayback()
        p.rate = rate
        playing = true
    }

    func teardown() {
        if let o = observer { player?.removeTimeObserver(o) }
        if let e = endObserver { NotificationCenter.default.removeObserver(e) }
        observer = nil; endObserver = nil
        player?.pause()
        player = nil
        playing = false; time = 0; duration = 0
    }
}

/// Exam listening: every recording plays once, in order, with no pause or seek. The clock IS the audio position (so a resumed attempt picks the
/// recording up where it was); afterwards a 2-minute review countdown runs on the wall clock. Mirrors web useExamPlaylist.
@MainActor @Observable
final class LrExamPlaylist {
    enum Phase { case idle, audio, review }
    private(set) var durations: [Double]?
    private(set) var error = false
    private(set) var phase: Phase = .idle
    private(set) var idx = 0
    private(set) var elapsed: Double
    private(set) var stalled = false
    private let urls: [URL?]
    private let startElapsed: Double
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var reviewStart = Date()

    init(urls: [URL?], startElapsed: Int) {
        self.urls = urls
        self.startElapsed = Double(startElapsed)
        elapsed = Double(startElapsed)
        Task { await loadDurations() }
    }

    private func loadDurations() async {
        var out: [Double] = []
        for u in urls {
            guard let u, let d = try? await AVURLAsset(url: u).load(.duration).seconds, d.isFinite else { error = true; return }
            out.append(d)
        }
        durations = out
    }

    private var starts: [Double] { (durations ?? []).reduce(into: [0]) { $0.append($0.last! + $1) } }
    var total: Double { starts.last ?? 0 }
    var reviewLeft: Int { max(0, Int((Double(Lr.listeningReviewSeconds) - (elapsed - total)).rounded(.up))) }
    var finishedReview: Bool { phase == .review && reviewLeft == 0 }

    func start() {
        guard let durations else { return }
        stalled = false
        if startElapsed >= total {
            reviewStart = Date().addingTimeInterval(-(startElapsed - total))
            phase = .review
            runTicker()
            return
        }
        var i = 0
        while i < durations.count - 1, startElapsed >= starts[i + 1] { i += 1 }
        phase = .audio
        activatePlayback()
        play(i, offset: startElapsed - starts[i])
        runTicker()
    }

    private func play(_ i: Int, offset: Double) {
        guard let url = urls[i] else { return }
        idx = i
        if let e = endObserver { NotificationCenter.default.removeObserver(e) }
        let item = AVPlayerItem(url: url)
        let p = player ?? AVPlayer()
        player = p
        p.replaceCurrentItem(with: item)
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.ended() }
        }
        if offset > 0 { p.seek(to: CMTime(seconds: offset, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) }
        p.play()
    }

    private func ended() {
        if idx < urls.count - 1 {
            play(idx + 1, offset: 0)
        } else {
            reviewStart = Date()
            phase = .review
        }
    }

    func resume() { stalled = false; activatePlayback(); player?.play() }

    private func runTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                guard let self else { return }
                if self.phase == .audio {
                    let t = self.player?.currentTime().seconds ?? 0
                    self.elapsed = self.starts[self.idx] + (t.isFinite ? t : 0)
                    // The device paused it (headphones unplugged, a call): the learner may not seek, but they can resume.
                    self.stalled = self.player?.timeControlStatus == .paused
                } else if self.phase == .review {
                    self.elapsed = self.total + Date().timeIntervalSince(self.reviewStart)
                }
            }
        }
    }

    func stop() {
        ticker?.cancel()
        if let e = endObserver { NotificationCenter.default.removeObserver(e) }
        player?.pause()
        player = nil
    }
}
