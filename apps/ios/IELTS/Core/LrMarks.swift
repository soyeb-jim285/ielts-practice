import Foundation
import Observation

/// A highlight, optionally with a note. Same JSON as web/Android: `{id, region, p, s, e, note?}`; `ex` is an iOS-only excerpt for the Notes list.
/// `region` is `passage:<part>:<paragraph>`, `q:<n>:<field>` or `grp:<from>:<field>`; `s`/`e` are UTF-16 offsets into that region's plain text.
struct LrAnnot: Codable, Hashable, Identifiable {
    var id: String
    var region: String
    var p: Int
    var s: Int
    var e: Int
    var note: String?
    var ex: String?
}

/// Offsets between a region's plain text and the displayed text, which carries one note-marker character after each noted mark.
/// `inserts` are the plain positions of those markers, ascending.
enum LrOffsets {
    static func dispStart(_ s: Int, _ inserts: [Int]) -> Int { s + inserts.filter { $0 <= s }.count }
    static func dispEnd(_ e: Int, _ inserts: [Int]) -> Int { e + inserts.filter { $0 < e }.count }
    static func plain(_ d: Int, _ inserts: [Int]) -> Int {
        d - inserts.enumerated().filter { $0.element + $0.offset < d }.count
    }
}

enum LrMarkOps {
    static let maxNote = 500

    static func slice(_ text: String, _ s: Int, _ e: Int) -> String {
        let n = text as NSString
        let a = max(0, min(s, n.length)), b = max(a, min(e, n.length))
        return n.substring(with: NSRange(location: a, length: b - a))
    }

    static func excerpt(_ text: String, _ s: Int, _ e: Int) -> String { String(slice(text, s, e).prefix(120)) }

    static func cleanNote(_ note: String?) -> String? {
        let t = (note ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : String(t.prefix(maxNote))
    }

    private static func overlaps(_ m: LrAnnot, _ s: Int, _ e: Int) -> Bool { m.s < e && s < m.e }

    static func inRegion(_ marks: [LrAnnot], _ region: String) -> [LrAnnot] { marks.filter { $0.region == region } }

    /// A mark with a note that the range touches: selecting over it edits it instead of adding another.
    static func notedOverlap(_ marks: [LrAnnot], region: String, s: Int, e: Int) -> LrAnnot? {
        marks.first { $0.region == region && $0.note != nil && overlaps($0, s, e) }
    }

    /// Plain highlights merge with the plain highlights they overlap; a range over a noted mark changes nothing.
    static func addHighlight(_ marks: [LrAnnot], region: String, p: Int, s: Int, e: Int, text: String, id: String = UUID().uuidString) -> [LrAnnot] {
        guard e > s, notedOverlap(marks, region: region, s: s, e: e) == nil else { return marks }
        var lo = s, hi = e
        var out = marks.filter { m in
            guard m.region == region, m.note == nil, overlaps(m, s, e) else { return true }
            lo = min(lo, m.s)
            hi = max(hi, m.e)
            return false
        }
        out.append(LrAnnot(id: id, region: region, p: p, s: lo, e: hi, note: nil, ex: excerpt(text, lo, hi)))
        return out
    }

    /// A new marked range with a note (an empty note makes it a plain highlight). Over a noted mark it edits that mark's note.
    static func addNote(_ marks: [LrAnnot], region: String, p: Int, s: Int, e: Int, text: String, note: String?, id: String = UUID().uuidString) -> [LrAnnot] {
        guard e > s else { return marks }
        if let n = notedOverlap(marks, region: region, s: s, e: e) { return setNote(marks, id: n.id, note: note) }
        guard let clean = cleanNote(note) else { return addHighlight(marks, region: region, p: p, s: s, e: e, text: text, id: id) }
        var out = marks.filter { !($0.region == region && overlaps($0, s, e)) }
        out.append(LrAnnot(id: id, region: region, p: p, s: s, e: e, note: clean, ex: excerpt(text, s, e)))
        return out
    }

    static func setNote(_ marks: [LrAnnot], id: String, note: String?) -> [LrAnnot] {
        marks.map { m in
            guard m.id == id else { return m }
            var c = m
            c.note = cleanNote(note)
            return c
        }
    }

    static func remove(_ marks: [LrAnnot], id: String) -> [LrAnnot] { marks.filter { $0.id != id } }

    static func decode(_ data: Data?) -> [LrAnnot] {
        guard let data, let m = try? JSONDecoder().decode([LrAnnot].self, from: data) else { return [] }
        return m
    }

    static func encode(_ marks: [LrAnnot]) -> Data { (try? JSONEncoder().encode(marks)) ?? Data() }

    // MARK: Regions

    private static func comps(_ region: String) -> [String] { region.split(separator: ":", omittingEmptySubsequences: false).map(String.init) }

    static func place(_ region: String) -> String {
        let c = comps(region)
        guard c.count >= 2 else { return "Test" }
        switch c[0] {
        case "passage":
            let para = c.count > 2 ? Int(c[2].split(separator: ".").first ?? "") ?? 0 : 0
            return "Passage \(c[1]), paragraph \(para + 1)"
        case "q": return "Question \(c[1])"
        default: return "Questions from \(c[1])"
        }
    }

    /// The question a q: or grp: region belongs to.
    static func question(_ region: String) -> Int? {
        let c = comps(region)
        guard c.count >= 2, c[0] == "q" || c[0] == "grp" else { return nil }
        return Int(c[1])
    }

    /// Index of the part (section) holding the region.
    static func partIndex(_ region: String, test: LrTest) -> Int? {
        let c = comps(region)
        guard c.count >= 2 else { return nil }
        if c[0] == "passage" { return Int(c[1]).flatMap { p in test.sections.firstIndex { $0.part == p } } }
        return question(region).flatMap { test.section(of: $0) }
    }

    /// Reading order for the Notes list: part, then paragraph or question, then offset.
    static func sortKey(_ m: LrAnnot, _ test: LrTest) -> [Int] {
        let c = comps(m.region)
        let pos = c.count > 2 && c[0] == "passage" ? Int(c[2].split(separator: ".").first ?? "") ?? 0 : question(m.region) ?? 0
        return [partIndex(m.region, test: test) ?? 99, pos, m.s]
    }
}

/// Marks of one attempt, on this device only (UserDefaults `lr.marks.<attemptId>`); never sent anywhere.
@Observable
final class LrMarkStore {
    struct Pending: Hashable {
        var region: String
        var p: Int
        var s: Int
        var e: Int
        var text: String
    }
    enum Editor: Identifiable {
        case new(Pending)
        case edit(String)
        var id: String { switch self { case .new: "new"; case let .edit(i): i } }
    }

    let attemptId: String
    @ObservationIgnored private let defaults: UserDefaults
    private(set) var marks: [LrAnnot]
    var editor: Editor?

    static func key(_ id: String) -> String { "lr.marks.\(id)" }
    static func clear(_ id: String, defaults: UserDefaults = .standard) { defaults.removeObject(forKey: key(id)) }

    init(attemptId: String, defaults: UserDefaults = .standard) {
        self.attemptId = attemptId
        self.defaults = defaults
        marks = LrMarkOps.decode(defaults.data(forKey: Self.key(attemptId)))
    }

    func marks(in region: String) -> [LrAnnot] { LrMarkOps.inRegion(marks, region) }
    func mark(_ id: String) -> LrAnnot? { marks.first { $0.id == id } }

    private func commit(_ next: [LrAnnot]) {
        marks = next
        defaults.set(LrMarkOps.encode(next), forKey: Self.key(attemptId))
    }

    func highlight(_ x: Pending) {
        if let n = LrMarkOps.notedOverlap(marks, region: x.region, s: x.s, e: x.e) { editor = .edit(n.id); return }
        commit(LrMarkOps.addHighlight(marks, region: x.region, p: x.p, s: x.s, e: x.e, text: x.text))
    }

    func note(_ x: Pending) {
        if let n = LrMarkOps.notedOverlap(marks, region: x.region, s: x.s, e: x.e) { editor = .edit(n.id) } else { editor = .new(x) }
    }

    func save(_ ed: Editor, note: String) {
        switch ed {
        case let .new(x): commit(LrMarkOps.addNote(marks, region: x.region, p: x.p, s: x.s, e: x.e, text: x.text, note: note))
        case let .edit(id): commit(LrMarkOps.setNote(marks, id: id, note: note))
        }
    }

    func remove(_ id: String) { commit(LrMarkOps.remove(marks, id: id)) }
}
