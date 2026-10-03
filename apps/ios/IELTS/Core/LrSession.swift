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

    func replace(_ next: [String: String]) {
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
            let _: Empty = try await api.send("PUT", "/api/lr/attempts/\(attempt.id)", ["responses": responses, "elapsedS": Int(elapsed)] as [String: Any])
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
            let a: LrAttempt = try await api.send("POST", "/api/lr/attempts/\(attempt.id)/submit", ["responses": responses, "elapsedS": Int(elapsed)] as [String: Any])
            UserDefaults.standard.removeObject(forKey: "lr:\(attempt.id):flags")
            UserDefaults.standard.removeObject(forKey: "lr:\(attempt.id):pos")
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
