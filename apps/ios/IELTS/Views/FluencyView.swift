import Charts
import SwiftUI

// Fluency tab (web: components/speaking/FluencyPanel.tsx + lib/result.ts speechStats / disfluencyTypes).
// Pace chart, pause strip, the measures grid against typical band-7 speech, then fillers, repeats and restarts.
//
// The old version never finished laying out in demo mode (no recording, so no audio bar): the measures sat in a
// LazyVGrid whose cells asked for an infinite height inside a vertical ScrollView. The grid is now plain stacks with
// natural heights, and nothing here waits on the player being loaded.

private enum FluTone { case good, warn, bad, na }

private struct FluStat: Identifiable {
    let key: String
    let label: String
    let value: String
    let tone: FluTone
    let info: String
    var id: String { key }
}

/// Under ~20 words or 15 s, rates and per-minute counts are noise: show no verdicts.
private func fluTooShort(_ m: SpeechMetrics) -> Bool { m.wordCount < 20 || m.durationS < 15 }

private func fluUpTo(_ v: Double, _ good: Double, _ warn: Double) -> FluTone { v <= good ? .good : v <= warn ? .warn : .bad }
private func fluAtLeast(_ v: Double, _ good: Double, _ warn: Double) -> FluTone { v >= good ? .good : v >= warn ? .warn : .bad }

/// Stat grid with a tone against a band-7 heuristic (web speechStats).
private func fluStats(_ m: SpeechMetrics) -> [FluStat] {
    let mins = max(m.durationS / 60, 0.25)
    func perMin(_ n: Int) -> Double { Double(n) / mins }
    let rate = m.speechRate
    let long = m.pauses.filter(resIsLongPause).count
    let pace: FluTone = rate >= 120 && rate <= 170 ? .good : rate >= 100 && rate <= 190 ? .warn : .bad
    let stats = [
        FluStat(key: "rate", label: "Speech rate", value: "\(Int(rate.rounded())) wpm", tone: pace,
                info: "Words per minute over the whole answer, pauses included. Band 7+ speakers usually sit around 120–170."),
        FluStat(key: "artic", label: "Articulation rate", value: "\(Int(m.articulationRate.rounded())) wpm", tone: fluAtLeast(m.articulationRate, 150, 130),
                info: "Words per minute while you are actually speaking (pauses removed). Low values mean slow, effortful delivery."),
        FluStat(key: "mlr", label: "Mean length of run", value: "\(fmt(m.mlr)) words", tone: fluAtLeast(m.mlr, 8, 5),
                info: "Average number of words between pauses. Longer runs sound more fluent."),
        FluStat(key: "pauseRatio", label: "Pause ratio", value: "\(Int((m.pauseRatio * 100).rounded()))%", tone: fluUpTo(m.pauseRatio, 0.2, 0.3),
                info: "Share of the answer spent in silence."),
        FluStat(key: "long", label: "Long pauses", value: "\(long)", tone: fluUpTo(perMin(long), 1, 2),
                info: "Silences of 1 second or more. Examiners hear these as searching for words."),
        FluStat(key: "mid", label: "Mid-clause pauses", value: "\(m.midClausePauses)", tone: fluUpTo(perMin(m.midClausePauses), 1, 2.5),
                info: "Pauses inside a clause rather than at a natural boundary. These hurt fluency more than pauses between ideas."),
        FluStat(key: "fillers", label: "Fillers", value: "\(fmt(m.fillersPerMin))/min", tone: fluUpTo(m.fillersPerMin, 2, 4),
                info: "um, uh, er, \"you know\", \"sort of\" and voiced hesitations per minute."),
        FluStat(key: "reps", label: "Repetitions", value: "\(m.repetitions.count)", tone: fluUpTo(perMin(m.repetitions.count), 1, 2),
                info: "Words or phrases repeated back-to-back while you search for the next idea."),
        FluStat(key: "self", label: "Self-corrections", value: "\(m.selfCorrections.count)", tone: fluUpTo(perMin(m.selfCorrections.count), 1, 2),
                info: "Restarts like \"I go— I went\". A few are natural; many suggest hesitation."),
        FluStat(key: "var", label: "Pace variability", value: "±\(Int(m.wpmStdDev.rounded())) wpm", tone: fluUpTo(m.wpmStdDev, 20, 35),
                info: "Standard deviation of your pace across 10-second windows. Big swings = uneven pace."),
    ]
    if fluTooShort(m) { return stats.map { FluStat(key: $0.key, label: $0.label, value: "—", tone: .na, info: $0.info) } }
    return stats
}

/// On target / Watch / Work on this, always with an icon and words (colour is never the only cue).
private func fluIndicator(_ t: FluTone) -> (icon: String, text: String, color: Color)? {
    switch t {
    case .good: return ("checkmark.circle.fill", "On target", Color.goodText)
    case .warn: return ("exclamationmark.triangle.fill", "Watch", Color.warnText)
    case .bad: return ("xmark.circle.fill", "Work on this", Color.bad)
    case .na: return nil
    }
}

struct FluencyView: View {
    let metrics: SpeechMetrics
    let player: Player
    var fc: Criterion? = nil
    var target: Double = 7

    private var tooShort: Bool { fluTooShort(metrics) }
    private var pauseCount: Int { metrics.pauses.count }
    private var longPauses: Int { metrics.pauses.filter(resIsLongPause).count }

    /// Playhead position for the strips, nil until there is a recording.
    private var playhead: Double? { player.isLoaded ? player.currentTime : nil }

    var body: some View {
        if let fc, fc.band < target, !tooShort, fluStats(metrics).allSatisfy({ $0.tone != .bad }) {
            ResAlert(tone: .info, title: "Your delivery measures look fine, but Fluency & Coherence is \(fmt(fc.band, 1))",
                     message: "The band is limited by something these numbers don't capture, such as answer length, relevance or how ideas connect. \(fc.summary)")
        }
        SectionTitle("Pace")
        paceCard
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Pauses")
            Text("\(pauseCount) \(pauseCount == 1 ? "pause" : "pauses"), \(longPauses) long, \(metrics.midClausePauses) mid-clause.\(player.isLoaded ? " Tap one to hear it." : "")")
                .font(.footnote).foregroundStyle(.muted)
        }
        pauseCard
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Fluency measures")
            Text(tooShort ? "Not enough speech to measure. Answer for at least 20 seconds to see these." : "Compared with typical band-7 speech, not the score.")
                .font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
        }
        statGrid
        if let fluency = metrics.fluency { disfluencies(fluency.events) }
    }

    // MARK: Pace

    @ViewBuilder private var paceCard: some View {
        let series = metrics.wpmSeries
        VStack(alignment: .leading, spacing: 8) {
            if series.count < 2 {
                Text("This answer is too short for a pace chart (it needs at least 15 seconds).").font(.callout).foregroundStyle(.muted)
            } else {
                let lo = Int((series.map(\.wpm).min() ?? 0).rounded())
                let hi = Int((series.map(\.wpm).max() ?? 0).rounded())
                let top = (max(200, series.map(\.wpm).max() ?? 200) / 40).rounded(.up) * 40
                Chart {
                    // The typical band-7 zone, then the pace line (windows are plotted at their midpoint).
                    RectangleMark(xStart: .value("Time", 0.0), xEnd: .value("Time", max(metrics.durationS, 1)),
                                  yStart: .value("WPM", 120.0), yEnd: .value("WPM", 160.0))
                        .foregroundStyle(Color.good.opacity(0.14))
                    ForEach(series, id: \.t) { p in
                        AreaMark(x: .value("Time", p.t + 5), y: .value("WPM", p.wpm))
                            .foregroundStyle(Color.brand.opacity(0.12))
                            .interpolationMethod(.monotone)
                        LineMark(x: .value("Time", p.t + 5), y: .value("WPM", p.wpm))
                            .foregroundStyle(Color.brand)
                            .interpolationMethod(.monotone)
                    }
                }
                .chartYScale(domain: 0...top)
                .chartXScale(domain: 0...max(metrics.durationS, 1))
                .chartXAxisLabel("seconds")
                .chartYAxisLabel("words / min")
                .frame(height: 200)
                .accessibilityLabel("Words per minute over time, from \(lo) to \(hi)")
                Text("Words per minute in 10-second windows, every 5 seconds. Shaded green: roughly where band-7 speakers sit.")
                    .font(.caption).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .card()
    }

    // MARK: Pauses

    private var pauseCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            FluStrip(durationS: metrics.durationS, marks: metrics.pauses.map { p in
                FluMark(start: p.start, end: p.end, color: resIsLongPause(p) ? Color.bad : Color.warn.opacity(0.6))
            }, playhead: playhead, summary: "\(pauseCount) pauses, \(longPauses) long") { player.seek(to: max(0, $0 - 1)) }
            HStack {
                Text("0:00")
                Spacer()
                Text(clock(Int(metrics.durationS.rounded())))
            }
            .font(.caption.monospacedDigit()).foregroundStyle(.muted)
            FlowLayout(spacing: 16, lineSpacing: 4) {
                swatch(Color.warn.opacity(0.6), "Short, 0.25–1 s")
                swatch(Color.bad, "Long, 1 s or more")
            }
        }
        .card()
    }

    private func swatch(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2, style: .continuous).fill(color).frame(width: 10, height: 10)
            Text(label).font(.caption).foregroundStyle(.muted)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Measures

    private var statGrid: some View {
        let stats = fluStats(metrics)
        return VStack(spacing: 0) {
            ForEach(Array(stride(from: 0, to: stats.count, by: 2)), id: \.self) { i in
                if i > 0 { Divider() }
                HStack(alignment: .top, spacing: 0) {
                    FluStatCell(stat: stats[i])
                    Rectangle().fill(Color.line).frame(width: 1)
                    if i + 1 < stats.count {
                        FluStatCell(stat: stats[i + 1])
                    } else {
                        Color.clear.frame(maxWidth: .infinity)
                    }
                }
            }
        }
        .card(padding: 0)
    }

    // MARK: Fillers, repeats and restarts

    private static let kindColors: [String: Color] = [
        "filled": Color.muted, "repetition": Color.sky, "repair": Color.brand, "false_start": Color.warn,
        "partial": Color.ink.opacity(0.55), "prolongation": Color.sky.opacity(0.5),
    ]

    @ViewBuilder private func disfluencies(_ events: [Disfluency]) -> some View {
        let kinds = Disfluency.kinds.filter { k in k.core || events.contains { $0.kind == k.key } }
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Fillers, repeats and restarts")
            Text(player.isLoaded ? "Each mark is one event along your answer. Tap a mark to hear it." : "Each mark is one event along your answer.")
                .font(.footnote).foregroundStyle(.muted)
        }
        VStack(alignment: .leading, spacing: 8) {
            FluStrip(durationS: metrics.durationS, marks: events.map { e in
                FluMark(start: e.start, end: max(e.end, e.start + 0.15), color: Self.kindColors[e.kind] ?? Color.muted)
            }, playhead: playhead, summary: "\(events.count) fillers, repeats and restarts along the recording") { player.seek(to: max(0, $0 - 1)) }
            FlowLayout(spacing: 16, lineSpacing: 4) {
                ForEach(kinds.filter { k in events.contains { $0.kind == k.key } }, id: \.key) { k in
                    swatch(Self.kindColors[k.key] ?? Color.muted, k.label)
                }
            }
        }
        .card()
        ForEach(kinds, id: \.key) { k in breakdown(k, events) }
    }

    /// One card per disfluency type: how many, how often, and what is normal versus what hurts coherence.
    private func breakdown(_ k: Disfluency.Kind, _ events: [Disfluency]) -> some View {
        let n = events.filter { $0.kind == k.key }.count
        let perMin = Double(n) / max(max(metrics.durationS, 1) / 60, 0.25)
        let tone: FluTone = tooShort ? .na : fluUpTo(perMin, k.rate[0], k.rate[1])
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(k.label).font(.headline).foregroundStyle(.ink)
                    Text(k.what).font(.caption).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(n)").font(.title2.weight(.semibold).monospacedDigit())
                    if !tooShort { Text("\(fmt(perMin))/min").font(.caption.monospacedDigit()).foregroundStyle(.muted) }
                }
            }
            if let ind = fluIndicator(tone) {
                Label { Text(ind.text) } icon: { Image(systemName: ind.icon) }
                    .font(.caption.weight(.medium)).foregroundStyle(ind.color)
            }
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 6) {
                    Text(Self.labelled("Normal: ", k.normal))
                    Text(Self.labelled("Hurts when: ", k.harmful))
                }
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 6)
            } label: {
                Text("When is this a problem?").font(.subheadline).foregroundStyle(.brand)
            }
        }
        .card()
        .accessibilityElement(children: .contain)
    }

    private static func labelled(_ label: String, _ text: String) -> AttributedString {
        var lead = AttributedString(label)
        lead.font = Font.footnote.weight(.semibold)
        lead.foregroundColor = Color.ink
        var rest = AttributedString(text)
        rest.foregroundColor = Color.muted
        return lead + rest
    }
}

// MARK: - Pieces

private struct FluMark {
    let start: Double
    let end: Double
    let color: Color
}

/// Whole-recording bar with marks placed on it. Tap near a mark to hear it; the playhead follows playback.
private struct FluStrip: View {
    let durationS: Double
    let marks: [FluMark]
    let playhead: Double?
    let summary: String
    let onPick: (Double) -> Void

    var body: some View {
        let d = max(durationS, 1)
        GeometryReader { g in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.surface2)
                ForEach(marks.indices, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(marks[i].color)
                        .frame(width: max(4, g.size.width * (marks[i].end - marks[i].start) / d), height: 28)
                        .offset(x: min(max(g.size.width - 4, 0), g.size.width * marks[i].start / d))
                }
                if let playhead {
                    Rectangle().fill(Color.brand).frame(width: 2, height: 40)
                        .offset(x: min(g.size.width - 2, g.size.width * max(playhead, 0) / d))
                }
            }
            .frame(width: g.size.width, height: g.size.height)
            .contentShape(Rectangle())
            .gesture(SpatialTapGesture().onEnded { v in
                var bestStart: Double?
                var bestDist: CGFloat = 22
                for m in marks {
                    let centre = g.size.width * (m.start + (m.end - m.start) / 2) / d
                    let dist = abs(centre - v.location.x)
                    if dist <= bestDist {
                        bestDist = dist
                        bestStart = m.start
                    }
                }
                if let bestStart { onPick(bestStart) }
            })
        }
        .frame(height: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary)
    }
}

/// One measure: label with an info tip, the value, and where it sits against typical band-7 speech.
private struct FluStatCell: View {
    let stat: FluStat
    @State private var showInfo = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 2) {
                Text(stat.label).font(.caption).foregroundStyle(.muted)
                Button { showInfo.toggle() } label: {
                    Image(systemName: "info.circle").font(.footnote).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain).foregroundStyle(.muted)
                .padding(.vertical, -14).padding(.horizontal, -8)
                .accessibilityLabel("About \(stat.label)")
                .accessibilityHint(showInfo ? "Hides the explanation" : "Shows an explanation")
            }
            Text(stat.value).font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(.ink)
            if let ind = fluIndicator(stat.tone) {
                Label { Text(ind.text) } icon: { Image(systemName: ind.icon) }
                    .font(.caption.weight(.medium)).foregroundStyle(ind.color)
            }
            if showInfo {
                Text(stat.info).font(.caption).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(14)
        .accessibilityElement(children: .contain)
    }
}
