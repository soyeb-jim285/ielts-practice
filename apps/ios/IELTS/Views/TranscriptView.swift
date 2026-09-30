import SwiftUI

/// Interactive transcript: tap a word to hear it (AVAudioPlayer seek), tap an underlined error for its explanation.
struct TranscriptView: View {
    let result: AnalysisResult
    let player: Player
    let onSelect: (AnalysisError) -> Void

    private struct Token: Identifiable {
        let id: Int
        let word: Word
        let error: AnalysisError?
        let unclearTier: Int?
        let filler: Bool
        let pauseAfter: Pause?
    }

    private struct Section: Identifiable { let id: Int; let title: String?; let tokens: [Token] }

    var body: some View {
        let sections = self.sections
        if sections.isEmpty {
            Text("No transcript available.").foregroundStyle(.secondary)
        } else {
            legend
            ForEach(sections) { s in
                VStack(alignment: .leading, spacing: 10) {
                    if let t = s.title { Text(t).font(.subheadline.weight(.semibold)).foregroundStyle(.brand) }
                    FlowLayout(spacing: 2, lineSpacing: 8) {
                        ForEach(s.tokens) { wordView($0) }
                    }
                }
                .card()
            }
        }
    }

    private var legend: some View {
        FlowLayout(spacing: 6) {
            Chip(text: "Tap a word to play", color: .brand)
            Chip(text: "Error", color: .bad)
            Chip(text: "Unclear", color: .warn)
            Chip(text: "Filler", color: .secondary)
            Chip(text: "Pause", color: .secondary)
        }
    }

    private func wordView(_ t: Token) -> some View {
        let active = player.isPlaying && player.currentTime >= t.word.start && player.currentTime < t.word.end + 0.05
        let errColor: Color? = t.error.map { $0.severity == "major" ? Color.bad : Color.warn }
        let textColor: Color = t.filler ? .secondary : t.unclearTier.map { $0 >= 3 ? Color.bad : Color.warn } ?? .primary
        return HStack(spacing: 2) {
            Text(t.word.w)
                .strikethrough(t.filler, color: .secondary)
                .underline(errColor != nil || t.unclearTier != nil, pattern: errColor == nil ? .dot : .solid, color: errColor ?? textColor)
                .foregroundStyle(textColor)
                .padding(.horizontal, 2)
                .background(active ? Color.brand.opacity(0.25) : (errColor?.opacity(0.12) ?? Color.clear), in: RoundedRectangle(cornerRadius: 4))
                .contentShape(Rectangle())
                .onTapGesture {
                    if let e = t.error { onSelect(e) } else { player.seek(to: max(0, t.word.start - 0.3)) }
                }
                .accessibilityAddTraits(.isButton)
            if let p = t.pauseAfter {
                Label(fmt(p.dur) + "s", systemImage: "pause.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(p.kind == "long" ? Color.bad : Color.secondary)
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background((p.kind == "long" ? Color.bad : Color.secondary).opacity(0.12), in: Capsule())
                    .accessibilityLabel("\(p.kind) pause, \(fmt(p.dur)) seconds")
            }
        }
    }

    private var sections: [Section] {
        guard let words = result.words, !words.isEmpty else { return [] }
        var errAt: [Int: AnalysisError] = [:]
        for e in result.errors where e.start >= 0 && e.start < words.count {
            for i in e.start...min(max(e.start, e.end), words.count - 1) where errAt[i] == nil { errAt[i] = e }
        }
        var unclear: [Int: Int] = [:]
        for u in result.metrics?.unclear ?? [] { unclear[u.wordIdx] = u.tier }
        let fillerTimes = Set((result.metrics?.fillers ?? []).filter { $0.kind == "lexical" }.map(\.time))
        var pauseAfter: [Int: Pause] = [:]
        for p in result.metrics?.pauses ?? [] {
            if let i = words.lastIndex(where: { $0.end <= p.start + 0.001 }) { pauseAfter[i] = p }
        }
        let tokens = words.enumerated().map { i, w in
            Token(id: i, word: w, error: errAt[i], unclearTier: unclear[i], filler: fillerTimes.contains(w.start), pauseAfter: pauseAfter[i])
        }
        let qs = (result.questions ?? []).filter { $0.startWord < tokens.count }.sorted { $0.startWord < $1.startWord }
        guard !qs.isEmpty else { return [Section(id: 0, title: nil, tokens: tokens)] }
        return qs.enumerated().map { j, q in
            let from = j == 0 ? 0 : q.startWord
            let to = j + 1 < qs.count ? qs[j + 1].startWord : tokens.count
            return Section(id: j, title: "Q\(j + 1). \(q.text)", tokens: Array(tokens[from..<max(from, to)]))
        }
    }
}
