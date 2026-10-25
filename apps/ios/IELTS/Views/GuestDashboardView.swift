import SwiftUI

/// Home for a signed-out visitor (web components/dashboard/GuestHome.tsx): the four skills and the mock, a labelled example result,
/// what is free, and the way in.
struct GuestDashboardView: View {
    @Environment(APIClient.self) private var api

    private let features: [(icon: String, title: String, body: String)] = [
        ("mic", "Speaking test", "All three parts, recorded. Four criteria scored, with your pauses timed in the transcript."),
        ("bubble.left.and.bubble.right", "Live examiner", "A spoken conversation: an AI examiner asks, listens and follows up."),
        ("pencil.line", "Writing marked by criterion", "Timed tasks marked against the public band descriptors, each mistake underlined and corrected."),
        ("rectangle.on.rectangle.angled", "Fix what you repeat", "The mistake log groups the errors you repeat. The review deck turns corrections into flashcards that return just before you forget."),
    ]

    /// The four skills, as on the web's guest strip: what each one offers without an account.
    private let skills: [(icon: String, title: String, body: String, route: Route)] = [
        ("headphones", "Listening", "Unlimited free practice tests, 40 questions or one part, marked at once with a band", .lrHub(skill: "listening")),
        ("book", "Reading", "Unlimited free practice tests, 40 questions or one passage, marked at once with a band", .lrHub(skill: "reading")),
        ("pencil.line", "Writing", "Task 1 and Task 2, feedback by criterion", .writing(.task2)),
        ("mic", "Speaking", "Live examiner 11-14 min, or practise one part", .speaking(.part(1))),
    ]

    /// Illustration only: fixed numbers that show the layout of a result, never a real score.
    private let example: [(label: String, band: Double)] = [
        ("Fluency and coherence", 6.5), ("Lexical resource", 7), ("Grammatical range and accuracy", 6), ("Pronunciation", 6.5),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Practise all four IELTS skills")
                        .font(.display(.largeTitle, weight: .bold))
                        .foregroundStyle(.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text("Listening, Reading, Writing and Speaking, plus a full mock test. Free to try, no account. Timed practice with a band for every criterion, and each mistake marked exactly where you made it.")
                        .foregroundStyle(.muted)
                }
                VStack(spacing: 12) {
                    NavigationLink(value: Route.speaking(.part(1))) {
                        Text("Try a speaking test").frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .primaryButton().controlSize(.large)
                    NavigationLink(value: Route.writing(.task2)) {
                        Text("Try a writing test").frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .secondaryButton().controlSize(.large)
                    NavigationLink(value: Route.lrHub(skill: "listening")) {
                        Text("Take a free Listening or Reading test").font(.body.weight(.medium)).underline().foregroundStyle(.brand).frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                }
                GuestRecentView()

                VStack(alignment: .leading, spacing: 4) {
                    SectionTitle("Four skills, one mock test").padding(.bottom, 4)
                    ForEach(skills, id: \.title) { k in
                        row(k.title, k.body, k.icon, k.route)
                        Divider()
                    }
                    row("Full mock test", "All four back to back, overall band at the end", "checklist", .mock)
                    Divider()
                    row("Prompt bank", "Browse every question and task, no account needed", "books.vertical", .bank(skill: ""))
                }
                .card()

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

                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle("Free to try")
                    Text("Try speaking and writing tests as a guest. Create a free account for more tests. Subscribers get unlimited speaking and writing. Listening and Reading are free.")
                        .foregroundStyle(.muted)
                    CommunityCard()
                    Text("History, mistakes and the review deck need an account.").font(.subheadline).foregroundStyle(.muted)
                    HStack(spacing: 20) {
                        Button("Create one") { api.requestSignIn("Create a free account for more tests.", signUp: true) }
                        Button("Sign in") { api.requestSignIn("Sign in to continue your practice.") }
                    }
                    .buttonStyle(.borderless).font(.subheadline.weight(.medium)).frame(minHeight: 44)
                }

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

    private func row(_ title: String, _ meta: String, _ icon: String, _ route: Route) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.body).foregroundStyle(.muted).frame(width: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body).foregroundStyle(.ink)
                    Text(meta).font(.caption).foregroundStyle(.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
