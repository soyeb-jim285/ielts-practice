import Charts
import SwiftUI

/// Renders a generated Task 1 ChartSpec (line/bar/pie/table/process/map).
struct ChartView: View {
    let spec: ChartSpec

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(spec.title).font(.headline)
            switch spec {
            case let .xy(bar, _, xLabel, yLabel, unit, categories, series):
                xy(bar: bar, xLabel: xLabel, yLabel: unit.isEmpty ? yLabel : "\(yLabel) (\(unit))", categories: categories, series: series)
            case let .pie(_, unit, pies):
                ForEach(pies, id: \.name) { pie in
                    VStack(alignment: .leading) {
                        if pies.count > 1 { Text(pie.name).font(.subheadline.weight(.semibold)) }
                        Chart(pie.slices, id: \.label) { s in
                            SectorMark(angle: .value("Value", s.value), innerRadius: .ratio(0.5), angularInset: 1.5)
                                .foregroundStyle(by: .value("Category", s.label))
                                .annotation(position: .overlay) {
                                    Text("\(Cell.format(s.value))\(unit)").font(.caption2.bold()).foregroundStyle(.white)
                                }
                        }
                        .frame(height: 220)
                    }
                }
            case let .table(_, columns, rows):
                ScrollView(.horizontal) {
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                        GridRow { ForEach(columns, id: \.self) { Text($0).font(.caption.weight(.bold)) } }
                        Divider()
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            GridRow { ForEach(Array(row.enumerated()), id: \.offset) { _, cell in Text(cell).font(.callout.monospacedDigit()) } }
                        }
                    }
                }
            case let .process(_, steps):
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(i + 1)").font(.caption.bold()).frame(width: 24, height: 24).background(.brand.opacity(0.15), in: Circle()).foregroundStyle(.brand)
                            Text(step)
                        }
                        if i + 1 < steps.count { Image(systemName: "arrow.down").foregroundStyle(.tertiary).padding(.leading, 5) }
                    }
                }
            case let .map(_, before, after):
                HStack(alignment: .top, spacing: 12) {
                    mapSide(before)
                    Image(systemName: "arrow.right").foregroundStyle(.tertiary).padding(.top, 4)
                    mapSide(after)
                }
            }
        }
    }

    private func xy(bar: Bool, xLabel: String, yLabel: String, categories: [String], series: [ChartSpec.Series]) -> some View {
        Chart {
            ForEach(series, id: \.name) { s in
                ForEach(Array(zip(categories, s.values).enumerated()), id: \.offset) { _, point in
                    if bar {
                        BarMark(x: .value(xLabel, point.0), y: .value(yLabel, point.1))
                            .foregroundStyle(by: .value("Series", s.name))
                            .position(by: .value("Series", s.name))
                    } else {
                        LineMark(x: .value(xLabel, point.0), y: .value(yLabel, point.1))
                            .foregroundStyle(by: .value("Series", s.name))
                            .symbol(by: .value("Series", s.name))
                    }
                }
            }
        }
        .chartXAxisLabel(xLabel)
        .chartYAxisLabel(yLabel)
        .frame(height: 240)
    }

    private func mapSide(_ side: ChartSpec.MapSide) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(side.label).font(.subheadline.weight(.semibold))
            ForEach(side.features, id: \.self) { Text("• \($0)").font(.callout) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension Cell {
    static func format(_ n: Double) -> String { n.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(n)) : String(format: "%.1f", n) }
}
