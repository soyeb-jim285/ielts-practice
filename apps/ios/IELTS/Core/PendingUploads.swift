import Foundation
import Observation

/// A finished speaking recording that has not reached the server yet. The m4a and this metadata live in
/// Application Support from the moment recording stops until the upload is confirmed, so a failed upload,
/// a relaunch or a killed app never loses it (web: hooks/pendingRecordings.ts).
/// When one question's answer window ran, in ms on the recording clock (which stands still while the examiner talks).
struct AnswerWindow: Codable, Equatable { let q: Int; let startMs: Int; let endMs: Int }

struct PendingRecording: Codable, Identifiable, Equatable {
    let id: String
    let promptId: String
    let part: Int
    let label: String
    let createdAt: Date
    let durationMs: Int
    let energy: [Int]
    let marks: [Int]
    var segments: [AnswerWindow]? = nil
    let sessionId: String?
    let parentAttemptId: String?
    /// Set when the recording is the speaking section of a mock test.
    var mockId: String? = nil
    // Upload progress, so a retry resumes at the step that failed.
    var attemptId: String?
    var uploadUrl: String?
    var uploaded = false
}

enum UploadState: Equatable {
    case uploading
    case failed(String)
    case done(String) // attempt id
}

/// Owns the pending recordings and their uploads. Uploads run in detached-from-view tasks, so leaving a screen never cancels them.
@MainActor @Observable
final class PendingStore {
    static let shared = PendingStore()

    private(set) var items: [PendingRecording] = []
    /// Upload state per recording id for this launch (a recording with no entry has not been tried yet).
    private(set) var states: [String: UploadState] = [:]

    init() { reload() }

    static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PendingRecordings", isDirectory: true)
    }

    func audioURL(_ id: String) -> URL { Self.directory.appendingPathComponent("\(id).m4a") }
    private func metaURL(_ id: String) -> URL { Self.directory.appendingPathComponent("\(id).json") }

    /// Call before recording into `audioURL(_:)`.
    func prepare() {
        try? FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
    }

    /// Re-read the disk (the hub calls this when it appears).
    /// ponytail: an m4a with no metadata (app killed mid-recording) is left behind; sweep them if storage ever matters.
    func reload() {
        let fm = FileManager.default
        let files = (try? fm.contentsOfDirectory(at: Self.directory, includingPropertiesForKeys: nil)) ?? []
        let decoder = JSONDecoder()
        items = files
            .filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(PendingRecording.self, from: Data(contentsOf: $0)) }
            .filter { fm.fileExists(atPath: audioURL($0.id).path) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    /// Keep a finished recording (its m4a is already at `audioURL(id)`).
    func add(_ p: PendingRecording) { write(p) }

    private func write(_ p: PendingRecording) {
        if let data = try? JSONEncoder().encode(p) { try? data.write(to: metaURL(p.id), options: .atomic) }
        if let i = items.firstIndex(where: { $0.id == p.id }) { items[i] = p } else { items.insert(p, at: 0) }
    }

    func remove(_ id: String) {
        try? FileManager.default.removeItem(at: audioURL(id))
        try? FileManager.default.removeItem(at: metaURL(id))
        items.removeAll { $0.id == id }
    }

    /// Delete the local copy and the half-created attempt on the server.
    func discard(_ p: PendingRecording, api: APIClient) async {
        if let a = p.attemptId { _ = try? await api.raw("DELETE", "/api/attempts/\(a)") }
        remove(p.id)
        states[p.id] = nil
    }

    /// Fire and forget; watch `states[p.id]`.
    func start(_ p: PendingRecording, api: APIClient) {
        Task { await upload(p, api: api) }
    }

    /// Create the attempt, PUT the audio, submit. Progress is saved after each step so a retry resumes where it failed.
    /// Returns the attempt id on success (the local copy is then removed), nil on failure or when already uploading.
    @discardableResult
    func upload(_ rec: PendingRecording, api: APIClient) async -> String? {
        if case .uploading = states[rec.id] { return nil }
        states[rec.id] = .uploading
        var p = items.first(where: { $0.id == rec.id }) ?? rec
        do {
            if p.attemptId == nil {
                var body: [String: Any] = ["promptId": p.promptId, "skill": "speaking", "part": p.part, "mode": "practice",
                                           "audioContentType": "audio/mp4"]
                if let s = p.sessionId { body["sessionId"] = s }
                if let a = p.parentAttemptId { body["parentAttemptId"] = a }
                if let m = p.mockId { body["mockId"] = m }
                let created: Created = try await api.send("POST", "/api/attempts", body)
                guard let url = created.uploadUrl else { throw APIError(status: 0, message: "The server didn't return an upload URL.") }
                p.attemptId = created.id
                p.uploadUrl = url
                write(p)
            }
            guard let attemptId = p.attemptId else { throw APIError(status: 0, message: "Couldn't start the upload.") }
            if !p.uploaded {
                guard let url = p.uploadUrl else { throw APIError(status: 0, message: "The server didn't return an upload URL.") }
                try await api.upload(url, file: audioURL(p.id), contentType: "audio/mp4")
                p.uploaded = true
                write(p)
            }
            do {
                var body: [String: Any] = ["durationMs": p.durationMs, "energy": Array(p.energy.prefix(20000)), "marks": Array(p.marks.prefix(200))]
                if let s = p.segments, !s.isEmpty { body["segments"] = s.prefix(200).map { ["q": $0.q, "startMs": $0.startMs, "endMs": $0.endMs] } }
                try await api.raw("POST", "/api/attempts/\(attemptId)/submit", body)
            } catch let e as APIError where e.status == 409 {
                // An earlier submit already went through and only its response was lost.
            }
            remove(p.id)
            states[p.id] = .done(attemptId)
            return attemptId
        } catch {
            states[p.id] = .failed(CommunityIssue.summary(error))
            return nil
        }
    }
}
