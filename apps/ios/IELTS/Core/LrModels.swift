import Foundation

// Listening & Reading tests (GET/POST/PUT /api/lr/*, cambridge-gated). Mirrors packages/core/src/lr.ts and apps/web/src/lib/lr.ts.

struct LrOption: Codable, Hashable { let key: String; let text: String }

struct LrQuestion: Codable, Hashable {
    let n: Int
    let text: String?
    let options: [LrOption]?
    let answer: [String]? // only after submission
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
    var status: String // in_progress | submitted
    var responses: [String: String]
    var elapsedS: Int
    let startedAt: String
    let submittedAt: String?
    let raw: Int?
    let total: Int?
    let band: Double?
    let marks: [LrMark]?
    let test: LrTest
    let assets: [String: String]
    var isExam: Bool { mode == "exam" }
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
    let answered: Int
    let bestBand: Double?
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

    enum Inline: Hashable { case text(String), bold(String), gap(Int) }
    enum Block: Hashable {
        case p([Inline])
        case list(ordered: Bool, items: [[Inline]])
        case table(head: [[Inline]], rows: [[[Inline]]])
    }

    static func parseInline(_ s: String) -> [Inline] {
        var out: [Inline] = []
        var rest = Substring(s)
        while !rest.isEmpty {
            if let r = rest.range(of: #"\{\{\d+\}\}|\*\*[^*]+\*\*"#, options: .regularExpression) {
                if r.lowerBound > rest.startIndex { out.append(.text(String(rest[rest.startIndex..<r.lowerBound]))) }
                let tok = rest[r]
                if tok.hasPrefix("{{") { out.append(.gap(Int(tok.dropFirst(2).dropLast(2)) ?? 0)) } else { out.append(.bold(String(tok.dropFirst(2).dropLast(2)))) }
                rest = rest[r.upperBound...]
            } else {
                out.append(.text(String(rest)))
                break
            }
        }
        return out
    }

    static func parseContent(_ md: String) -> [Block] {
        let lines = md.components(separatedBy: "\n")
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
