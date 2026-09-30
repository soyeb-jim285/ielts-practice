import SwiftUI

/// Results for one attempt or a session of attempts (part switcher + session overall). Polls until analysis finishes.
struct ResultView: View {
    let ids: [String]

    @Environment(APIClient.self) private var api
    @State private var attempts: [String: Attempt] = [:]
    @State private var selected = 0
    @State private var poll = 0
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            if ids.isEmpty {
                ContentUnavailableView("Nothing to score", systemImage: "waveform.slash", description: Text("No answers were recorded."))
            } else {
                if ids.count > 1 { sessionHeader }
                content
            }
        }
        .background(.canvas)
        .navigationTitle("Results")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: poll) { await pollUntilDone() }
    }

    @ViewBuilder
    private var content: some View {
            if let error, attempts[ids[selected]] == nil {
                ContentUnavailableView { Label("Couldn't load results", systemImage: "wifi.exclamationmark") } description: { Text(error) } actions: {
                    Button("Retry") { poll += 1 }.buttonStyle(.borderedProminent)
                }
            } else if let a = attempts[ids[selected]] {
                AttemptResultView(attempt: a) { Task { await retry(a.id) } }
                    .id(a.id)
            } else {
                ProgressView().frame(maxHeight: .infinity)
            }
    }

    private func pollUntilDone() async {
        while !Task.isCancelled {
            for id in ids where attempts[id]?.finished != true {
                do {
                    attempts[id] = try await api.get("/api/attempts/\(id)")
                    error = nil
                } catch is CancellationError {
                    return
                } catch {
                    self.error = error.localizedDescription
                }
            }
            if ids.allSatisfy({ attempts[$0]?.finished == true }) { return }
            try? await Task.sleep(for: .seconds(2))
        }
    }

    private func retry(_ id: String) async {
        do {
            let _: Empty = try await api.send("POST", "/api/attempts/\(id)/submit", [String: String]())
            attempts[id] = nil
            poll += 1
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var sessionHeader: some View {
        VStack(spacing: 10) {
            if let o = sessionOverall {
                HStack {
                    Text("Session overall").font(.headline)
                    Spacer()
                    Text("raw \(fmt(o.raw, 2))").font(.caption).foregroundStyle(.secondary)
                    BandPill(band: o.band, target: api.me?.settings.targetBand ?? 7)
                }
            }
            Picker("Part", selection: $selected) {
                ForEach(Array(ids.enumerated()), id: \.offset) { i, id in
                    Text(partLabel(i, id)).tag(i)
                }
            }
            .pickerStyle(.segmented)
        }
        .padding()
        .background(.bar)
    }

    private func partLabel(_ i: Int, _ id: String) -> String {
        guard let a = attempts[id] else { return "\(i + 1)" }
        return a.skill == "speaking" ? "P\(a.part)" : "T\(a.part)"
    }

    /// Speaking: criteria averaged across parts weighted by speaking time. Writing: (T1 + 2·T2) / 3.
    private var sessionOverall: (raw: Double, band: Double)? {
        let done = ids.compactMap { attempts[$0] }.filter { $0.analysis != nil && $0.analysis?.noSpeech != true }
        guard done.count == ids.count, let first = done.first else { return nil }
        if first.skill == "writing" {
            let t1 = done.first(where: { $0.part == 1 })?.analysis?.overallRaw
            let t2 = done.first(where: { $0.part == 2 })?.analysis?.overallRaw
            return t1 == nil && t2 == nil ? nil : Band.writingOverall(t1: t1, t2: t2)
        }
        func avg(_ k: String) -> Double {
            var sum = 0.0, weight = 0.0
            for a in done {
                guard let r = a.analysis, let c = r.criteria[k] else { continue }
                let w = max(r.metrics?.durationS ?? 1, 1)
                sum += c.band * w
                weight += w
            }
            return weight > 0 ? sum / weight : 0
        }
        return Band.speakingOverall(fc: avg("fc"), lr: avg("lr"), gra: avg("gra"), p: avg("p"))
    }
}

struct AttemptResultView: View {
    let attempt: Attempt
    let onRetry: () -> Void

    @Environment(APIClient.self) private var api
    @State private var tab = "Overview"
    @State private var player = Player()
    @State private var selectedError: AnalysisError?
    @State private var toast: String?
    @State private var parentText: String?

    private var speaking: Bool { attempt.skill == "speaking" }
    private var tabs: [String] { speaking ? ["Overview", "Transcript", "Fluency", "Language", "Improve"] : ["Overview", "Essay", "Structure", "Language", "Improve"] }
    private var target: Double { api.me?.settings.targetBand ?? 7 }

    var body: some View {
        Group {
            switch attempt.status {
            case "done":
                if let r = attempt.analysis { done(r) } else { ContentUnavailableView("No analysis", systemImage: "questionmark.circle") }
            case "failed":
                ContentUnavailableView {
                    Label("Analysis failed", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(attempt.error ?? "Something went wrong. Your answer is saved.")
                } actions: {
                    Button("Retry analysis", action: onRetry).buttonStyle(.borderedProminent)
                }
            default: analyzing
            }
        }
        .task(id: attempt.audioUrl) {
            guard speaking, let u = attempt.audioUrl, !player.isLoaded, let d = try? await api.download(u) else { return }
            try? player.load(d)
        }
        .task(id: attempt.parentAttemptId) {
            guard let id = attempt.parentAttemptId, let p: Attempt = try? await api.get("/api/attempts/\(id)") else { return }
            parentText = p.answerText
        }
        .onDisappear { player.stop() }
        .sheet(item: $selectedError) { e in
            ErrorSheet(error: e, onPlay: e.time == nil ? nil : { player.seek(to: max(0, (e.time ?? 0) - 0.3)) })
                .presentationDetents([.medium])
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast).font(.subheadline.weight(.semibold)).padding(12).background(.thinMaterial, in: Capsule()).padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: toast)
    }

    private var analyzing: some View {
        VStack(spacing: 16) {
            ProgressView().controlSize(.large)
            Text("Analysing your answer…").font(.headline)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(speaking ? ["Transcribing", "Measuring fluency", "Scoring against the band descriptors"]
                        : ["Measuring your text", "Checking structure", "Scoring against the band descriptors"], id: \.self) { s in
                    Label(s, systemImage: "circle.dotted")
                }
            }
            .foregroundStyle(.secondary)
            Text("This usually takes under a minute.").font(.caption).foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func done(_ r: AnalysisResult) -> some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tabs, id: \.self) { t in
                        Button(t) { tab = t }
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .foregroundStyle(tab == t ? Color.white : Color.primary)
                            .background(tab == t ? Color.brand : Color.surface, in: Capsule())
                            .accessibilityAddTraits(tab == t ? .isSelected : [])
                    }
                }
                .padding(.horizontal).padding(.vertical, 10)
            }
            if speaking && player.isLoaded && (tab == "Transcript" || tab == "Fluency" || tab == "Language") { audioBar }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    switch tab {
                    case "Transcript": TranscriptView(result: r, player: player) { selectedError = $0 }
                    case "Fluency": if let m = r.metrics { FluencyView(metrics: m, player: player) } else { Text("No fluency data.") }
                    case "Essay": EssayView(result: r, text: r.text ?? attempt.text ?? "") { selectedError = $0 }
                    case "Structure": StructureView(structure: r.structure)
                    case "Language": LanguageView(result: r, player: player) { selectedError = $0 }
                    case "Improve": improve(r)
                    default: overview(r)
                    }
                }
                .padding()
            }
        }
    }

    private var audioBar: some View {
        HStack(spacing: 12) {
            Button { player.toggle() } label: { Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill").font(.title) }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            Slider(value: Binding(get: { player.currentTime }, set: { player.seek(to: $0, play: player.isPlaying) }), in: 0...max(player.duration, 0.1))
            Text(clock(Int(player.currentTime))).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: Overview

    @ViewBuilder
    private func overview(_ r: AnalysisResult) -> some View {
        Text(attempt.prompt.title).font(.headline).foregroundStyle(.secondary)
        if r.noSpeech == true {
            ContentUnavailableView("No speech detected", systemImage: "waveform.slash", description: Text("We couldn't hear an answer in this recording. Check your microphone and try again."))
        } else {
            VStack(spacing: 6) {
                Text(Band.format(r.overall)).font(.system(size: 76, weight: .bold, design: .rounded)).foregroundStyle(bandColor(r.overall, target))
                HStack {
                    if r.range.count == 2 { Chip(text: "likely \(Band.format(r.range[0]))–\(Band.format(r.range[1]))", color: .brand) }
                    Chip(text: "raw \(fmt(r.overallRaw, 2))")
                    if r.calibrated == false { Chip(text: "uncalibrated", color: .warn).accessibilityHint("Estimated with an unvalidated model: scores may be off by about a band.") }
                    if attempt.overtime == true { Chip(text: "overtime", color: .warn) }
                    if r.tooShort == true { Chip(text: "under word limit", color: .bad) }
                }
            }
            .frame(maxWidth: .infinity)
            .card()
            if let c = r.comparison { comparison(c, r) }
            ForEach(Crit.order(attempt.skill), id: \.self) { k in
                if let c = r.criteria[k] { criterionCard(k, c) }
            }
            if !r.topFixes.isEmpty {
                SectionTitle("3 things to fix next")
                ForEach(Array(r.topFixes.enumerated()), id: \.offset) { i, f in FixCard(index: i + 1, fix: f) }
            }
        }
    }

    private func comparison(_ c: AnalysisResult.Comparison, _ r: AnalysisResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Compared with your previous try: \(Band.format(c.parentOverall)) → \(Band.format(r.overall))").font(.subheadline.weight(.semibold))
            HStack(spacing: 12) {
                ForEach(Crit.order(attempt.skill), id: \.self) { k in
                    if let d = c.deltas[k] {
                        Label("\(k.uppercased()) \(d >= 0 ? "+" : "")\(Band.format(d))", systemImage: d > 0 ? "arrow.up" : d < 0 ? "arrow.down" : "equal")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(d > 0 ? Color.good : d < 0 ? Color.bad : Color.secondary)
                    }
                }
            }
        }
        .card()
    }

    private func criterionCard(_ k: String, _ c: Criterion) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(Crit.label(k)).font(.headline)
                Spacer()
                BandPill(band: c.band, target: target)
            }
            ProgressView(value: min(c.band, 9), total: 9).tint(bandColor(c.band, target))
            Text("“\(c.descriptor)”").font(.callout.italic()).foregroundStyle(.secondary)
            Text(c.summary)
            if !c.evidence.isEmpty {
                ForEach(c.evidence, id: \.self) { e in
                    Text("› \(e)").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .card()
    }

    // MARK: Improve

    @ViewBuilder
    private func improve(_ r: AnalysisResult) -> some View {
        if let before = parentText, let now = attempt.answerText {
            SectionTitle("Since your last attempt")
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) { Chip(text: "removed", color: .bad); Chip(text: "added", color: .good) }
                Text(diffText(wordDiff(before, now))).font(speaking ? .body : .system(.body, design: .serif)).textSelection(.enabled)
            }
            .card()
        }
        SectionTitle(speaking ? "A band-higher version of your answer" : "A band-higher version of your essay")
        VStack(alignment: .leading, spacing: 10) {
            Text(r.rewrite.text).font(speaking ? .body : .system(.body, design: .serif)).textSelection(.enabled)
            Label(r.rewrite.note, systemImage: "exclamationmark.bubble").font(.footnote).foregroundStyle(.warn)
        }
        .card()
        if let v = r.vocabUpgrades, !v.isEmpty {
            SectionTitle("Vocabulary upgrades")
            ForEach(Array(v.enumerated()), id: \.offset) { _, u in VocabRow(upgrade: u) }
        }
        NavigationLink(value: speaking ? Route.speaking(.prompt(id: attempt.promptId, parent: attempt.id)) : Route.writing(.prompt(id: attempt.promptId, parent: attempt.id))) {
            Label("Retry this \(speaking ? "question" : "task")", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent).controlSize(.large)
        if !r.topFixes.isEmpty {
            Button {
                Task {
                    do {
                        for f in r.topFixes { try await api.addCard(front: f.before, back: "\(f.after)\n\n\(f.title): \(f.why)", source: "fix") }
                        await show("Added \(r.topFixes.count) cards to your deck")
                    } catch { await show(error.localizedDescription) }
                }
            } label: { Label("Add top fixes to review deck", systemImage: "rectangle.stack.badge.plus").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered).controlSize(.large)
        }
    }

    private func show(_ message: String) async {
        toast = message
        try? await Task.sleep(for: .seconds(2))
        toast = nil
    }
}

enum DiffOp: Equatable { case same, removed, added }

/// Word-level diff (LCS over whitespace tokens), merged into runs. Spec §7: a retry shows a word diff against its parent.
/// ponytail: O(n·m) table, fine for answers of a few hundred words; Myers diff if essays get much longer.
func wordDiff(_ old: String, _ new: String) -> [(op: DiffOp, text: String)] {
    let a = old.split(whereSeparator: \.isWhitespace).map(String.init), b = new.split(whereSeparator: \.isWhitespace).map(String.init)
    var lcs = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
    for i in stride(from: a.count - 1, through: 0, by: -1) {
        for j in stride(from: b.count - 1, through: 0, by: -1) {
            lcs[i][j] = a[i] == b[j] ? lcs[i + 1][j + 1] + 1 : max(lcs[i + 1][j], lcs[i][j + 1])
        }
    }
    var out: [(op: DiffOp, text: String)] = []
    func push(_ op: DiffOp, _ w: String) {
        if out.last?.op == op { out[out.count - 1].text += " " + w } else { out.append((op, w)) }
    }
    var i = 0, j = 0
    while i < a.count || j < b.count {
        if i < a.count, j < b.count, a[i] == b[j] { push(.same, a[i]); i += 1; j += 1 }
        else if i < a.count, j == b.count || lcs[i + 1][j] >= lcs[i][j + 1] { push(.removed, a[i]); i += 1 } // removed first: "has → have"
        else { push(.added, b[j]); j += 1 }
    }
    return out
}

func diffText(_ parts: [(op: DiffOp, text: String)]) -> AttributedString {
    var s = AttributedString()
    for p in parts {
        if !s.characters.isEmpty { s += AttributedString(" ") }
        var run = AttributedString(p.text)
        switch p.op {
        case .same: break
        case .removed:
            run.foregroundColor = Color.bad
            run.strikethroughStyle = Text.LineStyle(pattern: .solid, color: .bad)
            run.backgroundColor = Color.bad.opacity(0.12)
        case .added:
            run.foregroundColor = Color.good
            run.backgroundColor = Color.good.opacity(0.12)
        }
        s += run
    }
    return s
}

struct FixCard: View {
    let index: Int
    let fix: Fix
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(index)").font(.headline).foregroundStyle(.brand)
                Text(fix.title).font(.headline)
            }
            Text(fix.why).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(fix.before).strikethrough(color: .bad).foregroundStyle(.secondary)
                Label { Text(fix.after) } icon: { Image(systemName: "arrow.turn.down.right").foregroundStyle(.good) }
            }
            .font(.callout)
        }
        .card()
    }
}

struct VocabRow: View {
    let upgrade: VocabUpgrade
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(upgrade.original).strikethrough(color: .secondary)
                Image(systemName: "arrow.right").foregroundStyle(.tertiary)
                Text(upgrade.better.joined(separator: " · ")).foregroundStyle(.good).bold()
            }
            if !upgrade.note.isEmpty { Text(upgrade.note).font(.footnote).foregroundStyle(.secondary) }
        }
        .card(padding: 12)
    }
}

struct ErrorSheet: View {
    let error: AnalysisError
    let onPlay: (() -> Void)?
    @Environment(APIClient.self) private var api
    @State private var added = false
    @State private var failure: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Chip(text: categoryLabel(error.category), color: error.severity == "major" ? .bad : .warn)
                Chip(text: error.severity)
                Spacer()
            }
            Text(error.original).strikethrough(color: .bad).font(.title3)
            Label(error.correction, systemImage: "checkmark.circle.fill").font(.title3.weight(.semibold)).foregroundStyle(.good)
            Text(error.explanation)
            if let failure { ErrorLine(message: failure) }
            HStack {
                if let onPlay { Button { onPlay() } label: { Label("Play this bit", systemImage: "play.fill") }.buttonStyle(.bordered) }
                Button {
                    Task {
                        do {
                            try await api.addCard(front: error.original, back: "\(error.correction) — \(error.explanation)", source: "mistake")
                            added = true
                        } catch { failure = error.localizedDescription }
                    }
                } label: { Label(added ? "Added" : "Add to review deck", systemImage: added ? "checkmark" : "plus") }
                    .buttonStyle(.borderedProminent)
                    .disabled(added)
            }
            Spacer()
        }
        .padding(24)
    }
}

/// Essay with inline error highlights (char spans are UTF-16 offsets, matching JS string indices).
struct EssayView: View {
    let result: AnalysisResult
    let text: String
    let onSelect: (AnalysisError) -> Void

    var body: some View {
        Text(attributed)
            .font(.system(.body, design: .serif))
            .lineSpacing(5)
            .tint(Color.primary)
            .textSelection(.enabled)
            .environment(\.openURL, OpenURLAction { url in
                if let e = result.errors.first(where: { $0.id == url.host() || "err:\($0.id)" == url.absoluteString }) { onSelect(e) }
                return .handled
            })
            .card()
        let unmatched = result.errors.filter { $0.start < 0 }
        if !unmatched.isEmpty {
            SectionTitle("Other issues")
            ForEach(unmatched) { e in
                Button { onSelect(e) } label: { ErrorRow(error: e) }.buttonStyle(.plain)
            }
        }
    }

    private var attributed: AttributedString {
        var s = AttributedString(text)
        let len = (text as NSString).length
        for e in result.errors where e.start >= 0 && e.end > e.start && e.end <= len {
            guard let r = Range(NSRange(location: e.start, length: e.end - e.start), in: s) else { continue }
            let c: Color = e.severity == "major" ? .bad : .warn
            s[r].backgroundColor = c.opacity(0.16)
            s[r].underlineStyle = Text.LineStyle(pattern: .solid, color: c)
            s[r].link = URL(string: "err://\(e.id)")
        }
        return s
    }
}

struct ErrorRow: View {
    let error: AnalysisError
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(error.original).strikethrough(color: .bad)
                Image(systemName: "arrow.right").font(.caption).foregroundStyle(.tertiary)
                Text(error.correction).foregroundStyle(.good).bold()
            }
            Text(error.explanation).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 12)
    }
}

struct StructureView: View {
    let structure: WritingStructure?

    var body: some View {
        if let s = structure {
            SectionTitle("Paragraph map")
            ForEach(Array(s.paragraphs.enumerated()), id: \.offset) { i, p in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Chip(text: "¶\(i + 1) · \(p.role)", color: .brand)
                        Spacer()
                        Image(systemName: p.ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill").foregroundStyle(p.ok ? Color.good : Color.warn)
                    }
                    if !p.topicSentence.isEmpty { Text("“\(p.topicSentence)”").font(.system(.callout, design: .serif).italic()) }
                    Text(p.note).font(.footnote).foregroundStyle(.secondary)
                }
                .card()
            }
            SectionTitle("Checks")
            VStack(alignment: .leading, spacing: 10) {
                if let o = s.overview {
                    check("Overview present", o.present)
                    check("States the main trends", o.mainTrends)
                    check("No detailed data in the overview", o.noData)
                    note(o.note)
                }
                if let p = s.position {
                    check("Clear position", p.clear)
                    check("Position consistent throughout", p.consistent)
                    note(p.note)
                }
                if let p = s.planFollowed {
                    check("Followed your plan", p.followed)
                    note(p.note)
                }
            }
            .card()
        } else {
            Text("No structure analysis for this attempt.").foregroundStyle(.secondary)
        }
    }

    private func check(_ label: String, _ ok: Bool) -> some View {
        Label(label, systemImage: ok ? "checkmark.circle.fill" : "xmark.circle.fill").foregroundStyle(ok ? Color.good : Color.bad)
    }

    @ViewBuilder
    private func note(_ n: String) -> some View {
        if !n.isEmpty { Text(n).font(.footnote).foregroundStyle(.secondary) }
    }
}

struct LanguageView: View {
    let result: AnalysisResult
    let player: Player
    let onSelect: (AnalysisError) -> Void

    private var groups: [(String, [AnalysisError])] {
        Dictionary(grouping: result.errors, by: \.category).map { ($0.key, $0.value) }.sorted { $0.1.count > $1.1.count }
    }

    var body: some View {
        if !result.errors.isEmpty {
            SectionTitle("Mistakes by type")
            ForEach(groups, id: \.0) { cat, errs in
                DisclosureGroup {
                    ForEach(errs) { e in Button { onSelect(e) } label: { ErrorRow(error: e) }.buttonStyle(.plain) }
                } label: {
                    HStack { Text(categoryLabel(cat)).font(.headline); Spacer(); Text("\(errs.count)").monospacedDigit().foregroundStyle(.secondary) }
                }
                .card(padding: 12)
            }
        }
        if let v = result.vocabUpgrades, !v.isEmpty {
            SectionTitle("Vocabulary upgrades")
            ForEach(Array(v.enumerated()), id: \.offset) { _, u in VocabRow(upgrade: u) }
        }
        if let t = result.textMetrics { textStats(t) }
        if let rel = result.relevance, !rel.isEmpty {
            SectionTitle("Relevance")
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(rel.enumerated()), id: \.offset) { _, r in
                    VStack(alignment: .leading, spacing: 2) {
                        Label(questionText(r.questionIdx), systemImage: r.onTopic ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(r.onTopic ? Color.good : Color.warn)
                        if !r.note.isEmpty { Text(r.note).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
            }
            .card()
        }
        if let p = result.pronunciation { pronunciation(p) }
    }

    private func questionText(_ i: Int) -> String {
        if let q = result.questions, q.indices.contains(i) { return q[i].text }
        return "Question \(i + 1)"
    }

    private func textStats(_ t: TextMetrics) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("Language stats")
            HStack {
                stat("Words", "\(t.words)")
                stat("Avg sentence", "\(fmt(t.avgSentenceLen)) words")
                stat("Diversity (MTLD)", fmt(t.mtld, 0))
            }
            ProgressView(value: min(t.mtld, 120), total: 120) { Text("Lexical diversity").font(.caption) }
                .tint(t.mtld >= 70 ? Color.good : t.mtld >= 50 ? Color.warn : Color.bad)
            if !t.linkers.isEmpty {
                Text("Linking words").font(.headline)
                FlowLayout(spacing: 6) {
                    ForEach(t.linkers, id: \.word) { l in Chip(text: "\(l.word) ×\(l.count)", color: l.overused ? .bad : .secondary) }
                }
            }
            if !t.repeated.isEmpty {
                Text("Repeated words").font(.headline)
                FlowLayout(spacing: 6) {
                    ForEach(t.repeated, id: \.word) { r in Chip(text: "\(r.word) ×\(r.count)", color: .warn) }
                }
            }
        }
        .card()
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(value).font(.headline.monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func pronunciation(_ p: AnalysisResult.Pronunciation) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("Pronunciation")
            if p.unclear.isEmpty && p.llm == nil { Text("No unclear words detected.").foregroundStyle(.secondary) }
            if !p.unclear.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(p.unclear, id: \.wordIdx) { u in
                        Button {
                            if let w = result.words, w.indices.contains(u.wordIdx) { player.seek(to: max(0, w[u.wordIdx].start - 0.3)) }
                        } label: { Label(u.w, systemImage: "play.fill").font(.callout) }
                            .buttonStyle(.bordered)
                            .tint(u.tier >= 3 ? Color.bad : Color.warn)
                    }
                }
            }
            if let llm = p.llm {
                ForEach(Array(llm.words.enumerated()), id: \.offset) { _, w in
                    Button { player.seek(to: max(0, w.time - 0.3)) } label: {
                        VStack(alignment: .leading) {
                            Text("\(w.word) · \(w.issue)").font(.callout.weight(.semibold))
                            Text(w.tip).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
                if !llm.prosody.isEmpty { Text(llm.prosody).font(.callout) }
            }
            Text("Pronunciation hints are estimates from speech recognition, not a phoneme-level assessment.")
                .font(.caption).foregroundStyle(.tertiary)
        }
        .card()
    }
}
