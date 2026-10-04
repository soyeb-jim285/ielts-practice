import AVFoundation
import SwiftUI

/// A card as GET /api/cards/due returns it. The scheduling fields are optional so older payloads and demo fixtures still decode.
struct DueCard: Decodable, Identifiable {
    let id: String
    let front: String
    let back: String
    let source: String? // mistake | vocab | fix
    let ease: Double?
    let interval: Double? // days
    let reps: Int?

    /// Listening spelling cards ("🎧 Listening · spell the word you heard…") keep the word as the first line of the back.
    var heardWord: String? {
        guard front.hasPrefix("🎧 Listening") else { return nil }
        let w = (back.components(separatedBy: "\n").first ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return w.isEmpty ? nil : w
    }
}

/// `{ cards, total, deck }` (also accepts `{ items }`): the due batch, how many are due in all, and the whole deck size.
struct DueResponse: Decodable {
    let cards: [DueCard]?
    let items: [DueCard]?
    let total: Int?
    let deck: Int?
    var list: [DueCard] { cards ?? items ?? [] }
    var dueTotal: Int { total ?? list.count }
}

/// SM-2 flashcards: question, then Show answer, then grade Again / Hard / Good / Easy with the next interval under each.
struct ReviewView: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dynamicTypeSize) private var typeSize
    // The session queue: the due batch, plus every card graded Again re-queued at the end (a learning step, like Anki's).
    @State private var queue: [DueCard] = []
    @State private var index = 0
    @State private var dueTotal = 0
    @State private var batchSize = 0
    @State private var deck: Int?
    @State private var reviewed = 0 // graded this visit, so the end state can say so after the refetch empties the queue
    @State private var revealed = false
    @State private var loading = true
    @State private var grading = false
    @State private var error: String?
    @State private var gradeError: String?
    @State private var speech = AVSpeechSynthesizer() // one instance, kept alive so a word is not cut off mid-utterance

    private struct Grade: Identifiable {
        let grade: Int, label: String
        var id: Int { grade }
    }
    private static let grades = [Grade(grade: 1, label: "Again"), Grade(grade: 3, label: "Hard"), Grade(grade: 4, label: "Good"), Grade(grade: 5, label: "Easy")]
    private static let sourceLabel = ["mistake": "From your mistakes", "vocab": "Vocabulary", "fix": "Fix to practise"]
    private static let sourcePrompt = [
        "mistake": "How would you correct this? Say or write it, then reveal the answer.",
        "vocab": "Recall the meaning and use it in a sentence, then reveal the answer.",
        "fix": "How would you improve this sentence? Say or write it, then reveal the answer.",
    ]

    private var card: DueCard? { index < queue.count ? queue[index] : nil }
    private var total: Int { max(1, dueTotal + queue.count - batchSize) }
    private var noCards: Bool { reviewed == 0 && deck == 0 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if loading && card == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                } else if let error, card == nil {
                    ContentUnavailableView {
                        Label("Couldn't load cards", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await load() } }.primaryButton()
                    }
                } else if let card {
                    session(card)
                } else {
                    empty
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .demoScroll()
        .background(Color.canvas)
        .navigationTitle("Review")
        .refreshable { await load() }
        .task { await load() }
    }

    // MARK: Session

    private func session(_ card: DueCard) -> some View {
        // Fix cards are "title\n\nsentence" (server fixCard): the title is a label, only the sentence is the thing to improve.
        var label: String?
        var front = card.front
        if card.source == "fix", let r = card.front.range(of: "\n\n"), r.lowerBound != card.front.startIndex {
            label = String(card.front[..<r.lowerBound])
            front = String(card.front[r.upperBound...])
        }
        let left = max(0, total - index)
        return VStack(alignment: .leading, spacing: 16) {
            Text("\(left) \(left == 1 ? "card" : "cards") left today").font(.subheadline).foregroundStyle(.muted)
            HStack(spacing: 12) {
                ProgressView(value: min(1, Double(index) / Double(total)))
                    .accessibilityLabel("Session progress")
                Text("\(index) / \(total)").font(.caption.monospacedDigit()).foregroundStyle(.muted).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 16) {
                    if let s = card.source, let name = Self.sourceLabel[s] {
                        Label(name, systemImage: "rectangle.on.rectangle.angled").font(.caption).foregroundStyle(.muted)
                    }
                    if !revealed, let s = card.source, let prompt = Self.sourcePrompt[s] {
                        Text(prompt).font(.caption).foregroundStyle(.muted)
                    }
                    if let label { Text(label).font(.subheadline.weight(.medium)).foregroundStyle(.brand) }
                    Text(front).font(.display(.title2)).foregroundStyle(.ink)
                }
                .accessibilityElement(children: .combine)
                // Outside the combined text so VoiceOver reaches it as its own button. The spelling stays hidden until the card is turned.
                if let word = card.heardWord {
                    Button { say(word) } label: { Label("Hear the word", systemImage: "speaker.wave.2.fill") }
                        .secondaryButton()
                }
                if revealed {
                    Divider()
                    Text(card.back).font(.system(.title3, design: .serif)).foregroundStyle(.ink)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 260, alignment: .topLeading)
            .card(padding: 20)
            if let gradeError { ErrorLine(message: "Couldn't save that grade: \(gradeError)") }
            if revealed {
                gradeButtons(card)
            } else {
                Button { revealed = true } label: { Text("Show answer").frame(maxWidth: .infinity, minHeight: 28) }
                    .primaryButton()
                    .controlSize(.large)
            }
            Text("Grade honestly: cards you find hard come back sooner. Again shows the card once more before you finish.")
                .font(.caption).foregroundStyle(.muted)
        }
    }

    private func gradeButtons(_ card: DueCard) -> some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: typeSize.isAccessibilitySize ? 2 : 4)
        return LazyVGrid(columns: cols, spacing: 8) {
            ForEach(Self.grades) { g in
                Button { Task { await grade(card, g.grade) } } label: {
                    VStack(spacing: 2) {
                        Text(g.label).font(.subheadline.weight(.semibold)).foregroundStyle(color(g.grade))
                        Text(g.grade == 1 ? "This session" : days(nextInterval(card, g.grade)))
                            .font(.caption.monospacedDigit()).foregroundStyle(.muted)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .secondaryButton()
                .disabled(grading)
                .accessibilityLabel("\(g.label), next review \(g.grade == 1 ? "this session" : days(nextInterval(card, g.grade)))")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("How well did you remember?")
    }

    private func color(_ grade: Int) -> Color {
        switch grade {
        case 1: .bad
        case 3: .warnText
        case 4: .goodText
        default: .brand
        }
    }

    /// Port of packages/core srs.ts `review`: the interval in days the card would get for grade `g`.
    private func nextInterval(_ c: DueCard, _ g: Int) -> Int {
        if g < 3 { return 1 }
        let d = Double(5 - g)
        let ease = max(1.3, (c.ease ?? 2.5) + (0.1 - d * (0.08 + d * 0.02)))
        let reps = (c.reps ?? 0) + 1
        return reps == 1 ? 1 : reps == 2 ? 6 : Int(((c.interval ?? 0) * ease).rounded())
    }

    /// The device's British English voice, a little slow. ponytail: not the test speaker's voice; play the clip from the test audio if that matters.
    private func say(_ word: String) {
        activatePlayback() // playback category, so the silent switch does not mute it
        let u = AVSpeechUtterance(string: word)
        u.voice = AVSpeechSynthesisVoice(language: "en-GB")
        u.rate = 0.42
        speech.stopSpeaking(at: .immediate)
        speech.speak(u)
    }

    private func days(_ n: Int) -> String { n == 1 ? "1 day" : n < 30 ? "\(n) days" : "\(Int((Double(n) / 30).rounded())) mo" }

    private func grade(_ card: DueCard, _ g: Int) async {
        grading = true
        gradeError = nil
        defer { grading = false }
        do {
            let _: Empty = try await api.send("POST", "/api/cards/\(card.id)/review", ["grade": g])
            revealed = false
            reviewed += 1
            index += 1
            if g == 1 { queue.append(card) } else if index >= queue.count { await load() }
        } catch is CancellationError {
        } catch {
            gradeError = error.localizedDescription
        }
    }

    // MARK: Empty

    private var empty: some View {
        let title = reviewed > 0 ? "Session complete" : noCards ? "No cards yet" : (deck ?? 0) > 0 ? "All caught up" : "Nothing due right now"
        let text: String = {
            if reviewed > 0 { return "You reviewed \(reviewed) \(reviewed == 1 ? "card" : "cards"). Each one comes back when it is due, so a short session tomorrow keeps them fresh." }
            if noCards { return "Your deck is empty. Open Mistakes and press Add to deck on the corrections you want to remember; they come back here on a spaced schedule." }
            if (deck ?? 0) > 0 { return "Your cards come back here when they're due. Add more mistakes and fixes from your results any time." }
            return "Cards come back here on a spaced schedule. Add mistakes and fixes from your results to build your deck."
        }()
        return ContentUnavailableView {
            Label(title, systemImage: noCards ? "rectangle.on.rectangle.angled" : "checkmark.seal")
        } description: {
            Text(text)
        } actions: {
            NavigationLink(value: Route.mistakes(category: nil)) {
                Text(noCards ? "Go to Mistakes and add cards" : "Browse your mistakes")
            }
            .primaryButton()
        }
        .frame(maxWidth: .infinity, minHeight: 360)
    }

    // MARK: Loading

    private func load() async {
        do {
            let r: DueResponse = try await api.get("/api/cards/due")
            queue = r.list
            batchSize = r.list.count
            dueTotal = r.dueTotal
            deck = r.deck
            index = 0
            revealed = false
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}
