import SwiftUI

/// Listening or Reading hub (web components/lr/Hub.tsx): tests grouped by Cambridge book, then our own tests; status, progress and best band;
/// tapping a test opens the mode sheet, which first offers to continue an unfinished attempt.
struct LrHubView: View {
    @Environment(APIClient.self) private var api
    let skill: String // listening | reading
    @State private var items: [LrTestItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var variant = "all"
    @State private var state = Demo.screen == "lr-hub-todo" ? "todo" : "all" // all | todo | done
    @State private var pick: LrTestItem?
    @State private var runId: String?

    private var target: Double { api.me?.settings.targetBand ?? 7 }
    private var listening: Bool { skill == "listening" }
    private var icon: String { listening ? "headphones" : "book" }
    private var shown: [LrTestItem] {
        items.filter { (variant == "all" || $0.variant == variant) && (state == "all" || (state == "done") == ($0.status == "submitted")) }
    }
    private var doneCount: Int { items.filter { $0.status == "submitted" }.count }

    private struct Bucket: Identifiable { let id: String; let heading: String; let tests: [LrTestItem] }

    /// Cambridge tests grouped by book, newest first; our own tests under one heading.
    private var groups: [Bucket] {
        var books: [Int: [LrTestItem]] = [:]
        var own: [LrTestItem] = [], other: [LrTestItem] = []
        for t in shown {
            if t.source == "cambridge", let r = Lr.parseRef(t.ref) { books[r.book, default: []].append(t) } else if t.source == "cambridge" { other.append(t) } else { own.append(t) }
        }
        var out = books.keys.sorted(by: >).map { b in
            Bucket(id: "c\(b)", heading: "Cambridge IELTS \(b)", tests: books[b]!.sorted { (Lr.parseRef($0.ref)?.test ?? 0) < (Lr.parseRef($1.ref)?.test ?? 0) })
        }
        if !other.isEmpty { out.append(Bucket(id: "c", heading: "Cambridge IELTS", tests: other)) }
        if !own.isEmpty { out.append(Bucket(id: "own", heading: "Original practice tests", tests: own)) }
        return out
    }

    var body: some View {
        List {
            Section {
                Text(listening
                     ? "Four recordings, 40 questions. Take it like the real computer-delivered test, or practise with replay and slow-down."
                     : "Three passages, 40 questions, 60 minutes. Flag what to revisit and check your pace.")
                    .font(.subheadline).foregroundStyle(Color.muted)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 4, trailing: 16))
                if Set(items.map(\.variant)).count > 1 {
                    Picker("Module", selection: $variant) {
                        Text("All").tag("all")
                        Text("Academic").tag("academic")
                        Text("General").tag("general")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }
            }
            if doneCount > 0 {
                Section {
                    HStack {
                        Text("\(doneCount) of \(items.count) done").font(.subheadline).foregroundStyle(Color.muted)
                        Spacer(minLength: 12)
                        Picker("Show", selection: $state) {
                            Text("All").tag("all")
                            Text("To do").tag("todo")
                            Text("Done").tag("done")
                        }
                        .pickerStyle(.segmented).frame(maxWidth: 240)
                    }
                    .listRowBackground(Color.clear)
                }
            }
            Section { MockEntryCard(inList: true) }
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
            if api.isGuest {
                Section { GuestRecentView(skill: listening ? "listening" : "reading") }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
            }
            if let error {
                Section { ErrorLine(message: error); Button("Try again") { Task { await load() } } }
            }
            if shown.isEmpty && !items.isEmpty {
                Section { Text("No tests match this filter.").font(.subheadline).foregroundStyle(Color.muted).listRowBackground(Color.clear) }
            }
            ForEach(groups) { g in
                Section {
                    ForEach(g.tests) { t in
                        Button { pick = t } label: { row(t) }
                            .listRowBackground(Color.surface)
                    }
                } header: {
                    Text(g.heading).textCase(nil).font(.display(.headline)).foregroundStyle(Color.ink)
                }
            }
        }
        .canvasList()
        .demoScroll()
        .overlay {
            if loading && items.isEmpty {
                ProgressView()
            } else if items.isEmpty && error == nil {
                ContentUnavailableView(listening ? "No listening tests yet" : "No reading tests yet", systemImage: icon, description: Text("Tests appear here once they are imported."))
            }
        }
        .navigationTitle(listening ? "Listening" : "Reading")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .onAppear { Task { await load() } }
        .navigationDestination(item: $runId) { LrAttemptScreen(id: $0) }
        .sheet(item: $pick) { t in
            LrModeSheet(test: t) { runId = $0 }
                .presentationDetents([.height(540), .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func load() async {
        do {
            struct R: Decodable { let items: [LrTestItem] }
            let r: R = try await api.get("/api/lr/tests", query: ["skill": skill])
            items = r.items
            error = nil
            if Demo.screen == "lr-mode", pick == nil { pick = items.first { $0.attemptId == nil } }
        } catch is CancellationError {
        } catch let e as APIError where e.code == "cambridge_required" {
            error = "Listening and Reading tests are not enabled for this account."
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func row(_ t: LrTestItem) -> some View {
        let r = t.source == "cambridge" ? Lr.parseRef(t.ref) : nil
        return HStack(alignment: .center, spacing: 12) {
            Image(systemName: icon).foregroundStyle(Color.muted).frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(r.map { "Test \($0.test)" } ?? t.title).font(.body.weight(.medium)).foregroundStyle(Color.ink).multilineTextAlignment(.leading)
                if t.skill == "reading" {
                    Chip(text: t.variant == "academic" ? "Academic" : "General Training", color: t.variant == "academic" ? .muted : .sky)
                }
                Text(t.attemptId != nil ? "Resume in \(t.mode ?? "practice") mode" : t.status == "submitted" ? "Retake this test" : listening ? "40 questions, or one part at a time" : "40 questions, or one passage at a time")
                    .font(.caption).foregroundStyle(Color.muted)
            }
            Spacer(minLength: 8)
            status(t)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.muted.opacity(0.7)).accessibilityHidden(true)
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func status(_ t: LrTestItem) -> some View {
        if t.status == "in_progress" {
            VStack(alignment: .trailing, spacing: 6) {
                Text("\(t.parts == nil ? "In progress" : Lr.partsLabel(t.skill, t.parts)), \(t.answered)/\(t.total)").font(.caption.weight(.medium).monospacedDigit()).foregroundStyle(Color.brand)
                ProgressView(value: Double(t.answered), total: Double(max(t.total, 1))).frame(width: 90).tint(.brand)
                    .accessibilityLabel("\(t.answered) of \(t.total) answered")
            }
        } else if t.status == "submitted", let b = t.bestBand {
            VStack(alignment: .trailing, spacing: 2) {
                Text(fmt(b)).font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(bandTextColor(b, target)).accessibilityLabel("Best band \(fmt(b))")
                Text(t.attempts == 1 ? "1 attempt" : "\(t.attempts) attempts").font(.caption).foregroundStyle(Color.muted)
            }
        } else if t.status == "submitted" { // only parts taken: no band yet
            Text(t.attempts == 1 ? "1 attempt" : "\(t.attempts) attempts").font(.caption).foregroundStyle(Color.muted)
        } else {
            Text("Not started").font(.caption).foregroundStyle(Color.muted)
        }
    }
}

/// Exam or Practice and the whole test or one part (same rules as the web dialog), then Start.
/// A test with an unfinished attempt first offers Continue or Start new; starting new discards it.
struct LrModeSheet: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    let test: LrTestItem
    let onStart: (String) -> Void
    @State private var mode = "exam"
    @State private var part = 0 // 0 = the whole test
    @State private var startNew = false
    @State private var busy = false
    @State private var failed = false

    private var listening: Bool { test.skill == "listening" }
    private var noun: String { listening ? "Part" : "Passage" }
    private var parts: [Int]? { part == 0 ? nil : [part] }
    private var modes: [(key: String, title: String, hint: String, icon: String)] {
        [("exam", "Exam", listening ? "The recording plays once, with no pause or rewind. Then 2 minutes to check, and it submits itself." : "\(Lr.readingLimit(parts) / 60)-minute countdown. Submits itself when time is up.", "timer"),
         ("practice", "Practice", listening ? "Pause, rewind, slow down to 0.75× and replay any part. No time limit." : "No time limit. A clock counts up so you can see your pace.", "slider.horizontal.3")]
    }

    private var heading: some View {
        Text(Lr.parseRef(test.ref).map { "Cambridge IELTS \($0.book), Test \($0.test)" } ?? test.title).font(.display(.title2)).foregroundStyle(Color.ink)
    }

    var body: some View {
        if let open = test.attemptId, !startNew {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    heading
                    Text("You have an unfinished \(test.mode ?? "practice") attempt (\(Lr.partsLabel(test.skill, test.parts).lowercased()), \(test.answered) of \(test.total) answered). Continue where you left off, or start again.")
                        .font(.subheadline).foregroundStyle(Color.muted)
                }
                Spacer(minLength: 0)
                HStack(spacing: 12) {
                    Button("Start new") { startNew = true }.secondaryButton().controlSize(.large)
                    Button { dismiss(); onStart(open) } label: { Text("Continue").frame(maxWidth: .infinity) }
                        .primaryButton().controlSize(.large)
                }
            }
            .padding(20)
            .background(Color.canvas)
        } else {
            chooser
        }
    }

    private var chooser: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                heading
                Text("Choose how to take this test.").font(.subheadline).foregroundStyle(Color.muted)
            }
            ForEach(modes, id: \.key) { m in
                Button { mode = m.key } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: mode == m.key ? "largecircle.fill.circle" : "circle").font(.title3).foregroundStyle(mode == m.key ? Color.brand : Color.muted)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.title).font(.headline).foregroundStyle(Color.ink)
                            Text(m.hint).font(.subheadline).foregroundStyle(Color.muted).multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(14)
                    .background(mode == m.key ? Color.brandSoft : Color.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(mode == m.key ? Color.brand : Color.line, lineWidth: mode == m.key ? 2 : 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(mode == m.key ? .isSelected : [])
            }
            VStack(alignment: .leading, spacing: 6) {
                Picker(noun, selection: $part) {
                    Text("All").tag(0)
                    ForEach(Lr.partNumbers(test.skill), id: \.self) { Text("\($0)").tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityLabel(noun)
                Text(part == 0 ? "The full test, scored as a band." : "Only \(noun.lowercased()) \(part). Scored out of its questions, with no band.")
                    .font(.caption).foregroundStyle(Color.muted)
            }
            if test.attemptId != nil { Text("Your unfinished attempt will be discarded.").font(.caption).foregroundStyle(Color.muted) }
            if failed { ErrorLine(message: "Could not start the test. Try again.") }
            Spacer(minLength: 0)
            HStack(spacing: 12) {
                Button("Cancel") { dismiss() }.secondaryButton().controlSize(.large)
                Button { Task { await start() } } label: {
                    HStack { if busy { ProgressView() }; Text(part == 0 ? "Start \(mode) test" : "Start \(mode) \(noun.lowercased()) \(part)") }.frame(maxWidth: .infinity)
                }
                .primaryButton().controlSize(.large).disabled(busy)
            }
        }
        .padding(20)
        .background(Color.canvas)
    }

    private func start() async {
        busy = true; failed = false
        defer { busy = false }
        do {
            // fresh: an unfinished attempt of this test is discarded (the user chose Start new)
            var body: [String: Any] = ["mode": mode, "fresh": true]
            if let p = parts { body["parts"] = p }
            let a: LrAttempt = try await api.send("POST", "/api/lr/tests/\(test.id)/attempts", body)
            dismiss()
            onStart(a.id)
        } catch {
            failed = true
        }
    }
}
