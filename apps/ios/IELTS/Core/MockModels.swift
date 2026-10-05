import Foundation

// Full mock exam (docs/mock-exam.md): the server picks the tests, sequences the sections and sends the finished bands.
// Nothing here computes a band; the app only shows what GET /api/mock/{id} returns.

// openapi: Mock.sections[]

struct MockSection: Codable, Equatable, Identifiable {
    let skill: String // listening | reading | writing | speaking
    let state: String // todo | in_progress | submitted | marking | done | failed | skipped
    let band: Double?
    let attemptId: String?
    let sessionId: String?
    let elapsedS: Int?
    let limitS: Int?
    let mode: String? // recorded | live
    var id: String { skill }
}

// openapi: Mock

struct MockExam: Codable, Equatable, Identifiable {
    let id: String
    let variant: String // academic | general
    let source: String // cambridge | generated
    let ref: String?
    let status: String // in_progress | completed | closed
    let startedAt: String
    let expiresAt: String
    let completedAt: String?
    let next: String? // first section not submitted; nil once completed or closed
    let overall: Double?
    let sections: [MockSection]

    var isOpen: Bool { status == "in_progress" }
    func section(_ skill: String) -> MockSection? { sections.first { $0.skill == skill } }
}

// openapi: MockOptions

struct MockOptions: Decodable {
    struct Cambridge: Decodable, Equatable { let ref: String; let bookTest: String; let started: Bool }
    struct Allowance: Decodable { let writing: SkillQuota; let speaking: SkillQuota }
    let cambridge: [Cambridge]
    let own: Bool
    let quota: Allowance
}

// openapi: MockWritingStarted

struct MockWritingStart: Decodable {
    let prompts: [Prompt]
    let writingSessionId: String
    let elapsedS: Int
}

// openapi: MockSpeakingChosen

struct MockSpeakingChosen: Decodable {
    let mode: String
    let sessionId: String?
    let test: SpeakingTest?
}

/// What the recorded Speaking section needs from `speaking/choose`.
struct MockSpeakingRun {
    let mockId: String
    let sessionId: String
    let test: SpeakingTest
}

/// Copy and small rules of the mock flow, kept free of views so they can be unit-tested (same wording as web lib/mock.ts).
enum MockFlow {
    static let skills = ["listening", "reading", "writing", "speaking"]
    static let labels = ["listening": "Listening", "reading": "Reading", "writing": "Writing", "speaking": "Speaking"]
    static let times = [
        "listening": "about 30 minutes plus a 2-minute check",
        "reading": "60 minutes",
        "writing": "60 minutes for both tasks",
        "speaking": "11 to 14 minutes",
    ]

    static func label(_ skill: String) -> String { labels[skill] ?? skill.capitalized }

    /// The transition card: what just finished and what comes next. Nil when nothing is left, or for Speaking (which has its own choice screen).
    static func transition(next: String?) -> (title: String, body: String)? {
        guard let next, let i = skills.firstIndex(of: next), next != "speaking" else { return nil }
        let time = "\(label(next)), \(times[next] ?? "")"
        if i == 0 { return ("Ready for Listening?", "Next: \(time). Nothing is running yet. The clock starts when you press Start.") }
        return ("\(label(skills[i - 1])) finished.", "Next: \(time). Nothing is running. The clock starts when you press Start.")
    }

    enum Tone { case neutral, accent, good, bad }

    /// Row status per section state; Speaking says "Not taken yet" rather than "Not started".
    static func status(_ s: MockSection) -> (text: String, tone: Tone) {
        switch s.state {
        case "in_progress": return ("In progress", .accent)
        case "submitted": return ("Submitted", .accent)
        case "marking": return ("Being marked", .accent)
        case "done": return ("Marked", .good)
        case "failed": return ("Marking failed, retry", .bad)
        case "skipped": return ("Skipped", .neutral)
        default: return (s.skill == "speaking" ? "Not taken yet" : "Not started", .neutral)
        }
    }

    /// A submitted section links to its normal result page.
    static func isFinished(_ s: MockSection) -> Bool { ["submitted", "marking", "done", "failed"].contains(s.state) }

    /// "12 min used of 60", or how Speaking was taken.
    static func meta(_ s: MockSection) -> String? {
        if s.state == "in_progress", let e = s.elapsedS, e > 0 { return "\(e / 60) min used" + (s.limitS.map { " of \(Int((Double($0) / 60).rounded()))" } ?? "") }
        if s.skill == "speaking", let m = s.mode, s.state != "skipped" { return m == "live" ? "Live examiner" : "Recorded test" }
        return nil
    }

    /// The line beside the overall band.
    static func overallNote(_ m: MockExam, target: Double) -> String {
        if m.overall != nil { return "Mean of your four section bands, to the nearest half band. Target \(String(format: "%.1f", target))." }
        if m.status == "closed" { return "This mock was finished without Speaking, so it has no overall band." }
        if m.sections.contains(where: { $0.state == "marking" }) { return "Overall appears when all four sections are marked. Marking takes about a minute." }
        return "Overall appears when all four sections are marked."
    }

    /// "Continue your mock test, Reading next".
    static func continueLine(_ m: MockExam) -> String { m.next.map { "Continue your mock test, \(label($0)) next" } ?? "Your mock test" }

    /// Lowest-numbered Cambridge test the person has not started a mock on, else the first (web MockStart default).
    static func defaultRef(_ options: [MockOptions.Cambridge]) -> String? {
        func key(_ c: MockOptions.Cambridge) -> Int { Lr.parseRef(c.ref).map { $0.book * 100 + $0.test } ?? Int.max }
        let sorted = options.sorted { key($0) < key($1) }
        return (sorted.first { !$0.started } ?? sorted.first)?.ref
    }
}

extension APIClient {
    func mockOptions(variant: String) async throws -> MockOptions { try await get("/api/mock/options", query: ["variant": variant]) }

    func mockCurrent() async throws -> MockExam? {
        struct R: Decodable { let mock: MockExam? }
        let r: R = try await get("/api/mock/current")
        return r.mock
    }

    func mockList() async throws -> [MockExam] {
        struct R: Decodable { let items: [MockExam] }
        let r: R = try await get("/api/mock")
        return r.items
    }

    func mock(_ id: String) async throws -> MockExam { try await get("/api/mock/\(id)") }

    func createMock(variant: String, source: String, ref: String?, replace: Bool) async throws -> MockExam {
        var body: [String: Any] = ["variant": variant, "source": source]
        if let ref { body["ref"] = ref }
        return try await send("POST", "/api/mock" + (replace ? "?replace=true" : ""), body)
    }

    /// Listening or Reading: the exam-mode attempt (created, or the one in progress).
    func startMockSection(_ id: String, skill: String) async throws -> String {
        struct R: Decodable { let attemptId: String }
        let r: R = try await send("POST", "/api/mock/\(id)/sections/\(skill)/start", [String: String]())
        return r.attemptId
    }

    func startMockWriting(_ id: String) async throws -> MockWritingStart {
        try await send("POST", "/api/mock/\(id)/writing/start", [String: String]())
    }

    /// Autosave of the writing clock; the server only ever raises it.
    func saveMockClock(_ id: String, elapsedS: Int) async {
        do {
            let _: Empty = try await send("PATCH", "/api/mock/\(id)/writing/clock", ["elapsedS": min(7200, max(0, elapsedS))])
        } catch {} // best effort: the next tick saves again
    }

    func chooseMockSpeaking(_ id: String, mode: String) async throws -> MockSpeakingChosen {
        try await send("POST", "/api/mock/\(id)/speaking/choose", ["mode": mode])
    }

    /// Live examiner: link the finished live session to the mock.
    func attachMockSession(_ id: String, sessionId: String) async throws {
        let _: Empty = try await send("POST", "/api/mock/\(id)/speaking/attach", ["sessionId": sessionId])
    }

    func closeMock(_ id: String) async throws {
        let _: Empty = try await send("POST", "/api/mock/\(id)/close", [String: String]())
    }

    func abandonMock(_ id: String) async throws {
        let _: Empty = try await send("DELETE", "/api/mock/\(id)")
    }
}
