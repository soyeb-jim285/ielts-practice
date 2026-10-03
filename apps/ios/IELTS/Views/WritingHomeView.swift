import SwiftUI

/// Writing hub (web: routes/_app/writing/index.tsx): full test, one-task practice, recent writing, prompt bank link.
struct WritingHomeView: View {
    @Environment(APIClient.self) private var api
    @State private var variant = "academic"
    @State private var recent: [AttemptListItem] = []

    private var target: Double { api.me?.settings.targetBand ?? 7 }

    private struct Kind: Identifiable {
        let id: String
        let mode: WritingMode
        let title: String
        let blurb: String
        let meta: String
        let icon: String
    }

    private let kinds = [
        Kind(id: "t1a", mode: .task1(variant: "academic"), title: "Task 1 Academic", blurb: "Describe a chart, table, process or map", meta: "20 min, 150+ words", icon: "chart.bar.xaxis"),
        Kind(id: "t1g", mode: .task1(variant: "general"), title: "Task 1 General", blurb: "Write a letter covering three points", meta: "20 min, 150+ words", icon: "envelope"),
        Kind(id: "t2", mode: .task2, title: "Task 2", blurb: "Argue a position in an essay", meta: "40 min, 250+ words", icon: "text.alignleft"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Timed tasks, marked against the public band descriptors with every mistake located.")
                    .font(.subheadline).foregroundStyle(.muted)
                GuestRecentView(skill: "writing")
                fullTest
                practise
                if !recent.isEmpty { recentSection }
                bank
                Text(api.me?.settings.blockPaste == false
                     ? "Exam conditions: autocorrect, spellcheck and predictions are off, and pasting is allowed (change in Settings)."
                     : "Exam conditions: autocorrect, spellcheck and predictions are off, and pasting is blocked (change in Settings).")
                    .font(.footnote).foregroundStyle(.muted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(.canvas)
        .demoScroll()
        .navigationTitle("Writing")
        .task { await loadRecent() }
        .task { await api.loadQuota() }
        .refreshable { await api.loadQuota(force: true) }
    }

    // MARK: Full test

    private var fullTest: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Full test").font(.display(.title3)).foregroundStyle(.ink)
            Text("Task 1 and Task 2 on one 60-minute clock, as on test day. You manage your own time.")
                .font(.subheadline).foregroundStyle(.ink)
            Text("Task 1, 20 min. Task 2, 40 min. Both answers are marked together into one writing band.")
                .font(.caption).foregroundStyle(.muted)
            Picker("Test type", selection: $variant) {
                Text("Academic").tag("academic")
                Text("General").tag("general")
            }
            .pickerStyle(.segmented)
            NavigationLink(value: Route.writing(.full(variant: variant))) {
                Text("Start full test").frame(maxWidth: .infinity)
            }
            .primaryButton()
            .controlSize(.large)
            QuotaLabel(skill: "writing").frame(maxWidth: .infinity, alignment: .center)
        }
        .card()
    }

    // MARK: One task

    private var practise: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Or practise one task")
            QuotaLabel(skill: "writing")
            VStack(spacing: 0) {
                ForEach(Array(kinds.enumerated()), id: \.element.id) { i, k in
                    if i > 0 { Divider().padding(.leading, 64) }
                    NavigationLink(value: Route.writing(k.mode)) {
                        HStack(spacing: 12) {
                            Image(systemName: k.icon)
                                .font(.body).foregroundStyle(.ink)
                                .frame(width: 40, height: 40)
                                .background(.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(k.title).font(.headline).foregroundStyle(.ink)
                                Text(k.blurb).font(.subheadline).foregroundStyle(.muted)
                                Text(k.meta).font(.caption.monospacedDigit()).foregroundStyle(.muted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Label("Random", systemImage: "shuffle")
                                .font(.subheadline.weight(.medium)).foregroundStyle(.brand)
                                .fixedSize()
                        }
                        .padding(12)
                        .frame(minHeight: 76)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Starts a random \(k.title) prompt")
                }
            }
            .card(padding: 0)
        }
    }

    // MARK: Recent writing

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("Recent writing")
                NavigationLink("All writing attempts", value: Route.history(skill: "writing"))
                    .font(.subheadline.weight(.medium)).foregroundStyle(.brand).fixedSize()
            }
            VStack(spacing: 0) {
                ForEach(Array(recent.enumerated()), id: \.element.id) { i, a in
                    if i > 0 { Divider().padding(.leading, 16) }
                    NavigationLink(value: Route.result([a.id])) {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.promptTitle).font(.body).foregroundStyle(.ink).lineLimit(1)
                                Text("Task \(a.part), \(shortDate(a.createdAt))").font(.caption).foregroundStyle(.muted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            if a.status == "analyzing" {
                                Chip(text: "Scoring…", color: .brand)
                            } else if let o = a.overall {
                                Text(Band.format(o))
                                    .font(.display(.title3)).monospacedDigit()
                                    .foregroundStyle(bandTextColor(o, target))
                                    .accessibilityLabel("Band \(Band.format(o))")
                            }
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.muted)
                                .accessibilityHidden(true)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .frame(minHeight: 56)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .card(padding: 0)
        }
    }

    // MARK: Prompt bank

    private var bank: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Choose a prompt")
            NavigationLink(value: Route.bank(skill: "writing")) {
                HStack(spacing: 12) {
                    Image(systemName: "books.vertical")
                        .font(.body).foregroundStyle(.ink)
                        .frame(width: 40, height: 40)
                        .background(.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Prompt bank").font(.headline).foregroundStyle(.ink)
                        Text("Pick a specific task by type or topic, or search").font(.subheadline).foregroundStyle(.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.muted)
                        .accessibilityHidden(true)
                }
                .padding(12)
                .frame(minHeight: 64)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .card(padding: 0)
        }
    }

    // MARK: Data

    private func loadRecent() async {
        guard api.isSignedIn, let page: AttemptPage = try? await api.get("/api/attempts", query: ["skill": "writing", "page": "1"]) else { return }
        let ok = page.items.filter { $0.status == "done" || $0.status == "analyzing" }
        recent = Array(ok.prefix(3))
    }

    private func shortDate(_ iso: String) -> String {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let d = withFraction.date(from: iso) ?? plain.date(from: iso) else { return String(iso.prefix(10)) }
        return d.formatted(.dateTime.day().month(.abbreviated))
    }
}
