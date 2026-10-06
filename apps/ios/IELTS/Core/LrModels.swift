import Foundation

// Listening & Reading tests (GET/POST/PUT /api/lr/*, cambridge-gated). Mirrors packages/core/src/lr.ts and apps/web/src/lib/lr.ts.

struct LrOption: Codable, Hashable { let key: String; let text: String }

struct LrQuestion: Codable, Hashable {
    let n: Int
    let text: String?
    let options: [LrOption]?
    let answer: [String]? // only after submission
    var review: LrQuestionReview? = nil // only after submission
}

/// Review-only notes, precomputed per test (evidence quote, approximate audio second, why, why each wrong option is wrong, wording pairs).
struct LrQuestionReview: Codable, Hashable {
    var evidence: String?
    var at: Double?
    var why: String?
    var wrong: [String: String]?
    var paraphrase: [[String]]?
}

struct LrVocab: Codable, Hashable { let word: String; let meaning: String; let example: String? }

/// One word timing row, sent as the array [word, start, end].
struct LrWord: Codable, Hashable {
    let w: String, s: Double, e: Double
    init(w: String, s: Double, e: Double) { self.w = w; self.s = s; self.e = e }
    init(from d: Decoder) throws {
        var c = try d.unkeyedContainer()
        w = try c.decode(String.self); s = try c.decode(Double.self); e = try c.decode(Double.self)
    }
    func encode(to e: Encoder) throws { var c = e.unkeyedContainer(); try c.encode(w); try c.encode(s); try c.encode(self.e) }
}

struct LrGroup: Codable, Hashable, Identifiable {
    let from: Int
    let to: Int
    let type: String // gap | mcq | mcq-multi | tfng | ynng | match
    let instructions: String
    let wordLimit: String?
    let title: String?
    let content: String?
    let options: [LrOption]?
    let reusable: Bool?
    let image: String?
    let questions: [LrQuestion]
    var id: Int { from }
}

struct LrPassage: Codable, Hashable {
    struct Paragraph: Codable, Hashable { let label: String?; let text: String }
    let title: String
    let subtitle: String?
    let paragraphs: [Paragraph]
}

struct LrSection: Codable, Hashable, Identifiable {
    let part: Int
    let title: String?
    let audio: String?
    let transcript: String? // only after submission
    var vocab: [LrVocab]? = nil // only after submission
    var timings: [LrWord]? = nil // listening, only after submission
    let passage: LrPassage?
    let groups: [LrGroup]
    var id: Int { part }
}

struct LrTest: Codable, Hashable {
    let slug: String
    let skill: String // listening | reading
    let variant: String // academic | general
    let source: String // cambridge | generated
    let ref: String
    let title: String
    let sections: [LrSection]
    /// Listening, before submit: when the checking time the recording announces runs out, in seconds into the last part's audio. Nil: 2 minutes.
    var checkEndsAt: Double? = nil

    var isListening: Bool { skill == "listening" }
    var partNoun: String { isListening ? "Part" : "Passage" }
    var flat: [LrFlatQ] { sections.flatMap { s in s.groups.flatMap { g in g.questions.map { LrFlatQ(n: $0.n, part: s.part, group: g, q: $0) } } } }
    var total: Int { sections.reduce(0) { $0 + $1.groups.reduce(0) { $0 + $1.questions.count } } }
    func section(of n: Int) -> Int? { sections.firstIndex { $0.groups.contains { $0.from <= n && n <= $0.to } } }
}

struct LrFlatQ { let n: Int; let part: Int; let group: LrGroup; let q: LrQuestion }

struct LrMark: Codable, Hashable { let n: Int; let given: String; let correct: Bool; let answer: [String] }

struct LrAttempt: Codable {
    let id: String
    let testId: String
    let mode: String // exam | practice
    var parts: [Int]? = nil // chosen parts; nil = the whole test (partial attempts have no band)
    var status: String // in_progress | submitted
    var responses: [String: String]
    var elapsedS: Int
    let startedAt: String
    let submittedAt: String?
    let raw: Int?
    let total: Int?
    let band: Double?
    let marks: [LrMark]?
    var stats: LrStats? = nil
    var analysis: LrAnalysis? = nil // null for old attempts
    let test: LrTest
    let assets: [String: String]
    var isExam: Bool { mode == "exam" }
}

/// What the runner measured: seconds per part, answer changes per question, questions answered in the final 5 minutes.
struct LrStats: Codable, Hashable {
    var partS: [String: Double] = [:]
    var changes: [String: Int] = [:]
    var late: [Int] = []
    var audio: LrAudioState? = nil // practice listening: where each part's recording was left
}

/// Practice listening resume state (saved in the attempt's stats.audio, mirrored on the device): playback position per part, and the speed.
struct LrAudioState: Codable, Hashable {
    var pos: [String: Double] = [:]
    var rate: Double? = nil

    static let rates: [Double] = [0.75, 1, 1.25]

    /// Where to put the playhead: within 3 s of the end (or unknown) means the part was finished, so start over.
    static func resumePosition(_ pos: Double, duration: Double) -> Double {
        pos > 1 && duration.isFinite && pos < duration - 3 ? pos : 0
    }

    /// Drops anything the server would reject (non-finite, out of range, unknown speed).
    var cleaned: LrAudioState {
        var out = LrAudioState()
        for (k, v) in pos where k.count == 1 && k.first!.isNumber && v.isFinite { out.pos[k] = (min(3600, max(0, v)) * 10).rounded() / 10 }
        if let r = rate, Self.rates.contains(r) { out.rate = r }
        return out
    }

    private static func key(_ id: String) -> String { "lr:\(id):audio" }
    func saveLocal(_ id: String, defaults: UserDefaults = .standard) {
        if let d = try? JSONEncoder().encode(cleaned) { defaults.set(d, forKey: Self.key(id)) }
    }
    static func clearLocal(_ id: String, defaults: UserDefaults = .standard) { defaults.removeObject(forKey: key(id)) }
    /// This device's copy wins over the server's (it is never older than what this device last played).
    static func load(_ id: String, server: LrAudioState?, defaults: UserDefaults = .standard) -> LrAudioState? {
        if let d = defaults.data(forKey: key(id)), let a = try? JSONDecoder().decode(LrAudioState.self, from: d) { return a.cleaned }
        return server?.cleaned
    }
}

struct LrGapEntry: Codable, Hashable { let n: Int; let kind: String; let label: String; let message: String; let word: String?; let typed: String?; let before: Int? }
struct LrTfngRow: Codable, Hashable { let n: Int; let kind: String; let chose: String; let answer: String }
struct LrTypeAcc: Codable, Hashable { let label: String; let right: Int; let total: Int }
struct LrAnalysis: Codable, Hashable { let gaps: [LrGapEntry]; let tfng: [LrTfngRow]; let byType: [LrTypeAcc] }

/// GET /api/lr/progress
struct LrProgress: Codable {
    struct Trend: Codable, Identifiable { let attemptId: String; let skill: String; let date: String; let band: Double; var id: String { attemptId } }
    struct Weak: Codable, Identifiable { let skill: String; let label: String; let right: Int; let total: Int; var id: String { skill + label } }
    struct Suggested: Codable { let id: String; let title: String; let skill: String; let label: String; let count: Int }
    struct Pattern: Codable { let text: String }
    struct Tfng: Codable { let pattern: Pattern?; let rows: Int }
    let trend: [Trend]
    let weakest: [Weak]
    let suggested: Suggested?
    let tfng: Tfng
}

/// GET /api/lr/spelling
struct LrSpelling: Codable {
    struct Item: Codable, Identifiable { let word: String; let kind: String; let count: Int; let typed: [String]; let lastAt: String; var id: String { kind + word } }
    let items: [Item]
}

struct LrTestItem: Codable, Identifiable, Hashable {
    let id: String
    let slug: String
    let skill: String
    let variant: String
    let source: String
    let ref: String
    let title: String
    let total: Int
    let status: String // new | in_progress | submitted
    let attemptId: String?
    let mode: String?
    var parts: [Int]? = nil // parts of the in-progress attempt; nil = whole test
    let answered: Int
    let bestBand: Double? // whole-test attempts only
    let attempts: Int
}

struct LrAttemptItem: Codable, Identifiable {
    let id: String
    let testId: String
    let skill: String
    let variant: String
    let ref: String
    let title: String
    let mode: String
    var parts: [Int]? = nil
    let status: String
    let raw: Int?
    let total: Int?
    let band: Double?
    let answered: Int
    let startedAt: String
    let submittedAt: String?
}

enum Lr {
    static let readingSeconds = 3600
    /// Exam reading clock: 60 minutes for the whole test, 20 per passage when taking only some.
    static func readingLimit(_ parts: [Int]?) -> Int { guard let p = parts, !p.isEmpty else { return readingSeconds }; return 1200 * p.count }
    /// Every test has 4 listening parts / 3 reading passages; the server rejects a part a test lacks.
    static func partNumbers(_ skill: String) -> [Int] { skill == "listening" ? [1, 2, 3, 4] : [1, 2, 3] }
    /// "Part 2", "Passages 1, 3", or "Full test" when parts is nil.
    static func partsLabel(_ skill: String, _ parts: [Int]?) -> String {
        guard let p = parts, !p.isEmpty else { return "Full test" }
        return "\(skill == "listening" ? "Part" : "Passage")\(p.count > 1 ? "s" : "") \(p.map { String($0) }.joined(separator: ", "))"
    }
    static let listeningReviewSeconds = 120

    /// The heading a question type is reported under (web typeLabel).
    static func typeLabel(_ g: LrGroup) -> String {
        switch g.type {
        case "tfng": return "True / False / Not Given"
        case "ynng": return "Yes / No / Not Given"
        case "mcq": return "Multiple choice"
        case "mcq-multi": return "Multiple choice (more than one)"
        case "match":
            if g.image != nil { return "Labelling a map or diagram" }
            return g.options?.contains { $0.key.range(of: "^[ivx]+$", options: [.regularExpression, .caseInsensitive]) != nil } == true ? "Matching headings" : "Matching"
        default:
            if g.image != nil { return "Labelling a map or diagram" }
            if g.options != nil { return "Summary with a word box" }
            let t = "\(g.title ?? "") \(g.instructions)".lowercased()
            for (k, v) in [("table", "Table completion"), ("flow", "Flow-chart completion"), ("summary", "Summary completion"), ("form", "Form completion"),
                           ("notes", "Note completion"), ("sentence", "Sentence completion")] where t.contains(k) { return v }
            return "Completion"
        }
    }

    /// "C17 T2" gives (17, 2).
    static func parseRef(_ ref: String) -> (book: Int, test: Int)? {
        guard let m = ref.range(of: #"^C(\d+)\s*T(\d+)"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let nums = ref[m].split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
        return nums.count == 2 ? (nums[0], nums[1]) : nil
    }

    /// Slots (question numbers) a choose-N group stores its picks in, and the picks made so far.
    static func multiPicks(_ g: LrGroup, _ r: [String: String]) -> [String] { g.questions.compactMap { r[String($0.n)].flatMap { $0.isEmpty ? nil : $0 } } }
    static func setMultiPicks(_ g: LrGroup, _ r: [String: String], _ picks: [String]) -> [String: String] {
        var next = r
        for (i, q) in g.questions.enumerated() { next[String(q.n)] = i < picks.count ? picks[i] : nil }
        return next
    }

    static func answered(_ r: [String: String], _ n: Int) -> Bool { !(r[String(n)]?.trimmingCharacters(in: .whitespaces).isEmpty ?? true) }

    // MARK: Gap content: a small markdown subset (tables, lists, paragraphs, **bold**) with {{n}} placeholders (web parseContent)

    /// A gap is blank `part` of `of` of question n ("from {{7}} to {{7}}"); of = 1 is a plain gap.
    enum Inline: Hashable { case text(String), bold(String), gap(Int, part: Int = 0, of: Int = 1) }
    enum Block: Hashable {
        case p([Inline])
        case list(ordered: Bool, items: [[Inline]])
        case table(head: [[Inline]], rows: [[[Inline]]])
    }

    /// One question with two blanks ("from {{7}} to {{7}}") becomes "{{7:0:2}} ... {{7:1:2}}", so each blank gets its own field (web numberGapParts).
    static func numberGapParts(_ md: String) -> String {
        let re = try! NSRegularExpression(pattern: #"\{\{(\d+)\}\}"#)
        let ns = md as NSString
        let ms = re.matches(in: md, range: NSRange(location: 0, length: ns.length))
        var total: [String: Int] = [:], seen: [String: Int] = [:]
        for m in ms { total[ns.substring(with: m.range(at: 1)), default: 0] += 1 }
        var out = "", at = 0
        for m in ms {
            let n = ns.substring(with: m.range(at: 1)), of = total[n] ?? 1
            out += ns.substring(with: NSRange(location: at, length: m.range.location - at))
            if of > 1 { out += "{{\(n):\(seen[n, default: 0]):\(of)}}"; seen[n, default: 0] += 1 } else { out += ns.substring(with: m.range) }
            at = m.range.location + m.range.length
        }
        return out + ns.substring(from: at)
    }

    /// The answer to a multi-blank question is stored as "part / part"; marking folds "/" to a space.
    static func gapPart(_ v: String, _ part: Int) -> String {
        let parts = v.components(separatedBy: " / ")
        return part < parts.count ? parts[part] : ""
    }
    static func setGapPart(_ v: String, _ part: Int, _ of: Int, _ text: String) -> String {
        let parts = (0..<of).map { $0 == part ? text : gapPart(v, $0) }
        return parts.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ? parts.joined(separator: " / ") : ""
    }

    static func parseInline(_ s: String) -> [Inline] {
        var out: [Inline] = []
        var rest = Substring(s)
        while !rest.isEmpty {
            if let r = rest.range(of: #"\{\{\d+(:\d+:\d+)?\}\}|\*\*[^*]+\*\*"#, options: .regularExpression) {
                if r.lowerBound > rest.startIndex { out.append(.text(String(rest[rest.startIndex..<r.lowerBound]))) }
                let tok = rest[r]
                if tok.hasPrefix("{{") {
                    let f = tok.dropFirst(2).dropLast(2).split(separator: ":").map { Int($0) ?? 0 }
                    out.append(f.count == 3 ? .gap(f[0], part: f[1], of: f[2]) : .gap(f.first ?? 0))
                } else { out.append(.bold(String(tok.dropFirst(2).dropLast(2)))) }
                rest = rest[r.upperBound...]
            } else {
                out.append(.text(String(rest)))
                break
            }
        }
        return out
    }

    static func parseContent(_ md: String) -> [Block] {
        let lines = numberGapParts(md).components(separatedBy: "\n")
        var blocks: [Block] = []
        var i = 0
        let listRe = #"^([-•*]|\d+[.)])\s"#
        while i < lines.count {
            let line = lines[i].trimmingCharacters(in: .whitespaces)
            if line.isEmpty { i += 1; continue }
            if line.hasPrefix("|") {
                var rows: [[String]] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    var t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.hasPrefix("|") { t.removeFirst() }
                    if t.hasSuffix("|") { t.removeLast() }
                    let cells = t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                    if !cells.allSatisfy({ $0.range(of: #"^:?-{2,}:?$"#, options: .regularExpression) != nil }) { rows.append(cells) }
                    i += 1
                }
                let head = rows.first ?? []
                blocks.append(.table(head: head.map(parseInline), rows: rows.dropFirst().map { $0.map(parseInline) }))
            } else if line.range(of: listRe, options: .regularExpression) != nil {
                let ordered = line.first?.isNumber == true
                var items: [[Inline]] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).range(of: listRe, options: .regularExpression) != nil {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    items.append(parseInline(t.replacingOccurrences(of: #"^([-•*]|\d+[.)])\s+"#, with: "", options: .regularExpression)))
                    i += 1
                }
                blocks.append(.list(ordered: ordered, items: items))
            } else {
                blocks.append(.p(parseInline(line)))
                i += 1
            }
        }
        return blocks
    }

    /// Where an asset (audio, figure) is read from. The demo has no network: it plays the bundled recording and shows the bundled map.
    static func assetURL(_ s: String?) -> URL? {
        guard let s else { return nil }
        if Demo.on {
            let name = s.hasSuffix(".png") || s.hasSuffix(".svg") ? ("demo-map", "png") : ("demo-audio", "mp3")
            return Bundle.main.url(forResource: name.0, withExtension: name.1)
        }
        return URL(string: s)
    }

    /// Accuracy per key (part label or question type) from the marks of a submitted attempt, in first-seen order.
    static func accuracy(_ t: LrTest, _ marks: [LrMark], key: (LrFlatQ) -> String) -> [(label: String, right: Int, total: Int)] {
        let ok = Dictionary(uniqueKeysWithValues: marks.map { ($0.n, $0.correct) })
        var order: [String] = []
        var acc: [String: (Int, Int)] = [:]
        for f in t.flat {
            let k = key(f)
            if acc[k] == nil { order.append(k) }
            var e = acc[k] ?? (0, 0)
            e.1 += 1
            if ok[f.n] == true { e.0 += 1 }
            acc[k] = e
        }
        return order.map { (label: $0, right: acc[$0]!.0, total: acc[$0]!.1) }
    }
}
