import SwiftUI

// Interactive transcript (web: components/speaking/Transcript.tsx): filter chips with counts, tap a word to hear it,
// tap an underlined error for its explanation, typed tags for fillers/repeats/restarts, pause chips, and "Also noted".

private enum TrFilter: String, CaseIterable, Identifiable {
    case all, grammar, vocab, pronunciation, fluency, other, pauses

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "All"
        case .grammar: return "Grammar"
        case .vocab: return "Vocabulary"
        case .pronunciation: return "Pronunciation"
        case .fluency: return "Fluency"
        case .other: return "Task & other"
        case .pauses: return "Pauses"
        }
    }

    var type: MarkerType? {
        switch self {
        case .grammar: return .grammar
        case .vocab: return .vocabulary
        case .pronunciation: return .pronunciation
        case .fluency: return .fluency
        default: return nil
        }
    }
}

/// Transcript filter for an error: its timeline type, else "other" (task, cohesion).
private func trGroup(_ e: AnalysisError) -> TrFilter {
    switch MarkerType.of(category: e.category) {
    case .grammar: return .grammar
    case .vocabulary: return .vocab
    case .pronunciation: return .pronunciation
    case .fluency: return .fluency
    case nil: return .other
    }
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
    /// Word start times, for finding the word at a time.
    let words: [Word]

    private static let short = Timeline.disfluencyShort

    init(_ r: AnalysisResult, _ timeline: Timeline) {
        words = r.words ?? []
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
        for f in TrFilter.allCases { if let t = f.type { counts[f] = timeline.count(t) } }
        counts[.other] = r.errors.filter { trGroup($0) == .other }.count
        counts[.pauses] = r.metrics?.pauses.count ?? 0
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
    let timeline: Timeline
    /// The mistake picked on the chart or the audio bar (TimelineMarker.id).
    @Binding var focus: String?
    /// Every use of this word (any of its forms) gets a neutral tint.
    var lean: TextMetrics.Repeated? = nil
    let onSelect: (AnalysisError) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var filter: TrFilter = .all
    @State private var model: TrModel
    @State private var markDetail: String?
    /// Index of the word playing now (-1 for none). Updated by TrClock only when the word changes, so the 10 Hz clock does not rebuild the transcript.
    @State private var now = -1

    init(result: AnalysisResult, player: Player, timeline: Timeline, focus: Binding<String?>, lean: TextMetrics.Repeated? = nil, onSelect: @escaping (AnalysisError) -> Void) {
        self.result = result
        self.player = player
        self.timeline = timeline
        _focus = focus
        self.lean = lean
        self.onSelect = onSelect
        _model = State(initialValue: TrModel(result, timeline))
    }

    /// Word index of the focused mistake.
    private var focusWord: Int? {
        guard let id = focus, let m = timeline.markers.first(where: { $0.id == id }) else { return nil }
        return max(wordIndexAt(model.words, m.t), 0)
    }

    var body: some View {
        if model.tokens.isEmpty && model.unplaced.isEmpty {
            ContentUnavailableView("No transcript", systemImage: "text.alignleft", description: Text("No transcript is available for this answer."))
        } else {
            ScrollViewReader { proxy in
                VStack(alignment: .leading, spacing: 16) {
                    TrClock(player: player, words: model.words, now: $now)
                    filterBar
                    legend
                    if let markDetail { ResAlert(tone: .info, message: markDetail) }
                    ForEach(model.sections) { s in section(s) }
                    if !model.unplaced.isEmpty { alsoNoted }
                }
                .onChange(of: focus) { scrollToFocus(proxy) }
                .onChange(of: lean) { scrollToLean(proxy) }
                .task { try? await Task.sleep(for: .milliseconds(200)); scrollToFocus(proxy); scrollToLean(proxy) }
            }
        }
    }

    /// Bring a mistake picked elsewhere into view; no animation with Reduce Motion.
    private func scrollToFocus(_ proxy: ScrollViewProxy) {
        guard let i = focusWord else { return }
        if reduceMotion { proxy.scrollTo("w\(i)", anchor: .center) } else { withAnimation { proxy.scrollTo("w\(i)", anchor: .center) } }
    }

    /// Bring the first highlighted use of the leaned-on word into view.
    private func scrollToLean(_ proxy: ScrollViewProxy) {
        guard let lean else { return }
        let match = resFormMatcher(lean)
        guard let i = model.tokens.firstIndex(where: { match($0.word.w) }) else { return }
        if reduceMotion { proxy.scrollTo("w\(i)", anchor: .center) } else { withAnimation { proxy.scrollTo("w\(i)", anchor: .center) } }
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
            ForEach(MarkerType.allCases.filter { timeline.count($0) > 0 || $0 == .grammar || $0 == .vocabulary }) { t in
                legendItem(t.label.lowercased()) {
                    HStack(spacing: 4) {
                        MarkerGlyph(type: t, size: 9)
                        Text("word").underline(true, pattern: t.underline, color: t.color)
                    }
                }
            }
            if model.tokens.contains(where: \.filler) {
                legendItem("filler") { Text("um").strikethrough(true, color: Color.muted).foregroundStyle(Color.muted) }
            }
            if model.tokens.contains(where: { !$0.marks.isEmpty }) {
                legendItem("tap a tag for the detail") { Text("repeat").font(.caption2.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 2).background(Color.surface2, in: Capsule()) }
            }
            legendItem("long pause; short ones show under Pauses") {
                Text("pause 1.3s").font(.caption2.weight(.semibold)).foregroundStyle(.bad)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(Color.bad.opacity(0.12), in: Capsule())
            }
            if model.hasSentenceNotes {
                legendItem("task note (select Task & other)") { Text("…").padding(.horizontal, 4).background(Color.warn.opacity(0.14), in: RoundedRectangle(cornerRadius: 4)) }
            }
            if player.isLoaded {
                legendItem("playing now; tap any word to hear it") { Text("word").padding(.horizontal, 3).background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 3)).foregroundStyle(Color.ink) }
            }
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
        case .pauses: return false // words dim; the pause chips light up
        case .other: return t.errors.contains { trGroup($0) == .other }
        case .pronunciation: return t.unclearTier != nil || t.errors.contains { trGroup($0) == .pronunciation }
        case .fluency: return t.filler || !t.marks.isEmpty || t.errors.contains { trGroup($0) == .fluency }
        case .grammar, .vocab: return t.errors.contains { trGroup($0) == filter }
        }
    }

    private func wordView(_ t: TrToken) -> some View {
        let err = t.errors.first(where: shown)
        let sentence = err.map(trIsSentenceNote) ?? false
        // Underline in the mistake's type colour and pattern; task notes and other categories stay neutral.
        var type = err.flatMap { MarkerType.of(category: $0.category) }
        if err == nil, t.unclearTier != nil, !t.filler { type = .pronunciation }
        let underlineColor: Color? = sentence ? nil : (type?.color ?? (err != nil ? Color.muted : nil))
        let isNow = t.id == now
        let picked = t.id == focusWord
        let leaned = lean.map { resFormMatcher($0)(t.word.w) } ?? false
        let background: Color = isNow ? Color.brandSoft : leaned ? resLeanTint : sentence ? Color.warn.opacity(0.14) : Color.clear
        let dim = !(filter == .all || matches(t))
        return HStack(alignment: .firstTextBaseline, spacing: 2) {
            ForEach(Array(t.marks.enumerated()), id: \.offset) { _, m in markChip(m) }
            Text(t.word.w)
                .font(.system(.body, design: .serif))
                .strikethrough(t.filler, color: Color.muted)
                .underline(underlineColor != nil, pattern: type?.underline ?? .solid, color: underlineColor)
                .foregroundStyle(t.filler ? Color.muted : Color.ink)
                .padding(.horizontal, 2)
                .background(background, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(picked ? Color.ink : Color.clear, lineWidth: 1.5))
                .opacity(dim ? 0.35 : 1)
                .contentShape(Rectangle())
                .onTapGesture {
                    if let err { onSelect(err) } else { player.seek(to: max(0, t.word.start - 0.3)) }
                }
                .accessibilityLabel(wordLabel(t, err))
                .accessibilityHint(err != nil ? "Opens the explanation" : (player.isLoaded ? "Plays from this word" : ""))
                .accessibilityAddTraits(.isButton)
                .id("w\(t.id)")
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
            HStack(spacing: 3) { MarkerGlyph(type: .fluency, size: 7); Text(m.short) }
                .font(.caption2.weight(.medium))
                .foregroundStyle(.muted)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Color.surface2, in: Capsule())
                .overlay(Capsule().strokeBorder(filter == .fluency ? MarkerType.fluency.color : Color.clear, lineWidth: 1.5))
                .opacity(filter == .all || filter == .fluency ? 1 : 0.35)
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

/// Zero-size view that alone watches the 10 Hz playback clock and reports the playing word when it changes.
private struct TrClock: View {
    let player: Player
    let words: [Word]
    @Binding var now: Int

    var body: some View {
        let t = player.currentTime
        let i = player.isLoaded && player.isPlaying ? wordIndexAt(words, t) : -1
        let playing = i >= 0 && t < words[i].end + 0.05 ? i : -1
        Color.clear.frame(width: 0, height: 0)
            .onChange(of: playing) { _, v in now = v }
            .accessibilityHidden(true)
    }
}
