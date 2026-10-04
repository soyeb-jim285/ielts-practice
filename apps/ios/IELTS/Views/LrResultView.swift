import SwiftUI

/// Result of a submitted Listening or Reading attempt (web components/lr/Results.tsx): band and raw score, accuracy by part and by type,
/// every answer with a Wrong-only filter, and the passage or transcript with the questions marked in place.
struct LrResultView: View {
    @Environment(APIClient.self) private var api
    let attempt: LrAttempt
    private enum Tab: String { case summary, answers, context }
    @State private var tab: Tab = .summary
    @State private var wrongOnly = true
    @State private var byPart = false
    @State private var chipsOpen = Demo.screen == "lr-result-timestamps"
    @State private var partIdx = 0
    @State private var active: Int?
    @State private var scrollTo: AnyHashable?
    @State private var scrollAnchor = UnitPoint.top
    @State private var scrollStamp = 0
    @State private var selected: Int?
    @State private var dictOpen = false
    @State private var tfngPattern: String?
    @State private var busy = false
    @State private var removing: RemovalTarget?
    @State private var removeFailed = false
    @Environment(\.dismiss) private var dismiss
    @State private var failed = false
    @State private var retakeId: String?
    @State private var vocabOpen = false
    @State private var practice = LrPracticePlayer()
    @State private var rate: Float = 1

    private var test: LrTest { attempt.test }
    private var listening: Bool { test.isListening }
    private var target: Double { api.me?.settings.targetBand ?? 7 }
    private var marks: [Int: LrMark] { Dictionary(uniqueKeysWithValues: (attempt.marks ?? []).map { ($0.n, $0) }) }
    private var section: LrSection { test.sections[min(partIdx, test.sections.count - 1)] }
    private var band: Double { attempt.band ?? 0 }
    private var raw: Int { attempt.raw ?? 0 }
    private var entries: [Int: LrGapEntry] { Dictionary((attempt.analysis?.gaps ?? []).map { ($0.n, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var moments: [Int: LrReview.QuestionMoment] {
        listening ? Dictionary(test.sections.flatMap { LrReview.questionMoments($0.timings, $0.groups) }.map { ($0.n, $0) }, uniquingKeysWith: { a, _ in a }) : [:]
    }
    private var audioPins: [LrAudioPin] {
        LrReview.questionMoments(section.timings, section.groups).map { LrAudioPin(n: $0.n, at: $0.at, correct: marks[$0.n]?.correct == true, approx: !$0.exact) }
    }
    private var transcriptPins: [LrQPin] {
        guard listening, let t = section.transcript else { return [] }
        let paras = t.components(separatedBy: "\n")
        return section.groups.flatMap { g in g.questions.compactMap { q in
            LrReview.evidenceSpan(paras, q, gap: g.type == "gap").map { LrQPin(p: $0.p, s: $0.s, n: q.n, correct: marks[q.n]?.correct == true) }
        } }
    }
    private var sel: LrFlatQ? { selected.flatMap { n in test.flat.first { $0.n == n } } }
    private var selSection: LrSection? { sel.flatMap { f in test.sections.first { $0.part == f.part } } }
    /// Evidence of the selected question, when it lies in the part on screen.
    private var span: LrReview.Span? {
        guard let f = sel, let ss = selSection, ss.part == section.part else { return nil }
        return LrReview.evidenceSpan(LrReview.sectionParagraphs(ss), f.q, gap: f.group.type == "gap")
    }

    private var wrongCount: Int { max(0, (attempt.total ?? test.flat.count) - raw) }
    private var blankNs: [Int] { test.flat.filter { marks[$0.n]?.given.isEmpty ?? true }.map(\.n) }
    private var byType: [(label: String, right: Int, total: Int)] { Lr.accuracy(test, attempt.marks ?? []) { Lr.typeLabel($0.group) } }
    private var byPartRows: [(label: String, right: Int, total: Int)] {
        test.sections.map { s in
            let qs = s.groups.flatMap { $0.questions.map { marks[$0.n] } }
            return ("\(test.partNoun) \(s.part)", qs.filter { $0?.correct == true }.count, qs.count)
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    hero
                    Picker("View", selection: $tab) {
                        Text("Summary").tag(Tab.summary)
                        Text("Answers\(wrongCount > 0 ? " (\(wrongCount))" : "")").tag(Tab.answers)
                        Text(listening ? "Transcript" : "Passage").tag(Tab.context)
                    }
                    .pickerStyle(.segmented).id("tabs")
                    switch tab {
                    case .summary: summary
                    case .answers: answers
                    case .context: context
                    }
                }
                .padding(16).padding(.bottom, 24)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .task(id: scrollStamp) {
                guard let n = scrollTo else { return }
                try? await Task.sleep(for: .milliseconds(450))
                withAnimation { proxy.scrollTo(n, anchor: scrollAnchor) }
            }
        }
        .demoScroll()
        .background(Color.canvas)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // The practice player stays in reach while you read the transcript. It stays mounted (hidden) on the other tabs so
            // "Listen from" can start it from Answers.
            if listening {
                let on = tab == .context
                VStack(spacing: 4) {
                if !audioPins.isEmpty {
                    Button { withAnimation { chipsOpen.toggle() } } label: {
                        Label(chipsOpen ? "Hide question times" : "Question times", systemImage: chipsOpen ? "chevron.down" : "chevron.up").font(.footnote.weight(.medium)).frame(minHeight: 32)
                    }
                    .buttonStyle(.plain).foregroundStyle(Color.brand)
                    .demoPress("qtimes") { withAnimation { chipsOpen.toggle() } }
                }
                LrPracticeBar(player: practice, url: Lr.assetURL(attempt.assets[section.audio ?? ""]), label: "Part \(section.part)", rate: $rate, pins: audioPins, pinned: selected, showChips: chipsOpen, onPin: { select($0); play($0) })
                }
                    .padding(12).glassBar(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .padding(.horizontal, 12).padding(.bottom, 4)
                    .opacity(on ? 1 : 0).frame(height: on ? nil : 0).clipped().accessibilityHidden(!on)
            }
        }
        .onChange(of: tab) { _, t in if t != .context, practice.playing { practice.toggle() } }
        .navigationTitle(listening ? "Listening result" : "Reading result")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Retake") { Task { await retake() } }.disabled(busy).fontWeight(.semibold) }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) { removing = RemovalTarget(id: attempt.id, title: attempt.test.title, lr: true) } label: { Label("Remove from history", systemImage: "trash") }
                } label: { Image(systemName: "ellipsis.circle") }
                    .accessibilityLabel("More actions")
            }
        }
        .confirmRemoval($removing) { t in
            Task { do { try await AttemptRemoval.remove(api, id: t.id, lr: true); dismiss() } catch { removeFailed = true } }
        }
        .alert("Could not remove this test", isPresented: $removeFailed) { Button("OK", role: .cancel) {} }
        .navigationDestination(item: $retakeId) { LrAttemptScreen(id: $0) }
        .alert("Could not start a new attempt", isPresented: $failed) { Button("OK", role: .cancel) {} }
        .sheet(isPresented: $dictOpen) {
            if let f = sel, let ss = selSection { LrDictationSheet(q: f.q, section: ss, url: Lr.assetURL(attempt.assets[ss.audio ?? ""])) }
        }
        .task { if let p: LrProgress = try? await api.get("/api/lr/progress") { tfngPattern = p.tfng.pattern?.text } }
        .onAppear {
            if wrongCount == 0 { wrongOnly = false }
            switch Demo.screen {
            case "lr-result-p2": if test.sections.count > 1 { partIdx = 1 }
            case "lr-result-detail": tab = .answers; select(9)
            case "lr-result-answers": tab = .answers; goTabs()
            case "lr-result-passage": tab = .context; goTabs()
            case "lr-result-evidence": tab = .answers; select(9); Task { try? await Task.sleep(for: .seconds(1.2)); show() }
            case "lr-result-detail-listening": tab = .answers; select(28)
            case "lr-result-transcript": tab = .context; select(28); goTabs()
            case "lr-result-timestamps": tab = .context; select(28); Task { try? await Task.sleep(for: .seconds(1.2)); show() }
            case "lr-dictation": tab = .answers; select(28); Task { try? await Task.sleep(for: .seconds(1)); dictOpen = true }
            case "lr-result-pacing": tab = .summary
            default: break
            }
        }
        .onDisappear { practice.teardown() }
        .onDemoTour { if $0 == "lrr:show" { show() } } // demo auto-tour: bring the marked answer into view
    }

    private func goTabs() { scrollTo = "tabs"; scrollAnchor = .top; scrollStamp += 1 }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(test.title).font(.display(.title2)).foregroundStyle(Color.ink)
            Text("\(listening ? "Listening" : "Reading"), \(test.variant == "academic" ? "Academic" : "General Training"), \(attempt.mode) mode, \(ShellDate.date(attempt.submittedAt ?? attempt.startedAt))"
                 + (attempt.elapsedS > 0 ? ", \(ShellDate.duration(attempt.elapsedS * 1000))" : ""))
                .font(.subheadline).foregroundStyle(Color.muted)
        }
    }

    /// Two or three plain sentences about what to fix first.
    private var takeaways: [String] {
        let weak = byType.filter { $0.total >= 3 && $0.right < $0.total }.min { Double($0.right) / Double($0.total) < Double($1.right) / Double($1.total) }
        let slips = (attempt.analysis?.gaps ?? []).filter { $0.kind == "spelling" || $0.kind == "plural" }.count
        var out: [String] = []
        if let w = weak { out.append("Weakest: \(w.label.lowercased()), \(w.right) of \(w.total) right.") }
        if slips > 0 { out.append("\(slips) \(slips == 1 ? "answer was" : "answers were") the right word with a spelling or plural slip.") }
        if !blankNs.isEmpty { out.append("\(blankNs.count) left blank. There is no penalty for guessing.") }
        if wrongCount == 0 { out.append("Every answer was correct.") }
        return Array(out.prefix(3))
    }

    private var hero: some View {
        let gap = target - band
        return VStack(alignment: .leading, spacing: 16) {
            if let parts = attempt.parts {
                // a part on its own has no band: IELTS bands only map from all 40 questions
                VStack(alignment: .leading, spacing: 4) {
                    Text("Score").font(.subheadline).foregroundStyle(Color.muted)
                    (Text("\(raw)").foregroundStyle(Color.ink) + Text("/\(attempt.total ?? 0)").foregroundStyle(Color.muted))
                        .font(.system(size: 64, weight: .bold, design: .serif).monospacedDigit())
                        .accessibilityLabel("\(raw) of \(attempt.total ?? 0) correct")
                    Text("\(Lr.partsLabel(test.skill, parts)) only. Take the full test for a band score.").font(.subheadline).foregroundStyle(Color.muted)
                }
            } else {
                HStack(alignment: .bottom, spacing: 24) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Band").font(.subheadline).foregroundStyle(Color.muted)
                        Text(fmt(band)).font(.system(size: 64, weight: .bold, design: .serif).monospacedDigit()).foregroundStyle(bandTextColor(band, target))
                            .contentTransition(.numericText()).accessibilityLabel("Band \(fmt(band))")
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        (Text("\(raw)").foregroundStyle(Color.ink) + Text("/\(attempt.total ?? 40)").foregroundStyle(Color.muted) + Text("  correct").font(.subheadline).foregroundStyle(Color.muted))
                            .font(.system(size: 28, weight: .bold, design: .serif).monospacedDigit())
                            .accessibilityLabel("\(raw) of \(attempt.total ?? 40) correct")
                        Text(gap <= 0 ? "At or above your \(fmt(target)) target" : "\(fmt(gap)) below your \(fmt(target)) target")
                            .font(.subheadline.weight(.medium)).foregroundStyle(bandTextColor(band, target))
                    }
                    .padding(.bottom, 8)
                    Spacer(minLength: 0)
                }
            }
            if wrongCount > 0 {
                Button { wrongOnly = true; tab = .answers } label: { Text("See your \(wrongCount) \(wrongCount == 1 ? "mistake" : "mistakes")").frame(maxWidth: .infinity) }
                    .primaryButton().controlSize(.large)
                    .demoPress("mistakes") { wrongOnly = true; tab = .answers }
            }
            if !takeaways.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(takeaways, id: \.self) { t in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: "circle.fill").font(.system(size: 5)).foregroundStyle(Color.brand).accessibilityHidden(true)
                            Text(t).font(.callout).foregroundStyle(Color.ink)
                        }
                    }
                }
            }
        }
        .card(padding: 18)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle("Where you lost marks")
                Picker("Group by", selection: $byPart) {
                    Text("Question type").tag(false)
                    Text(test.partNoun).tag(true)
                }
                .pickerStyle(.segmented)
                accuracyList(byPart ? byPartRows : worstFirst(byType))
            }
            if let st = attempt.stats {
                fold("How you used your time", hint: "Minutes per \(test.partNoun.lowercased()), answers you changed, last-minute answers.") {
                    LrPacingPanel(stats: st, parts: test.sections.map { (part: $0.part, questions: $0.groups.flatMap { $0.questions.map(\.n) }) }, noun: test.partNoun,
                                  totalS: listening ? nil : Double(Lr.readingLimit(attempt.parts)), marks: marks, blank: blankNs)
                }
            }
            if !(attempt.analysis?.tfng ?? []).isEmpty {
                fold("True / False / Not Given", hint: "Which statements you mix up, and the rule for each.") {
                    LrTfngPanel(rows: attempt.analysis?.tfng ?? [], pattern: tfngPattern)
                }
            }
        }
    }

    private func worstFirst(_ rows: [(label: String, right: Int, total: Int)]) -> [(label: String, right: Int, total: Int)] {
        func ratio(_ r: (label: String, right: Int, total: Int)) -> Double { r.total > 0 ? Double(r.right) / Double(r.total) : 1 }
        return rows.sorted { ratio($0) != ratio($1) ? ratio($0) < ratio($1) : $0.total > $1.total }
    }

    private func fold<C: View>(_ title: String, hint: String, @ViewBuilder _ content: () -> C) -> some View {
        let body = content()
        return DisclosureGroup {
            body.padding(.top, 12)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline).foregroundStyle(Color.ink)
                Text(hint).font(.subheadline).foregroundStyle(Color.muted).multilineTextAlignment(.leading)
            }
        }
        .tint(.brand).card()
    }

    private func accuracyList(_ rows: [(label: String, right: Int, total: Int)]) -> some View {
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

    private var answers: some View {
        let all = test.flat
        let rows = all.filter { !wrongOnly || marks[$0.n]?.correct != true }
        return VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Your answers")
            Picker("Show", selection: $wrongOnly) {
                Text("All \(all.count)").tag(false)
                Text("Wrong only (\(wrongCount))").tag(true)
            }
            .pickerStyle(.segmented)
            Text("Tap a question to see why it is wrong and where the answer is.").font(.subheadline).foregroundStyle(Color.muted)
            if rows.isEmpty {
                Text("Nothing wrong. Every answer was correct.").font(.subheadline).foregroundStyle(Color.muted).padding(.vertical, 8)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.n) { i, f in
                        answerRow(f.n).id("row\(f.n)")
                        if i < rows.count - 1 { Divider().overlay(Color.line) }
                    }
                }
                .card(padding: 4)
            }
        }
    }

    private func answerRow(_ n: Int) -> some View {
        let m = marks[n]
        let mo = moments[n]
        let open = selected == n
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                Button { jump(n) } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: m?.correct == true ? "checkmark.circle.fill" : "xmark.circle.fill").foregroundStyle(m?.correct == true ? Color.goodText : Color.bad)
                            .accessibilityHidden(true).padding(.top, 2)
                        Text("\(n)").font(.body.weight(.semibold).monospacedDigit()).foregroundStyle(Color.ink).frame(minWidth: 26, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text((m?.given.isEmpty ?? true) ? "No answer" : m!.given)
                                .font(.body).italic(m?.given.isEmpty ?? true)
                                .foregroundStyle(m?.correct == true ? Color.ink : (m?.given.isEmpty ?? true) ? Color.muted : Color.bad)
                            if m?.correct != true {
                                Text("Answer: \((m?.answer ?? []).joined(separator: " / "))").font(.subheadline.weight(.medium)).foregroundStyle(Color.goodText)
                            }
                            if let e = entries[n] { Chip(text: e.label, color: .warnText) }
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(Color.muted).rotationEffect(.degrees(open ? 180 : 0)).accessibilityHidden(true).padding(.top, 4)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 10).frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Question \(n). Your answer: \((m?.given.isEmpty ?? true) ? "none" : m!.given). \(m?.correct == true ? "Correct." : "Wrong. Correct answer: \((m?.answer ?? []).joined(separator: " or ")).")" + (entries[n].map { " \($0.label)." } ?? ""))
                .accessibilityValue(open ? "Expanded" : "Collapsed")
                .accessibilityHint("Explains the question and shows where the answer is")
                .demoPress("row:\(n)") { jump(n) }
                if let mo, let part = test.section(of: n).map({ test.sections[$0].part }) {
                    Button { select(n); play(n) } label: {
                        Label("\(mo.exact ? "" : "~")\(clock(Int(mo.at)))", systemImage: "play.fill").font(.footnote.weight(.medium).monospacedDigit())
                            .padding(.horizontal, 10).frame(minHeight: 44)
                    }
                    .buttonStyle(.plain).foregroundStyle(Color.brand)
                    .demoPress("ts:\(n)") { select(n); play(n) }
                    .accessibilityLabel("Question \(n): listen from \(test.partNoun) \(part) at \(clock(Int(mo.at)))" + (mo.exact ? "" : ", approximate"))
                }
            }
            if open, let f = sel, let ss = selSection {
                let win = ss.audio != nil ? LrReview.audioWindow(ss.timings, f.q) : nil
                LrQuestionDetail(q: f.q, mark: marks[f.n], entry: entries[f.n], listening: listening, window: win,
                                 canDictate: win?.exact == true && !(ss.timings ?? []).isEmpty && marks[f.n]?.correct == false,
                                 onShow: show, onPlay: { play(f.n) }, onDictate: { dictOpen = true })
                    .padding(14)
                    .background(Color.surface2.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 6).padding(.bottom, 8)
            }
        }
    }

    private var context: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(listening ? "Read along with the recording. The Q marks show where each answer is; tap one to hear it." : "Pick a question under Answers to mark where its answer is in the passage.")
                .font(.subheadline).foregroundStyle(Color.muted)
            Picker(test.partNoun, selection: $partIdx) {
                ForEach(Array(test.sections.enumerated()), id: \.offset) { i, s in Text("\(test.partNoun) \(s.part)").tag(i) }
            }
            .pickerStyle(.segmented)
            if listening {
                if let t = section.transcript {
                    LrTranscriptView(text: t, evidence: span, pins: transcriptPins, onPin: { select($0) }).textSelection(.enabled)
                }
            } else if section.passage != nil {
                LrPassageView(section: section, evidence: span)
            }
            if let v = section.vocab, !v.isEmpty {
                DisclosureGroup("Key vocabulary (\(v.count))", isExpanded: $vocabOpen) { LrVocabList(vocab: v).padding(.top, 8) }
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

    /// Tap a question: expand its explanation in place and mark the evidence in the passage or transcript.
    private func jump(_ n: Int) {
        if selected == n { selected = nil; return }
        select(n)
    }

    private func select(_ n: Int) {
        guard let si = test.section(of: n) else { return }
        partIdx = si
        selected = n
        active = n
        if tab == .answers { scrollTo = "row\(n)"; scrollAnchor = .top; scrollStamp += 1 }
        Task { try? await Task.sleep(for: .seconds(3)); if active == n { active = nil } }
    }

    /// "Show in passage": scroll to the marked evidence.
    private func show() {
        tab = .context
        scrollTo = "ev"; scrollAnchor = .center
        scrollStamp += 1
    }

    /// "Play from here": the recording from 2 s before the evidence to 0.5 s after it.
    private func play(_ n: Int) {
        guard let f = test.flat.first(where: { $0.n == n }), let si = test.section(of: n),
              let w = LrReview.audioWindow(test.sections[si].timings, f.q) else { return }
        partIdx = si
        practice.rate = rate
        tab = .context
        practice.play(from: w.from, to: w.to)
    }

    private func retake() async {
        busy = true
        defer { busy = false }
        do {
            var body: [String: Any] = ["mode": attempt.mode]
            if let p = attempt.parts { body["parts"] = p }
            let a: LrAttempt = try await api.send("POST", "/api/lr/tests/\(attempt.testId)/attempts", body)
            retakeId = a.id
        } catch {
            failed = true
        }
    }
}
