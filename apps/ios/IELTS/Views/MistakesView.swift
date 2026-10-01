import SwiftUI

/// "grammar.article" -> "Grammar: article" (web lib/result.ts categoryLabel).
func shellCategoryLabel(_ c: String) -> String { categoryLabel(c) }

/// Error log: every correction from results, grouped by attempt, filterable by category, 30 per page (GET /api/mistakes).
struct MistakesView: View {
    @State var category: String?

    @Environment(APIClient.self) private var api
    @State private var groups: [ProgressData.CategoryCount] = []
    @State private var items: [Mistake] = []
    @State private var total = 0
    @State private var page = 1
    @State private var loading = true
    @State private var error: String?
    @State private var toast: String?
    @State private var toastTask: Task<Void, Never>?

    private struct AttemptGroup: Identifiable {
        let first: Mistake
        let items: [Mistake]
        var id: String { first.id }
    }

    /// One block per attempt: its prompt is named once, the corrections from it follow.
    private var attemptGroups: [AttemptGroup] {
        var out: [[Mistake]] = []
        for m in items {
            if let last = out.last?.first, last.attemptId == m.attemptId { out[out.count - 1].append(m) } else { out.append([m]) }
        }
        return out.map { AttemptGroup(first: $0[0], items: $0) }
    }

    private var all: Int { groups.reduce(0) { $0 + $1.count } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                Text(all > 0 ? "\(all) \(all == 1 ? "correction" : "corrections") from your results, grouped so patterns stand out." : "Every correction from your results, grouped so patterns stand out.")
                    .font(.subheadline).foregroundStyle(.muted)
                if !groups.isEmpty { chips }
                if let error {
                    VStack(alignment: .leading, spacing: 8) {
                        ErrorLine(message: error)
                        Button("Try again") { Task { await load(reset: true) } }.secondaryButton()
                    }
                    .card()
                }
                ForEach(attemptGroups) { g in group(g) }
                if loading { ProgressView().frame(maxWidth: .infinity).padding() }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .demoScroll()
        .overlay {
            if !loading && groups.isEmpty && error == nil {
                ContentUnavailableView {
                    Label("Your error log is empty", systemImage: "exclamationmark.triangle")
                } description: {
                    Text("Grammar slips, word choices and cohesion issues from your results collect here, so you can spot the ones that keep coming back.")
                } actions: {
                    NavigationLink(value: Route.writing(.task2)) { Text("Write an essay") }.primaryButton()
                }
                .background(Color.canvas)
            }
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast)
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .glassBar(Capsule())
                    .padding(.horizontal, 16).padding(.bottom, 12)
                    .transition(.opacity)
            }
        }
        .animation(.default, value: toast)
        .background(Color.canvas)
        .navigationTitle("Mistakes")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(reset: true) }
        .task(id: category) { await load(reset: true) }
    }

    // MARK: Filter chips

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", all, nil)
                ForEach(groups, id: \.category) { chip(shellCategoryLabel($0.category), $0.count, $0.category) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filter by category")
    }

    private func chip(_ label: String, _ count: Int, _ value: String?) -> some View {
        let on = category == value
        return Button { category = value } label: {
            HStack(spacing: 6) {
                Text(label)
                Text("\(count)").monospacedDigit().opacity(0.7)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .foregroundStyle(on ? Color.onBrand : Color.ink)
            .background(on ? Color.brand : Color.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? Color.clear : Color.line))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label), \(count)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: Attempt group

    private func group(_ g: AttemptGroup) -> some View {
        let m = g.first
        return VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                NavigationLink(value: Route.result([m.attemptId])) {
                    Text(m.promptTitle).font(.headline).foregroundStyle(.ink).multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                Text("\(m.skill == "speaking" ? "Speaking Part" : "Writing Task") \(m.part), \(ShellDate.relative(m.createdAt))")
                    .font(.caption).foregroundStyle(.muted)
            }
            .frame(minHeight: 44, alignment: .leading)
            VStack(spacing: 0) {
                ForEach(g.items) { item in
                    MistakeRow(m: item, showCategory: category == nil, toast: show, onAdded: markAdded)
                        .onAppear { if item.id == items.last?.id && items.count < total { Task { await load(reset: false) } } }
                    if item.id != g.items.last?.id { Divider() }
                }
            }
            .card(padding: 0)
        }
    }

    private func markAdded(_ id: String) {
        if let i = items.firstIndex(where: { $0.id == id }) { items[i].inDeck = true }
    }

    private func show(_ text: String) {
        toast = text
        toastTask?.cancel()
        toastTask = Task {
            try? await Task.sleep(for: .seconds(2.5))
            if !Task.isCancelled { toast = nil }
        }
    }

    // MARK: Loading

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

/// original -> correction, explanation, time in the answer, "Add to deck".
private struct MistakeRow: View {
    let m: Mistake
    let showCategory: Bool
    let toast: (String) -> Void
    let onAdded: (String) -> Void

    @Environment(APIClient.self) private var api
    @State private var adding = false
    @State private var expanded = false

    /// Nothing to diff: the explanation carries it.
    private var same: Bool { m.original.trimmingCharacters(in: .whitespacesAndNewlines) == m.correction.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// Off-topic spans quote whole answers: clamp them to two lines each until expanded.
    private var long: Bool { !same && m.original.count + m.correction.count > 200 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if showCategory || m.time != nil {
                HStack(spacing: 8) {
                    if showCategory { Chip(text: shellCategoryLabel(m.category)) }
                    if let t = m.time { Text("at \(clock(Int(t)))").font(.caption.monospacedDigit()).foregroundStyle(.muted) }
                }
            }
            if !same {
                VStack(alignment: .leading, spacing: 6) {
                    Text(m.original).strikethrough().foregroundStyle(.bad).lineLimit(long && !expanded ? 2 : nil)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "arrow.right").foregroundStyle(.muted).accessibilityLabel("corrected to")
                        Text(m.correction).fontWeight(.medium).foregroundStyle(.goodText).lineLimit(long && !expanded ? 2 : nil)
                    }
                }
                .font(.system(.body, design: .serif))
            }
            if long {
                Button(expanded ? "Show less" : "Show more") { expanded.toggle() }
                    .font(.subheadline.weight(.medium))
                    .frame(minHeight: 44)
                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            }
            Text(m.explanation).font(.subheadline).foregroundStyle(same ? Color.ink : Color.muted)
            HStack {
                Spacer()
                Button { Task { await add() } } label: {
                    if adding {
                        ProgressView().frame(minWidth: 80)
                    } else {
                        Label(m.inDeck ? "In deck" : "Add to deck", systemImage: m.inDeck ? "checkmark" : "plus")
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(m.inDeck || adding)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func add() async {
        adding = true
        defer { adding = false }
        do {
            let _: Empty = try await api.send("POST", "/api/mistakes/\(m.id)/card")
            onAdded(m.id)
            toast("Added to your review deck")
        } catch is CancellationError {
        } catch {
            toast(error.localizedDescription)
        }
    }
}
