import SwiftUI

/// Every attempt, newest first, 30 per page (GET /api/attempts).
struct HistoryView: View {
    @Environment(APIClient.self) private var api
    @State private var skill: String // "" = all
    init(skill: String = "") { _skill = State(initialValue: skill) }
    @State private var items: [AttemptListItem] = []
    @State private var total = 0
    @State private var page = 1
    @State private var loading = true
    @State private var error: String?

    private var target: Double { api.me?.settings.targetBand ?? 7 }

    var body: some View {
        List {
            Section {
                Picker("Skill", selection: $skill) {
                    Text("All").tag("")
                    Text("Speaking").tag("speaking")
                    Text("Writing").tag("writing")
                }
                .pickerStyle(.segmented)
            } footer: {
                if total > 0 { Text("\(total) attempt\(total == 1 ? "" : "s")") }
            }
            if let error { Section { ErrorLine(message: error) } }
            Section {
                ForEach(items) { a in
                    NavigationLink(value: Route.result([a.id])) { AttemptRow(a: a, target: target) }
                        .onAppear { if a.id == items.last?.id && items.count < total { Task { await load(reset: false) } } }
                }
                if loading { ProgressView().frame(maxWidth: .infinity) }
            }
        }
        .overlay {
            if !loading && items.isEmpty && error == nil {
                ContentUnavailableView("No attempts yet", systemImage: "clock.arrow.circlepath",
                                       description: Text("Every answer you record and essay you submit shows up here with its band."))
            }
        }
        .navigationTitle("History")
        .refreshable { await load(reset: true) }
        .task(id: skill) { await load(reset: true) }
    }

    private func load(reset: Bool) async {
        guard reset || !loading else { return }
        if reset { page = 1 }
        loading = true
        defer { loading = false }
        do {
            let p: AttemptPage = try await api.get("/api/attempts", query: ["skill": skill.isEmpty ? nil : skill, "page": String(page)])
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

/// One attempt: skill icon, prompt, part · date, band or status.
struct AttemptRow: View {
    let a: AttemptListItem
    let target: Double

    private var status: (String, Color) {
        switch a.status {
        case "recording": ("Not submitted", Color.secondary)
        case "analyzing": ("Scoring…", Color.brand)
        case "failed": ("Failed", Color.bad)
        default: (a.status.capitalized, Color.secondary)
        }
    }

    var body: some View {
        HStack {
            Image(systemName: a.skill == "speaking" ? "mic" : "pencil").foregroundStyle(.secondary).frame(width: 24)
                .accessibilityLabel(a.skill.capitalized)
            VStack(alignment: .leading) {
                Text(a.promptTitle).lineLimit(1)
                Text("\(a.skill == "speaking" ? "Part" : "Task") \(a.part) · \(a.createdAt.prefix(10))").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if let o = a.overall, a.status == "done" { BandPill(band: o, target: target) } else { Chip(text: status.0, color: status.1) }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
