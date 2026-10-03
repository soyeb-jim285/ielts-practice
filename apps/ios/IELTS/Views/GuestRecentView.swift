import SwiftUI

/// "Your recent tests" for a guest (web components/dashboard/GuestRecent.tsx). Guests have no History screen; the server caps their
/// GET /api/attempts at 10 and GET /api/lr/attempts is theirs only. Shows up to 5, newest first; renders nothing for an account or when empty.
struct GuestRecentView: View {
    @Environment(APIClient.self) private var api
    /// "" = every skill (Home), or speaking | writing | listening | reading for that hub.
    var skill = ""
    @State private var rows: [Row] = []
    @State private var removing: RemovalTarget?

    struct Row: Identifiable {
        let id: String
        let skill: String
        let title: String
        let part: String
        let mode: String
        let at: String
        let band: Double?
        let state: String // done | open | scoring | failed
    }
    private struct Page: Decodable { let items: [AttemptListItem] }
    private struct LrPage: Decodable { let items: [LrAttemptItem] }

    var body: some View {
        if api.isGuest {
            content.task(id: skill) { await load() }
                .confirmRemoval($removing) { t in Task { await remove(t) } }
        }
    }

    @ViewBuilder private var content: some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle("Your recent tests")
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                        if i > 0 { Divider().padding(.leading, 52) }
                        NavigationLink(value: r.skill == "listening" || r.skill == "reading" ? Route.lrAttempt(id: r.id) : Route.result([r.id])) { row(r) }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(role: .destructive) { removing = RemovalTarget(id: r.id, title: r.title, lr: r.skill == "listening" || r.skill == "reading") } label: { Label("Remove from history", systemImage: "trash") }
                            }
                            .accessibilityAction(named: "Remove from history") { removing = RemovalTarget(id: r.id, title: r.title, lr: r.skill == "listening" || r.skill == "reading") }
                    }
                }
                .background(Color.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text("These live on this device only. Create an account to keep them and unlock full History.")
                    .font(.footnote).foregroundStyle(.muted)
                Button("Create account") { api.requestSignIn("Create an account to keep your tests and unlock full History.", signUp: true) }
                    .secondaryButton().controlSize(.regular).frame(minHeight: 44)
            }
        }
    }

    private func row(_ r: Row) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: r.skill == "speaking" ? "mic" : r.skill == "listening" ? "headphones" : r.skill == "reading" ? "book" : "pencil")
                .foregroundStyle(.muted).frame(width: 24).padding(.top, 2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(r.title).font(.body.weight(.medium)).foregroundStyle(.ink).lineLimit(2).multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Chip(text: r.mode == "practice" ? "Practice" : r.mode == "live" ? "Live" : "Exam", color: r.mode == "practice" ? .muted : .brand)
                    Text("\(r.part), \(ShellDate.date(r.at))").font(.caption).foregroundStyle(.muted)
                }
            }
            Spacer(minLength: 8)
            switch r.state {
            case "open": Chip(text: "In progress, resume", color: .warnText)
            case "scoring": Chip(text: "Scoring", color: .brand)
            case "failed": Chip(text: "Scoring failed", color: .bad)
            default:
                if let b = r.band {
                    Text(Band.format(b)).font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(.ink).accessibilityLabel("Band \(Band.format(b))")
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func remove(_ t: RemovalTarget) async {
        withAnimation { rows.removeAll { $0.id == t.id } }
        try? await AttemptRemoval.remove(api, id: t.id, lr: t.lr)
        await load() // a refused delete brings the row back
    }

    private func load() async {
        var out: [Row] = []
        let sp = skill == "speaking" || skill == "writing"
        if skill.isEmpty || sp, let p: Page = try? await api.get("/api/attempts", query: ["skill": sp ? skill : nil]) {
            out += p.items.map { Row(id: $0.id, skill: $0.skill, title: $0.promptTitle, part: "\($0.skill == "speaking" ? "Part" : "Task") \($0.part)", mode: $0.mode, at: $0.createdAt, band: $0.overall,
                                     state: $0.status == "done" ? "done" : $0.status == "recording" ? "open" : $0.status == "failed" ? "failed" : "scoring") }
        }
        if skill.isEmpty || skill == "listening" || skill == "reading", let p: LrPage = try? await api.get("/api/lr/attempts") {
            out += p.items.filter { skill.isEmpty || $0.skill == skill }.map {
                Row(id: $0.id, skill: $0.skill, title: $0.title, part: $0.skill == "listening" ? "Listening" : "Reading", mode: $0.mode, at: $0.startedAt, band: $0.band, state: $0.status == "submitted" ? "done" : "open")
            }
        }
        rows = Array(out.sorted { (ShellDate.parse($0.at) ?? .distantPast) > (ShellDate.parse($1.at) ?? .distantPast) }.prefix(5))
    }
}
