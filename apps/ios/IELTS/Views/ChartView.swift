import Charts
import SwiftUI
import UIKit

/// Renders a generated Task 1 ChartSpec (line/bar/pie/table/process/map) as an exam-paper figure.
/// Series colours follow the web ChartRenderer: teal, sky, slate, amber, rose, ink (dynamic light/dark),
/// with dash patterns and symbols so lines stay tellable apart without colour.
struct ChartView: View {
    let spec: ChartSpec

    /// Web --chart-3 (slate), not in Theme.
    private static let slate = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0x94 / 255, green: 0xA3 / 255, blue: 0xB8 / 255, alpha: 1)
        : UIColor(red: 0x64 / 255, green: 0x74 / 255, blue: 0x8B / 255, alpha: 1) })
    private static let base: [Color] = [.brand, .sky, slate, .warn, .bad, .ink]
    private static let dashes: [[CGFloat]] = [[], [6, 3], [2, 3], [10, 4, 2, 4], [1, 2], [8, 2]]

    /// Past six series, repeat the palette as lighter tints so neighbours never share a colour.
    private static func color(_ i: Int) -> Color { i < base.count ? base[i] : base[i % base.count].opacity(0.55) }
    private static func dash(_ i: Int) -> [CGFloat] { dashes[i % dashes.count] }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !spec.title.isEmpty {
                Text(spec.title)
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            switch spec {
            case let .xy(bar, _, xLabel, yLabel, unit, categories, series):
                xy(bar: bar, xLabel: xLabel, yLabel: yLabel.isEmpty ? unit : (unit.isEmpty || yLabel.contains(unit) ? yLabel : "\(yLabel) (\(unit))"), categories: categories, series: series)
            case let .pie(_, unit, pies):
                pieCharts(unit: unit.isEmpty ? "%" : unit, pies: pies)
            case let .table(_, columns, rows):
                table(columns: columns, rows: rows)
            case let .process(_, steps):
                process(steps)
            case let .map(_, before, after):
                VStack(spacing: 12) {
                    mapSide(before)
                    mapSide(after)
                }
            }
        }
    }

    // MARK: Line and bar

    /// Round axis ticks from lo to hi: steps of 1, 2, 2.5 or 5 times 10^k, about 5 of them (port of web niceTicks).
    private static func niceTicks(_ lo: Double, _ hiIn: Double) -> [Double] {
        let hi = hiIn == lo ? lo + 1 : hiIn
        let raw = (hi - lo) / 5
        let mag = pow(10, floor(log10(raw)))
        let step = [1.0, 2, 2.5, 5, 10].map { $0 * mag }.first { $0 >= raw } ?? mag * 10
        var out: [Double] = []
        var t = floor(lo / step) * step
        while t < hi + step - 1e-9 && out.count < 40 {
            out.append((t * 1e9).rounded() / 1e9)
            t += step
        }
        return out
    }

    private func xy(bar: Bool, xLabel: String, yLabel: String, categories: [String], series: [ChartSpec.Series]) -> some View {
        let vals = series.flatMap(\.values)
        let ticks = Self.niceTicks(min(0, vals.min() ?? 0), max(0, vals.max() ?? 0))
        let lo = ticks.first ?? 0
        let hi = ticks.last ?? 1
        // Long category axes (years): label every nth so the text never collides.
        let every = max(1, Int(ceil(Double(categories.count) / 6)))
        let shown = categories.enumerated().filter { $0.offset % every == 0 }.map(\.element)
        let names = series.map(\.name)
        let colors = series.indices.map { Self.color($0) }

        return VStack(spacing: 12) {
            Chart {
                ForEach(Array(series.enumerated()), id: \.offset) { si, s in
                    ForEach(Array(zip(categories, s.values).enumerated()), id: \.offset) { _, point in
                        if bar {
                            BarMark(x: .value("Category", point.0), y: .value("Value", point.1))
                                .foregroundStyle(by: .value("Series", s.name))
                                .position(by: .value("Series", s.name))
                                .cornerRadius(2)
                        } else {
                            LineMark(x: .value("Category", point.0), y: .value("Value", point.1), series: .value("Series", s.name))
                                .foregroundStyle(by: .value("Series", s.name))
                                .lineStyle(StrokeStyle(lineWidth: 2, dash: Self.dash(si)))
                            PointMark(x: .value("Category", point.0), y: .value("Value", point.1))
                                .foregroundStyle(by: .value("Series", s.name))
                                .symbolSize(28)
                        }
                    }
                }
            }
            .chartForegroundStyleScale(domain: names, range: colors)
            .chartLegend(.hidden)
            .chartYScale(domain: lo...hi)
            .chartXAxis {
                AxisMarks(values: shown) { _ in
                    AxisTick().foregroundStyle(Color.line)
                    AxisValueLabel().foregroundStyle(Color.muted)
                }
            }
            .chartYAxis {
                AxisMarks(values: ticks) { value in
                    AxisGridLine().foregroundStyle(Color.line)
                    AxisValueLabel {
                        if let d = value.as(Double.self) { Text(d.formatted(.number.precision(.fractionLength(0...1)))) }
                    }
                    .foregroundStyle(Color.muted)
                }
            }
            .chartXAxisLabel(position: .bottom) {
                if !xLabel.isEmpty { Text(xLabel).font(.caption).foregroundStyle(Color.muted) }
            }
            .chartYAxisLabel(position: .leading) {
                if !yLabel.isEmpty { Text(yLabel).font(.caption).foregroundStyle(Color.muted) }
            }
            .font(.caption)
            .frame(height: 260)

            if series.count > 1 { legend(names: names, line: !bar) }
        }
    }

    private func legend(names: [String], line: Bool) -> some View {
        FlowLayout(spacing: 16, lineSpacing: 6) {
            ForEach(Array(names.enumerated()), id: \.offset) { i, name in
                HStack(spacing: 6) {
                    if line {
                        Path { p in
                            p.move(to: CGPoint(x: 0, y: 4))
                            p.addLine(to: CGPoint(x: 20, y: 4))
                        }
                        .stroke(Self.color(i), style: StrokeStyle(lineWidth: 2, dash: Self.dash(i)))
                        .frame(width: 20, height: 8)
                    } else {
                        RoundedRectangle(cornerRadius: 2).fill(Self.color(i)).frame(width: 10, height: 10)
                    }
                    Text(name).font(.caption).foregroundStyle(.ink)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    // MARK: Pie

    private func pieCharts(unit: String, pies: [ChartSpec.Pie]) -> some View {
        // One shared colour per label across every pie, so "Coal" is the same colour in 1990 and 2020.
        let labels = pies.flatMap { $0.slices.map(\.label) }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let colors = labels.indices.map { Self.color($0) }
        func value(_ v: Double) -> String { unit == "%" ? "\(Cell.format(v))%" : "\(Cell.format(v)) \(unit)" }

        return VStack(spacing: 20) {
            ForEach(Array(pies.enumerated()), id: \.offset) { _, pie in
                VStack(alignment: .leading, spacing: 10) {
                    Text(pie.name).font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                        .frame(maxWidth: .infinity, alignment: .center)
                    Chart {
                        ForEach(Array(pie.slices.enumerated()), id: \.offset) { _, s in
                            SectorMark(angle: .value("Value", s.value), angularInset: 1)
                                .foregroundStyle(by: .value("Category", s.label))
                        }
                    }
                    .chartForegroundStyleScale(domain: labels, range: colors)
                    .chartLegend(.hidden)
                    .frame(height: 180)
                    .accessibilityHidden(true)
                    // The values double as the legend: swatch, label, number.
                    VStack(spacing: 6) {
                        ForEach(Array(pie.slices.enumerated()), id: \.offset) { _, s in
                            HStack(spacing: 8) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(Self.color(labels.firstIndex(of: s.label) ?? 0))
                                    .frame(width: 10, height: 10)
                                Text(s.label).font(.subheadline).foregroundStyle(.ink)
                                Spacer(minLength: 8)
                                Text(value(s.value)).font(.subheadline.monospacedDigit()).foregroundStyle(.muted)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
        }
    }

    // MARK: Table

    private func table(columns: [String], rows: [[String]]) -> some View {
        let grid = Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(columns.enumerated()), id: \.offset) { i, c in
                    Text(c).font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .gridColumnAlignment(i == 0 ? .leading : .trailing)
                }
            }
            .background(.surface2)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Divider()
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { i, cell in
                        Text(cell)
                            .font(i == 0 ? .subheadline.weight(.medium) : .subheadline.monospacedDigit())
                            .foregroundStyle(.ink)
                            .padding(.horizontal, 12).padding(.vertical, 10)
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.line))

        return ViewThatFits(in: .horizontal) {
            grid
            ScrollView(.horizontal, showsIndicators: false) { grid }
        }
    }

    // MARK: Process and map

    private func process(_ steps: [String]) -> some View {
        VStack(spacing: 6) {
            ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                HStack(alignment: .top, spacing: 10) {
                    Text("\(i + 1)")
                        .font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(.canvas)
                        .frame(width: 24, height: 24)
                        .background(.ink, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .accessibilityHidden(true)
                    Text(step).font(.subheadline).foregroundStyle(.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.line))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Step \(i + 1), \(step)")
                if i + 1 < steps.count {
                    Image(systemName: "arrow.down").font(.footnote).foregroundStyle(.muted).accessibilityHidden(true)
                }
            }
        }
    }

    private func mapSide(_ side: ChartSpec.MapSide) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(side.label).font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                .frame(maxWidth: .infinity, alignment: .center)
            ForEach(Array(side.features.enumerated()), id: \.offset) { _, f in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Circle().fill(Color.ink.opacity(0.5)).frame(width: 6, height: 6).accessibilityHidden(true)
                    Text(f).font(.subheadline).foregroundStyle(.ink)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(side.label)
    }
}

extension Cell {
    static func format(_ n: Double) -> String { n.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(n)) : String(format: "%.1f", n) }
}
