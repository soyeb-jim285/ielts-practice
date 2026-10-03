import SwiftUI

// One timeline for a speaking result: where (seconds) and what (type) went wrong, shared by the pace chart, the audio bar
// and the transcript. Port of apps/web/src/lib/timeline.ts and components/speaking/timeline.tsx.

enum MarkerType: String, CaseIterable, Identifiable {
    case grammar, vocabulary, pronunciation, fluency

    var id: String { rawValue }

    var label: String {
        switch self {
        case .grammar: return "Grammar"
        case .vocabulary: return "Vocabulary"
        case .pronunciation: return "Pronunciation"
        case .fluency: return "Fluency"
        }
    }

    /// One colour per type. Teal is never used here: it means the playhead and the word playing.
    var color: Color {
        switch self {
        case .grammar: return .bad
        case .vocabulary: return .warn
        case .pronunciation: return .sky
        case .fluency: return .muted
        }
    }

    /// Underline pattern in text, so the type reads without colour (SwiftUI has no wavy underline).
    var underline: Text.LineStyle.Pattern {
        switch self {
        case .grammar: return .solid
        case .vocabulary: return .dash
        case .pronunciation: return .dot
        case .fluency: return .dashDot
        }
    }

    /// Error category prefix to type: grammar.*, vocabulary.* or lexis.*, pronunciation.*, fluency.*; task and cohesion have none.
    static func of(category: String) -> MarkerType? {
        switch category.split(separator: ".").first.map(String.init) ?? "" {
        case "grammar": return .grammar
        case "lexis", "vocabulary": return .vocabulary
        case "pronunciation": return .pronunciation
        case "fluency": return .fluency
        default: return nil
        }
    }
}

/// Circle, square, triangle or diamond per type, so the chart reads without colour.
struct MarkerShape: Shape {
    let type: MarkerType

    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let r = min(rect.width, rect.height) / 2
        switch type {
        case .grammar:
            return Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        case .vocabulary:
            let s = r * 0.85
            return Path(CGRect(x: c.x - s, y: c.y - s, width: s * 2, height: s * 2))
        case .pronunciation:
            var p = Path()
            p.move(to: CGPoint(x: c.x, y: c.y - r))
            p.addLine(to: CGPoint(x: c.x + r, y: c.y + r * 0.8))
            p.addLine(to: CGPoint(x: c.x - r, y: c.y + r * 0.8))
            p.closeSubpath()
            return p
        case .fluency:
            var p = Path()
            p.move(to: CGPoint(x: c.x, y: c.y - r))
            p.addLine(to: CGPoint(x: c.x + r, y: c.y))
            p.addLine(to: CGPoint(x: c.x, y: c.y + r))
            p.addLine(to: CGPoint(x: c.x - r, y: c.y))
            p.closeSubpath()
            return p
        }
    }
}

/// A type's shape in its colour, decorative (the text next to it names the type).
struct MarkerGlyph: View {
    let type: MarkerType
    var size: CGFloat = 10
    var body: some View {
        MarkerShape(type: type).fill(type.color).frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct TimelineMarker: Identifiable, Equatable {
    let id: String
    let t: Double
    let end: Double?
    let type: MarkerType
    let label: String
    let errorId: String?
}

struct QuestionSegment: Equatable {
    let idx: Int
    let start: Double
    let end: Double
    let text: String
}

struct TimelinePause: Equatable { let start: Double; let end: Double }

struct Timeline {
    var markers: [TimelineMarker] = []
    var questions: [QuestionSegment] = []
    var pauses: [TimelinePause] = []
    var durationS: Double = 0

    static let empty = Timeline()

    func count(_ t: MarkerType) -> Int { markers.filter { $0.type == t }.count }

    /// Short names of fused disfluency kinds (web DISFLUENCY[kind].short).
    static let disfluencyShort = ["filled": "filler", "repetition": "repeat", "repair": "repair", "false_start": "false start", "partial": "cut-off", "prolongation": "held sound"]

    init() {}

    /// Mistake markers (errors with a time, disfluency events, unclear words), question segments and long pauses (1 s or more).
    init(_ r: AnalysisResult) {
        let words = r.words ?? []
        let m = r.metrics
        durationS = m?.durationS ?? words.last?.end ?? 0
        for e in r.errors {
            guard let type = MarkerType.of(category: e.category) else { continue }
            let w = e.start >= 0 && e.start < words.count ? words[e.start] : nil
            guard let t = e.time ?? w?.start else { continue }
            let endWord = e.end >= 0 && e.end < words.count ? words[e.end].end : nil
            markers.append(TimelineMarker(id: e.id, t: t, end: endWord, type: type, label: e.original.isEmpty ? e.explanation : "\(e.original) → \(e.correction)", errorId: e.id))
        }
        if let m {
            for (i, d) in (m.fluency?.events ?? []).enumerated() {
                markers.append(TimelineMarker(id: "d\(i)", t: d.start, end: d.end, type: .fluency, label: Self.disfluencyShort[d.kind] ?? d.kind, errorId: nil))
            }
            for u in m.unclear where u.wordIdx >= 0 && u.wordIdx < words.count {
                let w = words[u.wordIdx]
                markers.append(TimelineMarker(id: "u\(u.wordIdx)", t: w.start, end: w.end, type: .pronunciation, label: "Unclear: “\(u.w)”", errorId: nil))
            }
        }
        markers.sort { $0.t < $1.t }

        let starts = (r.questions ?? []).enumerated().compactMap { i, q -> (Int, Double, String)? in
            q.startWord >= 0 && q.startWord < words.count ? (i, words[q.startWord].start, q.text) : nil
        }
        questions = starts.enumerated().map { i, s in
            QuestionSegment(idx: s.0, start: s.1, end: i + 1 < starts.count ? starts[i + 1].1 : durationS, text: s.2)
        }
        pauses = (m?.pauses ?? []).filter(resIsLongPause).map { TimelinePause(start: $0.start, end: $0.end) }
    }
}

/// Pace at time t, interpolated along the chart line (windows are plotted at their midpoint).
func wpmAt(_ series: [WpmPoint], windowS: Double = 10, _ t: Double) -> Double {
    let pts = series.map { (x: $0.t + windowS / 2, y: $0.wpm) }
    guard let first = pts.first, let last = pts.last else { return 0 }
    guard let i = pts.firstIndex(where: { $0.x >= t }) else { return last.y }
    if i == 0 { return first.y }
    let a = pts[i - 1], b = pts[i]
    let span = b.x - a.x
    return a.y + (b.y - a.y) * (t - a.x) / (span == 0 ? 1 : span)
}

/// Index of the word playing at time t (the last word that started), or -1 before the first.
func wordIndexAt(_ words: [Word], _ t: Double) -> Int {
    var lo = 0, hi = words.count
    while lo < hi {
        let mid = (lo + hi) / 2
        if words[mid].start <= t { lo = mid + 1 } else { hi = mid }
    }
    return lo - 1
}

/// What the replay clock is on (core `activeAt`): the word being spoken, or the pause after `word`. A gap under `holdS` between words keeps the previous word lit.
struct ActiveSpot: Equatable { var word: Int; var pause: Bool }
func activeSpot(_ words: [Word], _ t: Double, holdS: Double = 0.25) -> ActiveSpot {
    let i = wordIndexAt(words, t)
    if i < 0 { return ActiveSpot(word: -1, pause: false) }
    let w = words[i]
    if t < w.end + 0.05 { return ActiveSpot(word: i, pause: false) }
    if i + 1 < words.count, words[i + 1].start - w.end < holdS { return ActiveSpot(word: i, pause: false) }
    return ActiveSpot(word: i, pause: true)
}

/// Core `alignWords` without the energy step: Whisper-style times run a word's start back over a pause it hid, so a 0.07 s "I" shows as 0.7 s.
/// A word longer than max(0.7 s, 2x expected) gets its start moved up to end - expected. Older results were stored untrimmed.
func trimStretched(_ words: [Word]) -> [Word] {
    words.enumerated().map { i, w in
        let letters = w.w.filter { $0.isLetter && $0.isASCII }.count
        let expected = 0.07 * Double(letters)
        if i == 0 || w.end - w.start <= max(0.7, 2 * expected) { return w }
        return Word(w: w.w, start: w.end - expected, end: w.end, conf: w.conf)
    }
}
