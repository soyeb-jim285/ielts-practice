import SwiftUI

struct WritingHomeView: View {
    var body: some View {
        List {
            Section {
                row(.writing(.full(variant: "academic")), "Full test", "Task 1 + Task 2 · 60 minutes", "doc.text")
            }
            Section("Single task") {
                row(.writing(.task1(variant: "academic")), "Task 1 · Academic", "Describe a chart, table, process or map · 20 min", "chart.bar.xaxis")
                row(.writing(.task1(variant: "general")), "Task 1 · General Training", "Write a letter · 20 min", "envelope")
                row(.writing(.task2), "Task 2 · Essay", "Opinion, discussion, problem–solution · 40 min", "text.alignleft")
            }
            Section {
                row(.bank(skill: "writing"), "Prompt bank", "Pick a specific task by type or topic", "books.vertical")
            } footer: {
                Text("Exam conditions: autocorrect, spellcheck and predictions are off, and pasting is blocked (change in Settings).")
            }
        }
        .navigationTitle("Writing")
    }

    private func row(_ route: Route, _ title: String, _ subtitle: String, _ icon: String) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.title2).foregroundStyle(.brand).frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
    }
}
