import Foundation
import Observation

/// Answers of an in-progress attempt: local state, debounced autosave (~1 s), flush on background / exit, a keep-alive save of the clock
/// every 15 s, flags and position kept on the device, and submit. Mirrors web useLrSession.
@MainActor @Observable
final class LrSession {
    enum Save { case saved, dirty, saving, error }

    let attempt: LrAttempt
    var test: LrTest { attempt.test }
    private(set) var responses: [String: String]
    var flagged: Set<Int> { didSet { UserDefaults.standard.set(flagged.sorted(), forKey: "lr:\(attempt.id):flags") } }
    private(set) var save: Save = .saved
    private(set) var submitting = false
    /// Seconds spent on the attempt (wall clock, or the audio position in exam listening); saved with the answers.
    var elapsed: Double
    /// Pacing: seconds per part (the runner ticks it), answer changes per question, questions answered late (after `lateFrom` elapsed seconds).
    var stats: LrStats
    /// Reading: the last 5 minutes (3300 s); exam listening: once the recordings end; practice listening: never.
    var lateFrom: Double = .infinity
    @ObservationIgnored private var focusVal: [Int: String] = [:]
    @ObservationIgnored private var focusedText: Int?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private var dirty = false
    @ObservationIgnored private var busy = false
    @ObservationIgnored private var done = false
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var keepAlive: Task<Void, Never>?

    init(attempt: LrAttempt, api: APIClient) {
        self.attempt = attempt
        self.api = api
        responses = attempt.responses
        elapsed = Double(attempt.elapsedS)
        var st = attempt.stats ?? LrStats()
        st.audio = LrAudioState.load(attempt.id, server: st.audio)
        stats = st
        flagged = Set((UserDefaults.standard.array(forKey: "lr:\(attempt.id):flags") as? [Int]) ?? [])
        keepAlive = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                self?.dirty = true // persist the clock too
                await self?.flush()
            }
        }
    }

    deinit { keepAlive?.cancel(); debounce?.cancel() }

    var position: (part: Int, n: Int)? {
        guard let a = UserDefaults.standard.array(forKey: "lr:\(attempt.id):pos") as? [Int], a.count == 2 else { return nil }
        return (a[0], a[1])
    }
    func remember(part: Int, n: Int) { UserDefaults.standard.set([part, n], forKey: "lr:\(attempt.id):pos") }

    func value(_ n: Int) -> String { responses[String(n)] ?? "" }
    var answeredCount: Int { test.flat.filter { Lr.answered(responses, $0.n) }.count }

    func set(_ n: Int, _ v: String) {
        var next = responses
        if v.isEmpty { next[String(n)] = nil } else { next[String(n)] = v }
        replace(next)
    }

    /// A text gap got focus: typing in it counts as one change per visit (noteBlur), not per keystroke.
    func noteFocus(_ n: Int) { focusedText = n; focusVal[n] = value(n) }
    func noteBlur(_ n: Int) {
        if let before = focusVal[n], !before.isEmpty, value(n) != before { stats.changes[String(n), default: 0] += 1 }
        focusVal[n] = nil
        if focusedText == n { focusedText = nil }
    }
    func tick(part: Int) { stats.partS[String(part), default: 0] += 1 }

    private var statsBody: [String: Any] {
        var b: [String: Any] = ["partS": stats.partS.mapValues { Int($0.rounded()) }, "changes": stats.changes, "late": stats.late]
        if let a = stats.audio?.cleaned {
            var o: [String: Any] = ["pos": a.pos]
            if let r = a.rate { o["rate"] = r }
            b["audio"] = o
        }
        return b
    }

    // Practice listening position: `noteAudio` is hot (every player tick, memory only); `saveAudio` stores it on the device and queues a server save.
    func audioStart(_ part: Int) -> Double { stats.audio?.pos[String(part)] ?? 0 }
    var audioRate: Float { Float(stats.audio?.rate ?? 1) }
    func noteAudio(part: Int, pos: Double) {
        var a = stats.audio ?? LrAudioState()
        a.pos[String(part)] = pos
        stats.audio = a
    }
    func noteRate(_ r: Float) {
        var a = stats.audio ?? LrAudioState()
        a.rate = Double(r)
        stats.audio = a
        saveAudio()
    }
    func saveAudio() {
        guard !done, let a = stats.audio else { return }
        a.saveLocal(attempt.id)
        dirty = true
        Task { await flush() }
    }

    func replace(_ next: [String: String]) {
        for k in Set(responses.keys).union(next.keys) where (responses[k] ?? "") != (next[k] ?? "") {
            guard let n = Int(k) else { continue }
            if !(responses[k] ?? "").isEmpty, focusedText != n { stats.changes[k, default: 0] += 1 }
            if !(next[k] ?? "").isEmpty, elapsed >= lateFrom, !stats.late.contains(n) { stats.late.append(n) }
        }
        responses = next
        dirty = true
        save = .dirty
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { await self?.flush() }
        }
    }

    func saveNow() async { dirty = true; await flush() }

    func stop() { keepAlive?.cancel(); debounce?.cancel() }

    func flush() async {
        debounce?.cancel()
        guard !done, dirty else { return }
        if busy {
            debounce = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(500))
                if !Task.isCancelled { await self?.flush() }
            }
            return
        }
        busy = true
        dirty = false
        save = .saving
        defer { busy = false }
        do {
            let _: Empty = try await api.send("PUT", "/api/lr/attempts/\(attempt.id)", ["responses": responses, "elapsedS": Int(elapsed), "stats": statsBody] as [String: Any])
            save = dirty ? .dirty : .saved
        } catch is CancellationError {
            dirty = true
        } catch {
            dirty = true
            save = .error
            debounce = Task { [weak self] in // offline: keep trying
                try? await Task.sleep(for: .seconds(5))
                if !Task.isCancelled { await self?.flush() }
            }
        }
    }

    func submit() async throws -> LrAttempt {
        guard !done else { throw CancellationError() }
        done = true
        stop()
        submitting = true
        defer { submitting = false }
        do {
            let a: LrAttempt = try await api.send("POST", "/api/lr/attempts/\(attempt.id)/submit", ["responses": responses, "elapsedS": Int(elapsed), "stats": statsBody] as [String: Any])
            UserDefaults.standard.removeObject(forKey: "lr:\(attempt.id):flags")
            UserDefaults.standard.removeObject(forKey: "lr:\(attempt.id):pos")
            LrAudioState.clearLocal(attempt.id)
            LrMarkStore.clear(attempt.id) // highlights and notes live only on the device and go with the attempt
            return a
        } catch {
            done = false
            keepAlive = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    self?.dirty = true
                    await self?.flush()
                }
            }
            throw error
        }
    }
}
