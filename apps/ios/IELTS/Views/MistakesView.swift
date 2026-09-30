import SwiftUI

/// Error log: every correction from results, filterable by category, 30 per page (GET /api/mistakes).
struct MistakesView: View {
    @State var category: String?

    @Environment(APIClient.self) private var api
    @State private var groups: [ProgressData.CategoryCount] = []
    @State private var items: [Mistake] = []
    @State private var total = 0
    @State private var page = 1
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if !groups.isEmpty { chips }
                if let error { ErrorLine(message: error).card() }
                ForEach($items) { $m in
                    MistakeRow(m: $m, showCategory: category == nil)
                        .onAppear { if m.id == items.last?.id && items.count < total { Task { await load(reset: false) } } }
                }
                if loading { ProgressView().padding() }
            }
            .padding()
        }
        .overlay {
            if !loading && groups.isEmpty && error == nil {
                ContentUnavailableView("Your error log is empty", systemImage: "exclamationmark.triangle",
                                       description: Text("Grammar slips, word choices and cohesion issues from your results collect here, so you can spot the ones that keep coming back."))
            }
        }
        .background(.canvas)
        .navigationTitle("Mistakes")
        .refreshable { await load(reset: true) }
        .task(id: category) { await load(reset: true) }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", groups.reduce(0) { $0 + $1.count }, nil)
                ForEach(groups, id: \.category) { chip(categoryLabel($0.category), $0.count, $0.category) }
            }
        }
        .accessibilityLabel("Filter by category")
    }

    private func chip(_ label: String, _ count: Int, _ value: String?) -> some View {
        let on = category == value
        return Button { category = value } label: {
            Text("\(label) \(Text("\(count)").monospacedDigit().foregroundStyle(on ? .white.opacity(0.8) : .secondary))")
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 12).padding(.vertical, 6)
                .foregroundStyle(on ? .white : .primary)
                .background(on ? Color.brand : Color.surface, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func load(reset: Bool) async {
        guard reset || !loading else { return }
        if reset { page = 1 }
        loading = true
        defer { loading = false }
        do {
            let log: MistakeLog = try await api.get("/api/mistakes", query: ["category": category, "page": String(page)])
            groups = log.groups
            items = reset ? log.items : items + log.items
            total = log.total
            page += 1
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
            total = items.count // stop auto-paging until refresh
        }
    }
}

/// original → correction, explanation, where it happened, "Add to deck".
private struct MistakeRow: View {
    @Binding var m: Mistake
    let showCategory: Bool

    @Environment(APIClient.self) private var api
    @State private var adding = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if showCategory { Chip(text: categoryLabel(m.category)) }
            Text("\(Text(m.original).strikethrough().foregroundStyle(.bad))  \(Image(systemName: "arrow.right"))  \(Text(m.correction).fontWeight(.medium).foregroundStyle(.good))")
                .font(.body)
                .accessibilityLabel("\(m.original), corrected to \(m.correction)")
            Text(m.explanation).font(.subheadline).foregroundStyle(.secondary)
            if let error { ErrorLine(message: error) }
            Divider()
            HStack {
                NavigationLink(value: Route.result([m.attemptId])) {
                    Text("\(Text(m.promptTitle).foregroundStyle(.brand)) · \(place) · \(m.createdAt.prefix(10))")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .buttonStyle(.plain)
                Spacer()
                Button { Task { await add() } } label: {
                    if adding { ProgressView() } else { Label(m.inDeck ? "In deck" : "Add to deck", systemImage: m.inDeck ? "checkmark" : "plus") }
                }
                .font(.subheadline.weight(.medium))
                .buttonStyle(.borderless)
                .disabled(m.inDeck || adding)
            }
        }
        .card()
    }

    private var place: String {
        (m.skill == "speaking" ? "Speaking Part \(m.part)" : "Writing Task \(m.part)") + (m.time.map { " at \(clock(Int($0)))" } ?? "")
    }

    private func add() async {
        adding = true
        defer { adding = false }
        do {
            let _: Empty = try await api.send("POST", "/api/mistakes/\(m.id)/card")
            m.inDeck = true
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
