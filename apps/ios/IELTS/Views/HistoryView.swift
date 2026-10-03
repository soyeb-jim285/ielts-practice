import SwiftUI

/// Date helpers for the shell screens (web lib/format.ts and components/bank/group.ts).
enum ShellDate {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()
    private static let short: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "d MMM yyyy"
        return f
    }()
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        f.dateTimeStyle = .named
        return f
    }()

    static func parse(_ s: String) -> Date? { fractional.date(from: s) ?? plain.date(from: s) }

    /// "30 Sep 2026".
    static func date(_ s: String) -> String { parse(s).map { short.string(from: $0) } ?? String(s.prefix(10)) }

    /// "yesterday", "3 days ago".
    static func relative(_ s: String) -> String { parse(s).map { relativeFormatter.localizedString(for: $0, relativeTo: Date()) } ?? String(s.prefix(10)) }

    /// Recency bucket for newest-first lists: Today, Yesterday, Past 7 days, Past 30 days, Older.
    static func bucket(_ s: String, now: Date = Date()) -> String {
        guard let d = parse(s) else { return "Older" }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: now)).day ?? 0
        return days <= 0 ? "Today" : days == 1 ? "Yesterday" : days < 7 ? "Past 7 days" : days < 30 ? "Past 30 days" : "Older"
    }

    /// 95_000 ms -> "1m 35s", 42_000 -> "42s", 3_900_000 -> "1h 5m".
    static func duration(_ ms: Int) -> String {
        let s = Int((Double(ms) / 1000).rounded())
        if s < 60 { return "\(s)s" }
        let h = s / 3600, m = (s % 3600) / 60
        if h > 0 { return "\(h)h" + (m > 0 ? " \(m)m" : "") }
        return "\(m)m" + (s % 60 > 0 ? " \(s % 60)s" : "")
    }
}

/// One row of GET /api/attempts. Local so it can read `durationMs` and `flag` when the server sends them.
private struct HistoryItem: Decodable, Identifiable {
    let id: String
    let promptTitle: String
    let skill: String
    let part: Int
    let status: String // recording | analyzing | done | failed
    let overall: Double?
    let createdAt: String
    let durationMs: Int?
    let flag: String? // offTopic | tooShort
    /// Listening & Reading attempts (GET /api/lr/attempts) share the list; they open the L/R runner or result.
    var lr = false
    var lrDetail: String? = nil
    enum CodingKeys: String, CodingKey { case id, promptTitle, skill, part, status, overall, createdAt, durationMs, flag }

    /// Editor time under a minute is a pasted or abandoned essay, not a meaningful duration; speaking recordings are short by design.
    var shownDuration: String? {
        guard let ms = durationMs, ms > 0, skill == "speaking" || ms >= 60_000 else { return nil }
        return ShellDate.duration(ms)
    }
}

private struct HistoryPage: Decodable { let items: [HistoryItem]; let total: Int }
private struct LrHistoryPage: Decodable { let items: [LrAttemptItem] }

private extension HistoryItem {
    init(_ a: LrAttemptItem) {
        self.init(id: a.id, promptTitle: a.title, skill: a.skill, part: 0, status: a.status == "submitted" ? "done" : "recording", overall: a.band,
                  createdAt: a.submittedAt ?? a.startedAt, durationMs: nil, flag: nil, lr: true,
                  lrDetail: [a.mode.capitalized, a.raw.map { "\($0)/\(a.total ?? 40)" }].compactMap { $0 }.joined(separator: ", "))
    }
}

/// Every attempt, newest first, grouped by day bucket, 30 per page (GET /api/attempts).
struct HistoryView: View {
    @Environment(APIClient.self) private var api
    @State private var skill: String // "" = all
    init(skill: String = "") { _skill = State(initialValue: skill) }
    @State private var items: [HistoryItem] = []
    @State private var total = 0
    @State private var lrItems: [HistoryItem] = []
    @State private var page = 1
    @State private var loading = true
    @State private var error: String?

    private var target: Double { api.me?.settings.targetBand ?? 7 }
    private var hasLr: Bool { api.me?.cambridgeAccess == true }
    private var lrOnly: Bool { skill == "listening" || skill == "reading" }

    /// What the list shows: speaking/writing pages merged with the Listening & Reading attempts (newest first) once those are in range.
    private var shown: [HistoryItem] {
        if lrOnly { return lrItems.filter { $0.skill == skill } }
        guard skill.isEmpty, hasLr else { return items }
        let oldest = items.count < total ? items.last.flatMap { ShellDate.parse($0.createdAt) } : nil
        let extra = lrItems.filter { oldest == nil || (ShellDate.parse($0.createdAt) ?? .distantFuture) >= oldest! }
        return (items + extra).sorted { (ShellDate.parse($0.createdAt) ?? .distantPast) > (ShellDate.parse($1.createdAt) ?? .distantPast) }
    }

    private struct DayGroup: Identifiable {
        let key: String
        let items: [HistoryItem]
        var id: String { key + (items.first?.id ?? "") }
    }

    /// Consecutive runs that share a bucket, so a page boundary never splits a heading.
    private var groups: [DayGroup] {
        var out: [(key: String, items: [HistoryItem])] = []
        for a in shown {
            let k = ShellDate.bucket(a.createdAt)
            if out.last?.key == k { out[out.count - 1].items.append(a) } else { out.append((k, [a])) }
        }
        return out.map { DayGroup(key: $0.key, items: $0.items) }
    }

    var body: some View {
        List {
            Section {
                Picker("Skill", selection: $skill) {
                    Text("All").tag("")
                    Text("Speaking").tag("speaking")
                    Text("Writing").tag("writing")
                    if hasLr {
                        Text("Listening").tag("listening")
                        Text("Reading").tag("reading")
                    }
                }
                .pickerStyle(.segmented)
            } footer: {
                Text(shown.count > 0 ? "\(shown.count) \(shown.count == 1 ? "attempt" : "attempts"), newest first" : "Every answer you record and essay you submit.")
            }
            if let error {
                Section {
                    ErrorLine(message: error)
                    Button("Try again") { Task { await load(reset: true) } }
                }
            }
            ForEach(groups) { g in
                Section {
                    ForEach(g.items) { a in
                        NavigationLink(value: a.lr ? Route.lrAttempt(id: a.id) : Route.result([a.id])) { HistoryRow(a: a, target: target) }
                            .listRowBackground(Color.surface)
                            .onAppear { if a.id == items.last?.id && items.count < total { Task { await load(reset: false) } } }
                    }
                } header: {
                    Text(g.key).textCase(nil)
                }
            }
            if loading && !items.isEmpty {
                Section { ProgressView().frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
            }
        }
        .canvasList()
        .demoScroll()
        .overlay {
            if loading && items.isEmpty {
                ProgressView()
            } else if shown.isEmpty && error == nil {
                ContentUnavailableView {
                    Label(skill.isEmpty ? "Nothing practised yet" : "No \(skill) attempts yet", systemImage: "clock.arrow.circlepath")
                } description: {
                    Text("Each answer you record and essay you submit is listed here with its band, newest first, so you can see the trend.")
                } actions: {
                    NavigationLink(value: lrOnly ? Route.lrHub(skill: skill) : skill == "writing" ? Route.writing(.task2) : Route.speaking(.full)) { Text("Start practising") }
                        .primaryButton()
                }
                .padding(.top, 80)
            }
        }
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(reset: true) }
        .task(id: skill) { await load(reset: true) }
    }

    private func load(reset: Bool) async {
        guard reset || !loading else { return }
        if reset { page = 1 }
        loading = true
        defer { loading = false }
        if reset, hasLr, skill.isEmpty || lrOnly, let r: LrHistoryPage = try? await api.get("/api/lr/attempts") { lrItems = r.items.map(HistoryItem.init) }
        if lrOnly { items = []; total = 0; error = nil; return }
        do {
            let p: HistoryPage = try await api.get("/api/attempts", query: ["skill": skill.isEmpty ? nil : skill, "page": String(page)])
            items = reset ? p.items : items + p.items
            total = p.total
            page += 1
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
            total = items.count // stop auto-paging until refresh
        }
    }
}

/// One attempt: skill icon, prompt, status or flag badge, part, date and duration, then the band.
private struct HistoryRow: View {
    let a: HistoryItem
    let target: Double

    private var status: (label: String, color: Color)? {
        switch a.status {
        case "recording": ("Not submitted", Color.warnText)
        case "analyzing": ("Scoring", Color.brand)
        case "failed": ("Scoring failed", Color.bad)
        default: nil
        }
    }

    private var flag: String? {
        switch a.flag {
        case "offTopic": "Off topic"
        case "tooShort": "Under length"
        default: nil
        }
    }

    private var meta: String {
        [a.lr ? a.lrDetail : "\(a.skill == "speaking" ? "Part" : "Task") \(a.part)", ShellDate.date(a.createdAt), a.shownDuration].compactMap { $0 }.joined(separator: ", ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: a.skill == "speaking" ? "mic" : a.skill == "listening" ? "headphones" : a.skill == "reading" ? "book" : "pencil").foregroundStyle(.muted).frame(width: 24).padding(.top, 2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(a.promptTitle).font(.body.weight(.medium)).lineLimit(2)
                if let status {
                    Chip(text: status.label, color: status.color)
                } else if let flag {
                    Chip(text: flag, color: .warnText)
                }
                Text(meta).font(.caption).foregroundStyle(.muted)
            }
            Spacer(minLength: 8)
            if status == nil, let o = a.overall {
                if o == 0 {
                    Text("No speech").font(.caption).foregroundStyle(.muted)
                } else {
                    Text(fmt(o)).font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(bandTextColor(o, target))
                        .accessibilityLabel("Band \(fmt(o))")
                }
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
