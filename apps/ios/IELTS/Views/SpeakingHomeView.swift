import SwiftUI

struct SpeakingHomeView: View {
    @Environment(APIClient.self) private var api

    var body: some View {
        List {
            Section {
                row(.speaking(.full), "Full test", "Parts 1, 2 and 3 · about 12 minutes", "list.number")
                row(.live, "Live examiner", liveSubtitle, "person.wave.2.fill")
            }
            Section("Practise one part") {
                row(.speaking(.part(1)), "Part 1 · Interview", "Familiar topics · answers of 15–40 s", "1.circle")
                row(.speaking(.part(2)), "Part 2 · Long turn", "Cue card · 1 min prep, 2 min talk", "2.circle")
                row(.speaking(.part(3)), "Part 3 · Discussion", "Abstract questions · answers of 30–60 s", "3.circle")
            }
            Section {
                row(.bank(skill: "speaking"), "Prompt bank", "Search every topic and cue card", "books.vertical")
            }
        }
        .navigationTitle("Speaking")
    }

    private var liveSubtitle: String {
        guard let me = api.me else { return "" }
        return me.settings.liveProvider == "openai-realtime" && me.realtimeAvailable
            ? "Real-time conversation (OpenAI Realtime)" : "Turn-based spoken interview"
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
