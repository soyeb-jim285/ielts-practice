import SwiftUI

/// SM-2 flashcards: front → tap to reveal → grade Again(1) / Hard(3) / Good(4) / Easy(5).
struct ReviewView: View {
    @Environment(APIClient.self) private var api
    @State private var cards: [ReviewCard] = []
    @State private var revealed = false
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        VStack(spacing: 20) {
            if loading {
                ProgressView()
            } else if let error {
                ContentUnavailableView { Label("Couldn't load cards", systemImage: "wifi.exclamationmark") } description: { Text(error) } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
            } else if let card = cards.first {
                Text("\(cards.count) due").font(.subheadline).foregroundStyle(.secondary)
                Button { withAnimation(.snappy) { revealed = true } } label: {
                    VStack(spacing: 16) {
                        Text(card.front).font(.title2.weight(.semibold)).multilineTextAlignment(.center)
                        if revealed {
                            Divider()
                            Text(card.back).font(.title3).foregroundStyle(.good).multilineTextAlignment(.center)
                        } else {
                            Text("Tap to reveal").font(.subheadline).foregroundStyle(.tertiary)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 260)
                    .card(padding: 24)
                }
                .buttonStyle(.plain)
                .id(card.id)
                .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)).combined(with: .opacity))
                if revealed {
                    HStack(spacing: 10) {
                        grade("Again", 1, .bad, card)
                        grade("Hard", 3, .warn, card)
                        grade("Good", 4, .good, card)
                        grade("Easy", 5, .brand, card)
                    }
                    .controlSize(.large)
                }
            } else {
                ContentUnavailableView("All caught up", systemImage: "checkmark.seal",
                                       description: Text("Add mistakes and fixes from your results to build your deck."))
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.canvas)
        .navigationTitle("Review")
        .task { await load() }
        .refreshable { await load() }
    }

    private func grade(_ label: String, _ g: Int, _ color: Color, _ card: ReviewCard) -> some View {
        Button {
            Task {
                do {
                    let _: Empty = try await api.send("POST", "/api/cards/\(card.id)/review", ["grade": g])
                    withAnimation(.snappy) {
                        cards.removeFirst()
                        revealed = false
                    }
                } catch {
                    self.error = error.localizedDescription
                }
            }
        } label: { Text(label).frame(maxWidth: .infinity) }
            .buttonStyle(.borderedProminent)
            .tint(color)
    }

    private func load() async {
        error = nil
        do {
            let list: ListOf<ReviewCard> = try await api.get("/api/cards/due")
            cards = list.items
            revealed = false
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}
