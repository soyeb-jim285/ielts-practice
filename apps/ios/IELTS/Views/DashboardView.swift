import Charts
import SwiftUI

/// Dashboard payload (GET /api/progress). Local to this screen so it can read fields (`skill`, `part`, `lastFailed`) the shared
/// ProgressData does not carry; everything beyond the original contract is optional so older servers and demo fixtures still decode.
private struct DashProgress: Decodable {
    struct Point: Decodable {
        let skill: String?
        let part: Int?
        let criteria: [String: Double]
    }
    struct Failed: Decodable { let id: String; let skill: String }
    let trend: [Point]
    let streak: Int
    let minutesThisWeek: Double
    let attempts: Int
    let weakest: ProgressData.Weakest?
    let topMistakes: [ProgressData.CategoryCount]
    let predicted: ProgressData.Predicted
    let lastFailed: Failed?
}

/// Where to practise each criterion when the user has no scored attempts to tell us where they are weakest (web criteria.ts PRACTICE).
private let practiceDefault: [String: (skill: String, part: Int)] = [
    "fc": ("speaking", 2), "gra": ("speaking", 2), "lr": ("speaking", 2), "p": ("speaking", 1), "ta": ("writing", 2), "cc": ("writing", 2),
]
private let criterionShort = ["fc": "Fluency", "gra": "Grammar", "lr": "Vocabulary", "p": "Pronunciation", "ta": "Task response", "cc": "Coherence"]

/// Chart series: teal, sky, slate, ink (the fourth also dashed). Green, amber and red stay reserved for good, warn and bad.
private func seriesColor(_ key: String) -> Color {
    switch key {
    case "fc", "ta": .brand
    case "lr": .sky
    case "gra": .muted
    default: .ink
    }
}
private func seriesDashed(_ key: String) -> Bool { key == "p" || key == "cc" }

private func greeting(_ date: Date = Date()) -> String {
    let h = Calendar.current.component(.hour, from: date)
    return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
}

/// Track with a fill and an optional target tick (web ProgressBar plus marker).
private struct BandBar: View {
    let value: Double // 0...1
    var marker: Double? // 0...1
    var fill: Color = .brand
    var height: CGFloat = 8
    let label: String

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.surface2)
                Capsule().fill(fill).frame(width: max(0, min(1, value)) * g.size.width)
                if let marker {
                    Capsule().fill(Color.ink).frame(width: 2, height: height + 8)
                        .offset(x: min(max(marker * g.size.width - 1, 0), max(0, g.size.width - 2)))
                }
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

struct DashboardView: View {
    @Environment(APIClient.self) private var api
    @State private var progress: DashProgress?
    @State private var trends: [String: ProgressData] = [:]
    @State private var trendSkill = "speaking"
    @State private var due: DueResponse?
    @State private var lr: LrProgress?
    @State private var lrBusy = false
    @State private var lrStarted: String?
    @State private var error: String?
    @State private var targetDraft = 7.0

    private var target: Double { api.me?.settings.targetBand ?? 7 }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(spacing: 16) {
                if let p = progress {
                    header(p)
                    if let f = p.lastFailed { failedAlert(f) }
                    CommunityCard()
                    if p.attempts == 0 {
                        onboarding
                    } else {
                        nextUp(p)
                        predictedCard(p)
                        trendCard
                    }
                    MockEntryCard()
                    lrCard.id("lr")
                    practiseCard
                    if !p.topMistakes.isEmpty { mistakesCard(p.topMistakes) }
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn't load your dashboard", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await load() } }.primaryButton()
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .demoScroll()
        .task(id: lr?.trend.count) { // demo: bring the Listening & Reading section into view
            if Demo.screen == "dashboard-lr", lr != nil { try? await Task.sleep(for: .milliseconds(600)); proxy.scrollTo("lr", anchor: .top) }
        }
        }
        .background(Color.canvas)
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(); await api.loadQuota(force: true) }
        .task { await load() }
        .task { await api.loadQuota() }
        .onAppear { targetDraft = target }
        .navigationDestination(item: $lrStarted) { LrAttemptScreen(id: $0) }
    }

    // MARK: Listening and Reading (web LrInsights)

    @ViewBuilder private var lrCard: some View {
        if let d = lr, !d.trend.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Listening and Reading").font(.display(.title3)).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    NavigationLink(value: Route.history(skill: "listening")) { Text("All results").font(.subheadline.weight(.medium)).frame(minHeight: 44) }
                }
                ForEach(["listening", "reading"], id: \.self) { k in
                    let rows = d.trend.filter { $0.skill == k }
                    if let last = rows.last {
                        let name = k == "listening" ? "Listening" : "Reading"
                        HStack(alignment: .center, spacing: 16) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text("\(name), latest of \(rows.count)").font(.subheadline).foregroundStyle(.muted)
                                Text(fmt(last.band)).font(.system(size: 34, weight: .bold, design: .serif).monospacedDigit()).foregroundStyle(bandTextColor(last.band, target))
                                if rows.count > 1, let first = rows.first {
                                    let d = last.band - first.band
                                    Text(d == 0 ? "Same as your first" : "\(d > 0 ? "Up" : "Down") \(fmt(abs(d))) from your first").font(.caption).foregroundStyle(.muted)
                                }
                            }
                            Spacer(minLength: 8)
                            Chart {
                                RuleMark(y: .value("Target", target)).foregroundStyle(Color.line).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                                ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                                    LineMark(x: .value("Attempt", i), y: .value("Band", r.band)).foregroundStyle(Color.brand).interpolationMethod(.monotone)
                                    PointMark(x: .value("Attempt", i), y: .value("Band", r.band)).foregroundStyle(Color.brand).symbolSize(i == rows.count - 1 ? 50 : 18)
                                }
                            }
                            .chartYScale(domain: 0...9).chartXAxis(.hidden).chartYAxis(.hidden)
                            .frame(width: 150, height: 52)
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(name) band over \(rows.count) attempts, latest \(fmt(last.band)). Dashed line is your \(fmt(target)) target.")
                        }
                    }
                }
                Divider().overlay(Color.line)
                Text("Weakest question types").font(.headline).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
                if d.weakest.isEmpty {
                    Text("Your weak spots appear after a few more answered questions.").font(.subheadline).foregroundStyle(.muted)
                } else {
                    ForEach(d.weakest) { w in
                        let r = Double(w.right) / Double(max(1, w.total))
                        VStack(spacing: 6) {
                            HStack {
                                (Text(w.label).foregroundStyle(.ink) + Text(" (\(w.skill == "listening" ? "Listening" : "Reading"))").font(.caption).foregroundStyle(.muted)).font(.body)
                                Spacer(minLength: 8)
                                Text("\(Int((r * 100).rounded()))%").font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(r < 0.5 ? Color.bad : Color.warnText)
                            }
                            ProgressView(value: r).tint(r >= 0.75 ? .good : r >= 0.5 ? .warn : .bad)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(w.label), \(w.skill): \(w.right) of \(w.total) correct")
                    }
                }
                if let sg = d.suggested {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Suggested next test").font(.caption).foregroundStyle(.muted)
                            Text(sg.title).font(.body.weight(.medium)).foregroundStyle(.ink)
                            Text("\(sg.count) \(sg.label.lowercased()) questions").font(.caption).foregroundStyle(.muted)
                        }
                        Spacer(minLength: 8)
                        Button { Task { await startLr(sg.id) } } label: { if lrBusy { ProgressView() } else { Text("Practise") } }
                            .primaryButton().controlSize(.large).disabled(lrBusy)
                            .accessibilityLabel("Practise \(sg.title)")
                    }
                    .padding(12)
                    .background(Color.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .card()
        }
    }

    private func startLr(_ testId: String) async {
        lrBusy = true
        defer { lrBusy = false }
        if let a: LrAttempt = try? await api.send("POST", "/api/lr/tests/\(testId)/attempts", ["mode": "practice"]) { lrStarted = a.id }
    }

    private func load() async {
        do {
            async let p: DashProgress = api.get("/api/progress")
            async let d: DueResponse = api.get("/api/cards/due")
            async let sp: ProgressData = api.get("/api/progress", query: ["skill": "speaking"])
            async let wr: ProgressData = api.get("/api/progress", query: ["skill": "writing"])
            let first = progress == nil
            progress = try await p
            due = try? await d
            lr = try? await api.get("/api/lr/progress")
            var t: [String: ProgressData] = [:]
            t["speaking"] = try? await sp
            t["writing"] = try? await wr
            trends = t
            // Open on the skill that has a line to show (web: needs three scored attempts).
            if first {
                let has = { (s: String) in (t[s]?.trend.count ?? 0) >= 3 }
                trendSkill = has("speaking") || !has("writing") ? "speaking" : "writing"
            }
            error = nil
        } catch is CancellationError {
        } catch {
            if progress == nil { self.error = error.localizedDescription }
        }
    }

    // MARK: Header

    private func header(_ p: DashProgress) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            let first = api.me?.user.name.split(separator: " ").first.map(String.init)
            Text(greeting() + (first.map { ", \($0)" } ?? ""))
                .font(.display(.largeTitle, weight: .bold))
                .foregroundStyle(.ink)
                .accessibilityAddTraits(.isHeader)
            if p.attempts > 0 {
                HStack(spacing: 16) {
                    Label(p.streak > 0 ? "\(p.streak) \(p.streak == 1 ? "day" : "days") in a row" : "Practise today to start a streak", systemImage: "flame.fill")
                        .foregroundStyle(p.streak > 0 ? Color.warnText : Color.muted)
                    Text(p.minutesThisWeek < 1 ? "<1 min practised this week" : "\(Int(p.minutesThisWeek)) \(Int(p.minutesThisWeek) == 1 ? "minute" : "minutes") practised this week")
                }
                .font(.subheadline)
                .foregroundStyle(.muted)
            } else {
                Text("Welcome. Here is how to get your first score.").font(.subheadline).foregroundStyle(.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func failedAlert(_ f: DashProgress.Failed) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your last attempt couldn't be scored").font(.headline).foregroundStyle(.ink)
                    Text("Your answer is saved. Open it to retry the analysis.").font(.subheadline).foregroundStyle(.muted)
                }
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.warn)
            }
            NavigationLink(value: Route.result([f.id])) { Text("Open it").frame(minHeight: 28) }
                .secondaryButton()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.warn.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: Onboarding (no scored attempts yet)

    private var onboarding: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Get your first band")
            Text("Answer once and every criterion is scored against the public IELTS band descriptors, with each mistake marked where you made it.")
                .font(.subheadline).foregroundStyle(.muted)
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: "mic.fill").foregroundStyle(.brand).accessibilityHidden(true)
                Text("Speak for four minutes").font(.display(.title2))
                Text("Part 1 is everyday questions. You get fluency, vocabulary, grammar and pronunciation feedback, with your pauses timed.")
                    .font(.subheadline).foregroundStyle(.muted)
                NavigationLink(value: Route.speaking(.part(1))) {
                    Text("Start Speaking Part 1").frame(maxWidth: .infinity, minHeight: 28)
                }
                .primaryButton()
                .controlSize(.large)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: "pencil.line").foregroundStyle(.muted).accessibilityHidden(true)
                Text("Or write an essay").font(.display(.title3))
                Text("Task 2, 40 minutes, at least 250 words. Every mistake is underlined in your text with a correction.")
                    .font(.subheadline).foregroundStyle(.muted)
                NavigationLink(value: Route.writing(.task2)) {
                    Text("Start Writing Task 2").frame(maxWidth: .infinity, minHeight: 28)
                }
                .secondaryButton()
                .controlSize(.large)
            }
            .card(padding: 20)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Target band").font(.subheadline.weight(.medium))
                    Spacer()
                    Text(fmt(targetDraft)).font(.display(.title3).monospacedDigit()).foregroundStyle(.ink)
                }
                Slider(value: $targetDraft, in: 4...9, step: 0.5) { editing in
                    if !editing { Task { await saveTarget() } }
                }
                .accessibilityLabel("Target band")
                .accessibilityValue(fmt(targetDraft))
                Text("Scores at or above your target band show green. You can change it any time in Settings.")
                    .font(.caption).foregroundStyle(.muted)
            }
            .card()
        }
    }

    private func saveTarget() async {
        guard var s = api.me?.settings, s.targetBand != targetDraft else { return }
        s.targetBand = targetDraft
        do { try await api.saveSettings(s); error = nil } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    // MARK: Where you stand

    /// The one hero: what to practise next. The weakest criterion when known (at the part where the user scores lowest on it), else a full test.
    private func nextUp(_ p: DashProgress) -> some View {
        let weakest: ProgressData.Weakest? = p.weakest.flatMap { practiceDefault[$0.key] == nil ? nil : $0 }
        let practice = weakest.flatMap { practiceTarget($0.key, p.trend) }
        let partLabel = practice.map { ($0.skill == "speaking" ? "Part " : "Task ") + String($0.part) }
        let avg = weakest.map { ($0.avg * 2).rounded() / 2 } ?? 0
        let cta = weakest != nil && partLabel != nil ? "Practise \(partLabel!) (\(criterionShort[weakest!.key] ?? ""))" : "Start a full speaking test"
        let route: Route = {
            guard let practice else { return .speaking(.full) }
            if practice.skill == "writing" { return practice.part == 1 ? .writing(.task1(variant: "academic")) : .writing(.task2) }
            return .speaking(.part(practice.part))
        }()
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Next up").font(.caption.weight(.semibold)).foregroundStyle(.brand)
                Text(weakest.map { "\(Crit.label($0.key)) is holding your band back" } ?? "Ready for another round?")
                    .font(.display(.title2))
                    .foregroundStyle(.ink)
                if let weakest, let partLabel {
                    Text("You average \(fmt(avg)) here\(avg < target ? ", \(fmt(target - avg)) below your \(fmt(target)) target" : ""), and your lowest scores came in \(partLabel). Focused practice there moves it fastest.")
                        .font(.subheadline).foregroundStyle(.muted)
                        .accessibilityLabel("Weakest criterion \(Crit.label(weakest.key)). You average \(fmt(avg)) here.")
                } else {
                    Text("A full test gives the most complete picture of your band.").font(.subheadline).foregroundStyle(.muted)
                }
            }
            NavigationLink(value: route) {
                HStack { Text(cta); Image(systemName: "arrow.right").accessibilityHidden(true) }
                    .frame(maxWidth: .infinity, minHeight: 28)
            }
            .primaryButton()
            .controlSize(.large)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    /// Skill, and the part/task where the user's own scores on `key` are lowest (web practiceTarget).
    private func practiceTarget(_ key: String, _ trend: [DashProgress.Point]) -> (skill: String, part: Int)? {
        guard let d = practiceDefault[key] else { return nil }
        var byPart: [Int: [Double]] = [:]
        for t in trend where t.skill == d.skill {
            if let v = t.criteria[key], let part = t.part { byPart[part, default: []].append(v) }
        }
        let mean = { (a: [Double]) in a.reduce(0, +) / Double(max(1, a.count)) }
        let best = byPart.min { a, b in
            let (ma, mb) = (mean(a.value), mean(b.value))
            return ma != mb ? ma < mb : a.key < b.key
        }
        return (d.skill, best?.key ?? d.part)
    }

    private func predictedCard(_ p: DashProgress) -> some View {
        VStack(spacing: 0) {
            predictedRow("speaking", p.predicted.speaking, n: p.trend.filter { $0.skill == "speaking" }.count)
            Divider().padding(.vertical, 14)
            predictedRow("writing", p.predicted.writing, n: p.trend.filter { $0.skill == "writing" }.count)
        }
        .card()
    }

    /// One predicted band: label + bar + target on the left, the number on the right. With no scores the row holds the invitation and its action.
    private func predictedRow(_ skill: String, _ band: Double?, n: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let band {
                HStack(alignment: .center, spacing: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Predicted \(skill) band").font(.caption).foregroundStyle(.muted)
                        BandBar(value: band / 9, marker: target / 9, label: "\(skill.capitalized) band \(fmt(band)) of 9, target \(fmt(target))")
                        HStack(spacing: 8) {
                            Text("Target \(fmt(target))").font(.caption).foregroundStyle(.muted)
                            if band >= target { Chip(text: "On target", color: .goodText) } else { Chip(text: "\(fmt(target - band)) to go", color: .muted) }
                        }
                    }
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(fmt(band)).font(.display(.largeTitle, weight: .bold).monospacedDigit()).foregroundStyle(.ink)
                        Text(n > 1 ? "Avg of last \(min(n, 5))" : "Latest score").font(.caption).foregroundStyle(.muted)
                    }
                    .accessibilityElement(children: .combine)
                }
            } else {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Predicted \(skill) band").font(.caption).foregroundStyle(.muted)
                        Text("No \(skill) scores yet.").font(.subheadline)
                    }
                    Spacer()
                    NavigationLink(value: skill == "speaking" ? Route.speaking(.part(1)) : Route.writing(.task2)) {
                        Text(skill == "speaking" ? "Try Part 1" : "Try Task 2").frame(minHeight: 28)
                    }
                    .secondaryButton()
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: Band by criterion

    private var trendCard: some View {
        let rows = trends[trendSkill]?.trend ?? []
        let keys = Crit.order(trendSkill)
        return VStack(alignment: .leading, spacing: 14) {
            Text("Band by criterion").font(.display(.title3)).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
            Picker("Skill", selection: $trendSkill) {
                Text("Speaking").tag("speaking")
                Text("Writing").tag("writing")
            }
            .pickerStyle(.segmented)
            if rows.isEmpty {
                Text("Your \(trendSkill) criteria appear after your first scored attempt.").font(.subheadline).foregroundStyle(.muted).padding(.vertical, 12)
            } else if rows.count < 3 {
                // A line needs three points to say anything: until then show the latest attempt's bands side by side.
                let latest = rows.last?.criteria ?? [:]
                ForEach(keys, id: \.self) { k in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(Crit.label(k)).font(.subheadline)
                            Spacer()
                            Text(latest[k].map { fmt($0) } ?? "–").font(.display(.headline).monospacedDigit())
                        }
                        BandBar(value: (latest[k] ?? 0) / 9, marker: target / 9, label: "\(Crit.label(k)) band \(latest[k].map { fmt($0) } ?? "none") of 9")
                    }
                    .accessibilityElement(children: .combine)
                }
                Text("From your latest \(trendSkill) attempt; the marker is your \(fmt(target)) target. The trend line appears after three scored attempts.")
                    .font(.caption).foregroundStyle(.muted)
            } else {
                trendChart(rows, keys)
            }
        }
        .card()
    }

    private func trendChart(_ rows: [ProgressData.TrendPoint], _ keys: [String]) -> some View {
        let all = rows.flatMap { $0.criteria.values }
        let lo = max(0, min(floor(all.min() ?? 0), target) - 0.5)
        let ticks = stride(from: ceil(lo), through: 9, by: 1).map { $0 }
        return Chart {
            ForEach(Array(rows.enumerated()), id: \.offset) { i, point in
                ForEach(keys, id: \.self) { k in
                    if let v = point.criteria[k] {
                        LineMark(x: .value("Attempt", i + 1), y: .value("Band", v))
                            .foregroundStyle(by: .value("Criterion", Crit.label(k)))
                            .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round, dash: seriesDashed(k) ? [5, 3] : []))
                            .interpolationMethod(.monotone)
                    }
                }
            }
            RuleMark(y: .value("Target", target))
                .foregroundStyle(Color.muted)
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [2, 4]))
                .annotation(position: .top, alignment: .trailing) {
                    Text("Target \(fmt(target))").font(.caption2).foregroundStyle(.muted)
                }
        }
        .chartForegroundStyleScale(domain: keys.map { Crit.label($0) }, range: keys.map { seriesColor($0) })
        .chartYScale(domain: lo...9)
        .chartYAxis { AxisMarks(values: ticks) }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 5)) { value in
                AxisGridLine()
                AxisValueLabel { if let i = value.as(Int.self) { Text("#\(i)") } }
            }
        }
        .chartLegend(position: .bottom, alignment: .leading, spacing: 12)
        .frame(height: 240)
        .accessibilityLabel("Band trend over your last \(rows.count) attempts, oldest first")
    }

    // MARK: Practise

    private var practiseCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Practise").padding(.bottom, 4)
            practiseRow("Full speaking test", "11-14 min, all three parts", "mic", .speaking(.full))
            Divider()
            practiseRow("Live examiner", "A spoken conversation with an AI examiner", "bubble.left.and.bubble.right", .live)
            Divider()
            practiseRow("Task 2 essay", "40 min, at least 250 words", "pencil.line", .writing(.task2))
            Divider()
            practiseRow("Listening test", "Four recordings, 40 questions", "headphones", .lrHub(skill: "listening"))
            Divider()
            practiseRow("Reading test", "Three passages, 40 questions, 60 min", "book", .lrHub(skill: "reading"))
            Divider()
            practiseRow("Review deck", reviewMeta, "rectangle.on.rectangle.angled", .review, badge: (due?.dueTotal ?? 0) > 0 ? "\(due?.dueTotal ?? 0) due" : nil)
            Divider().padding(.bottom, 4)
            // One row when it fits without wrapping; a vertical list on narrow or large-text screens.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 16) { footerLinks }
                VStack(alignment: .leading, spacing: 0) { footerLinks }
            }
        }
        .card()
    }

    @ViewBuilder private var footerLinks: some View {
        footerLink("Prompt bank", "books.vertical", .bank(skill: ""))
        footerLink("Past attempts", "clock.arrow.circlepath", .history(skill: nil))
        footerLink("Mistakes", "exclamationmark.triangle", .mistakes(category: nil))
    }

    private var reviewMeta: String {
        guard let due else { return "Nothing due today" }
        if due.dueTotal > 0 { return "A few minutes keeps corrections from slipping" }
        if due.deck == 0 { return "Add corrections from Mistakes to start your deck" }
        return due.deck != nil ? "All caught up for today" : "Nothing due today"
    }

    private func practiseRow(_ title: String, _ meta: String, _ icon: String, _ route: Route, badge: String? = nil) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.body).foregroundStyle(.muted).frame(width: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body).foregroundStyle(.ink)
                    Text(meta).font(.caption).foregroundStyle(.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                if let badge { Chip(text: badge, color: .brand) }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func footerLink(_ title: String, _ icon: String, _ route: Route) -> some View {
        NavigationLink(value: route) {
            Label(title, systemImage: icon).font(.subheadline.weight(.medium)).foregroundStyle(.brand).lineLimit(1).fixedSize(horizontal: true, vertical: false).frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }

    // MARK: Recurring mistakes

    private func mistakesCard(_ m: [ProgressData.CategoryCount]) -> some View {
        let most = Double(max(1, m.map(\.count).max() ?? 1))
        return VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Recurring mistakes")
            Text("Last 30 days").font(.caption).foregroundStyle(.muted).padding(.bottom, 8)
            ForEach(m, id: \.category) { c in
                NavigationLink(value: Route.mistakes(category: c.category)) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(shellCategoryLabel(c.category)).font(.body).foregroundStyle(.ink).multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            Text("\(c.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.muted)
                        }
                        BandBar(value: Double(c.count) / most, fill: .muted, height: 4, label: "\(shellCategoryLabel(c.category)): \(c.count)")
                    }
                    .padding(.vertical, 8)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            NavigationLink(value: Route.mistakes(category: nil)) {
                Label("Open error log", systemImage: "arrow.right").font(.subheadline.weight(.medium)).foregroundStyle(.brand).frame(minHeight: 44)
            }
            .buttonStyle(.plain)
        }
        .card()
    }
}
