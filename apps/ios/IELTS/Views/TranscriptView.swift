import SwiftUI

// Interactive transcript (web: components/speaking/Transcript.tsx): filter chips with counts, tap a word to hear it,
// tap an underlined error for its explanation, typed tags for fillers/repeats/restarts, pause chips, and "Also noted".

private enum TrFilter: String, CaseIterable, Identifiable {
    case all, grammar, vocab, other, pauses, fillers, repeats, unclear

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "All"
        case .grammar: return "Grammar"
        case .vocab: return "Vocabulary"
        case .other: return "Task & other"
        case .pauses: return "Pauses"
        case .fillers: return "Fillers"
        case .repeats: return "Repeats & repairs"
        case .unclear: return "Unclear"
        }
    }
}

/// Transcript filter for an error: task, cohesion, fluency and pronunciation notes all go under "other".
private func trGroup(_ e: AnalysisError) -> TrFilter {
    e.category.hasPrefix("grammar") ? .grammar : e.category.hasPrefix("lexis") ? .vocab : .other
}

/// A task or relevance note on a whole stretch (8+ words): drawn as a sentence tint, only when its filter is on.
private func trIsSentenceNote(_ e: AnalysisError) -> Bool { trGroup(e) == .other && e.end - e.start >= 7 }

/// A typed tag before the word where a repeat, repair, false start, cut-off or held sound happens.
private struct TrMark {
    let short: String
    let detail: String
    let time: Double
}

private struct TrToken: Identifiable {
    let id: Int
    let word: Word
    var errors: [AnalysisError] = []
    var unclearTier: Int?
    var filler = false
    var pauseAfter: Pause?
    var marks: [TrMark] = []
}

private struct TrSection: Identifiable {
    let id: Int
    let n: Int?
    let head: String
    let rest: String
    let range: Range<Int>
}

/// Everything derived from the analysis, built once per result (the playback clock must not rebuild it).
private struct TrModel {
    let tokens: [TrToken]
    let sections: [TrSection]
    let unplaced: [AnalysisError]
    let counts: [TrFilter: Int]
    let hasSentenceNotes: Bool

    private static let short = ["filled": "filler", "repetition": "repeat", "repair": "repair", "false_start": "false start", "partial": "cut-off", "prolongation": "held sound"]

    init(_ r: AnalysisResult) {
        var tokens = (r.words ?? []).enumerated().map { TrToken(id: $0.offset, word: $0.element) }
        for e in r.errors where e.start >= 0 && e.start < tokens.count {
            for i in e.start...min(max(e.start, e.end), tokens.count - 1) { tokens[i].errors.append(e) }
        }
        if let m = r.metrics {
            for p in m.pauses {
                let i = tokens.firstIndex { abs($0.word.end - p.start) < 0.001 } ?? tokens.lastIndex { $0.word.end <= p.start + 0.001 }
                if let i { tokens[i].pauseAfter = p }
            }
            for f in m.fillers where f.kind == "lexical" {
                guard let i = tokens.firstIndex(where: { abs($0.word.start - f.time) < 0.001 }) else { continue }
                tokens[i].filler = true
                if f.word.contains(" "), i + 1 < tokens.count { tokens[i + 1].filler = true }
            }
            for u in m.unclear where u.wordIdx >= 0 && u.wordIdx < tokens.count { tokens[u.wordIdx].unclearTier = u.tier }
            for e in m.fluency?.events ?? [] {
                if e.kind == "filled" && e.sources.contains("stt") { continue } // already struck through on its word
                guard !tokens.isEmpty else { break }
                let i = tokens.firstIndex { $0.word.end > e.start - 0.02 } ?? (tokens.count - 1)
                let what = Disfluency.kinds.first { $0.key == e.kind }?.what ?? "Disfluency"
                tokens[i].marks.append(TrMark(short: Self.short[e.kind] ?? e.kind, detail: what, time: e.start))
            }
        }
        self.tokens = tokens
        unplaced = r.errors.filter { $0.start < 0 || $0.start >= tokens.count }
        hasSentenceNotes = r.errors.contains(where: trIsSentenceNote)

        var counts: [TrFilter: Int] = [:]
        for e in r.errors { counts[trGroup(e), default: 0] += 1 }
        counts[.pauses] = r.metrics?.pauses.count ?? 0
        counts[.fillers] = tokens.filter(\.filler).count
        counts[.repeats] = tokens.reduce(0) { $0 + $1.marks.count }
        counts[.unclear] = tokens.filter { $0.unclearTier != nil }.count
        self.counts = counts

        // One section per question, headed "Q1. ..."; without question boundaries, one headless block.
        let qs = (r.questions ?? []).enumerated()
            .filter { $0.element.startWord >= 0 && $0.element.startWord < tokens.count }
            .sorted { $0.element.startWord < $1.element.startWord }
        if qs.isEmpty {
            sections = tokens.isEmpty ? [] : [TrSection(id: 0, n: nil, head: "", rest: "", range: 0..<tokens.count)]
        } else {
            sections = qs.enumerated().map { j, q in
                let from = j == 0 ? 0 : q.element.startWord
                let to = j + 1 < qs.count ? qs[j + 1].element.startWord : tokens.count
                let h = resQuestionHead(q.element.text)
                return TrSection(id: j, n: q.offset + 1, head: h.head, rest: h.rest, range: from..<max(from, to))
            }
        }
    }
}

struct TranscriptView: View {
    let result: AnalysisResult
    let player: Player
    let onSelect: (AnalysisError) -> Void

    @State private var filter: TrFilter = .all
    @State private var model: TrModel
    @State private var markDetail: String?

    init(result: AnalysisResult, player: Player, onSelect: @escaping (AnalysisError) -> Void) {
        self.result = result
        self.player = player
        self.onSelect = onSelect
        _model = State(initialValue: TrModel(result))
    }

    var body: some View {
        if model.tokens.isEmpty && model.unplaced.isEmpty {
            ContentUnavailableView("No transcript", systemImage: "text.alignleft", description: Text("No transcript is available for this answer."))
        } else {
            filterBar
            legend
            if let markDetail { ResAlert(tone: .info, message: markDetail) }
            ForEach(model.sections) { s in section(s) }
            if !model.unplaced.isEmpty { alsoNoted }
        }
    }

    // MARK: Filters and legend

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(TrFilter.allCases.filter { $0 == .all || $0 == filter || (model.counts[$0] ?? 0) > 0 }) { f in
                    ResFilterChip(label: f.label, count: f == .all ? nil : (model.counts[f] ?? 0), selected: filter == f) { filter = f }
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }

    /// What the marks mean; only the marks that appear in this transcript.
    private var legend: some View {
        FlowLayout(spacing: 16, lineSpacing: 6) {
            legendItem("major error") { Text("word").underline(true, pattern: .solid, color: Color.bad) }
            legendItem("minor error") { Text("word").underline(true, pattern: .solid, color: Color.warn) }
            if (model.counts[.unclear] ?? 0) > 0 {
                legendItem("unclear to speech recognition") { Text("word").underline(true, pattern: .dot, color: Color.warn) }
            }
            if (model.counts[.fillers] ?? 0) > 0 {
                legendItem("filler") { Text("um").strikethrough(true, color: Color.muted).foregroundStyle(Color.muted) }
            }
            if (model.counts[.repeats] ?? 0) > 0 {
                legendItem("tap a tag for the detail") { Text("repeat").font(.caption2.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 2).background(Color.surface2, in: Capsule()) }
            }
            legendItem("long pause; short ones show under Pauses") {
                Text("pause 1.3s").font(.caption2.weight(.semibold)).foregroundStyle(.bad)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(Color.bad.opacity(0.12), in: Capsule())
            }
            if model.hasSentenceNotes {
                legendItem("task note (select Task & other)") { Text("…").padding(.horizontal, 4).background(Color.warn.opacity(0.14), in: RoundedRectangle(cornerRadius: 4)) }
            }
            if player.isLoaded { Text("Tap any word to hear it").font(.caption).foregroundStyle(.muted) }
        }
    }

    private func legendItem<S: View>(_ label: String, @ViewBuilder sample: () -> S) -> some View {
        HStack(spacing: 6) {
            sample().font(.caption)
            Text(label).font(.caption).foregroundStyle(.muted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Legend: \(label)")
    }

    // MARK: Words

    private func section(_ s: TrSection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let n = s.n {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Q\(n). \(s.head)").font(.subheadline.weight(.medium)).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                    if !s.rest.isEmpty { Text(s.rest).font(.caption).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true) }
                }
                .accessibilityAddTraits(.isHeader)
            }
            FlowLayout(spacing: 4, lineSpacing: 10) {
                ForEach(model.tokens[s.range]) { wordView($0) }
            }
        }
        .card()
    }

    /// Sentence-wide notes would drown word-level marks, so they only show under their own filter.
    private func shown(_ e: AnalysisError) -> Bool { !trIsSentenceNote(e) || filter == trGroup(e) }

    private func matches(_ t: TrToken) -> Bool {
        switch filter {
        case .all: return true
        case .fillers: return t.filler
        case .repeats: return !t.marks.isEmpty
        case .unclear: return t.unclearTier != nil
        case .pauses: return false // words dim; the pause chips light up
        case .grammar, .vocab, .other: return t.errors.contains { trGroup($0) == filter }
        }
    }

    private func wordView(_ t: TrToken) -> some View {
        let err = t.errors.first(where: shown)
        let sentence = err.map(trIsSentenceNote) ?? false
        let errColor: Color? = err.map { $0.severity == "major" ? Color.bad : Color.warn }
        var unclear: Color?
        if let tier = t.unclearTier, !t.filler, err == nil { unclear = tier >= 3 ? Color.bad : Color.warn }
        let active = player.isPlaying && player.currentTime >= t.word.start && player.currentTime < t.word.end + 0.05
        let background: Color = active ? Color.brand.opacity(0.25) : sentence ? Color.warn.opacity(0.14) : (errColor?.opacity(0.12) ?? Color.clear)
        let underlineColor: Color? = sentence ? nil : (errColor ?? unclear)
        let dim = !(filter == .all || matches(t))
        return HStack(alignment: .firstTextBaseline, spacing: 2) {
            ForEach(Array(t.marks.enumerated()), id: \.offset) { _, m in markChip(m) }
            Text(t.word.w)
                .font(.system(.body, design: .serif))
                .strikethrough(t.filler, color: Color.muted)
                .underline(underlineColor != nil, pattern: errColor == nil ? .dot : .solid, color: underlineColor)
                .foregroundStyle(t.filler ? Color.muted : Color.ink)
                .padding(.horizontal, 2)
                .background(background, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                .opacity(dim ? 0.35 : 1)
                .contentShape(Rectangle())
                .onTapGesture {
                    if let err { onSelect(err) } else { player.seek(to: max(0, t.word.start - 0.3)) }
                }
                .accessibilityLabel(wordLabel(t, err))
                .accessibilityHint(err != nil ? "Opens the explanation" : (player.isLoaded ? "Plays from this word" : ""))
                .accessibilityAddTraits(.isButton)
            if let p = t.pauseAfter, resIsLongPause(p) || filter == .pauses { pauseChip(p) }
        }
    }

    private func wordLabel(_ t: TrToken, _ err: AnalysisError?) -> String {
        guard let err else { return t.word.w }
        return "\(t.word.w), \(resCategoryLabel(err.category)) mistake"
    }

    private func markChip(_ m: TrMark) -> some View {
        Button {
            markDetail = markDetail == m.detail ? nil : m.detail
            player.seek(to: max(0, m.time - 0.3))
        } label: {
            Text(m.short)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.muted)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Color.surface2, in: Capsule())
                .overlay(Capsule().strokeBorder(filter == .repeats ? Color.brand : Color.clear, lineWidth: 1.5))
                .opacity(filter == .all || filter == .repeats ? 1 : 0.35)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(m.detail)
    }

    private func pauseChip(_ p: Pause) -> some View {
        let long = resIsLongPause(p)
        let color: Color = long ? .bad : .muted
        return Text("pause \(resPauseSec(p))s")
            .font(.caption2.weight(.semibold).monospacedDigit())
            .foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(long ? Color.bad.opacity(0.12) : Color.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(filter == .pauses ? color : Color.clear, lineWidth: 1))
            .onTapGesture { player.seek(to: max(0, p.start - 0.3)) }
            .accessibilityLabel("\(long ? "Long pause" : "Pause"), \(resPauseSec(p)) seconds")
    }

    // MARK: Also noted

    private var alsoNoted: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Also noted")
            VStack(spacing: 0) {
                ForEach(Array(model.unplaced.enumerated()), id: \.element.id) { i, e in
                    if i > 0 { Divider() }
                    ErrorDetailsView(error: e, onPlay: playAction(e))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                }
            }
            .card(padding: 0)
        }
    }

    private func playAction(_ e: AnalysisError) -> (() -> Void)? {
        guard player.isLoaded, let t = e.time else { return nil }
        return { player.seek(to: max(0, t - 0.3)) }
    }
}
