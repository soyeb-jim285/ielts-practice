import SwiftUI

/// Result of a submitted Listening or Reading attempt (web components/lr/Results.tsx): band and raw score, accuracy by part and by type,
/// every answer with a Wrong-only filter, and the passage or transcript with the questions marked in place.
struct LrResultView: View {
    @Environment(APIClient.self) private var api
    let attempt: LrAttempt
    @State private var wrongOnly = false
    @State private var partIdx = 0
    @State private var active: Int?
    @State private var scrollTo: Int?
    @State private var scrollStamp = 0
    @State private var busy = false
    @State private var failed = false
    @State private var retakeId: String?
    @State private var passageOpen = false
    @State private var practice = LrPracticePlayer()
    @State private var rate: Float = 1

    private var test: LrTest { attempt.test }
    private var listening: Bool { test.isListening }
    private var target: Double { api.me?.settings.targetBand ?? 7 }
    private var marks: [Int: LrMark] { Dictionary(uniqueKeysWithValues: (attempt.marks ?? []).map { ($0.n, $0) }) }
    private var section: LrSection { test.sections[min(partIdx, test.sections.count - 1)] }
    private var band: Double { attempt.band ?? 0 }
    private var raw: Int { attempt.raw ?? 0 }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header
                    score
                    accuracy
                    answers
                    context
                }
                .padding(16).padding(.bottom, 24)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .task(id: scrollStamp) {
                guard let n = scrollTo else { return }
                try? await Task.sleep(for: .milliseconds(350))
                withAnimation { proxy.scrollTo(n, anchor: .center) }
            }
        }
        .demoScroll()
        .background(Color.canvas)
        .navigationTitle(listening ? "Listening result" : "Reading result")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Retake") { Task { await retake() } }.disabled(busy).fontWeight(.semibold) } }
        .navigationDestination(item: $retakeId) { LrAttemptScreen(id: $0) }
        .alert("Could not start a new attempt", isPresented: $failed) { Button("OK", role: .cancel) {} }
        .onAppear {
            if Demo.screen == "lr-result-p2", test.sections.count > 1 { partIdx = 1 }
        }
        .onDisappear { practice.teardown() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(test.title).font(.display(.title2)).foregroundStyle(Color.ink)
            Text("\(listening ? "Listening" : "Reading"), \(test.variant == "academic" ? "Academic" : "General Training"), \(attempt.mode) mode, \(ShellDate.date(attempt.submittedAt ?? attempt.startedAt))"
                 + (attempt.elapsedS > 0 ? ", \(ShellDate.duration(attempt.elapsedS * 1000))" : ""))
                .font(.subheadline).foregroundStyle(Color.muted)
        }
    }

    private var score: some View {
        let gap = target - band
        return HStack(alignment: .bottom, spacing: 28) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Band").font(.caption).foregroundStyle(Color.muted)
                Text(fmt(band)).font(.system(size: 64, weight: .bold, design: .serif).monospacedDigit()).foregroundStyle(bandTextColor(band, target))
                    .contentTransition(.numericText()).accessibilityLabel("Band \(fmt(band))")
            }
            VStack(alignment: .leading, spacing: 6) {
                (Text("\(raw)").foregroundStyle(Color.ink) + Text("/\(attempt.total ?? 40)").foregroundStyle(Color.muted) + Text("  correct").font(.caption).foregroundStyle(Color.muted))
                    .font(.system(size: 28, weight: .bold, design: .serif).monospacedDigit())
                    .accessibilityLabel("\(raw) of \(attempt.total ?? 40) correct")
                Text(gap <= 0 ? "At or above your \(fmt(target)) target" : "\(fmt(gap)) below your \(fmt(target)) target")
                    .font(.subheadline.weight(.medium)).foregroundStyle(bandTextColor(band, target))
            }
            .padding(.bottom, 8)
            Spacer(minLength: 0)
        }
        .card()
    }

    private var accuracy: some View {
        let byPart = test.sections.map { s -> (label: String, right: Int, total: Int) in
            let qs = s.groups.flatMap { $0.questions.map { marks[$0.n] } }
            return ("\(test.partNoun) \(s.part)", qs.filter { $0?.correct == true }.count, qs.count)
        }
        let byType = Lr.accuracy(test, attempt.marks ?? []) { Lr.typeLabel($0.group) }
        return VStack(alignment: .leading, spacing: 24) {
            accuracyBlock("By \(test.partNoun.lowercased())", byPart)
            accuracyBlock("By question type", byType)
        }
    }

    private func accuracyBlock(_ title: String, _ rows: [(label: String, right: Int, total: Int)]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title)
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                    let ratio = r.total > 0 ? Double(r.right) / Double(r.total) : 0
                    VStack(spacing: 6) {
                        HStack {
                            Text(r.label).font(.body).foregroundStyle(Color.ink)
                            Spacer(minLength: 8)
                            Text("\(r.right)/\(r.total)").font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(Color.ink)
                        }
                        ProgressView(value: ratio).tint(ratio >= 0.75 ? .good : ratio >= 0.5 ? .warn : .bad)
                    }
                    .padding(.vertical, 10)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(r.label): \(r.right) of \(r.total) correct")
                    if i < rows.count - 1 { Divider().overlay(Color.line) }
                }
            }
            .card(padding: 14)
        }
    }

    private var answers: some View {
        let all = test.flat
        let rows = all.filter { !wrongOnly || marks[$0.n]?.correct != true }
        return VStack(alignment: .leading, spacing: 10) {
            SectionTitle("Your answers")
            Picker("Filter", selection: $wrongOnly) {
                Text("All \(all.count)").tag(false)
                Text("Wrong only (\(all.count - raw))").tag(true)
            }
            .pickerStyle(.segmented)
            if rows.isEmpty {
                Text("Nothing wrong. Every answer was correct.").font(.subheadline).foregroundStyle(Color.muted).padding(.vertical, 8)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.n) { i, f in
                        answerRow(f.n)
                        if i < rows.count - 1 { Divider().overlay(Color.line) }
                    }
                }
                .card(padding: 4)
            }
        }
    }

    private func answerRow(_ n: Int) -> some View {
        let m = marks[n]
        return Button { jump(n) } label: {
            HStack(alignment: .top, spacing: 12) {
                Text("\(n)").font(.body.weight(.semibold).monospacedDigit()).foregroundStyle(Color.brand).frame(width: 34, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text((m?.given.isEmpty ?? true) ? "No answer" : m!.given)
                        .font(.body).italic(m?.given.isEmpty ?? true)
                        .foregroundStyle(m?.correct == true ? Color.ink : (m?.given.isEmpty ?? true) ? Color.muted : Color.bad)
                    if m?.correct != true {
                        Text("Correct: \((m?.answer ?? []).joined(separator: " / "))").font(.subheadline.weight(.medium)).foregroundStyle(Color.goodText)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: m?.correct == true ? "checkmark.circle.fill" : "xmark.circle.fill").foregroundStyle(m?.correct == true ? Color.goodText : Color.bad)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 10).padding(.vertical, 10).frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Question \(n). Your answer: \((m?.given.isEmpty ?? true) ? "none" : m!.given). \(m?.correct == true ? "Correct." : "Wrong. Correct answer: \((m?.answer ?? []).joined(separator: " or ")).")")
        .accessibilityHint("Shows the question in context")
    }

    private var context: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(listening ? "Transcript and questions" : "Passage and questions")
            Text("Tap a number above to jump to that question.").font(.footnote).foregroundStyle(Color.muted)
            Picker(test.partNoun, selection: $partIdx) {
                ForEach(Array(test.sections.enumerated()), id: \.offset) { i, s in Text("\(test.partNoun) \(s.part)").tag(i) }
            }
            .pickerStyle(.segmented)
            if listening {
                LrPracticeBar(player: practice, url: Lr.assetURL(attempt.assets[section.audio ?? ""]), label: "Part \(section.part)", rate: $rate)
                    .padding(14).glassBar(RoundedRectangle(cornerRadius: 22, style: .continuous))
                if let t = section.transcript {
                    DisclosureGroup("Transcript", isExpanded: $passageOpen) {
                        Text(t).font(.body).fontDesign(.serif).lineSpacing(5).foregroundStyle(Color.ink).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                    }
                    .font(.headline).foregroundStyle(Color.ink).tint(.brand).card()
                }
            } else if section.passage != nil {
                DisclosureGroup("Passage", isExpanded: $passageOpen) {
                    LrPassageView(section: section).padding(.top, 8)
                }
                .font(.headline).foregroundStyle(Color.ink).tint(.brand).card()
            }
            VStack(alignment: .leading, spacing: 32) {
                ForEach(section.groups) { g in
                    LrGroupView(group: g, ctx: LrCtx(responses: attempt.responses, assets: attempt.assets, review: marks, active: active))
                }
            }
            .padding(.top, 8)
        }
    }

    private func jump(_ n: Int) {
        guard let si = test.section(of: n) else { return }
        partIdx = si
        active = n
        scrollTo = n
        scrollStamp += 1
        Task { try? await Task.sleep(for: .seconds(3)); if active == n { active = nil } }
    }

    private func retake() async {
        busy = true
        defer { busy = false }
        do {
            let a: LrAttempt = try await api.send("POST", "/api/lr/tests/\(attempt.testId)/attempts", ["mode": attempt.mode])
            retakeId = a.id
        } catch {
            failed = true
        }
    }
}
