import Charts
import SwiftUI

struct FluencyView: View {
    let metrics: SpeechMetrics
    let player: Player

    private var minutes: Double { max(metrics.durationS / 60, 1.0 / 60) }

    var body: some View {
        SectionTitle("Speaking pace")
        VStack(alignment: .leading, spacing: 8) {
            Chart {
                RectangleMark(xStart: .value("Time", 0.0), xEnd: .value("Time", max(metrics.durationS, 10)),
                              yStart: .value("WPM", 120.0), yEnd: .value("WPM", 160.0))
                    .foregroundStyle(.good.opacity(0.14))
                ForEach(metrics.wpmSeries, id: \.t) { p in
                    AreaMark(x: .value("Time", p.t), y: .value("WPM", p.wpm))
                        .foregroundStyle(.brand.opacity(0.18))
                        .interpolationMethod(.monotone)
                    LineMark(x: .value("Time", p.t), y: .value("WPM", p.wpm))
                        .foregroundStyle(.brand)
                        .interpolationMethod(.monotone)
                }
            }
            .chartXAxisLabel("seconds")
            .chartYAxisLabel("words / min")
            .frame(height: 200)
            Text("Green band: 120–160 wpm, the band-7 pace zone (heuristic).").font(.caption).foregroundStyle(.secondary)
        }
        .card()

        SectionTitle("Pauses")
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.15))
                    ForEach(Array(metrics.pauses.enumerated()), id: \.offset) { _, p in
                        Rectangle()
                            .fill(p.kind == "long" ? Color.bad : Color.warn)
                            .frame(width: max(3, g.size.width * p.dur / max(metrics.durationS, 1)))
                            .offset(x: g.size.width * p.start / max(metrics.durationS, 1))
                            .onTapGesture { player.seek(to: max(0, p.start - 1)) }
                    }
                }
            }
            .frame(height: 24)
            .accessibilityLabel("\(metrics.pauses.count) pauses, \(metrics.longPauses) long")
            Text("Amber: short pause · red: long pause (1 s+). Tap one to hear it.").font(.caption).foregroundStyle(.secondary)
        }
        .card()

        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            stat("Speech rate", "\(Int(metrics.speechRate)) wpm", grade(metrics.speechRate, good: 120...160, warn: 100...180), "Words per minute over the whole answer.")
            stat("Articulation rate", "\(Int(metrics.articulationRate)) wpm", nil, "Speed while actually speaking, pauses excluded.")
            stat("Mean length of run", "\(fmt(metrics.mlr)) words", metrics.mlr >= 8 ? .good : metrics.mlr >= 5 ? .warn : .bad, "Words between pauses. Longer runs sound more fluent.")
            stat("Pause ratio", "\(Int(metrics.pauseRatio * 100))%", metrics.pauseRatio <= 0.2 ? .good : metrics.pauseRatio <= 0.3 ? .warn : .bad, "Share of time spent silent.")
            stat("Long pauses", "\(metrics.longPauses)", perMin(metrics.longPauses, 1, 2), "Pauses of a second or more.")
            stat("Mid-clause pauses", "\(metrics.midClausePauses)", perMin(metrics.midClausePauses, 1, 2), "Pauses inside a clause signal searching for words.")
            stat("Fillers / min", fmt(metrics.fillersPerMin), metrics.fillersPerMin <= 3 ? .good : metrics.fillersPerMin <= 6 ? .warn : .bad, "um, uh, like, you know… and voiced hesitations.")
            stat("Repetitions", "\(metrics.repetitions.count)", perMin(metrics.repetitions.count, 1, 2), "Immediately repeated words or phrases.")
            stat("Self-corrections", "\(metrics.selfCorrections.count)", nil, "Restarts like “I go— I went”. Some are natural.")
            stat("Pace variability", "±\(Int(metrics.wpmStdDev)) wpm", metrics.wpmStdDev <= 25 ? .good : metrics.wpmStdDev <= 40 ? .warn : .bad, "Big swings = uneven pace.")
        }
    }

    private func grade(_ x: Double, good: ClosedRange<Double>, warn: ClosedRange<Double>) -> Color {
        good.contains(x) ? .good : warn.contains(x) ? .warn : .bad
    }

    private func perMin(_ n: Int, _ good: Double, _ warn: Double) -> Color {
        let r = Double(n) / minutes
        return r <= good ? .good : r <= warn ? .warn : .bad
    }

    private func stat(_ title: String, _ value: String, _ color: Color?, _ info: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if let color { Circle().fill(color).frame(width: 8, height: 8) }
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            Text(value).font(.title3.weight(.bold).monospacedDigit())
            Text(info).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .card(padding: 12)
        .accessibilityElement(children: .combine)
    }
}
