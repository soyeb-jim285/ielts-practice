import SwiftUI

/// Home for a signed-out visitor (web components/dashboard/GuestHome.tsx): what the product does, a labelled example result, and the way in.
struct GuestDashboardView: View {
    @Environment(APIClient.self) private var api

    private let features: [(icon: String, title: String, body: String)] = [
        ("mic", "Speaking test", "All three parts, recorded. Fluency, vocabulary, grammar and pronunciation are scored, with your pauses timed in the transcript."),
        ("bubble.left.and.bubble.right", "Live examiner", "A spoken conversation: an AI examiner asks, listens and follows up on what you say. Runs on your own API key."),
        ("pencil.line", "Writing Task 1 and 2", "Timed tasks marked against the public band descriptors, with each mistake underlined and corrected."),
        ("exclamationmark.triangle", "Mistake log", "The errors you repeat, grouped, so you know what to fix first."),
        ("rectangle.on.rectangle.angled", "Review deck", "Turn corrections into short flashcards that come back just before you forget them."),
    ]

    /// Illustration only: fixed numbers that show the layout of a result, never a real score.
    private let example: [(label: String, band: Double)] = [
        ("Fluency and coherence", 6.5), ("Lexical resource", 7), ("Grammatical range and accuracy", 6), ("Pronunciation", 6.5),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Practise IELTS Speaking and Writing")
                        .font(.display(.largeTitle, weight: .bold))
                        .foregroundStyle(.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text("Timed practice with a band for every criterion, and each mistake marked exactly where you made it.")
                        .foregroundStyle(.muted)
                }
                VStack(spacing: 12) {
                    NavigationLink(value: Route.speaking(.full)) {
                        Text("Try a free speaking test").frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .primaryButton().controlSize(.large)
                    QuotaLabel(skill: "speaking")
                    NavigationLink(value: Route.writing(.task2)) {
                        Text("Try a free writing task").frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .secondaryButton().controlSize(.large)
                    QuotaLabel(skill: "writing")
                    HStack(spacing: 4) {
                        Button("Create account") { api.requestSignIn("Create an account for 1 test a day.", signUp: true) }
                        Text("or").foregroundStyle(.muted)
                        Button("sign in") { api.requestSignIn("Sign in to continue your practice.") }
                    }
                    .buttonStyle(.borderless).font(.subheadline).frame(minHeight: 44)
                }
                GuestRecentView()
                CommunityCard()

                VStack(alignment: .leading, spacing: 14) {
                    SectionTitle("What you get")
                    ForEach(features, id: \.title) { f in
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: f.icon).font(.title3).foregroundStyle(.muted).frame(width: 28).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.title).font(.headline).foregroundStyle(.ink)
                                Text(f.body).font(.subheadline).foregroundStyle(.muted)
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle("What a result looks like")
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Example, not a real score")
                                    .font(.caption.weight(.medium)).foregroundStyle(.muted)
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(Color.surface2, in: Capsule())
                                Text("Speaking, Part 2").font(.caption).foregroundStyle(.muted)
                            }
                            Spacer()
                            Text(Band.format(6.5)).font(.display(.largeTitle, weight: .bold)).monospacedDigit().foregroundStyle(.ink)
                        }
                        ForEach(example, id: \.label) { c in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(c.label).font(.subheadline).foregroundStyle(.ink)
                                    Spacer()
                                    Text(Band.format(c.band)).font(.headline.monospacedDigit()).foregroundStyle(.ink)
                                }
                                GeometryReader { g in
                                    ZStack(alignment: .leading) {
                                        Capsule().fill(Color.surface2)
                                        Capsule().fill(Color.muted).frame(width: c.band / 9 * g.size.width)
                                    }
                                }
                                .frame(height: 6)
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(c.label): example band \(Band.format(c.band)) of 9")
                        }
                    }
                    .card()
                }

                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle("Look around first")
                    Text("Everything opens without an account. Guests get 1 speaking and 1 writing test a week; an account gets 1 of each a day. History, mistakes and review need an account.")
                        .font(.subheadline).foregroundStyle(.muted)
                    NavigationLink(value: Route.bank(skill: "")) {
                        Label("Browse the prompt bank", systemImage: "books.vertical").frame(minHeight: 44, alignment: .leading)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
        .demoScroll()
        .background(Color.canvas)
        .task { await api.loadQuota() }
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
    }
}
