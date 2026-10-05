import AVFoundation
import Observation

/// Streams a recording from its presigned URL (AVPlayer supports Range requests). Playback category so the silent switch does not mute it.
@MainActor
func activatePlayback() {
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
    /// Set while the player sits at a restored position and has not been played since.
    private(set) var resumedAt: Double = 0
    /// Resume hooks (practice runner): `track` gets the position every tick once the saved one is applied, `persist` asks for a save (pause, every ~5 s, teardown).
    @ObservationIgnored private var track: ((Double) -> Void)?
    @ObservationIgnored private var persist: (() -> Void)?
    @ObservationIgnored private var resumeTo: Double?
    @ObservationIgnored private var ready = true // false until the saved position is applied: currentTime is 0 and must not overwrite it
    @ObservationIgnored private var lastPersist: Double = 0
    var rate: Float = 1 { didSet { if playing { player?.rate = rate } } }
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var observer: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    /// "Play from here": play [from, to] and pause at `to`. Held until the recording has loaded.
    @ObservationIgnored private var stopAt: Double?
    @ObservationIgnored private var pending: (from: Double, to: Double)?

    func load(_ url: URL?, resumeAt: Double = 0, track: ((Double) -> Void)? = nil, persist: (() -> Void)? = nil) {
        let keep = pending
        teardown()
        pending = keep
        self.track = track; self.persist = persist
        resumeTo = track == nil ? nil : resumeAt
        ready = track == nil
        guard let url else { failed = true; return }
        failed = false
        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        player = p
        observer = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main) { [weak self] t in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.time = t.seconds.isFinite ? t.seconds : 0
                let d = item.duration.seconds
                if d.isFinite, d > 0 { self.duration = d }
                self.failed = item.status == .failed
                if let stop = self.stopAt, self.time >= stop { self.stopAt = nil; self.player?.pause(); self.playing = false }
                if let c = self.pending, self.duration > 0 { self.pending = nil; self.play(from: c.from, to: c.to) }
                if !self.ready, self.duration > 0 {
                    let at = LrAudioState.resumePosition(self.resumeTo ?? 0, duration: self.duration)
                    self.ready = true
                    if at > 0 { self.seek(to: at); self.resumedAt = at }
                } else if self.ready, self.track != nil {
                    self.track?(self.time)
                    if self.playing, self.time - self.lastPersist >= 5 || self.time < self.lastPersist { self.lastPersist = self.time; self.persist?() }
                }
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.playing = false }
        }
    }

    func toggle() {
        guard let p = player else { return }
        if playing {
            p.pause(); playing = false
            savePosition()
        } else { activatePlayback(); p.rate = rate; playing = true; resumedAt = 0 }
    }

    func play(from: Double, to: Double) {
        guard let p = player, duration > 0 else { pending = (from, to); return }
        seek(to: from)
        stopAt = to
        activatePlayback()
        p.rate = rate
        playing = true
    }

    private func savePosition() {
        guard ready, let track else { return }
        track(time)
        persist?()
    }

    func seek(to t: Double) {
        stopAt = nil
        let target = max(0, duration > 0 ? min(t, duration) : t)
        time = target
        player?.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func skip(_ s: Double) { seek(to: time + s) }

    func replay() {
        seek(to: 0)
        guard let p = player else { return }
        resumedAt = 0
        activatePlayback()
        p.rate = rate
        playing = true
    }

    func teardown() {
        savePosition()
        track = nil; persist = nil; resumeTo = nil; ready = true; resumedAt = 0; lastPersist = 0
        if let o = observer { player?.removeTimeObserver(o) }
        if let e = endObserver { NotificationCenter.default.removeObserver(e) }
        observer = nil; endObserver = nil
        player?.pause()
        player = nil
        playing = false; time = 0; duration = 0; stopAt = nil; pending = nil
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
    /// Whole sitting left: rest of the recording plus the review window.
    var timeLeft: Int { max(0, Int((total + Double(Lr.listeningReviewSeconds) - elapsed).rounded(.up))) }
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
