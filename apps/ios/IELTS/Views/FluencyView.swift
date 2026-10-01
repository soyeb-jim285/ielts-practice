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
    var timeline = Timeline.empty
    var errors: [AnalysisError] = []
    @Binding var focus: String?
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
        if metrics.wpmSeries.count < 2 {
            Text("This answer is too short for a pace chart (it needs at least 15 seconds).").font(.callout).foregroundStyle(.muted).card()
        } else {
            FluPace(metrics: metrics, timeline: timeline, errors: errors, player: player, focus: $focus)
        }
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

// MARK: - Pace chart with the speaking timeline (web: WpmChart in FluencyPanel.tsx)

/// Pace over time with the typical band-7 zone. Mistakes sit on the line (shape and colour per type), questions are bands,
/// long pauses are shaded, and the teal line follows the audio. Without a recording the playhead is hidden and tapping just selects.
private struct FluPace: View {
    let metrics: SpeechMetrics
    let timeline: Timeline
    let errors: [AnalysisError]
    let player: Player
    @Binding var focus: String?
    @State private var hidden: Set<MarkerType> = []

    private var series: [WpmPoint] { metrics.wpmSeries }
    private var duration: Double { max(metrics.durationS, 1) }
    private var top: Double { (max(200, series.map(\.wpm).max() ?? 200) / 40).rounded(.up) * 40 }
    private var multi: Bool { timeline.questions.count > 1 }
    private var shown: [TimelineMarker] { timeline.markers.filter { !hidden.contains($0.type) && $0.t <= duration } }
    private var picked: TimelineMarker? { timeline.markers.first { $0.id == focus } }

    private func y(_ m: TimelineMarker) -> Double { wpmAt(series, m.t) }

    var body: some View {
        let lo = Int((series.map(\.wpm).min() ?? 0).rounded())
        let hi = Int((series.map(\.wpm).max() ?? 0).rounded())
        VStack(alignment: .leading, spacing: 10) {
            chart
                .frame(height: 220)
                .accessibilityLabel("Words per minute over time, from \(lo) to \(hi)")
            Text("Words per minute in 10-second windows, every 5 seconds. Shaded green: roughly where band-7 speakers sit.")
                .font(.caption).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
            legend
            if let picked { detail(picked) }
            if !shown.isEmpty { list }
        }
        .card()
    }

    private var chart: some View {
        Chart {
            RectangleMark(xStart: .value("Start", 0.0), xEnd: .value("End", duration), yStart: .value("Min", 120.0), yEnd: .value("Max", 160.0))
                .foregroundStyle(Color.good.opacity(0.14))
            if multi {
                ForEach(timeline.questions.filter { $0.idx % 2 == 1 }, id: \.idx) { q in
                    RectangleMark(xStart: .value("Start", q.start), xEnd: .value("End", q.end), yStart: .value("Min", 0.0), yEnd: .value("Max", top))
                        .foregroundStyle(Color.ink.opacity(0.05))
                }
            }
            ForEach(timeline.pauses, id: \.start) { p in
                RectangleMark(xStart: .value("Start", p.start), xEnd: .value("End", p.end), yStart: .value("Min", 0.0), yEnd: .value("Max", top))
                    .foregroundStyle(Color.muted.opacity(0.25))
            }
            if multi {
                ForEach(timeline.questions, id: \.idx) { q in
                    RuleMark(x: .value("Question", q.start))
                        .foregroundStyle(Color.muted.opacity(0.6))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .annotation(position: .top, alignment: .leading, spacing: 0) {
                            Text("Q\(q.idx + 1)").font(.caption2).foregroundStyle(.muted)
                        }
                }
            }
            ForEach(series, id: \.t) { p in
                LineMark(x: .value("Time", p.t + 5), y: .value("WPM", p.wpm))
                    .foregroundStyle(Color.ink.opacity(0.55))
                    .interpolationMethod(.linear)
            }
            ForEach(shown) { m in
                PointMark(x: .value("Time", m.t), y: .value("WPM", y(m)))
                    .symbol {
                        ZStack {
                            if m.id == focus { Circle().strokeBorder(Color.ink, lineWidth: 1.5).frame(width: 20, height: 20) }
                            MarkerShape(type: m.type).fill(m.type.color).overlay(MarkerShape(type: m.type).stroke(Color.surface, lineWidth: 1)).frame(width: 11, height: 11)
                        }
                    }
            }
            if player.isLoaded {
                RuleMark(x: .value("Playing", min(player.currentTime, duration)))
                    .foregroundStyle(Color.brand)
                    .lineStyle(StrokeStyle(lineWidth: 2))
            }
        }
        .chartYScale(domain: 0...top)
        .chartXScale(domain: 0...duration)
        .chartXAxisLabel("seconds")
        .chartYAxisLabel("words / min")
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(Color.clear).contentShape(Rectangle())
                    .gesture(SpatialTapGesture().onEnded { v in pick(near: v.location, proxy, geo) })
            }
        }
    }

    /// The nearest dot within 28 pt of the tap, if any.
    private func pick(near point: CGPoint, _ proxy: ChartProxy, _ geo: GeometryProxy) {
        guard let frame = proxy.plotFrame else { return }
        let origin = geo[frame].origin
        var best: TimelineMarker?
        var bestDist: CGFloat = 28
        for m in shown {
            guard let px = proxy.position(forX: m.t), let py = proxy.position(forY: y(m)) else { continue }
            let d = hypot(origin.x + px - point.x, origin.y + py - point.y)
            if d <= bestDist { bestDist = d; best = m }
        }
        if let best { select(best) }
    }

    private func select(_ m: TimelineMarker) {
        focus = m.id
        if player.isLoaded { player.seek(to: max(0, m.t - 0.5)) }
    }

    // MARK: Legend, detail, list

    private var legend: some View {
        FlowLayout(spacing: 8, lineSpacing: 4) {
            ForEach(MarkerType.allCases.filter { timeline.count($0) > 0 }) { t in
                let on = !hidden.contains(t)
                Button {
                    if on { hidden.insert(t) } else { hidden.remove(t) }
                } label: {
                    HStack(spacing: 6) {
                        MarkerGlyph(type: t)
                        Text(t.label)
                        Text("\(timeline.count(t))").monospacedDigit().opacity(0.7)
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.ink)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(on ? Color.surface2 : Color.clear, in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.line))
                    .opacity(on ? 1 : 0.55)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(t.label), \(timeline.count(t)) mistakes")
                .accessibilityValue(on ? "Shown" : "Hidden")
                .accessibilityHint("Shows or hides these on the chart")
            }
            if !timeline.pauses.isEmpty {
                legendSwatch(Color.muted.opacity(0.25), "Long pause")
            }
            if player.isLoaded { legendSwatch(Color.brand, "Playing now") }
        }
    }

    private func legendSwatch(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2, style: .continuous).fill(color).frame(width: 12, height: 10)
            Text(label).font(.caption).foregroundStyle(.muted)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
    }

    private func detail(_ m: TimelineMarker) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                MarkerGlyph(type: m.type)
                Text(m.type.label).font(.subheadline.weight(.medium))
                Text(clock(Int(m.t))).font(.caption.monospacedDigit()).foregroundStyle(.muted)
                Spacer()
                Button { focus = nil } label: {
                    Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain).foregroundStyle(.muted).accessibilityLabel("Close")
            }
            if let e = errors.first(where: { $0.id == m.errorId }) {
                ErrorDetailsView(error: e, onPlay: player.isLoaded ? { player.seek(to: max(0, m.t - 0.3)) } : nil, hideCategory: true)
            } else {
                Text(m.label).font(.callout).foregroundStyle(.ink)
            }
        }
        .padding(12)
        .background(Color.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    /// Every dot as a list: the VoiceOver route into the chart, and a precise way to pick one.
    private var list: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(shown) { m in
                    Button { select(m) } label: {
                        HStack(spacing: 8) {
                            MarkerGlyph(type: m.type)
                            Text(clock(Int(m.t))).font(.caption.monospacedDigit()).foregroundStyle(.muted)
                            Text(m.label).font(.footnote).foregroundStyle(.ink).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(m.type.label) mistake at \(clock(Int(m.t))): \(m.label)")
                    .accessibilityAddTraits(m.id == focus ? .isSelected : [])
                }
            }
        } label: {
            Text("All \(shown.count) marked \(shown.count == 1 ? "moment" : "moments")").font(.subheadline).foregroundStyle(.ink)
        }
    }
}
