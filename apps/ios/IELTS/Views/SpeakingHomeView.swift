import SwiftUI

/// Speaking hub (web: routes/_app/speaking/index.tsx): unsent recordings, the two ways to practise, single parts, recent results.
struct SpeakingHomeView: View {
    @Environment(APIClient.self) private var api
    @State private var recent: [AttemptListItem]?
    @State private var recentError: String?
    @State private var openResult: String?
    @State private var deleting: PendingRecording?

    private var store: PendingStore { .shared }
    private var target: Double { api.me?.settings.targetBand ?? 7 }
    /// No attempts yet: the first action is a single part, so that list leads and the full modes follow.
    private var fresh: Bool { recent?.isEmpty == true }

    private struct PartInfo: Identifiable {
        let n: Int, title: String, desc: String, time: String
        var id: Int { n }
    }

    private let parts = [
        PartInfo(n: 1, title: "Interview", desc: "Everyday questions about you, your home, work or studies.", time: "4-5 min"),
        PartInfo(n: 2, title: "Long turn", desc: "A cue card, one minute to prepare with notes, then up to two minutes of talking.", time: "3-4 min"),
        PartInfo(n: 3, title: "Discussion", desc: "Abstract follow-up questions. Develop each idea with reasons and examples.", time: "4-5 min"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Text("Record your answers and get a band for each criterion, with every mistake and pause located in your transcript.")
                    .foregroundStyle(.muted)
                if fresh { partsSection }
                pendingSection
                modesSection
                if !fresh { partsSection }
                recentSection
                bankLink
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
        .demoScroll()
        .background(Color.canvas)
        .navigationTitle("Speaking")
        .navigationDestination(item: $openResult) { id in ResultView(ids: [id]) }
        .task { await loadRecent() }
        .task { await api.loadQuota() }
        .refreshable { await loadRecent(); await api.loadQuota(force: true) }
        .onAppear { store.reload() }
        .confirmationDialog("Delete this recording?",
                            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { p in
            Button("Delete", role: .destructive) { Task { await store.discard(p, api: api) } }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("The recording is removed from this device and can't be uploaded afterwards.")
        }
    }

    // MARK: Pending uploads

    /// Recordings that never finished uploading (kept on this device). Hidden when there are none.
    @ViewBuilder private var pendingSection: some View {
        if !store.items.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Label(store.items.count == 1 ? "A recording was not uploaded" : "\(store.items.count) recordings were not uploaded",
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(Color.warnText)
                    Text("They are still saved on this device. Upload them to get your band, or delete them.")
                        .font(.subheadline).foregroundStyle(.muted)
                }
                .card()
                VStack(spacing: 0) {
                    ForEach(Array(store.items.enumerated()), id: \.element.id) { i, p in
                        if i > 0 { Divider() }
                        pendingRow(p)
                    }
                }
                .card(padding: 0)
            }
        }
    }

    private func pendingRow(_ p: PendingRecording) -> some View {
        let state = store.states[p.id]
        let uploading = state == UploadState.uploading
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.label).font(.subheadline.weight(.medium)).lineLimit(2)
                Text("Recorded \(speakingRelative(p.createdAt))").font(.caption).foregroundStyle(.muted)
                if case let .failed(message)? = state { Text(message).font(.caption).foregroundStyle(.bad) }
            }
            HStack(spacing: 8) {
                Button {
                    Task { if let id = await store.upload(p, api: api) { openResult = id } }
                } label: {
                    if uploading { ProgressView() } else { Label("Upload now", systemImage: "arrow.clockwise") }
                }
                .secondaryButton()
                .disabled(uploading)
                Button("Delete", role: .destructive) { deleting = p }
                    .buttonStyle(.borderless)
                    .frame(minHeight: 44)
                    .disabled(uploading)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Modes

    private var modesSection: some View {
        VStack(spacing: 16) {
            modeCard(icon: "list.number", kind: "Practice test, at your own pace", title: "Full practice test",
                     text: "All three parts in order, like test day. You read each question, record your answer, and every part is scored plus an overall band.",
                     meta: "11-14 min, recorded", cta: "Start full test", route: .speaking(.full), live: false)
            modeCard(icon: "waveform", kind: "Live, spoken conversation", title: "Live examiner",
                     text: "An AI examiner asks the questions aloud, listens, and follows up on what you say, like the real interview. The whole test is scored at the end.",
                     meta: "11-14 min, needs a microphone", cta: "Talk to the examiner", route: .live, live: true)
        }
    }

    /// Static card; the button is the only interactive part. The live examiner sits on a soft teal wash, the self-paced test on the plain surface.
    private func modeCard(icon: String, kind: String, title: String, text: String, meta: String, cta: String, route: Route, live: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Label {
                    Text(kind).foregroundStyle(.muted)
                } icon: {
                    Image(systemName: icon).foregroundStyle(live ? Color.brand : Color.ink)
                }
                .font(.caption)
                Text(title).font(.display(.title2)).foregroundStyle(.ink)
                Text(text).foregroundStyle(.muted)
            }
            Divider()
            Text(meta).font(.caption.monospacedDigit()).foregroundStyle(.muted)
            NavigationLink(value: route) {
                HStack(spacing: 6) {
                    Text(cta)
                    Image(systemName: "arrow.right").accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity)
            }
            .secondaryButton()
            .controlSize(.large)
            if live { liveNote } else { QuotaLabel(skill: "speaking").frame(maxWidth: .infinity, alignment: .center) }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack {
                Color.surface
                if live { Color.brandSoft.opacity(0.7) }
            }
            .clipShape(shape)
        }
        .overlay(shape.strokeBorder(live ? Color.brand.opacity(0.25) : Color.line))
    }

    /// The live examiner never runs on the community balance: it needs an own OpenRouter, OpenAI or Gemini key.
    @ViewBuilder private var liveNote: some View {
        if let q = api.quota {
            Text(q.liveProviders.isEmpty ? "Needs your own API key" : "Runs on your own key")
                .font(.caption).foregroundStyle(.muted).frame(maxWidth: .infinity, alignment: .center)
        }
    }

    // MARK: Parts

    private var partsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(fresh ? "Start with one part" : "Or practise one part")
            QuotaLabel(skill: "speaking")
            VStack(spacing: 0) {
                ForEach(parts) { p in
                    if p.n > 1 { Divider() }
                    NavigationLink(value: Route.speaking(.part(p.n))) {
                        HStack(spacing: 14) {
                            Text("\(p.n)").font(.display(.title, weight: .medium)).foregroundStyle(.muted)
                                .frame(width: 28).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text("Part \(p.n): \(p.title)").font(.headline).foregroundStyle(.ink)
                                    Spacer(minLength: 8)
                                    Text(p.time).font(.caption.monospacedDigit()).foregroundStyle(.muted)
                                }
                                Text(p.desc).font(.subheadline).foregroundStyle(.muted)
                            }
                            .multilineTextAlignment(.leading)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.muted)
                                .accessibilityHidden(true)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .card(padding: 0)
        }
    }

    // MARK: Recent results

    /// Last few speaking results. Hidden once loaded with none.
    @ViewBuilder private var recentSection: some View {
        if let items = recent {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline) {
                        SectionTitle("Recent results")
                        NavigationLink("View all", value: Route.history(skill: "speaking"))
                            .font(.subheadline.weight(.medium))
                            .frame(minHeight: 44)
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(items.prefix(5).enumerated()), id: \.element.id) { i, a in
                            if i > 0 { Divider() }
                            attemptRow(a)
                        }
                    }
                    .card(padding: 0)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle("Recent results")
                if recentError != nil {
                    HStack {
                        Text("Couldn't load your results.").foregroundStyle(.muted)
                        Button("Try again") { Task { await loadRecent() } }.frame(minHeight: 44)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24).accessibilityLabel("Loading recent results")
                }
            }
        }
    }

    private func attemptRow(_ a: AttemptListItem) -> some View {
        let when = speakingRelative(iso: a.createdAt)
        return NavigationLink(value: Route.result([a.id])) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(speakingSentenceCase(a.promptTitle)).font(.headline).foregroundStyle(.ink).lineLimit(2)
                    Text(when.isEmpty ? "Part \(a.part)" : "Part \(a.part), \(when)").font(.subheadline).foregroundStyle(.muted)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                if a.status == "done", let o = a.overall {
                    Text(Band.format(o)).font(.display(.title3)).monospacedDigit()
                        .foregroundStyle(bandTextColor(o, target))
                        .accessibilityLabel("Band \(Band.format(o))")
                } else if a.status == "failed" {
                    Text("Failed").font(.caption).foregroundStyle(.bad)
                } else {
                    Text(a.status == "analyzing" ? "Scoring" : "Not submitted").font(.caption).foregroundStyle(.muted)
                }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.muted).accessibilityHidden(true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var bankLink: some View {
        NavigationLink(value: Route.bank(skill: "speaking")) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Prompt bank").font(.headline).foregroundStyle(.ink)
                    Text("Search every topic and cue card").font(.subheadline).foregroundStyle(.muted)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.muted).accessibilityHidden(true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .card(padding: 0)
    }

    private func loadRecent() async {
        guard api.isSignedIn else { recent = []; return } // guests have no results
        do {
            let page: AttemptPage = try await api.get("/api/attempts", query: ["skill": "speaking", "page": "1"])
            recent = page.items
            recentError = nil
        } catch is CancellationError {
        } catch {
            if recent == nil { recentError = error.localizedDescription }
        }
    }
}

// MARK: Formatting (web: formatRelative, sentenceCase)

private func speakingRelative(_ date: Date) -> String {
    RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
}

private func speakingRelative(iso: String) -> String {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
    return speakingRelative(date)
}

/// ALL-CAPS prompt titles from the bank read as sentences.
private func speakingSentenceCase(_ t: String) -> String {
    guard t == t.uppercased(), t.range(of: "[A-Z]{2}", options: .regularExpression) != nil else { return t }
    return String(t.prefix(1)) + t.dropFirst().lowercased()
}
