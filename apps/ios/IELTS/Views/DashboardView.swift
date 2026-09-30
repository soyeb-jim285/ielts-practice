import Charts
import SwiftUI

struct DashboardView: View {
    @Environment(APIClient.self) private var api
    @State private var progress: ProgressData?
    @State private var trend: ProgressData?
    @State private var trendSkill = "speaking"
    @State private var recent: [AttemptListItem] = []
    @State private var dueCount = 0
    @State private var error: String?

    private var target: Double { api.me?.settings.targetBand ?? 7 }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                header
                if let error { ErrorLine(message: error).card() }
                if let p = progress {
                    if p.attempts == 0 { onboarding } else {
                        predicted(p)
                        trendCard
                        if let w = p.weakest { weakest(w) }
                        if !p.topMistakes.isEmpty { mistakes(p.topMistakes) }
                    }
                }
                quickStart
                if dueCount > 0 {
                    Label("\(dueCount) review card\(dueCount == 1 ? "" : "s") due — open the Review tab.", systemImage: "rectangle.on.rectangle.angled")
                        .card()
                }
                if !recent.isEmpty { recentCard }
            }
            .padding()
        }
        .background(.canvas)
        .navigationTitle("Home")
        .refreshable { await load() }
        .task { await load() }
        .task(id: trendSkill) { trend = try? await api.get("/api/progress", query: ["skill": trendSkill]) }
    }

    private func load() async {
        error = nil
        do {
            async let p: ProgressData = api.get("/api/progress")
            async let r: ListOf<AttemptListItem> = api.get("/api/attempts", query: ["page": "1"])
            async let d: ListOf<ReviewCard> = api.get("/api/cards/due")
            progress = try await p
            recent = Array(try await r.items.prefix(8))
            dueCount = (try? await d.items.count) ?? 0
            trend = try? await api.get("/api/progress", query: ["skill": trendSkill])
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Hi, \(api.me?.user.name.split(separator: " ").first.map(String.init) ?? "there")").font(.title.bold())
            if let p = progress {
                HStack(spacing: 16) {
                    Label("\(p.streak)-day streak", systemImage: "flame.fill").foregroundStyle(p.streak > 0 ? Color.warn : Color.secondary)
                    Label("\(Int(p.minutesThisWeek)) min this week", systemImage: "clock")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var onboarding: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Get started")
            step(1, "Set your target band", "Settings › Target band (now \(Band.format(target))).")
            NavigationLink(value: Route.speaking(.part(1))) { step(2, "Try a Part 1 interview", "Short answers about familiar topics.") }
            NavigationLink(value: Route.writing(.task2)) { step(3, "Write a Task 2 essay", "40 minutes, at least 250 words.") }
        }
        .buttonStyle(.plain)
        .card()
    }

    private func step(_ n: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)").font(.headline).frame(width: 30, height: 30).background(.brand.opacity(0.15), in: Circle()).foregroundStyle(.brand)
            VStack(alignment: .leading) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .contentShape(Rectangle())
    }

    private func predicted(_ p: ProgressData) -> some View {
        HStack(spacing: 12) {
            predictedCard("Speaking", p.predicted.speaking)
            predictedCard("Writing", p.predicted.writing)
        }
    }

    private func predictedCard(_ name: String, _ band: Double?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Predicted \(name)").font(.subheadline).foregroundStyle(.secondary)
            Text(band.map(Band.format) ?? "—")
                .font(.system(size: 40, weight: .bold, design: .rounded))
                .foregroundStyle(band.map { bandColor($0, target) } ?? Color.secondary)
            Text("Target \(Band.format(target))").font(.caption).foregroundStyle(.secondary)
        }
        .card()
    }

    private var trendCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionTitle("Band trend")
                Picker("Skill", selection: $trendSkill) {
                    Text("Speaking").tag("speaking")
                    Text("Writing").tag("writing")
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 200)
            }
            if let t = trend, !t.trend.isEmpty {
                Chart {
                    ForEach(Array(t.trend.enumerated()), id: \.offset) { i, point in
                        ForEach(Crit.order(trendSkill), id: \.self) { k in
                            if let v = point.criteria[k] {
                                LineMark(x: .value("Attempt", i + 1), y: .value("Band", v))
                                    .foregroundStyle(by: .value("Criterion", Crit.label(k)))
                                    .interpolationMethod(.monotone)
                            }
                        }
                    }
                    RuleMark(y: .value("Target", target)).foregroundStyle(.good.opacity(0.6)).lineStyle(StrokeStyle(dash: [4, 4]))
                }
                .chartYScale(domain: 0...9)
                .frame(height: 200)
            } else {
                Text("No \(trendSkill) attempts yet.").foregroundStyle(.secondary)
            }
        }
        .card()
    }

    private func weakest(_ w: ProgressData.Weakest) -> some View {
        let speaking = ["fc", "p"].contains(w.key)
        return NavigationLink(value: speaking ? Route.speaking(.part(3)) : Route.writing(.task2)) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your weakest area").font(.subheadline).foregroundStyle(.secondary)
                    Text("\(Crit.label(w.key)) (\(Band.format(Band.round(w.avg))))").font(.headline)
                    Text(speaking ? "Practice: Part 3 discussion" : "Practice: Task 2 essay").font(.subheadline).foregroundStyle(.brand)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .card()
        }
        .buttonStyle(.plain)
    }

    private func mistakes(_ m: [ProgressData.CategoryCount]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Recurring mistakes")
            ForEach(m, id: \.category) { c in
                HStack {
                    Text(categoryLabel(c.category))
                    Spacer()
                    Text("\(c.count)").monospacedDigit().foregroundStyle(.secondary)
                }
            }
        }
        .card()
    }

    private var quickStart: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("Quick start")
            quick("Full speaking test", "mic.fill", .speaking(.full))
            quick("Live examiner", "person.wave.2.fill", .live)
            quick("Task 2 essay", "pencil.line", .writing(.task2))
            quick("Prompt bank", "books.vertical", .bank(skill: "speaking"))
        }
        .card()
    }

    private func quick(_ title: String, _ icon: String, _ route: Route) -> some View {
        NavigationLink(value: route) {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var recentCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Recent attempts")
            ForEach(recent) { a in
                NavigationLink(value: Route.result([a.id])) {
                    HStack {
                        Image(systemName: a.skill == "speaking" ? "mic" : "pencil").foregroundStyle(.secondary).frame(width: 24)
                        VStack(alignment: .leading) {
                            Text(a.promptTitle).lineLimit(1)
                            Text("\(a.skill == "speaking" ? "Part" : "Task") \(a.part) · \(a.createdAt.prefix(10))").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let o = a.overall { BandPill(band: o, target: target) } else { Chip(text: a.status.capitalized) }
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .card()
    }
}
