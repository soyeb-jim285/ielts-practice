import SwiftUI

/// A row of GET /api/prompts. Local so it can read `sourceRef`, which the shared Prompt model does not carry.
private struct BankPrompt: Decodable, Identifiable {
    let id: String
    let skill: String
    let part: Int
    let type: String?
    let title: String
    let body: String
    let source: String?
    let sourceRef: String?
    let bullets: [String]?
    let followUps: [String]?
    let done: Bool?
}

private struct BankPage: Decodable { let items: [BankPrompt]; let total: Int }

/// GET /api/prompts/meta: the distinct topics and types per skill and part (null entries tolerated).
private struct BankMeta: Decodable {
    struct Group: Decodable {
        let skill: String
        let part: Int
        let topics: [String?]
        let types: [String?]
    }
    let groups: [Group]
}

/// Web lib/writing.ts typeLabel.
private func bankTypeLabel(_ t: String) -> String {
    let labels = [
        "adv-disadv": "Advantages & disadvantages", "problem-solution": "Problem & solution", "two-part": "Two-part question",
        "letter-formal": "Formal letter", "letter-semi": "Semi-formal letter", "letter-informal": "Informal letter",
        "line": "Line graph", "bar": "Bar chart", "pie": "Pie chart", "mixed": "Mixed charts",
        "p1-topic": "Part 1 topic", "p1-intro": "Part 1 opening topic", "p1-branch": "Part 1 work / study", "cue-card": "Cue card", "p3-linked": "Part 3 (linked to cue card)", "p3-discussion": "Part 3 discussion",
    ]
    return labels[t] ?? (t.prefix(1).uppercased() + t.dropFirst()).replacingOccurrences(of: "-", with: " ")
}

/// "grammar-and-more" -> "Grammar and more" (web bank `pretty`).
private func pretty(_ s: String) -> String {
    (s.prefix(1).uppercased() + s.dropFirst()).replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
}

/// Every question and task you can practise, with the web's filters (skill, part or task, type, topic, source) and search.
struct BankView: View {
    @State var skill: String // "" = all skills

    @Environment(APIClient.self) private var api
    @State private var partKey = "all" // all | 1 | 2 | 3 | 1-academic | 1-general
    @State private var type = ""
    @State private var topic = ""
    @State private var source = ""
    @State private var query = ""
    @State private var meta: [BankMeta.Group] = []
    @State private var items: [BankPrompt] = []
    @State private var total: Int?
    @State private var page = 1
    @State private var generation = 0
    @State private var loading = true
    @State private var error: String?

    private struct PartOption: Identifiable {
        let id: String, label: String
    }
    private var partOptions: [PartOption] {
        skill == "speaking"
            ? [PartOption(id: "all", label: "All"), PartOption(id: "1", label: "Part 1"), PartOption(id: "2", label: "Part 2"), PartOption(id: "3", label: "Part 3")]
            : [PartOption(id: "all", label: "All"), PartOption(id: "1-academic", label: "T1 Academic"), PartOption(id: "1-general", label: "T1 General"),
               PartOption(id: "2", label: "Task 2")]
    }
    private var partNum: Int? { partKey == "all" ? nil : Int(partKey.prefix(1)) }
    private var variant: String? { partKey.contains("-") ? String(partKey.split(separator: "-")[1]) : nil }
    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespaces) }
    private var filtered: Bool { !skill.isEmpty || !type.isEmpty || !topic.isEmpty || !source.isEmpty || !trimmedQuery.isEmpty }

    private var scoped: [BankMeta.Group] {
        meta.filter { (skill.isEmpty || $0.skill == skill) && (partNum == nil || $0.part == partNum) }
    }
    /// Types only once a part is picked, and then just that part's (Task 1 letters are General, the rest Academic).
    private var types: [String] {
        guard partNum != nil else { return [] }
        let ofVariant = { (t: String) in variant == nil || (variant == "general") == t.hasPrefix("letter") }
        return Array(Set(scoped.flatMap { $0.types.compactMap { $0 } }.filter(ofVariant))).sorted()
    }
    private var topics: [String] { Array(Set(scoped.flatMap { $0.topics.compactMap { $0 } })).sorted() }

    private struct RunGroup: Identifiable {
        let key: String
        let label: String
        let items: [BankPrompt]
        var id: String { key + (items.first?.id ?? "") }
    }

    /// Rows arrive sorted by skill then part: consecutive runs share one section header.
    private var groups: [RunGroup] {
        var out: [(key: String, items: [BankPrompt])] = []
        for p in items {
            let k = "\(p.skill)\(p.part)"
            if out.last?.key == k { out[out.count - 1].items.append(p) } else { out.append((k, [p])) }
        }
        return out.map { g in
            let p = g.items[0]
            let part = p.skill == "speaking" ? "Part \(p.part)" : "Task \(p.part)"
            let v = p.skill == "writing" ? variant.map { " " + pretty($0) } ?? "" : ""
            return RunGroup(key: g.key, label: "\(pretty(p.skill)), \(part)\(v)", items: g.items)
        }
    }

    var body: some View {
        List {
            Section {
                Picker("Skill", selection: $skill) {
                    Text("All").tag("")
                    Text("Speaking").tag("speaking")
                    Text("Writing").tag("writing")
                }
                .pickerStyle(.segmented)
                if !skill.isEmpty {
                    Picker(skill == "speaking" ? "Part" : "Task", selection: $partKey) {
                        ForEach(partOptions) { Text($0.label).tag($0.id) }
                    }
                    .pickerStyle(.menu)
                }
                if types.count > 1 {
                    Picker("Type", selection: $type) {
                        Text("Any type").tag("")
                        ForEach(types, id: \.self) { Text(bankTypeLabel($0)).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                Picker("Topic", selection: $topic) {
                    Text("All topics").tag("")
                    ForEach(topics, id: \.self) { Text(pretty($0)).tag($0) }
                }
                .pickerStyle(.menu)
                // Without Cambridge access everything is generated, so a source filter means nothing.
                if api.me?.cambridgeAccess == true {
                    Picker("Source", selection: $source) {
                        Text("All sources").tag("")
                        Text("Generated").tag("generated")
                        Text("Cambridge").tag("cambridge")
                    }
                    .pickerStyle(.menu)
                }
                if filtered { Button("Clear filters") { clear() } }
            } footer: {
                Text(total.map { "\($0.formatted()) \($0 == 1 ? "prompt" : "prompts")\(filtered ? " match" : "")" } ?? "Every question and task you can practise.")
            }
            .listRowBackground(Color.surface)

            if let error {
                Section {
                    ErrorLine(message: error)
                    Button("Try again") { Task { await load(reset: true) } }
                }
                .listRowBackground(Color.surface)
            } else if loading && items.isEmpty {
                Section { ProgressView().frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
            } else if items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label(filtered ? "No prompts match" : "The bank is empty", systemImage: "books.vertical")
                    } description: {
                        Text(filtered ? "Try a broader search or fewer filters." : "Seed the prompt bank on the server to start practising.")
                    } actions: {
                        if filtered { Button("Clear filters") { clear() }.secondaryButton() }
                    }
                }
                .listRowBackground(Color.clear)
            }

            ForEach(groups) { g in
                Section {
                    ForEach(g.items) { p in
                        NavigationLink(value: p.skill == "speaking" ? Route.speaking(.prompt(id: p.id, parent: nil)) : Route.writing(.prompt(id: p.id, parent: nil))) {
                            row(p)
                        }
                        .onAppear { if p.id == items.last?.id && items.count < (total ?? 0) { Task { await load(reset: false) } } }
                    }
                } header: {
                    Text(g.label).textCase(nil)
                }
                .listRowBackground(Color.surface)
            }
            if loading && !items.isEmpty {
                Section { ProgressView().frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .canvasList()
        .demoScroll()
        .navigationTitle("Prompt bank")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Search titles and questions")
        .task { await loadMeta() }
        .task(id: "\(skill)|\(partKey)|\(type)|\(topic)|\(source)|\(trimmedQuery)") {
            try? await Task.sleep(for: .milliseconds(300)) // debounce typing
            guard !Task.isCancelled else { return }
            await load(reset: true)
        }
        .onChange(of: skill) {
            partKey = "all"
            type = ""
            topic = ""
        }
        .onChange(of: partKey) {
            type = ""
            topic = ""
        }
    }

    private func row(_ p: BankPrompt) -> some View {
        // Speaking Part 1 and 3 titles are just the topic: show the first question under it; writing shows the task type.
        // Part 2: first cue-card point ("You should say:" alone says nothing); others: the opening line or follow-up.
        let question: String? = p.skill == "speaking"
            ? (p.part == 2 ? p.bullets?.first.map { "Say \($0)" } : p.followUps?.first ?? p.body.split(separator: "\n").first.map(String.init))
            : p.type.map(bankTypeLabel)
        return VStack(alignment: .leading, spacing: 4) {
            Text(p.title).font(.body).foregroundStyle(.ink).lineLimit(2)
            HStack(spacing: 8) {
                if let question, question != p.title { Text(question).font(.caption).foregroundStyle(.muted).lineLimit(1) }
                if p.source == "cambridge" { Chip(text: p.sourceRef ?? "Cambridge", color: .brand) }
                if p.done == true { Chip(text: "Done", color: .goodText) }
            }
        }
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func clear() {
        query = ""
        skill = ""
        partKey = "all"
        type = ""
        topic = ""
        source = ""
    }

    private func loadMeta() async {
        if let m: BankMeta = try? await api.get("/api/prompts/meta") { meta = m.groups }
    }

    private func load(reset: Bool) async {
        guard reset || !loading else { return }
        if reset {
            generation += 1
            page = 1
        }
        let gen = generation
        loading = true
        defer { if gen == generation { loading = false } }
        do {
            let p: BankPage = try await api.get("/api/prompts", query: [
                "skill": skill.isEmpty ? nil : skill, "part": partNum.map(String.init), "variant": variant,
                "type": type.isEmpty ? nil : type, "topic": topic.isEmpty ? nil : topic, "source": source.isEmpty ? nil : source,
                "q": trimmedQuery.isEmpty ? nil : trimmedQuery, "page": String(page),
            ])
            guard gen == generation else { return }
            items = reset ? p.items : items + p.items
            total = p.total
            page += 1
            error = nil
        } catch is CancellationError {
        } catch {
            guard gen == generation else { return }
            self.error = error.localizedDescription
            total = items.count // stop auto-paging until retry
        }
    }
}
