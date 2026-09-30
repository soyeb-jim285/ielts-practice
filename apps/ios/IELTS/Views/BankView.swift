import SwiftUI

struct BankView: View {
    @State var skill: String

    @Environment(APIClient.self) private var api
    @State private var part = 0 // 0 = all
    @State private var query = ""
    @State private var cambridgeOnly = false
    @State private var items: [Prompt] = []
    @State private var page = 1
    @State private var more = true
    @State private var error: String?

    private var parts: [Int] { skill == "speaking" ? [1, 2, 3] : [1, 2] }

    var body: some View {
        List {
            Section {
                Picker("Skill", selection: $skill) {
                    Text("Speaking").tag("speaking")
                    Text("Writing").tag("writing")
                }
                .pickerStyle(.segmented)
                Picker(skill == "speaking" ? "Part" : "Task", selection: $part) {
                    Text("All").tag(0)
                    ForEach(parts, id: \.self) { Text(skill == "speaking" ? "Part \($0)" : "Task \($0)").tag($0) }
                }
                .pickerStyle(.segmented)
                if api.me?.cambridgeAccess == true { Toggle("Cambridge only", isOn: $cambridgeOnly) }
            }
            if let error { Section { ErrorLine(message: error) } }
            Section {
                ForEach(items) { p in
                    NavigationLink(value: p.skill == "speaking" ? Route.speaking(.prompt(id: p.id, parent: nil)) : Route.writing(.prompt(id: p.id, parent: nil))) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(p.title).font(.headline).lineLimit(2)
                                Spacer()
                                if p.done == true { Image(systemName: "checkmark.circle.fill").foregroundStyle(.good).accessibilityLabel("Done") }
                            }
                            HStack(spacing: 6) {
                                Chip(text: p.skill == "speaking" ? "Part \(p.part)" : "Task \(p.part)", color: .brand)
                                if let t = p.type { Chip(text: t) }
                                if let topic = p.topic { Text(topic.capitalized).font(.caption).foregroundStyle(.secondary) }
                                if p.source == "cambridge" { Chip(text: "Cambridge", color: .warn) }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .onAppear { if p.id == items.last?.id && more { Task { await load(reset: false) } } }
                }
                if items.isEmpty && error == nil && !more { Text("No prompts match.").foregroundStyle(.secondary) }
            }
        }
        .navigationTitle("Prompt bank")
        .searchable(text: $query, prompt: "Search prompts")
        .task(id: "\(skill)|\(part)|\(cambridgeOnly)|\(query)") {
            try? await Task.sleep(for: .milliseconds(300)) // debounce typing
            guard !Task.isCancelled else { return }
            await load(reset: true)
        }
        .onChange(of: skill) { part = 0 }
    }

    private func load(reset: Bool) async {
        if reset { page = 1; more = true }
        do {
            let list: ListOf<Prompt> = try await api.get("/api/prompts", query: [
                "skill": skill, "part": part == 0 ? nil : String(part), "q": query.isEmpty ? nil : query,
                "source": cambridgeOnly ? "cambridge" : nil, "page": String(page),
            ])
            items = reset ? list.items : items + list.items
            more = !list.items.isEmpty && list.items.count >= 30
            page += 1
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
            more = false
        }
    }
}
