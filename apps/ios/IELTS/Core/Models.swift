import Foundation

// Hand-written Codable mirror of the server contract (apps/server/src/ai/types.ts, routes/*.ts).
// ponytail: hand-written instead of swift-openapi-generator (an ~all-views rewrite for 25 small types). Structs tagged
// `// openapi: <schema path>` are checked against apps/web/src/openapi.json in CI (apps/ios/scripts/check-models.mjs).

// openapi: Me.user

struct User: Codable { let id: String; let email: String; let name: String; let emailVerified: Bool }

// openapi: Settings.models

struct ModelChoices: Codable, Equatable {
    var analysis: String, examiner: String, stt: String, tts: String, ttsVoice: String, audioPron: String
}

// openapi: Settings

struct AppSettings: Codable, Equatable {
    var models: ModelChoices
    var audioPronEnabled: Bool
    var liveProvider: String // "turn" | "gpt-live" | "gemini-live"
    var targetBand: Double
    var writingAutoSubmit: Bool
    var blockPaste: Bool
}

// openapi: Me

struct Me: Codable {
    let user: User
    var settings: AppSettings
    let cambridgeAccess: Bool
    let gptLiveAvailable: Bool
    let geminiLiveAvailable: Bool
}

/// Decodes to nil instead of failing the parent when the payload has an unexpected shape.
struct Lenient<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

/// Accepts a bare array or `{ items | cards | models | data: [...] }`.
struct ListOf<T: Decodable>: Decodable {
    let items: [T]
    init(from decoder: Decoder) throws {
        if let a = try? [T](from: decoder) { items = a; return }
        let c = try decoder.container(keyedBy: AnyKey.self)
        for k in ["items", "cards", "models", "data"] {
            if let a = try? c.decode([T].self, forKey: AnyKey(k)) { items = a; return }
        }
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Expected a list"))
    }
}

struct Empty: Decodable {}

// MARK: - Prompts

// openapi: Prompt

struct Prompt: Decodable, Identifiable {
    let id: String
    let skill: String
    let part: Int
    let variant: String?
    let type: String?
    let topic: String?
    let title: String
    let body: String
    let bullets: [String]?
    let followUps: [String]?
    let chart: Lenient<ChartSpec>?
    let imageUrl: String?
    let groupId: String?
    let done: Bool?
    let source: String?

    /// Questions asked in this prompt's recording (P2: the cue card title).
    var questions: [String] {
        if skill == "speaking" && part == 2 { return [title] }
        if let f = followUps, !f.isEmpty { return f }
        return [body]
    }
    var chartSpec: ChartSpec? { chart?.value }
}

// openapi: SpeakingTest

struct SpeakingTest: Decodable { let part1: [Prompt]; let part2: Prompt; let part3: Prompt }

/// A cell in a table chart: string or number.
struct Cell: Decodable {
    let text: String
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { text = s } else {
            let n = try c.decode(Double.self)
            text = n.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(n)) : String(n)
        }
    }
}

enum ChartSpec: Decodable {
    struct Series: Decodable { let name: String; let values: [Double] }
    struct Slice: Decodable { let label: String; let value: Double }
    struct Pie: Decodable { let name: String; let slices: [Slice] }
    struct MapSide: Decodable { let label: String; let features: [String] }

    case xy(bar: Bool, title: String, xLabel: String, yLabel: String, unit: String, categories: [String], series: [Series])
    case pie(title: String, unit: String, pies: [Pie])
    case table(title: String, columns: [String], rows: [[String]])
    case process(title: String, steps: [String])
    case map(title: String, before: MapSide, after: MapSide)

    private enum K: String, CodingKey { case kind, title, xLabel, yLabel, unit, categories, series, pies, columns, rows, steps, before, after }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let kind = try c.decode(String.self, forKey: .kind)
        let title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        switch kind {
        case "line", "bar":
            self = .xy(bar: kind == "bar", title: title,
                       xLabel: try c.decodeIfPresent(String.self, forKey: .xLabel) ?? "",
                       yLabel: try c.decodeIfPresent(String.self, forKey: .yLabel) ?? "",
                       unit: try c.decodeIfPresent(String.self, forKey: .unit) ?? "",
                       categories: try c.decode([String].self, forKey: .categories),
                       series: try c.decode([Series].self, forKey: .series))
        case "pie":
            self = .pie(title: title, unit: try c.decodeIfPresent(String.self, forKey: .unit) ?? "", pies: try c.decode([Pie].self, forKey: .pies))
        case "table":
            self = .table(title: title, columns: try c.decode([String].self, forKey: .columns),
                          rows: try c.decode([[Cell]].self, forKey: .rows).map { $0.map(\.text) })
        case "process":
            self = .process(title: title, steps: try c.decode([String].self, forKey: .steps))
        case "map":
            self = .map(title: title, before: try c.decode(MapSide.self, forKey: .before), after: try c.decode(MapSide.self, forKey: .after))
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Unknown chart kind \(kind)")
        }
    }

    var title: String {
        switch self {
        case let .xy(_, t, _, _, _, _, _), let .pie(t, _, _), let .table(t, _, _), let .process(t, _), let .map(t, _, _): return t
        }
    }
}

// MARK: - Attempts

// openapi: CreatedAttempt

struct Created: Decodable { let id: String; let uploadUrl: String? }

// openapi: Attempt

struct Attempt: Decodable, Identifiable {
    let id: String
    let promptId: String
    let skill: String
    let part: Int
    let mode: String
    let sessionId: String?
    let parentAttemptId: String?
    let audioUrl: String?
    let text: String?
    let plan: String?
    let durationMs: Int?
    let overtime: Bool?
    let status: String // recording | analyzing | done | failed
    let error: String?
    let createdAt: String
    let analysis: AnalysisResult?
    let prompt: Prompt

    var finished: Bool { status == "done" || status == "failed" }
    /// The essay, or the transcript for speaking.
    var answerText: String? { analysis?.text ?? text ?? analysis?.words.map { $0.map(\.w).joined(separator: " ") } }
}

// openapi: AttemptListItem

struct AttemptListItem: Decodable, Identifiable {
    let id: String
    let promptTitle: String
    let skill: String
    let part: Int
    let mode: String
    let status: String
    let overall: Double?
    let createdAt: String
}

// openapi: AttemptList

struct AttemptPage: Decodable { let items: [AttemptListItem]; let total: Int }

// MARK: - Analysis (ai/types.ts)

struct Criterion: Decodable { let band: Double; let range: [Double]; let descriptor: String; let evidence: [String]; let summary: String }
struct Fix: Decodable { let title: String; let why: String; let before: String; let after: String }
struct AnalysisError: Decodable, Identifiable {
    let id: String
    let category: String
    let severity: String // minor | major
    let start: Int
    let end: Int
    let original: String
    let correction: String
    let explanation: String
    let time: Double?
}
struct VocabUpgrade: Decodable { let original: String; let better: [String]; let note: String }
struct Word: Decodable { let w: String; let start: Double; let end: Double; let conf: Double? }
struct Pause: Decodable { let start: Double; let end: Double; let dur: Double; let kind: String; let midClause: Bool; let voiced: Bool }
struct Filler: Decodable { let word: String; let time: Double; let kind: String }
struct Repetition: Decodable { let phrase: String; let time: Double; let wordIdx: Int }
struct SelfCorrection: Decodable { let time: Double; let wordIdx: Int }
struct Unclear: Decodable { let wordIdx: Int; let w: String; let conf: Double; let tier: Int }
struct WpmPoint: Decodable { let t: Double; let wpm: Double }
/// Fused disfluency event (core `Disfluency`): kind is one of `Disfluency.kinds`; sources say which detectors saw it.
struct Disfluency: Decodable {
    /// Mirrors core DisfluencyKind (scripts/check-models.mjs keeps the keys in sync). `rate` = [good, warn] events per minute; the copy mirrors web GUIDE.
    struct Kind {
        let key: String, label: String, what: String, normal: String, harmful: String
        let rate: [Double]
        /// Always listed (a zero is good news); cut-offs and held sounds only when present.
        let core: Bool
    }
    static let kinds: [Kind] = [
        Kind(key: "filled", label: "Filled pauses", what: "\"um\", \"uh\", \"er\" while searching for a word.",
             normal: "A couple a minute is natural, even for native speakers.",
             harmful: "More than about 4 a minute, or several in a row, sounds unsure. Pause silently instead.", rate: [2, 4], core: true),
        Kind(key: "repetition", label: "Repetitions", what: "A word or phrase said twice, like \"I I think\".",
             normal: "An occasional repeat while you plan the next word is fine.",
             harmful: "Frequent repeats signal word-searching. Plan the first few words before you start.", rate: [1, 2], core: true),
        Kind(key: "repair", label: "Self-corrections", what: "You restart and change the wording, like \"he go… he goes\".",
             normal: "Fixing a real mistake shows self-monitoring; band 7 allows some.",
             harmful: "Many restarts make the listener lose the idea. Correct only what matters.", rate: [1, 2], core: true),
        Kind(key: "false_start", label: "False starts", what: "A sentence you abandon and begin again.",
             normal: "One now and then is normal in unplanned speech.",
             harmful: "Often abandoning sentences hurts coherence. Start with a short, safe clause.", rate: [1, 2], core: true),
        Kind(key: "partial", label: "Cut-off words", what: "A word you cut off and restart, like \"sh- she\".",
             normal: "Occasional cut-offs happen when you change your mind about a word.",
             harmful: "Many cut-offs suggest reaching for words you are unsure of. Choose a simpler word.", rate: [1, 2], core: false),
        Kind(key: "prolongation", label: "Held sounds", what: "A sound held while you think, like \"sooo\".",
             normal: "An occasional stretched word buys thinking time.",
             harmful: "Frequent stretching slows the answer and sounds hesitant. Try a short pause.", rate: [2, 4], core: false),
    ]
    let kind: String; let start: Double; let end: Double; let sources: [String]
}
/// Server `disfluencyProfile`: per-type count and rates. Absent on older analyses.
struct DisfluencyProfile: Decodable {
    struct Rate: Decodable { let n: Int; let perMin: Double; let per100w: Double }
    let byKind: [String: Rate]
}
struct FluencyDetail: Decodable { let events: [Disfluency]; let profile: DisfluencyProfile? }

struct SpeechMetrics: Decodable {
    let durationS: Double
    let wordCount: Int
    let speechRate: Double
    let articulationRate: Double
    let phonationRatio: Double
    let pauseRatio: Double
    let mlr: Double
    let pauses: [Pause]
    let longPauses: Int
    let midClausePauses: Int
    let fillers: [Filler]
    let fillersPerMin: Double
    let repetitions: [Repetition]
    let selfCorrections: [SelfCorrection]
    let unclear: [Unclear]
    let wpmSeries: [WpmPoint]
    let wpmStdDev: Double
    let fluency: FluencyDetail? // absent on analyses stored before disfluency fusion
}

struct TextMetrics: Decodable {
    struct Linker: Decodable { let word: String; let count: Int; let overused: Bool }
    struct Repeated: Decodable { let word: String; let count: Int }
    let words: Int
    let sentences: Int
    let paragraphs: Int
    let avgSentenceLen: Double
    let mtld: Double
    let ttr: Double
    let linkers: [Linker]
    let repeated: [Repeated]
}

struct PronunciationLlm: Decodable {
    struct W: Decodable { let word: String; let time: Double; let issue: String; let tip: String }
    let words: [W]
    let prosody: String
    let band: Double
}

struct WritingStructure: Decodable {
    struct Paragraph: Decodable { let role: String; let topicSentence: String; let ok: Bool; let note: String }
    struct Overview: Decodable { let present: Bool; let mainTrends: Bool; let noData: Bool; let note: String }
    struct Position: Decodable { let clear: Bool; let consistent: Bool; let note: String }
    struct Plan: Decodable { let followed: Bool; let note: String }
    let paragraphs: [Paragraph]
    let overview: Overview?
    let position: Position?
    let planFollowed: Plan?
}

struct AnalysisResult: Decodable {
    struct Rewrite: Decodable { let text: String; let note: String }
    struct Question: Decodable { let text: String; let startWord: Int }
    struct Pronunciation: Decodable { let unclear: [Unclear]; let llm: PronunciationLlm? }
    struct Relevance: Decodable { let questionIdx: Int; let onTopic: Bool; let note: String }
    struct Comparison: Decodable { let parentAttemptId: String; let parentOverall: Double; let deltas: [String: Double] }

    let skill: String
    let part: Int?
    let overall: Double
    let overallRaw: Double
    let range: [Double]
    let calibrated: Bool? // false: unvalidated model, range ±1 band; absent on older analyses
    let criteria: [String: Criterion]
    let topFixes: [Fix]
    let errors: [AnalysisError]
    let vocabUpgrades: [VocabUpgrade]?
    let rewrite: Rewrite
    // speaking
    let words: [Word]?
    let metrics: SpeechMetrics?
    let questions: [Question]?
    let pronunciation: Pronunciation?
    let relevance: [Relevance]?
    let noSpeech: Bool?
    // writing
    let text: String?
    let structure: WritingStructure?
    let textMetrics: TextMetrics?
    let tooShort: Bool?
    let comparison: Comparison?
}

// MARK: - Progress, cards, models, live

// openapi: Progress

struct ProgressData: Decodable {
    // openapi: Progress.trend[]
    struct TrendPoint: Decodable { let date: String; let overall: Double; let criteria: [String: Double] }
    // openapi: Progress.weakest
    struct Weakest: Decodable { let key: String; let avg: Double }
    // openapi: Progress.topMistakes[]
    struct CategoryCount: Decodable { let category: String; let count: Int }
    // openapi: Progress.predicted
    struct Predicted: Decodable { let speaking: Double?; let writing: Double? }
    let trend: [TrendPoint]
    let streak: Int
    let minutesThisWeek: Double
    let attempts: Int
    let weakest: Weakest?
    let topMistakes: [CategoryCount]
    let predicted: Predicted
}

// openapi: Card

struct ReviewCard: Decodable, Identifiable { let id: String; let front: String; let back: String }

// openapi: Mistake

struct Mistake: Decodable, Identifiable {
    let id: String
    let attemptId: String
    let skill: String
    let part: Int
    let promptTitle: String
    let category: String
    let original: String
    let correction: String
    let explanation: String
    let time: Double?
    var inDeck: Bool
    let createdAt: String
}

// openapi: MistakeLog

struct MistakeLog: Decodable { let groups: [ProgressData.CategoryCount]; let items: [Mistake]; let total: Int }

// openapi: Model

struct ModelInfo: Decodable, Identifiable {
    // openapi: Model.pricing
    struct Pricing: Decodable { let prompt: String?; let completion: String? }
    let id: String
    let name: String?
    let pricing: Pricing?
}

// openapi: LiveStarted

struct LiveReply: Decodable {
    let sessionId: String?
    let examinerText: String
    let audioUrl: String?
    let voiceError: String? // why audioUrl is null (TTS failed): the test continues with captions
    let phase: String
    let prepSeconds: Int?
    let cueCard: Prompt?
    let test: SpeakingTest?
}
// openapi: LiveUpload
struct UploadTarget: Decodable { let key: String; let uploadUrl: String }
// openapi: GeminiToken
struct GeminiToken: Decodable { let value: String; let model: String? }
// openapi: LiveFinished
struct FinishResult: Decodable { let attemptIds: [String] }
