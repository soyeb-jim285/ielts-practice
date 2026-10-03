import Foundation

/// Listening & Reading review helpers: locating answers in passages, transcripts and word timings, and the dictation diff. A faithful port of the
/// client-side parts of packages/core/src/lr-review.ts. Offsets are UTF-16 units, exactly as in JS, so spans match the web ones.
/// (The gap classifier is not ported: the server sends `analysis` with every submitted attempt.)
enum LrReview {
    // MARK: Normalising

    static func fold(_ s: String) -> String {
        var t = s.lowercased().decomposedStringWithCompatibilityMapping
        t = String(String.UnicodeScalarView(t.unicodeScalars.filter { !(0x300...0x36f).contains($0.value) }))
        for (re, with) in [("[‘’`]", "'"), ("[-–—/]", " "), ("[.,;:!?\"“”]+", " "), ("\\s+", " ")] { t = t.replacingOccurrences(of: re, with: with, options: .regularExpression) }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    static func words(_ s: String) -> [String] { fold(s).split(separator: " ").map(String.init) }

    /// "(the) old (town) hall" → every variant with / without each optional part (core expandAnswer).
    static func expandAnswer(_ a: String) -> [String] {
        guard let r = a.range(of: #"\(([^()]*)\)"#, options: .regularExpression) else { return [fold(a)] }
        let inner = String(a[r].dropFirst().dropLast())
        let pre = String(a[..<r.lowerBound]), post = String(a[r.upperBound...])
        return expandAnswer(pre + inner + post) + expandAnswer(pre + post)
    }

    // MARK: Answer location

    struct Span: Equatable { var p: Int; var s: Int; var e: Int }

    private static func u16(_ s: String) -> [UInt16] { Array(s.utf16) }
    private static func slice(_ s: String, _ a: Int, _ b: Int) -> String { (s as NSString).substring(with: NSRange(location: a, length: max(0, b - a))) }

    /// Letters/digits lower-cased, everything else one space, with each kept char's index in the raw text.
    private static func normMap(_ text: String) -> (out: String, idx: [Int]) {
        var out: [Character] = []
        var idx: [Int] = []
        for (i, u) in u16(text).enumerated() {
            let one = UnicodeScalar(u).map { $0.properties.isWhitespace ? " " : String($0) } ?? " "
            let f = fold(one)
            for c in (f.isEmpty ? " " : f) {
                if c.isASCII, c.isLetter || c.isNumber { out.append(c); idx.append(i) }
                else if !out.isEmpty, out.last != " " { out.append(" "); idx.append(i) }
            }
        }
        return (String(out), idx)
    }

    private static func exactSpan(_ paras: [String], _ phrase: String) -> Span? {
        var needle = fold(phrase)
        for (re, with) in [("[^a-z0-9 ]", " "), ("\\s+", " ")] { needle = needle.replacingOccurrences(of: re, with: with, options: .regularExpression) }
        needle = needle.trimmingCharacters(in: .whitespaces)
        if needle.isEmpty { return nil }
        for (p, t) in paras.enumerated() {
            let m = normMap(t)
            if let r = m.out.range(of: needle) {
                let at = m.out.distance(from: m.out.startIndex, to: r.lowerBound)
                return Span(p: p, s: m.idx[at], e: m.idx[at + needle.count - 1] + 1)
            }
        }
        return nil
    }

    private static func sentenceAround(_ text: String, _ s: Int, _ e: Int) -> (Int, Int) {
        let u = u16(text)
        let n = u.count
        var a = s
        while a > 0 {
            if u[a - 1] == 10 { break }
            if slice(text, max(0, a - 3), a).range(of: #"[.!?]["”’']?\s$"#, options: .regularExpression) != nil { break }
            a -= 1
        }
        var b = e
        let end: Set<UInt16> = [46, 33, 63]
        while b < n, !(b - 1 >= 0 && end.contains(u[b - 1])) { b += 1 }
        let quotes: Set<UInt16> = [34, 0x201D, 0x2019, 39]
        while b < n, quotes.contains(u[b]) { b += 1 }
        return (a, min(b, n))
    }

    private static func bestSentence(_ paras: [String], _ phrase: String) -> Span? {
        let want = Set(words(phrase))
        if want.count < 3 { return nil }
        let re = try! NSRegularExpression(pattern: #"[^.!?\n]+[.!?]*["”’']?"#)
        var best: (p: Int, s: Int, e: Int, score: Double)?
        for (p, t) in paras.enumerated() {
            let sents = re.matches(in: t, range: NSRange(location: 0, length: (t as NSString).length)).map(\.range)
            for i in sents.indices {
                for n in 1...3 where i + n <= sents.count {
                    let run = Array(sents[i..<(i + n)])
                    let have = Set(words(run.map { (t as NSString).substring(with: $0) }.joined(separator: " ")))
                    let score = Double(want.intersection(have).count) / Double(want.count) - Double(n - 1) * 0.01
                    if score > (best?.score ?? 0) { best = (p, run[0].location, run.last!.location + run.last!.length, score) }
                }
            }
        }
        if let b = best, b.score >= 0.6 { return Span(p: b.p, s: b.s, e: b.e) }
        return nil
    }

    /// Where a gap answer sits: the sentence of the paragraph containing the longest accepted variant as whole words.
    static func answerSentence(_ paras: [String], _ accepted: [String]) -> Span? {
        var seen = Set<String>()
        let variants = accepted.flatMap(expandAnswer).filter { !$0.isEmpty && $0.utf16.count >= 3 && seen.insert($0).inserted }
        let sorted = variants.enumerated().sorted { $0.element.utf16.count != $1.element.utf16.count ? $0.element.utf16.count > $1.element.utf16.count : $0.offset < $1.offset }.map(\.element)
        for v in sorted {
            guard let re = try? NSRegularExpression(pattern: "(^| )\(NSRegularExpression.escapedPattern(for: v))( |$)") else { continue }
            for (p, t) in paras.enumerated() {
                let m = normMap(t)
                guard let r = re.firstMatch(in: m.out, range: NSRange(location: 0, length: (m.out as NSString).length)) else { continue }
                let g1 = r.range(at: 1).length
                let s = m.idx[r.range.location + g1], e = m.idx[r.range.location + g1 + v.utf16.count - 1] + 1
                let (a, b) = sentenceAround(t, s, e)
                return Span(p: p, s: a, e: b)
            }
        }
        return nil
    }

    /// The text to highlight for a question: `review.evidence` (verbatim, then its fragments split at "…", then the closest sentence),
    /// else for gap questions the sentence containing the accepted answer.
    static func evidenceSpan(_ paras: [String], _ q: LrQuestion, gap: Bool) -> Span? {
        if let ev = q.review?.evidence?.trimmingCharacters(in: .whitespacesAndNewlines), !ev.isEmpty {
            if let whole = exactSpan(paras, ev) { return whole }
            let parts = ev.replacingOccurrences(of: "…", with: "...").components(separatedBy: "...").map { $0.trimmingCharacters(in: .whitespaces) }.filter { words($0).count >= 3 }
            let found = parts.compactMap { exactSpan(paras, $0) }
            if let f = found.first, found.allSatisfy({ $0.p == f.p }) { return Span(p: f.p, s: found.map(\.s).min()!, e: found.map(\.e).max()!) }
            if let near = bestSentence(paras, ev) { return near }
        }
        return gap ? answerSentence(paras, q.answer ?? []) : nil
    }

    /// The paragraphs of a section's reading passage, or the transcript's lines for listening.
    static func sectionParagraphs(_ s: LrSection) -> [String] { s.passage.map { $0.paragraphs.map(\.text) } ?? (s.transcript ?? "").components(separatedBy: "\n") }

    // MARK: Listening: word timings

    private struct Tok { let w: String; let s: Double; let e: Double }
    private static func tokens(_ t: [LrWord]) -> [Tok] { canon(t.flatMap { r in words(noCurrency(r.w)).map { Tok(w: $0, s: r.s, e: r.e) } }) }
    private static func noCurrency(_ s: String) -> String { String(s.map { "£$€¥".contains($0) ? " " : $0 }) }

    private static let units: [String: Int] = ["zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19]
    private static let tensWords: [String: Int] = ["twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90]
    private static let ordinals = ["first": "one", "second": "two", "third": "three", "fifth": "five", "eighth": "eight", "ninth": "nine", "twelfth": "twelve"]
    private static func cardinal(_ w: String) -> String {
        if let o = ordinals[w] { return o }
        if w.hasSuffix("ieth") { return String(w.dropLast(4)) + "y" }
        if w.hasSuffix("th") { let b = String(w.dropLast(2)); if units[b] != nil || tensWords[b] != nil { return b } }
        return w
    }
    private static func numberWord(_ raw: String) -> (v: Int, tens: Bool)? {
        let w = cardinal(raw)
        if let v = units[w] { return (v, false) }
        if let v = tensWords[w] { return (v, true) }
        return nil
    }
    /// Numbers spoken as words become digits ("eleven thirty" = "11.30", "thirty five" = 35, "five hundred" = 500, "fifteenth" = 15); same rules as web `canon`.
    private static func canon(_ t: [Tok]) -> [Tok] {
        var out: [Tok] = []
        var i = 0
        while i < t.count {
            let x = t[i]
            defer { i += 1 }
            guard let n = numberWord(x.w) else {
                out.append(Tok(w: x.w.replacingOccurrences(of: "^(\\d+)(st|nd|rd|th)$", with: "$1", options: .regularExpression), s: x.s, e: x.e)); continue
            }
            let nx = i + 1 < t.count ? numberWord(t[i + 1].w) : nil
            if n.tens, let nx, !nx.tens, nx.v < 10 { out.append(Tok(w: String(n.v + nx.v), s: x.s, e: t[i + 1].e)); i += 1 }
            else if !n.tens, n.v < 10, i + 1 < t.count, t[i + 1].w == "hundred" { out.append(Tok(w: String(n.v * 100), s: x.s, e: t[i + 1].e)); i += 1 }
            else { out.append(Tok(w: String(n.v), s: x.s, e: x.e)) }
        }
        return out
    }

    /// Finds a phrase in the word timings: exact run first, else the best window with at least 60% of its words.
    static func locatePhrase(_ timings: [LrWord]?, _ phrase: String) -> (start: Double, end: Double)? {
        guard let timings, !timings.isEmpty else { return nil }
        let T = tokens(timings), P = canon(words(noCurrency(phrase)).map { Tok(w: $0, s: 0, e: 0) }).map(\.w)
        if P.isEmpty || P.count > T.count { return nil }
        for i in 0...(T.count - P.count) where P.indices.allSatisfy({ T[i + $0].w == P[$0] }) { return (T[i].s, T[i + P.count - 1].e) }
        // spelled out letter by letter or digit by digit ("RH12 3TL" = R H one two three T L)
        let ps = P.joined()
        if ps.count >= 3 {
            for i in T.indices {
                var acc = "", k = i
                while k < T.count, T[k].w.count <= 2, ps.hasPrefix(acc + T[k].w) { acc += T[k].w; k += 1 }
                if acc == ps, k - i >= 2 { return (T[i].s, T[k - 1].e) }
            }
        }
        if P.count < 4 { return nil }
        var want: [String: Int] = [:]
        P.forEach { want[$0, default: 0] += 1 }
        func score(_ from: Int) -> Int {
            var left = want, hit = 0
            for i in from..<(from + P.count) where (left[T[i].w] ?? 0) > 0 { left[T[i].w]! -= 1; hit += 1 }
            return hit
        }
        var at = -1, top = 0
        for i in 0...(T.count - P.count) { let s = score(i); if s > top { top = s; at = i } }
        if at < 0 || Double(top) / Double(P.count) < 0.6 { return nil }
        let set = Set(P)
        var a = at, b = at + P.count - 1
        while a < b, !set.contains(T[a].w) { a += 1 }
        while b > a, !set.contains(T[b].w) { b -= 1 }
        return (T[a].s, T[b].e)
    }

    struct AudioWindow: Equatable { let from: Double, to: Double, start: Double, end: Double, exact: Bool }

    /// Seconds to play for a question: evidence, else the accepted answer, else `review.at` (6 s). `from` starts 2 s early.
    static func audioWindow(_ timings: [LrWord]?, _ q: LrQuestion) -> AudioWindow? {
        var hit = q.review?.evidence.flatMap { locatePhrase(timings, $0) }
        if hit == nil {
            var seen = Set<String>()
            let vs = (q.answer ?? []).flatMap(expandAnswer).filter { ($0.utf16.count >= 3 || ($0.utf16.count >= 2 && $0.contains(where: \.isNumber))) && seen.insert($0).inserted }
            hit = vs.enumerated().sorted { $0.element.utf16.count != $1.element.utf16.count ? $0.element.utf16.count > $1.element.utf16.count : $0.offset < $1.offset }
                .lazy.compactMap { locatePhrase(timings, $0.element) }.first
        }
        if let h = hit { return AudioWindow(from: max(0, h.start - 2), to: h.end + 0.5, start: h.start, end: h.end, exact: true) }
        if let at = q.review?.at { return AudioWindow(from: max(0, at - 2), to: at + 6, start: at, end: at + 6, exact: false) }
        return nil
    }

    /// Groups moments within `gap` (a fraction of the recording) of the previous one, so crowded scrubber markers can fold into one.
    static func clusterMoments<T>(_ items: [T], duration: Double, gap: Double = 0.08, at: (T) -> Double) -> [[T]] {
        var out: [[T]] = []
        for m in items.sorted(by: { at($0) < at($1) }) {
            if duration > 0, let last = out.last?.last, (at(m) - at(last)) / duration < gap { out[out.count - 1].append(m) } else { out.append([m]) }
        }
        return out
    }

    struct QuestionMoment: Equatable { let n: Int, at: Double, from: Double, to: Double, exact: Bool }

    /// Where each question of a listening part is answered in the recording, in time order (web questionMoments). Unlocatable questions are left out.
    static func questionMoments(_ timings: [LrWord]?, _ groups: [LrGroup]) -> [QuestionMoment] {
        groups.flatMap { $0.questions }.compactMap { q in
            audioWindow(timings, q).map { QuestionMoment(n: q.n, at: $0.start, from: $0.from, to: $0.to, exact: $0.exact) }
        }.sorted { $0.at != $1.at ? $0.at < $1.at : $0.n < $1.n }
    }

    /// The recording's words between two instants, as spoken (for the dictation drill).
    static func wordsBetween(_ t: [LrWord]?, _ from: Double, _ to: Double) -> String {
        (t ?? []).filter { $0.s >= from - 0.01 && $0.e <= to + 0.01 }.map(\.w).joined(separator: " ")
    }

    // MARK: Dictation

    struct DictOp: Equatable { enum Status { case correct, missing, wrong, extra }; let word: String; var typed: String? = nil; let status: Status }

    /// Word-by-word comparison (LCS on normalised words). Unmatched stretches pair up as "wrong", leftovers are missing / extra.
    static func dictationDiff(_ typed: String, _ expected: String) -> [DictOp] {
        let E = expected.split(whereSeparator: \.isWhitespace).map(String.init), T = typed.split(whereSeparator: \.isWhitespace).map(String.init)
        let en = E.map(fold), tn = T.map(fold)
        var L = Array(repeating: Array(repeating: 0, count: T.count + 1), count: E.count + 1)
        if !E.isEmpty && !T.isEmpty {
            for i in stride(from: E.count - 1, through: 0, by: -1) { for j in stride(from: T.count - 1, through: 0, by: -1) { L[i][j] = en[i] == tn[j] ? L[i + 1][j + 1] + 1 : max(L[i + 1][j], L[i][j + 1]) } }
        }
        var out: [DictOp] = []
        var i = 0, j = 0
        func gap(_ ei: Int, _ tj: Int) {
            let es = Array(E[i..<ei]), ts = Array(T[j..<tj])
            for (k, w) in es.enumerated() { out.append(k < ts.count ? DictOp(word: w, typed: ts[k], status: .wrong) : DictOp(word: w, status: .missing)) }
            if ts.count > es.count { for w in ts[es.count...] { out.append(DictOp(word: "", typed: w, status: .extra)) } }
        }
        while i < E.count, j < T.count {
            if en[i] == tn[j] { out.append(DictOp(word: E[i], typed: T[j], status: .correct)); i += 1; j += 1; continue }
            var ni = i, nj = j
            while ni < E.count, nj < T.count, en[ni] != tn[nj] { if L[ni + 1][nj] >= L[ni][nj + 1] { ni += 1 } else { nj += 1 } }
            if ni >= E.count || nj >= T.count { break }
            gap(ni, nj)
            i = ni; j = nj
        }
        gap(E.count, T.count)
        return out
    }

    static func dictationScore(_ ops: [DictOp]) -> (right: Int, total: Int) { (ops.filter { $0.status == .correct }.count, ops.filter { $0.status != .extra }.count) }

    // MARK: TRUE / FALSE / NOT GIVEN

    private static let tf = ["t": "TRUE", "true": "TRUE", "f": "FALSE", "false": "FALSE", "ng": "NOT GIVEN", "not given": "NOT GIVEN", "y": "YES", "yes": "YES", "n": "NO", "no": "NO"]
    static func tfngValue(_ given: String) -> String { tf[fold(given)] ?? "" }
    static let tfngRules: [String: [(value: String, rule: String)]] = [
        "tfng": [("TRUE", "The passage says the same thing, usually in different words. Look for a paraphrase, not matching words."),
                 ("FALSE", "The passage says the opposite. You can point to a sentence that contradicts the statement."),
                 ("NOT GIVEN", "The passage never settles it. If no sentence confirms or contradicts the statement, it is NOT GIVEN, whatever you know yourself.")],
        "ynng": [("YES", "The statement agrees with the writer's view or claim. Check it is the writer's opinion, not a fact or someone else's view."),
                 ("NO", "The statement contradicts the writer's view or claim. You can point to the sentence that says the opposite."),
                 ("NOT GIVEN", "The writer expresses no view on it. If the passage neither agrees nor disagrees, it is NOT GIVEN.")],
    ]

    /// Key under which a wrong pick is explained: the option as given, or TRUE / FALSE / NOT GIVEN.
    static func wrongNote(_ q: LrQuestion, given: String) -> String? {
        guard let w = q.review?.wrong, !given.isEmpty else { return nil }
        let g = given.trimmingCharacters(in: .whitespaces)
        let keys = [g, tfngValue(g)].filter { !$0.isEmpty }.map { $0.lowercased() }
        return w.first { k, _ in keys.contains(k.lowercased()) }?.value
    }
}
