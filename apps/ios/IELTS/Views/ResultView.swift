import SwiftUI

// Results for one attempt or a session of attempts. Mirrors the web result routes and components/results/*
// (apps/web/src/routes/_app/{speaking,writing}/result.$attemptId.tsx). The Transcript and Fluency tabs live in
// TranscriptView.swift and FluencyView.swift.

// MARK: - Shared helpers (web: lib/result.ts, lib/format.ts, lib/writing.ts)

private let resIsoFrac: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
private let resIsoPlain = ISO8601DateFormatter()
private let resDay: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_GB")
    f.dateFormat = "d MMM yyyy"
    return f
}()

/// "30 Sep 2026" (web formatDate); empty when the string is not a date.
func resFormatDate(_ iso: String) -> String {
    guard let d = resIsoFrac.date(from: iso) ?? resIsoPlain.date(from: iso) else { return "" }
    return resDay.string(from: d)
}

/// "51s", "4m 12s", "1h 5m" (web formatDuration).
func resFormatDuration(_ ms: Int) -> String {
    let s = Int((Double(ms) / 1000).rounded())
    if s < 60 { return "\(s)s" }
    let h = s / 3600, m = (s % 3600) / 60
    if h > 0 { return m > 0 ? "\(h)h \(m)m" : "\(h)h" }
    return s % 60 > 0 ? "\(m)m \(s % 60)s" : "\(m)m"
}

/// Stored prompt titles can be ALL CAPS: show those in sentence case (web sentenceCase).
func resSentenceCase(_ t: String) -> String {
    let chars = Array(t)
    var hasTwoCaps = false
    if chars.count > 1 {
        for i in 0..<(chars.count - 1) where chars[i].isASCII && chars[i].isUppercase && chars[i + 1].isASCII && chars[i + 1].isUppercase {
            hasTwoCaps = true
            break
        }
    }
    guard hasTwoCaps, t == t.uppercased() else { return t }
    return String(t.prefix(1)) + t.dropFirst().lowercased()
}

/// [6, 7] gives "6–7"; [6.5, 6.5] gives "6.5" (web formatRange).
func resRange(_ lo: Double, _ hi: Double) -> String {
    lo == hi ? fmt(lo, 1) : "\(Band.format(lo))–\(Band.format(hi))"
}

/// Cut at the last whole word within `max` characters, with an ellipsis (web clipWords).
func resClipWords(_ s: String, _ max: Int) -> String {
    if s.count <= max { return s }
    let cut = String(s.prefix(max)).replacingOccurrences(of: "\\s+\\S*$", with: "", options: .regularExpression)
    return cut + "…"
}

func resCriterionLabel(_ k: String) -> String { k == "ta" ? "Task Achievement/Response" : Crit.label(k) }

/// "grammar.article" gives "Grammar: article" (web categoryLabel).
func resCategoryLabel(_ c: String) -> String {
    let groups = ["grammar": "Grammar", "lexis": "Vocabulary", "cohesion": "Cohesion", "task": "Task", "pronunciation": "Pronunciation", "fluency": "Fluency"]
    let parts = c.split(separator: ".", maxSplits: 1).map(String.init)
    let g = parts.first ?? ""
    let name = groups[g] ?? g
    guard parts.count > 1 else { return name }
    return "\(name): \(parts[1].replacingOccurrences(of: "-", with: " "))"
}

func resErrorTitle(_ c: String) -> String {
    let task = ["task.relevance": "Off-topic phrase", "task.overview": "Missing overview", "task.position": "Unclear position"]
    return task[c] ?? resCategoryLabel(c)
}

/// No usable speech: flagged by the pipeline, or overall 0.
func resNotAssessed(_ r: AnalysisResult) -> Bool { r.noSpeech == true || r.overall == 0 }

/// Pronunciation more than 2 bands above fluency is an audio-only guess (web pronunciationUnsupported).
func resPronUnsupported(_ r: AnalysisResult, _ k: String) -> Bool {
    guard k == "p", let p = r.criteria["p"], let fc = r.criteria["fc"] else { return false }
    return p.band - fc.band > 2
}

func resMinWords(_ part: Int) -> Int { part == 1 ? 150 : 250 }

func resTaskLabel(_ p: Prompt) -> String { p.part == 2 ? "Task 2" : "Task 1 \(p.variant == "general" ? "General" : "Academic")" }

func resIsLongPause(_ p: Pause) -> Bool { Int((p.dur * 10).rounded()) >= 10 }
func resPauseSec(_ p: Pause) -> String { String(format: "%.1f", (p.dur * 10).rounded() / 10) }

/// Whether question `i` has any speech in the transcript. Unknown boundaries count as answered.
func resWasAnswered(_ r: AnalysisResult, _ i: Int) -> Bool {
    guard let qs = r.questions, qs.indices.contains(i) else { return true }
    let q = qs[i]
    let next = qs[(i + 1)...].first { $0.startWord >= 0 }
    return q.startWord >= 0 && q.startWord < (r.words?.count ?? 0) && (next == nil || (next?.startWord ?? 0) > q.startWord)
}

func resAnsweredRelevance(_ r: AnalysisResult) -> [AnalysisResult.Relevance] {
    (r.relevance ?? []).filter { resWasAnswered(r, $0.questionIdx) }
}

/// Speaking answers that missed their question, when that is most of them; else nil.
func resOffTopic(_ r: AnalysisResult) -> (off: Int, total: Int)? {
    let rel = resAnsweredRelevance(r)
    let off = rel.filter { !$0.onTopic }.count
    return off * 2 > rel.count ? (off, rel.count) : nil
}

/// Transcript heading for a question: its first line, plus the rest (cue card) without a repeat of that line.
func resQuestionHead(_ text: String) -> (head: String, rest: String) {
    let parts = text.components(separatedBy: "\n")
    let head = parts.first ?? ""
    var rest = parts.dropFirst().joined(separator: "\n")
    if !head.isEmpty && rest.hasPrefix(head) {
        rest = String(rest.dropFirst(head.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    rest = rest.replacingOccurrences(of: "\\s*\\n\\s*", with: " ", options: .regularExpression)
    return (head, rest)
}

/// `s` without a leading `lead` it repeats (cue-card bodies restate the title).
func resStripLead(_ lead: String, _ s: String) -> String {
    guard !lead.isEmpty, s.hasPrefix(lead) else { return s }
    return String(s.dropFirst(lead.count)).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// What the header shows: an off-topic writing answer is capped at one band over its Task Achievement/Response score (web capOffTopic).
struct ResScore {
    let overall: Double
    let raw: Double
    let range: [Double]
    let offTopic: Bool
}

func resScore(_ r: AnalysisResult) -> ResScore {
    let plain = ResScore(overall: r.overall, raw: r.overallRaw, range: r.range, offTopic: false)
    guard r.skill == "writing", r.tooShort != true, let ta = r.criteria["ta"]?.band else { return plain }
    let major = r.errors.contains { $0.category == "task.relevance" && $0.severity == "major" }
    guard ta <= 4 || major else { return plain }
    let cap = ta + 1
    return ResScore(overall: min(r.overall, cap), raw: min(r.overallRaw, cap), range: r.range.map { min($0, cap) }, offTopic: true)
}

// MARK: Text metrics (port of packages/core/src/text.ts: tokenize, MTLD, repeated words)

func resTokenize(_ text: String) -> [String] {
    let chars = Array(text.lowercased())
    func isLetter(_ c: Character) -> Bool { c >= "a" && c <= "z" }
    var out: [String] = []
    var i = 0
    while i < chars.count {
        guard isLetter(chars[i]) else { i += 1; continue }
        var j = i
        while j < chars.count && isLetter(chars[j]) { j += 1 }
        if j + 1 < chars.count && chars[j] == "'" && isLetter(chars[j + 1]) {
            var k = j + 1
            while k < chars.count && isLetter(chars[k]) { k += 1 }
            j = k
        }
        out.append(String(chars[i..<j]))
        i = j
    }
    return out
}

private func resMtldPass(_ tokens: [String], _ threshold: Double) -> Double {
    var factors = 0.0, types = Set<String>(), count = 0, ttr = 1.0
    for t in tokens {
        types.insert(t)
        count += 1
        ttr = Double(types.count) / Double(count)
        if ttr <= threshold {
            factors += 1
            types = []
            count = 0
            ttr = 1
        }
    }
    if count > 0 { factors += (1 - ttr) / (1 - threshold) }
    return factors == 0 ? Double(tokens.count) : Double(tokens.count) / factors
}

func resMtld(_ tokens: [String]) -> Double {
    if tokens.isEmpty { return 0 }
    return (resMtldPass(tokens, 0.72) + resMtldPass(Array(tokens.reversed()), 0.72)) / 2
}

private let resStop: Set<String> = Set(("that this with have from they their there them then than these those were been being will would could should what when where "
    + "which while about after before because also some such more most many much very only just into over other each both same does "
    + "doing done your yours make made like well even here itself ours whom upon among within without again further once").split(separator: " ").map(String.init))

/// Content words (length > 3, not a function word) used 4+ times, most frequent first (max 10).
func resRepeatedWords(_ tokens: [String]) -> [(word: String, count: Int)] {
    var freq: [String: Int] = [:]
    var order: [String] = []
    for t in tokens where t.count > 3 && !resStop.contains(t) {
        if freq[t] == nil { order.append(t) }
        freq[t, default: 0] += 1
    }
    let rows = order.compactMap { w -> (word: String, count: Int)? in
        let c = freq[w] ?? 0
        return c >= 4 ? (w, c) : nil
    }
    return Array(rows.enumerated().sorted { a, b in a.element.count != b.element.count ? a.element.count > b.element.count : a.offset < b.offset }.prefix(10).map { $0.element })
}

// MARK: - Small shared views

enum ResAlertTone { case bad, warn, info }

/// Inline notice (web Alert): tinted card, icon, optional title, optional action row.
struct ResAlert: View {
    let tone: ResAlertTone
    var title: String? = nil
    let message: String
    var action: AnyView? = nil

    private var icon: String { tone == .info ? "info.circle.fill" : "exclamationmark.triangle.fill" }
    private var iconColor: Color { tone == .bad ? .bad : tone == .warn ? .warn : .muted }
    private var fill: Color { tone == .bad ? Color.bad.opacity(0.10) : tone == .warn ? Color.warn.opacity(0.12) : Color.surface2 }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.headline).foregroundStyle(iconColor).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                if let title { Text(title).font(.headline).foregroundStyle(.ink) }
                Text(message).font(.callout).foregroundStyle(.ink).fixedSize(horizontal: false, vertical: true)
                if let action { action }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.line))
        .accessibilityElement(children: .contain)
    }
}

/// Filter chip with an optional count; selected = teal ("you are here"). 44 pt tall tap target.
struct ResFilterChip: View {
    let label: String
    var count: Int? = nil
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(label)
                if let count { Text("\(count)").monospacedDigit().opacity(0.75) }
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14).padding(.vertical, 7)
            .foregroundStyle(selected ? Color.onBrand : Color.ink)
            .background(selected ? Color.brand : Color.surface2, in: Capsule())
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Thin horizontal meter (counts, lexical range).
struct ResMeter: View {
    let fraction: Double
    var color: Color = .brand
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.surface2)
                Capsule().fill(color).frame(width: g.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// 0-9 band meter in the band colour against the target, with a tick at the target (web BandBar).
struct ResBandBar: View {
    let band: Double
    let target: Double
    let label: String
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.surface2).frame(height: 6)
                Capsule().fill(bandColor(band, target)).frame(width: g.size.width * min(max(band, 0), 9) / 9, height: 6)
                Rectangle().fill(Color.ink.opacity(0.7)).frame(width: 2, height: 14)
                    .offset(x: g.size.width * min(max(target, 0), 9) / 9 - 1)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue("Band \(fmt(band, 1)), target \(fmt(target, 1))")
    }
}

// MARK: - Container: one attempt, or a test of several

/// The attempt plus the two fields the shared `Attempt` model does not carry (web: `stage`, `retryable`).
struct ResFetched: Decodable {
    let attempt: Attempt
    let stage: String?
    let retryable: Bool

    init(from decoder: Decoder) throws {
        attempt = try Attempt(from: decoder)
        let c = try decoder.container(keyedBy: AnyKey.self)
        stage = try? c.decodeIfPresent(String.self, forKey: AnyKey("stage"))
        retryable = (try? c.decodeIfPresent(Bool.self, forKey: AnyKey("retryable"))) ?? true
    }
}

/// Results for one attempt or a session of attempts (part switcher + test overall). Polls until analysis finishes.
struct ResultView: View {
    let ids: [String]

    @Environment(APIClient.self) private var api
    @State private var fetched: [String: ResFetched] = [:]
    @State private var selected = 0
    @State private var poll = 0
    @State private var error: String?

    private var index: Int { min(max(selected, 0), max(ids.count - 1, 0)) }
    private var target: Double { api.me?.settings.targetBand ?? 7 }

    var body: some View {
        Group {
            if ids.isEmpty {
                ContentUnavailableView("Nothing to score", systemImage: "waveform.slash", description: Text("No answers were recorded."))
            } else if let error, fetched[ids[index]] == nil {
                ContentUnavailableView {
                    Label("Couldn't load this result", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try again") { poll += 1 }.primaryButton()
                }
            } else if let f = fetched[ids[index]] {
                AttemptResultView(attempt: f.attempt, stage: f.stage, retryable: f.retryable, extras: sessionExtras) { Task { await retry(f.attempt.id) } }
                    .id(f.attempt.id)
            } else {
                ProgressView("Loading result").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(.canvas)
        .navigationTitle("Results")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: poll) { await pollUntilDone() }
    }

    private func pollUntilDone() async {
        while !Task.isCancelled {
            for id in ids where fetched[id]?.attempt.finished != true {
                do {
                    fetched[id] = try await api.get("/api/attempts/\(id)")
                    error = nil
                } catch is CancellationError {
                    return
                } catch {
                    self.error = error.localizedDescription
                }
            }
            if ids.allSatisfy({ fetched[$0]?.attempt.finished == true }) { return }
            try? await Task.sleep(for: .seconds(2))
        }
    }

    private func retry(_ id: String) async {
        do {
            let _: Empty = try await api.send("POST", "/api/attempts/\(id)/submit", [String: String]())
            fetched[id] = nil
            poll += 1
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: Session header (part switcher, test overall)

    private var sessionExtras: AnyView? {
        guard ids.count > 1 else { return nil }
        let attempts = ids.compactMap { fetched[$0]?.attempt }
        let writing = attempts.first?.skill == "writing"
        return AnyView(
            VStack(alignment: .leading, spacing: 12) {
                ResSwitcher(items: switcherItems, selected: Binding(get: { index }, set: { selected = $0 }))
                if writing {
                    if let combined = writingCombined {
                        HStack(alignment: .center) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Writing band for this test").font(.headline)
                                Text("Task 2 counts twice as much as Task 1.").font(.caption).foregroundStyle(.muted)
                            }
                            Spacer()
                            Text(fmt(combined, 1)).font(.system(size: 34, weight: .semibold).monospacedDigit()).foregroundStyle(bandTextColor(combined, target))
                        }
                        .card()
                        .accessibilityElement(children: .combine)
                    }
                } else if let s = speakingSummary {
                    Text(summaryText(s))
                        .font(.subheadline.weight(.medium)).foregroundStyle(.ink)
                }
            }
        )
    }

    private func summaryText(_ s: (band: Double, scored: Int)) -> String {
        let base = "Test overall \(fmt(s.band, 1))"
        return s.scored < ids.count ? "\(base), \(s.scored) of \(ids.count) parts scored" : base
    }

    private var switcherItems: [ResSwitcher.Item] {
        let loaded = ids.map { fetched[$0]?.attempt }
        let p1Total = loaded.compactMap { $0 }.filter { $0.skill == "speaking" && $0.part == 1 }.count
        var p1 = 0
        return ids.enumerated().map { i, id in
            var label = "Part \(i + 1)"
            var band: Double?
            var busy = true
            if let a = loaded[i] {
                if a.skill == "writing" {
                    label = "Task \(a.part)"
                } else if a.part == 1 && p1Total > 1 {
                    p1 += 1
                    label = "Part 1.\(p1)"
                } else {
                    label = "Part \(a.part)"
                }
                busy = !a.finished
                if let r = a.analysis, !resNotAssessed(r) { band = resScore(r).overall }
            }
            return ResSwitcher.Item(id: id, label: label, band: band, busy: busy)
        }
    }

    /// Speaking: criteria averaged across parts weighted by speaking time, whole bands, then the usual rounding (web sessionOverall).
    private var speakingSummary: (band: Double, scored: Int)? {
        let scored = ids.compactMap { fetched[$0]?.attempt }.filter { a in
            guard let r = a.analysis, !resNotAssessed(r) else { return false }
            return Crit.order("speaking").allSatisfy { r.criteria[$0] != nil }
        }
        guard !scored.isEmpty else { return nil }
        let total = scored.reduce(0.0) { $0 + max(Double($1.durationMs ?? 0), 1) }
        func avg(_ k: String) -> Double {
            var sum = 0.0
            for a in scored {
                let band = a.analysis?.criteria[k]?.band ?? 0
                let weight = max(Double(a.durationMs ?? 0), 1)
                sum += band * weight
            }
            return (sum / total).rounded()
        }
        let o = Band.speakingOverall(fc: avg("fc"), lr: avg("lr"), gra: avg("gra"), p: avg("p"))
        return (o.band, scored.count)
    }

    /// Writing: (Task 1 + 2 x Task 2) / 3 on the shown (off-topic capped) bands.
    private var writingCombined: Double? {
        let attempts = ids.compactMap { fetched[$0]?.attempt }
        func shown(_ part: Int) -> Double? {
            guard let r = attempts.first(where: { $0.part == part })?.analysis else { return nil }
            return resScore(r).overall
        }
        guard let t1 = shown(1), let t2 = shown(2) else { return nil }
        return Band.writingOverall(t1: t1, t2: t2).band
    }
}

/// Part / task switcher with the band per part. Scrolls sideways if the parts do not fit.
private struct ResSwitcher: View {
    struct Item: Identifiable {
        let id: String
        let label: String
        let band: Double?
        let busy: Bool
    }

    let items: [Item]
    @Binding var selected: Int

    private func spoken(_ item: Item) -> String {
        if item.busy { return "\(item.label), analysing" }
        if let b = item.band { return "\(item.label), band \(fmt(b, 1))" }
        return "\(item.label), no score"
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    let on = i == selected
                    Button { selected = i } label: {
                        VStack(spacing: 1) {
                            Text(item.label).font(.subheadline.weight(.semibold)).lineLimit(1)
                            if item.busy {
                                ProgressView().controlSize(.mini).frame(height: 14)
                            } else if let b = item.band {
                                Text(fmt(b, 1)).font(.caption.monospacedDigit())
                            } else {
                                Text("No score").font(.caption)
                            }
                        }
                        .foregroundStyle(on ? Color.brand : Color.muted)
                        .padding(.horizontal, 14)
                        .frame(minWidth: 78, minHeight: 48)
                        .background(on ? Color.surface : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(on ? Color.line : Color.clear))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(spoken(item))
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(4)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .background(Color.surface2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - One attempt

struct AttemptResultView: View {
    let attempt: Attempt
    var stage: String? = nil
    var retryable = true
    var extras: AnyView? = nil
    let onRetry: () -> Void

    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var sizeClass
    @ScaledMetric(relativeTo: .largeTitle) private var bandSize: CGFloat = 60
    @State private var tab = Demo.arg("tab") ?? "Overview"
    @State private var player = Player()
    @State private var selectedError: AnalysisError?
    @State private var toast: String?
    @State private var parentText: String?
    @State private var audioFailed = false
    @State private var addedFixes = false
    @State private var showPrompt = false
    @State private var scrollToRelevance = false

    private var speaking: Bool { attempt.skill == "speaking" }
    private var tabs: [String] { speaking ? ["Overview", "Transcript", "Fluency", "Language", "Improve"] : ["Overview", "Essay", "Structure", "Language", "Improve"] }
    private var current: String { tabs.contains(tab) ? tab : "Overview" }
    private var target: Double { api.me?.settings.targetBand ?? 7 }
    private var order: [String] { Crit.order(attempt.skill) }

    private var showAudio: Bool {
        speaking && player.isLoaded && attempt.status == "done" && ["Transcript", "Fluency", "Language"].contains(current)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16, pinnedViews: [.sectionHeaders]) {
                    header
                    content
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .demoScroll()
            .onChange(of: tab) {
                guard scrollToRelevance else { return }
                scrollToRelevance = false
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(150))
                    proxy.scrollTo("relevance", anchor: .top)
                }
            }
        }
        .background(.canvas)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showAudio { ResAudioBar(player: player).padding(.horizontal, 16).padding(.bottom, 8) }
        }
        .task(id: attempt.audioUrl) {
            guard speaking, let u = attempt.audioUrl, !player.isLoaded else { return }
            do { try player.load(try await api.download(u)) } catch { audioFailed = true }
        }
        .task(id: attempt.parentAttemptId) {
            guard let id = attempt.parentAttemptId, let p: Attempt = try? await api.get("/api/attempts/\(id)") else { return }
            parentText = p.answerText
        }
        .onDisappear { player.stop() }
        .sheet(item: $selectedError) { e in
            ErrorSheet(error: e, onPlay: sheetPlay(e))
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast).font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 12)
                    .glassBar(Capsule())
                    .padding(.bottom, showAudio ? 88 : 24)
                    .transition(.opacity)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .animation(reduceMotion ? nil : .snappy, value: toast)
    }

    private func sheetPlay(_ e: AnalysisError) -> (() -> Void)? {
        guard player.isLoaded, let t = e.time else { return nil }
        return { player.seek(to: max(0, t - 0.3)) }
    }

    // MARK: Header

    private var title: String {
        if speaking { return attempt.part == 1 ? "Part 1: \(resSentenceCase(attempt.prompt.title))" : resSentenceCase(attempt.prompt.title) }
        return attempt.prompt.title
    }

    private var meta: String {
        var parts: [String] = []
        if speaking {
            parts.append(attempt.part == 1 ? "Speaking" : "Speaking, Part \(attempt.part)")
            let nq = attempt.analysis?.questions?.count ?? 0
            if nq > 1 { parts.append("\(nq) questions") }
        } else {
            parts.append("Writing")
            parts.append(resTaskLabel(attempt.prompt))
        }
        let d = resFormatDate(attempt.createdAt)
        if !d.isEmpty { parts.append(d) }
        if speaking, let ms = attempt.durationMs, ms > 0 { parts.append(resFormatDuration(ms)) }
        return parts.joined(separator: ", ")
    }

    /// Long writing prompts are clipped on a word boundary until opened (web PromptTitle).
    private var clipped: Bool { !speaking && title.count > 48 }

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(clipped && !showPrompt ? resClipWords(title, 48) : title)
                .font(.display(.title2)).foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(meta).font(.subheadline).foregroundStyle(.muted)
            if clipped {
                Button(showPrompt ? "Hide prompt" : "Show prompt") { showPrompt.toggle() }
                    .font(.subheadline).frame(minHeight: 44, alignment: .leading)
            }
        }
        if attempt.status == "done", let r = attempt.analysis, !resNotAssessed(r) { scoreCard(r) }
        if let extras { extras }
    }

    private func scoreCard(_ r: AnalysisResult) -> some View {
        let s = resScore(r)
        let off = speaking ? resOffTopic(r) : nil
        let words = r.textMetrics?.words ?? 0
        let under = !speaking && r.tooShort != true && r.textMetrics != nil && words < resMinWords(attempt.part)
        return HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Overall band").font(.caption).foregroundStyle(.muted)
                Text(fmt(s.overall, 1)).font(.system(size: bandSize, weight: .semibold).monospacedDigit())
                    .foregroundStyle(bandTextColor(s.overall, target))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Overall band \(fmt(s.overall, 1))")
            VStack(alignment: .leading, spacing: 8) {
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    if s.overall > 0, s.range.count == 2 {
                        Chip(text: "likely \(resRange(max(s.range[0], s.overall - 1), min(s.range[1], s.overall + 1)))", color: .muted)
                    }
                    if s.overall > 0, r.calibrated == false {
                        Chip(text: "AI estimate", color: .warnText)
                            .accessibilityHint("An estimate from AI scoring, not an official IELTS result. It may be off by about a band.")
                    }
                    if off != nil {
                        Button { openRelevance() } label: { Chip(text: "Off topic", color: .bad) }
                            .buttonStyle(.plain).accessibilityHint("Opens the Language tab")
                    }
                    if s.offTopic { Chip(text: "Capped: off topic", color: .bad) }
                    if r.tooShort == true || under {
                        Chip(text: "Under word limit", color: .bad)
                    } else if r.textMetrics != nil {
                        Chip(text: "\(words) \(words == 1 ? "word" : "words")", color: .muted)
                    }
                    if attempt.overtime == true { Chip(text: "Overtime", color: .warnText) }
                }
                Text(gapLine(s.overall)).font(.subheadline)
            }
        }
        .card()
    }

    private func gapLine(_ overall: Double) -> AttributedString {
        let gap = target - overall
        var lead = AttributedString(gap <= 0 ? "At or above" : "\(fmt(gap, 1)) below")
        lead.foregroundColor = bandTextColor(overall, target)
        lead.font = Font.subheadline.weight(.semibold)
        return lead + AttributedString(" your \(fmt(target, 1)) target")
    }

    private func openRelevance() {
        scrollToRelevance = true
        tab = "Language"
    }

    // MARK: States

    @ViewBuilder private var content: some View {
        switch attempt.status {
        case "done":
            if let r = attempt.analysis {
                if resNotAssessed(r) {
                    noSpeech
                } else {
                    Section {
                        panel(r)
                    } header: {
                        tabStrip
                    }
                }
            } else {
                ContentUnavailableView("No analysis", systemImage: "questionmark.circle")
            }
        case "failed": failed
        case "recording": if speaking { notSubmitted } else { ResAnalyzing(speaking: false, stage: stage) }
        default: ResAnalyzing(speaking: speaking, stage: stage)
        }
    }

    private var noSpeech: some View {
        ContentUnavailableView {
            Label("No speech detected", systemImage: "mic.slash")
        } description: {
            Text("We couldn't hear enough speech in this recording to score it. Check the right microphone is selected, speak a little closer to it, and keep talking for at least 20 seconds.")
        } actions: {
            retryLink(prominent: true)
        }
    }

    private var failed: some View {
        VStack(alignment: .leading, spacing: 16) {
            ResAlert(tone: .bad, title: "Analysis failed",
                     message: attempt.error ?? "Something went wrong. Your answer is saved, so you can retry.",
                     action: AnyView(
                        FlowLayout(spacing: 8, lineSpacing: 8) {
                            if retryable {
                                Button("Retry analysis", action: onRetry).primaryButton()
                            } else {
                                Button("Try again later", action: onRetry).secondaryButton()
                            }
                            if speaking {
                                retryLink(again: true, prominent: false)
                                Button("Practise another part") { dismiss() }.buttonStyle(.plain).foregroundStyle(.brand).frame(minHeight: 44)
                            }
                        }
                     ))
            questionsCard
        }
    }

    private var notSubmitted: some View {
        VStack(alignment: .leading, spacing: 16) {
            ResAlert(tone: .bad, title: "Not submitted",
                     message: "This recording never finished uploading. Record it again to get your result.",
                     action: AnyView(
                        FlowLayout(spacing: 8, lineSpacing: 8) {
                            retryLink(again: true, prominent: true)
                            Button("Practise another part") { dismiss() }.buttonStyle(.plain).foregroundStyle(.brand).frame(minHeight: 44)
                        }
                     ))
            questionsCard
        }
    }

    /// What the candidate was asked: the cue card (Part 2) or the question list.
    @ViewBuilder private var questionsCard: some View {
        let p = attempt.prompt
        if attempt.part == 2 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Cue card").font(.caption).foregroundStyle(.muted)
                Text(p.title).font(.display(.title3))
                let detail = resStripLead(p.title, p.body)
                if !detail.isEmpty { Text(detail).font(.body).foregroundStyle(.muted) }
                if let bullets = p.bullets, !bullets.isEmpty {
                    Text("You should say").font(.subheadline.weight(.medium)).padding(.top, 4)
                    ForEach(bullets, id: \.self) { b in
                        Label { Text(b).font(.system(.callout, design: .serif)) } icon: { Image(systemName: "circle.fill").font(.system(size: 5)).foregroundStyle(.muted) }
                    }
                }
            }
            .card()
        } else {
            let qs = (p.followUps ?? []).isEmpty ? [p.body] : (p.followUps ?? [])
            VStack(alignment: .leading, spacing: 8) {
                Text("Questions you were asked").font(.headline)
                ForEach(Array(qs.enumerated()), id: \.offset) { i, q in
                    Text("\(i + 1). \(q)").font(.system(.callout, design: .serif))
                }
            }
            .card()
        }
    }

    // MARK: Tabs

    private var tabStrip: some View {
        ViewThatFits(in: .horizontal) {
            tabRow
            ScrollView(.horizontal, showsIndicators: false) { tabRow }
        }
        .padding(4)
        .glassBar(Capsule())
        .padding(.vertical, 6)
    }

    private var tabRow: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.self) { t in
                let on = current == t
                Button { tab = t } label: {
                    // "Text" on phones (as on the web) so all five tabs fit on a 393 pt screen without scrolling.
                    Text(t == "Transcript" && sizeClass == .compact ? "Text" : t)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(1).fixedSize()
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(on ? Color.onBrand : Color.ink)
                        .background(on ? Color.brand : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    @ViewBuilder private func panel(_ r: AnalysisResult) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            switch current {
            case "Transcript":
                TranscriptView(result: r, player: player) { selectedError = $0 }
                if audioFailed { Text("Couldn't load the recording, so words can't be played.").font(.caption).foregroundStyle(.muted) }
            case "Fluency":
                if let m = r.metrics {
                    FluencyView(metrics: m, player: player, fc: r.criteria["fc"], target: target)
                } else {
                    ContentUnavailableView("No fluency data", systemImage: "waveform.slash", description: Text("This analysis has no speech measurements."))
                }
            case "Essay":
                let text = r.text ?? attempt.text ?? ""
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ContentUnavailableView("No essay text", systemImage: "doc.text", description: Text("Nothing was written for this task."))
                } else {
                    EssayView(result: r, text: text) { selectedError = $0 }
                }
            case "Structure":
                if let s = r.structure {
                    StructureView(structure: s)
                } else {
                    ContentUnavailableView("No structure analysis", systemImage: "doc.text", description: Text("The answer was too short to map its paragraphs."))
                }
            case "Language": LanguageView(result: r, player: player)
            case "Improve": improve(r)
            default: overview(r)
            }
        }
    }

    // MARK: Overview

    @ViewBuilder private func overview(_ r: AnalysisResult) -> some View {
        let s = resScore(r)
        if speaking, let off = resOffTopic(r) {
            ResAlert(tone: .bad, title: "Off topic",
                     message: "\(off.total > 1 ? "\(off.off) of \(off.total) answers didn’t" : "Your answer didn’t") address the question.",
                     action: AnyView(Button("See details in Language") { openRelevance() }.buttonStyle(.plain).foregroundStyle(.brand).frame(minHeight: 44)))
        }
        if !speaking { writingAlert(r, s) }
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Band by criterion")
            Text(criteriaNote(r, s)).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
        }
        ForEach(order, id: \.self) { k in
            if let c = r.criteria[k] {
                ResCriterionCard(key: k, criterion: c, target: target, delta: r.comparison?.deltas[k], soft: resPronUnsupported(r, k))
            }
        }
        Text("Your target band is \(fmt(target, 1)). Unrounded average of the criteria: \(fmt(s.raw, 2)).").font(.caption).foregroundStyle(.muted)
        if let c = r.comparison {
            ResComparisonStrip(comparison: c, overall: s.overall, order: order, parentId: attempt.parentAttemptId ?? c.parentAttemptId,
                               linkText: speaking ? "See last try" : "View previous attempt")
        }
        if !r.topFixes.isEmpty {
            SectionTitle(r.topFixes.count == 1 ? "One thing to fix next" : "\(r.topFixes.count) things to fix next")
            ForEach(Array(r.topFixes.enumerated()), id: \.offset) { i, f in FixCard(index: i + 1, fix: f) }
        }
    }

    /// One line on how the headline number relates to the rows below (web OverviewPanel).
    private func criteriaNote(_ r: AnalysisResult, _ s: ResScore) -> String {
        let bands = order.compactMap { k in r.criteria[k].map { (key: k, band: $0.band) } }
        guard let low = bands.min(by: { $0.band < $1.band }), let high = bands.map(\.band).max() else { return "" }
        let avg = Band.round(bands.map(\.band).reduce(0, +) / Double(bands.count))
        if s.offTopic && avg > s.overall {
            return "Average of these \(bands.count) bands would be \(fmt(avg, 1)), capped at \(fmt(s.overall, 1)) because the \(attempt.part == 1 ? "answer" : "essay") is off topic."
        }
        let pulls = high - low.band >= 2 ? ", so \(resCriterionLabel(low.key)) (\(fmt(low.band, 1))) pulls it down without capping it" : ""
        return "Overall \(fmt(s.overall, 1)) is the average of these \(bands.count) bands, rounded to the nearest half band\(pulls)."
    }

    /// One alert for everything wrong with the essay itself (web writing Done).
    @ViewBuilder private func writingAlert(_ r: AnalysisResult, _ s: ResScore) -> some View {
        let ta = attempt.part == 1 ? "Task Achievement" : "Task Response"
        let words = r.textMetrics?.words ?? 0
        let under = r.tooShort != true && r.textMetrics != nil && words < resMinWords(attempt.part)
        let cap = fmt((r.criteria["ta"]?.band ?? 0) + 1, 1)
        let kind = attempt.part == 1 ? "answer" : "essay"
        let message: [String] = (s.offTopic ? ["Your \(kind) doesn’t answer this question, so your overall band can’t go above \(cap): one band over your \(ta) score."] : [])
            + (under ? ["You wrote \(words) of the \(resMinWords(attempt.part)) words required, which lowers \(ta)."] : [])
        if r.tooShort == true {
            ResAlert(tone: .warn, title: "Too short to assess",
                     message: "Responses of 20 words or fewer are rated Band 1 on every criterion. Aim for at least \(resMinWords(attempt.part)) words.")
        } else if s.offTopic || under {
            ResAlert(tone: s.offTopic ? .bad : .warn, title: s.offTopic ? "Off topic" : "Under \(resMinWords(attempt.part)) words",
                     message: message.joined(separator: " "),
                     action: s.offTopic ? AnyView(
                        NavigationLink(value: Route.writing(.prompt(id: attempt.promptId, parent: attempt.id))) {
                            Label("Rewrite on this topic", systemImage: "arrow.counterclockwise")
                        }.secondaryButton()
                     ) : nil)
        }
    }

    // MARK: Improve

    @ViewBuilder private func improve(_ r: AnalysisResult) -> some View {
        VStack(spacing: 8) {
            retryLink(prominent: true)
            if !r.topFixes.isEmpty {
                Button {
                    Task { await addFixes(r.topFixes) }
                } label: {
                    Label(addedFixes ? "Fixes in your deck" : "Add top fixes to review deck", systemImage: addedFixes ? "checkmark" : "rectangle.stack.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .secondaryButton().controlSize(.large).disabled(addedFixes)
            }
        }
        if let before = parentText, let now = attempt.answerText {
            VStack(alignment: .leading, spacing: 4) {
                SectionTitle("Since your last attempt")
                Text("Your previous answer against this one.").font(.footnote).foregroundStyle(.muted)
            }
            ResDiffCard(original: before, rewrite: now, cleanLabel: "This attempt", serif: !speaking)
        }
        if r.rewrite.text.isEmpty {
            if !speaking {
                ContentUnavailableView("No rewrite for this answer", systemImage: "doc.text",
                                       description: Text("Write a full-length answer to get a band-higher version to compare against."))
            }
        } else if speaking {
            SectionTitle("Your answer, one band higher")
            Text(r.rewrite.text).font(.system(.body, design: .serif)).lineSpacing(4).textSelection(.enabled).card()
            if !r.rewrite.note.isEmpty { ResAlert(tone: .info, message: r.rewrite.note) }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                SectionTitle("One band higher")
                Text(r.rewrite.note.isEmpty ? "Study what changed and why. Don’t memorise it: examiners recognise learned essays." : r.rewrite.note)
                    .font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
            }
            ResDiffCard(original: r.text ?? attempt.text ?? "", rewrite: r.rewrite.text, cleanLabel: "Clean rewrite", serif: true)
        }
    }

    @ViewBuilder private func retryLink(again: Bool = false, prominent: Bool) -> some View {
        let route: Route = speaking ? .speaking(.prompt(id: attempt.promptId, parent: attempt.id)) : .writing(.prompt(id: attempt.promptId, parent: attempt.id))
        // A retry re-records the whole part, so name the part when it has several questions.
        let label = !speaking ? "Retry this prompt" : again ? "Record again" : (attempt.prompt.followUps?.count ?? 0) > 1 ? "Retry Part \(attempt.part)" : "Retry this question"
        if prominent {
            NavigationLink(value: route) { Label(label, systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity) }
                .primaryButton().controlSize(.large)
        } else {
            NavigationLink(value: route) { Label(label, systemImage: "arrow.counterclockwise") }
                .secondaryButton()
        }
    }

    private func addFixes(_ fixes: [Fix]) async {
        do {
            let cards = fixes.map { ["front": "\($0.title)\n\n\($0.before)", "back": "\($0.after)\n\n\($0.why)", "source": "fix"] }
            let _: Empty = try await api.send("POST", "/api/cards/bulk", ["cards": cards] as [String: Any])
            addedFixes = true
            await show("Added \(fixes.count) \(fixes.count == 1 ? "card" : "cards") to your review deck")
        } catch {
            await show(error.localizedDescription)
        }
    }

    private func show(_ message: String) async {
        toast = message
        try? await Task.sleep(for: .seconds(2))
        toast = nil
    }
}

// MARK: Audio bar (floating control surface)

struct ResAudioBar: View {
    let player: Player

    var body: some View {
        HStack(spacing: 8) {
            Button { player.toggle() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.title3).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain).foregroundStyle(.brand)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            Slider(value: Binding(get: { player.currentTime }, set: { player.seek(to: $0, play: player.isPlaying) }), in: 0...max(player.duration, 0.1))
                .accessibilityLabel("Playback position")
            Text("\(clock(Int(player.currentTime))) / \(clock(Int(player.duration)))")
                .font(.caption.monospacedDigit()).foregroundStyle(.muted)
        }
        .padding(.horizontal, 12).padding(.vertical, 2)
        .glassBar(Capsule(), interactive: true)
    }
}

// MARK: Analysing

/// Shown while an attempt is analysing (the page polls). Real pipeline stages from the server, else the web's estimated schedule.
private struct ResAnalyzing: View {
    let speaking: Bool
    let stage: String?
    @State private var started = Date()

    private static let labels = [
        "transcribing": "Transcribing your recording",
        "analyzing": "Analysing fluency, grammar and vocabulary",
        "feedback": "Marking mistakes and writing your fixes",
        "scoring": "Scoring against the band descriptors",
        "finalizing": "Finishing up",
    ]

    private var stages: [String] { speaking ? ["transcribing", "analyzing", "finalizing"] : ["feedback", "scoring", "finalizing"] }
    private var fallback: [String] {
        speaking ? ["Uploading", "Transcribing", "Measuring fluency", "Scoring against the band descriptors"]
            : ["Measuring vocabulary and linking", "Scoring against the band descriptors", "Locating mistakes", "Writing your fixes"]
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let elapsed = ctx.date.timeIntervalSince(started)
            let real = stage.flatMap { stages.firstIndex(of: $0) }
            let labels = real != nil ? stages.map { Self.labels[$0] ?? $0 } : fallback
            let active = real ?? min(fallback.count - 1, Int(elapsed / (speaking ? 7 : 8)))
            VStack(alignment: .leading, spacing: 12) {
                Text(speaking ? "Analysing your answer" : "Marking your answer").font(.display(.title3)).foregroundStyle(.ink)
                Text(elapsed >= 45
                     ? "Taking longer than usual. You can leave this page; we'll keep working and the result will be in your history."
                     : "Usually under a minute. You can leave this page; the result will be in your history.")
                    .font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(labels.enumerated()), id: \.offset) { i, s in
                        HStack(spacing: 12) {
                            Group {
                                if i < active {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.goodText)
                                } else if i == active {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Image(systemName: "circle").foregroundStyle(.muted)
                                }
                            }
                            .frame(width: 24, height: 24)
                            Text(s).font(.body).foregroundStyle(i > active ? Color.muted : Color.ink)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(s), \(i < active ? "done" : i == active ? "in progress" : "waiting")")
                    }
                }
                .padding(.top, 4)
            }
            .card()
        }
    }
}

// MARK: Overview pieces

private struct ResCriterionCard: View {
    let key: String
    let criterion: Criterion
    let target: Double
    let delta: Double?
    let soft: Bool
    @State private var open = false

    private func descriptorText(_ d: String) -> AttributedString {
        var lead = AttributedString("Band descriptor: ")
        lead.font = Font.caption.weight(.semibold)
        lead.foregroundColor = Color.ink
        var rest = AttributedString(d)
        rest.font = Font.caption
        rest.foregroundColor = Color.muted
        return lead + rest
    }

    var body: some View {
        let c = criterion
        // Audio-only pronunciation is a rough guide: widen its range.
        let lo = c.range.count == 2 ? (soft ? max(0, min(c.range[0], c.band - 1.5)) : c.range[0]) : c.band
        let hi = c.range.count == 2 ? (soft ? min(9, max(c.range[1], c.band + 1.5)) : c.range[1]) : c.band
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(resCriterionLabel(key)).font(.headline).foregroundStyle(.ink)
                Spacer(minLength: 8)
                Text(fmt(c.band, 1)).font(.system(.title, weight: .semibold).monospacedDigit()).foregroundStyle(bandTextColor(c.band, target))
            }
            HStack(spacing: 8) {
                Text("likely \(resRange(lo, hi))").font(.caption.monospacedDigit()).foregroundStyle(.muted)
                if let d = delta, d != 0 {
                    Label("\(fmt(abs(d), 1)) vs last try", systemImage: d > 0 ? "arrow.up" : "arrow.down")
                        .font(.caption.weight(.medium)).foregroundStyle(d > 0 ? Color.goodText : Color.bad)
                }
            }
            ResBandBar(band: c.band, target: target, label: "\(resCriterionLabel(key)) band")
            if soft {
                Chip(text: "Audio check only, low confidence", color: .warnText)
                    .accessibilityHint("The pronunciation band comes from the audio alone. Halting or very short speech is hard to judge, so treat it as a rough guide.")
            }
            Text(c.summary).font(.body).foregroundStyle(.ink).fixedSize(horizontal: false, vertical: true)
            if !c.descriptor.isEmpty || !c.evidence.isEmpty {
                Button { open.toggle() } label: {
                    HStack(spacing: 4) {
                        Text(open ? "Hide evidence" : "Show evidence")
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.caption.weight(.semibold))
                    }
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain).foregroundStyle(.brand).font(.subheadline.weight(.medium))
                .accessibilityAddTraits(.isButton)
                if open {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(c.evidence, id: \.self) { q in
                            Text("“\(q)”").font(.system(.callout, design: .serif))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(Color.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        if !c.descriptor.isEmpty {
                            Text(descriptorText(c.descriptor))
                        }
                    }
                }
            }
        }
        .card()
    }
}

private struct ResDelta: View {
    let d: Double
    var body: some View {
        if d > 0 {
            Label("+\(fmt(d, 1))", systemImage: "arrow.up").foregroundStyle(.goodText).font(.subheadline.weight(.semibold))
                .accessibilityLabel("up \(fmt(d, 1))")
        } else if d < 0 {
            Label("−\(fmt(abs(d), 1))", systemImage: "arrow.down").foregroundStyle(.bad).font(.subheadline.weight(.semibold))
                .accessibilityLabel("down \(fmt(abs(d), 1))")
        } else {
            Label("0", systemImage: "minus").foregroundStyle(.muted).font(.subheadline)
                .accessibilityLabel("no change")
        }
    }
}

/// Retry comparison: previous overall to this overall, per-criterion deltas, and a link to the previous try (web ComparisonStrip).
private struct ResComparisonStrip: View {
    let comparison: AnalysisResult.Comparison
    let overall: Double
    let order: [String]
    let parentId: String
    let linkText: String

    var body: some View {
        let change = ((overall - comparison.parentOverall) * 10).rounded() / 10
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("Last try").foregroundStyle(.muted)
                Text(fmt(comparison.parentOverall, 1)).fontWeight(.semibold)
                Image(systemName: "arrow.right").font(.caption).foregroundStyle(.muted).accessibilityLabel("to")
                Text(fmt(overall, 1)).fontWeight(.semibold)
                ResDelta(d: change)
            }
            .font(.subheadline.monospacedDigit())
            FlowLayout(spacing: 16, lineSpacing: 6) {
                ForEach(order.filter { comparison.deltas[$0] != nil }, id: \.self) { k in
                    HStack(spacing: 6) {
                        Text(resCriterionLabel(k)).font(.caption).foregroundStyle(.muted)
                        ResDelta(d: comparison.deltas[k] ?? 0).font(.caption)
                    }
                }
            }
            NavigationLink(value: Route.result([parentId])) {
                Text(linkText).font(.subheadline.weight(.medium)).frame(minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.plain).foregroundStyle(.brand)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.surface2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// Word diff with a clean-read toggle (web DiffView).
private struct ResDiffCard: View {
    let original: String
    let rewrite: String
    let cleanLabel: String
    let serif: Bool
    @State private var clean = false

    var body: some View {
        let font: Font = serif ? .system(.body, design: .serif) : .body
        VStack(alignment: .leading, spacing: 12) {
            Picker("Rewrite view", selection: $clean) {
                Text("Show changes").tag(false)
                Text(cleanLabel).tag(true)
            }
            .pickerStyle(.segmented)
            if !clean {
                HStack(spacing: 8) { Chip(text: "removed", color: .bad); Chip(text: "added", color: .goodText) }
            }
            Text(clean ? AttributedString(rewrite) : diffText(wordDiff(original, rewrite)))
                .font(font).lineSpacing(4).textSelection(.enabled)
        }
        .card()
    }
}

// MARK: - Word diff (retry vs parent). Covered by WordDiffTests.

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
            run.foregroundColor = Color.goodText
            run.backgroundColor = Color.good.opacity(0.12)
        }
        s += run
    }
    return s
}

// MARK: - Fix, vocabulary and error rows

/// One "thing to fix next": numeral, title, why it limits the band, and the before and after wording.
struct FixCard: View {
    let index: Int
    let fix: Fix
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(index)").font(.display(.title, weight: .regular)).foregroundStyle(.muted).frame(width: 24, alignment: .leading)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                Text(fix.title).font(.headline).foregroundStyle(.ink)
                Text(fix.why).font(.callout).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("Before").font(.caption).foregroundStyle(.muted).frame(width: 44, alignment: .leading)
                        Text(fix.before).font(.system(.callout, design: .serif)).strikethrough(color: .bad).foregroundStyle(.muted)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("After").font(.caption).foregroundStyle(.muted).frame(width: 44, alignment: .leading)
                        Text(fix.after).font(.system(.callout, design: .serif).weight(.medium)).foregroundStyle(.goodText)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .card()
    }
}

struct VocabRow: View {
    let upgrade: VocabUpgrade
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FlowLayout(spacing: 8, lineSpacing: 4) {
                Text(upgrade.original).font(.system(.callout, design: .serif)).foregroundStyle(.muted)
                Image(systemName: "arrow.right").font(.caption).foregroundStyle(.muted).accessibilityLabel("try")
                ForEach(upgrade.better, id: \.self) { b in
                    Text(b).font(.system(.callout, design: .serif).weight(.semibold)).foregroundStyle(.brand)
                }
            }
            if !upgrade.note.isEmpty { Text(upgrade.note).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true) }
        }
        .card(padding: 12)
    }
}

/// "original → correction" as one wrapping run.
private func resFixText(_ e: AnalysisError) -> AttributedString {
    var original = AttributedString(e.original)
    original.foregroundColor = Color.muted
    original.strikethroughStyle = Text.LineStyle(pattern: .solid, color: .bad)
    var correction = AttributedString(e.correction)
    correction.foregroundColor = Color.goodText
    correction.font = Font.system(.callout, design: .serif).weight(.medium)
    var arrow = AttributedString("  →  ")
    arrow.foregroundColor = Color.muted
    return original + arrow + correction
}

/// Original to correction, explanation, and the actions. Used inline (Language tab, "Also noted") and in the sheet.
struct ErrorDetailsView: View {
    let error: AnalysisError
    var onPlay: (() -> Void)? = nil
    var hideCategory = false

    @Environment(APIClient.self) private var api
    @State private var added = false
    @State private var failure: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Chip(text: error.severity, color: error.severity == "major" ? .bad : .warnText)
                if !hideCategory { Text(resCategoryLabel(error.category)).font(.caption).foregroundStyle(.muted) }
            }
            if !error.original.isEmpty || !error.correction.isEmpty {
                Text(resFixText(error)).font(.system(.callout, design: .serif))
            }
            Text(error.explanation).font(.callout).foregroundStyle(.ink).fixedSize(horizontal: false, vertical: true)
            if let failure { ErrorLine(message: failure) }
            FlowLayout(spacing: 8, lineSpacing: 8) {
                if let onPlay {
                    Button { onPlay() } label: { Label("Play this bit", systemImage: "play.fill") }.secondaryButton()
                }
                Button {
                    Task {
                        do {
                            try await api.addCard(front: "Fix: \"\(error.original)\"", back: "\(error.correction)\n\n\(error.explanation)", source: "mistake")
                            added = true
                        } catch {
                            failure = error.localizedDescription
                        }
                    }
                } label: { Label(added ? "In your deck" : "Add to review deck", systemImage: added ? "checkmark" : "plus") }
                    .secondaryButton().disabled(added)
            }
        }
    }
}

struct ErrorSheet: View {
    let error: AnalysisError
    let onPlay: (() -> Void)?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(resErrorTitle(error.category)).font(.display(.title3)).foregroundStyle(.ink)
                ErrorDetailsView(error: error, onPlay: onPlay, hideCategory: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .background(.canvas)
    }
}

/// A mistake in a list: severity, title, the fix, and the explanation. Tapping opens the sheet.
struct ErrorRow: View {
    let error: AnalysisError
    var located = true
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Chip(text: error.severity, color: error.severity == "major" ? .bad : .warnText)
                Text(resErrorTitle(error.category)).font(.caption).foregroundStyle(.muted).lineLimit(1)
                Spacer(minLength: 0)
                if !located { Image(systemName: "mappin.slash").font(.caption).foregroundStyle(.muted).accessibilityLabel("Not located in the text") }
            }
            if !error.original.isEmpty || !error.correction.isEmpty { Text(resFixText(error)).font(.system(.callout, design: .serif)) }
            Text(error.explanation).font(.footnote).foregroundStyle(.muted).lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .contentShape(Rectangle())
    }
}

// MARK: - Writing: essay and structure

/// Essay with inline error highlights (char spans are UTF-16 offsets, matching JS string indices).
struct EssayView: View {
    let result: AnalysisResult
    let text: String
    let onSelect: (AnalysisError) -> Void
    @State private var filter: String?

    private func group(_ e: AnalysisError) -> String { String(e.category.split(separator: ".").first ?? "") }

    private var groups: [(name: String, count: Int)] {
        var counts: [String: Int] = [:]
        for e in result.errors { counts[group(e), default: 0] += 1 }
        return counts.map { (name: $0.key, count: $0.value) }.sorted { $0.count != $1.count ? $0.count > $1.count : $0.name < $1.name }
    }

    private var visible: [AnalysisError] { filter == nil ? result.errors : result.errors.filter { group($0) == filter } }
    private func located(_ e: AnalysisError) -> Bool { e.start >= 0 && e.end > e.start && e.end <= (text as NSString).length }

    var body: some View {
        if !result.errors.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ResFilterChip(label: "All", count: result.errors.count, selected: filter == nil) { filter = nil }
                    ForEach(Array(groups.enumerated()), id: \.offset) { _, g in
                        ResFilterChip(label: resCategoryLabel(g.name), count: g.count, selected: filter == g.name) { filter = filter == g.name ? nil : g.name }
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        }
        Text(attributed)
            .font(.system(.body, design: .serif))
            .lineSpacing(5)
            .tint(Color.ink)
            .textSelection(.enabled)
            .environment(\.openURL, OpenURLAction { url in
                if let e = result.errors.first(where: { $0.id == url.host() || "err://\($0.id)" == url.absoluteString }) { onSelect(e) }
                return .handled
            })
            .card()
        if !result.errors.isEmpty {
            Text("Underlined text has a mistake: red for major, amber for minor. Tap it to see why.").font(.caption).foregroundStyle(.muted)
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("Mistakes")
                Text("\(visible.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.muted)
            }
            if visible.isEmpty {
                Text("No mistakes in this category.").font(.footnote).foregroundStyle(.muted)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { i, e in
                        if i > 0 { Divider() }
                        Button { onSelect(e) } label: { ErrorRow(error: e, located: located(e)) }.buttonStyle(.plain)
                    }
                }
                .card(padding: 0)
            }
        }
    }

    private var attributed: AttributedString {
        var s = AttributedString(text)
        for e in visible where located(e) {
            guard let r = Range(NSRange(location: e.start, length: e.end - e.start), in: s) else { continue }
            let c: Color = e.severity == "major" ? .bad : .warn
            s[r].backgroundColor = c.opacity(0.16)
            s[r].underlineStyle = Text.LineStyle(pattern: .solid, color: c)
            s[r].link = URL(string: "err://\(e.id)")
        }
        return s
    }
}

struct StructureView: View {
    let structure: WritingStructure

    private static let roles = ["intro": "Introduction", "overview": "Overview", "body": "Body", "conclusion": "Conclusion",
                                "greeting": "Greeting", "closing": "Closing", "other": "Other"]

    var body: some View {
        let s = structure
        if s.overview != nil || s.position != nil || s.planFollowed != nil {
            SectionTitle("Checks")
            VStack(spacing: 0) {
                if let o = s.overview {
                    checkRow("Overview", [("Overview present", o.present), ("States the main trends", o.mainTrends), ("No detailed figures in it", o.noData)], o.note)
                }
                if let p = s.position {
                    if s.overview != nil { Divider() }
                    checkRow("Position", [("Clear position", p.clear), ("Consistent throughout", p.consistent)], p.note)
                }
                if let p = s.planFollowed {
                    if s.overview != nil || s.position != nil { Divider() }
                    checkRow("Your plan", [("Essay followed the plan", p.followed)], p.note)
                }
            }
            .card(padding: 0)
        }
        SectionTitle("Paragraph map")
        if s.paragraphs.isEmpty {
            Text("No paragraphs were detected. Separate paragraphs with a blank line.").font(.footnote).foregroundStyle(.muted)
        } else {
            VStack(spacing: 0) {
                ForEach(Array(s.paragraphs.enumerated()), id: \.offset) { i, p in
                    if i > 0 { Divider() }
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(i + 1)").font(.subheadline.weight(.semibold).monospacedDigit())
                            .frame(width: 32, height: 32).background(Color.surface2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 10) {
                                Text("Paragraph \(i + 1): \(Self.roles[p.role] ?? p.role.capitalized)").font(.subheadline.weight(.semibold))
                                Label(p.ok ? "Works" : "Needs work", systemImage: p.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                    .font(.footnote).foregroundStyle(p.ok ? Color.goodText : Color.warnText)
                            }
                            if !p.topicSentence.isEmpty { Text("“\(p.topicSentence)”").font(.system(.callout, design: .serif)) }
                            if !p.note.isEmpty { Text(p.note).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true) }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .card(padding: 0)
        }
    }

    private func checkRow(_ title: String, _ checks: [(String, Bool)], _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold))
            ForEach(Array(checks.enumerated()), id: \.offset) { _, c in
                Label(c.0, systemImage: c.1 ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .font(.callout).foregroundStyle(c.1 ? Color.goodText : Color.bad)
                    .accessibilityLabel("\(c.0): \(c.1 ? "yes" : "no")")
            }
            if !note.isEmpty { Text(note).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Language tab

struct LanguageView: View {
    let result: AnalysisResult
    let player: Player

    private var speaking: Bool { result.skill == "speaking" }

    private var groups: [(cat: String, errors: [AnalysisError])] {
        var by: [String: [AnalysisError]] = [:]
        for e in result.errors { by[e.category, default: []].append(e) }
        return by.map { (cat: $0.key, errors: $0.value) }.sorted { $0.errors.count != $1.errors.count ? $0.errors.count > $1.errors.count : $0.cat < $1.cat }
    }

    /// Upgrades whose suggestions differ from the original.
    private var upgrades: [VocabUpgrade] {
        (result.vocabUpgrades ?? []).compactMap { v in
            let better = v.better.filter { $0.trimmingCharacters(in: .whitespaces).lowercased() != v.original.trimmingCharacters(in: .whitespaces).lowercased() }
            return better.isEmpty ? nil : VocabUpgrade(original: v.original, better: better, note: v.note)
        }
    }

    var body: some View {
        if speaking { speakingBody } else { writingBody }
    }

    // MARK: Speaking

    @ViewBuilder private var speakingBody: some View {
        SectionTitle("Mistakes by type")
        if groups.isEmpty {
            Text("No grammar or vocabulary mistakes were flagged in this answer.").font(.callout).foregroundStyle(.muted).card()
        } else {
            let maxCount = max(groups.first?.errors.count ?? 1, 5)
            VStack(spacing: 0) {
                ForEach(Array(groups.enumerated()), id: \.offset) { i, g in
                    if i > 0 { Divider() }
                    ResErrorGroup(category: g.cat, errors: g.errors, maxCount: maxCount, player: player, words: result.words ?? [])
                }
            }
            .card(padding: 0)
        }
        if !upgrades.isEmpty { vocabulary }
        speakingLexical
        relevance
        pronunciation
    }

    @ViewBuilder private var vocabulary: some View {
        SectionTitle("Vocabulary upgrades")
        ForEach(Array(upgrades.enumerated()), id: \.offset) { _, u in VocabRow(upgrade: u) }
    }

    /// Lexical range and the words leaned on, from the transcript.
    @ViewBuilder private var speakingLexical: some View {
        let tokens = resTokenize((result.words ?? []).map(\.w).joined(separator: " "))
        let mtld = resMtld(tokens)
        let tone: (Color, String) = mtld >= 70 ? (Color.goodText, "Wide range") : mtld >= 50 ? (Color.warnText, "Adequate range") : (Color.bad, "Limited range")
        let repeated = resRepeatedWords(tokens)
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Lexical diversity").font(.headline)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(Int(mtld.rounded()))").font(.system(.largeTitle, weight: .semibold).monospacedDigit())
                    Text("MTLD").font(.subheadline).foregroundStyle(.muted)
                    Chip(text: tone.1, color: tone.0)
                }
                if tokens.count < 50 || tone.1 != "Wide range" {
                    Text(tokens.count < 50 ? "Short answer, so treat this number as rough." : "Try synonyms and more precise words for repeated ideas.")
                        .font(.footnote).foregroundStyle(.muted)
                }
                Text("MTLD: how long you keep using new words before repeating yourself. Higher means a wider range. Around 70+ is typical of band 7 speech.")
                    .font(.caption).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text("Words you leaned on").font(.headline)
                if repeated.isEmpty {
                    Text("No content word stood out as overused.").font(.footnote).foregroundStyle(.muted)
                } else {
                    FlowLayout(spacing: 6, lineSpacing: 6) {
                        ForEach(Array(repeated.enumerated()), id: \.offset) { _, r in Chip(text: "\(r.word) ×\(r.count)", color: .muted) }
                    }
                }
            }
        }
        .card()
    }

    @ViewBuilder private var relevance: some View {
        let rel = resAnsweredRelevance(result)
        if !rel.isEmpty {
            SectionTitle("Did you answer the question?").id("relevance")
            VStack(spacing: 0) {
                ForEach(Array(rel.enumerated()), id: \.offset) { i, r in
                    if i > 0 { Divider() }
                    let q = resQuestionHead(result.questions?.indices.contains(r.questionIdx) == true ? (result.questions?[r.questionIdx].text ?? "") : "Question \(r.questionIdx + 1)")
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: r.onTopic ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(r.onTopic ? Color.goodText : Color.warnText)
                            .accessibilityLabel(r.onTopic ? "On topic" : "Off topic")
                        VStack(alignment: .leading, spacing: 4) {
                            Text(q.head).font(.body.weight(.medium))
                            if !q.rest.isEmpty { Text(q.rest).font(.caption).foregroundStyle(.muted) }
                            if !r.note.isEmpty { Text(r.note).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true) }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                }
            }
            .card(padding: 0)
        }
    }

    @ViewBuilder private var pronunciation: some View {
        let words = result.words ?? []
        let unclear = result.pronunciation?.unclear ?? []
        let llm = result.pronunciation?.llm
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle("Pronunciation")
            Text("Pronunciation hints are estimates from speech recognition, not a phoneme-level assessment.").font(.footnote).foregroundStyle(.muted)
        }
        VStack(spacing: 0) {
            if unclear.isEmpty && llm == nil {
                Text("Speech recognition understood every word clearly.").font(.callout).foregroundStyle(.muted)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }
            ForEach(Array(unclear.enumerated()), id: \.offset) { i, u in
                if i > 0 { Divider() }
                HStack(spacing: 8) {
                    if player.isLoaded, words.indices.contains(u.wordIdx) {
                        Button { player.seek(to: max(0, words[u.wordIdx].start - 0.3)) } label: {
                            Image(systemName: "play.fill").frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).foregroundStyle(.brand).accessibilityLabel("Play \(u.w)")
                    }
                    Text(u.w).font(.body.weight(.medium))
                    Spacer(minLength: 8)
                    Chip(text: u.tier >= 3 ? "Hard to recognise" : "Slightly unclear", color: u.tier >= 3 ? .bad : .warnText)
                    Text("\(Int((u.conf * 100).rounded()))%").font(.caption.monospacedDigit()).foregroundStyle(.muted).frame(minWidth: 36, alignment: .trailing)
                }
                .padding(.horizontal, 16).padding(.vertical, 4)
            }
            if let llm {
                ForEach(Array(llm.words.enumerated()), id: \.offset) { i, w in
                    if i > 0 || !unclear.isEmpty { Divider() }
                    HStack(alignment: .top, spacing: 8) {
                        if player.isLoaded {
                            Button { player.seek(to: max(0, w.time - 0.3)) } label: {
                                Image(systemName: "play.fill").frame(width: 44, height: 44).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain).foregroundStyle(.brand).accessibilityLabel("Play \(w.word)")
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text(w.word).font(.body.weight(.medium))
                                Chip(text: Self.issues[w.issue] ?? w.issue.capitalized, color: .muted)
                            }
                            Text(w.tip).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 10)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.vertical, 2)
                }
                if !llm.prosody.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Rhythm and intonation").font(.subheadline.weight(.semibold))
                        Text(llm.prosody).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                }
            }
        }
        .card(padding: 0)
    }

    private static let issues = ["sound": "Sound", "stress": "Word stress", "intonation": "Intonation", "unclear": "Unclear"]

    // MARK: Writing

    @ViewBuilder private var writingBody: some View {
        if let m = result.textMetrics { glance(m) }
        if !groups.isEmpty {
            SectionTitle("Mistakes by type")
            let maxCount = max(3, groups.first?.errors.count ?? 3)
            VStack(spacing: 14) {
                ForEach(Array(groups.enumerated()), id: \.offset) { _, g in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(resCategoryLabel(g.cat)).font(.subheadline)
                            Spacer()
                            Text("\(g.errors.count)").font(.subheadline.weight(.medium).monospacedDigit())
                        }
                        ResMeter(fraction: max(0.04, Double(g.errors.count) / Double(maxCount)))
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .card()
        }
        if let m = result.textMetrics, !m.linkers.isEmpty { linking(m) }
        if let m = result.textMetrics, !m.repeated.isEmpty {
            SectionTitle("Repeated words")
            FlowLayout(spacing: 6, lineSpacing: 6) {
                ForEach(m.repeated, id: \.word) { w in Chip(text: "\(w.word) ×\(w.count)", color: .muted) }
            }
        }
        if !upgrades.isEmpty { vocabulary }
    }

    private func glance(_ m: TextMetrics) -> some View {
        let tone: (Color, String) = m.mtld >= 80 ? (Color.goodText, "Wide range") : m.mtld >= 55 ? (Color.warnText, "Adequate range") : (Color.bad, "Limited range")
        return VStack(alignment: .leading, spacing: 12) {
            SectionTitle("At a glance")
            let cells: [(String, String, String?)] = [
                ("Words", "\(m.words)", nil),
                ("Paragraphs", "\(m.paragraphs)", nil),
                ("Sentences", "\(m.sentences)", nil),
                ("Avg sentence", "\(fmt(m.avgSentenceLen)) words", "Band 7+ essays usually mix short and long sentences, averaging roughly 15–25 words."),
                ("Unique-word ratio", "\(Int((m.ttr * 100).rounded()))%", "Type–token ratio. It naturally falls as essays get longer, so compare like with like."),
            ]
            VStack(spacing: 0) {
                ForEach(Array(stride(from: 0, to: cells.count, by: 2)), id: \.self) { i in
                    if i > 0 { Divider() }
                    HStack(alignment: .top, spacing: 0) {
                        ResGlanceCell(label: cells[i].0, value: cells[i].1, tip: cells[i].2)
                        Rectangle().fill(Color.line).frame(width: 1)
                        if i + 1 < cells.count {
                            ResGlanceCell(label: cells[i + 1].0, value: cells[i + 1].1, tip: cells[i + 1].2)
                        } else {
                            Color.clear.frame(maxWidth: .infinity)
                        }
                    }
                }
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    Text("Lexical diversity").font(.caption).foregroundStyle(.muted)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("MTLD \(Int(m.mtld.rounded()))").font(.title3.weight(.semibold).monospacedDigit())
                        Chip(text: tone.1, color: tone.0)
                    }
                    Text("MTLD: how long you keep using new words before repeating yourself. Higher is more varied. Ranges here are rough guides, not band cut-offs.")
                        .font(.caption).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(14)
            }
            .card(padding: 0)
        }
    }

    private func linking(_ m: TextMetrics) -> some View {
        let linkers = m.linkers.sorted { $0.count > $1.count }
        let maxCount = max(3, linkers.first?.count ?? 3)
        return VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Linking words")
            Text("Examiners penalise mechanical linking. Overused ones are flagged; swap some for referencing (“this trend”, “such policies”).")
                .font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 14) {
                ForEach(linkers, id: \.word) { l in
                    let over = l.overused && l.count >= 2
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Text(l.word).font(.subheadline)
                            if over { Chip(text: "Overused", color: .warnText) }
                            Spacer()
                            Text("\(l.count)").font(.subheadline.weight(.medium).monospacedDigit())
                        }
                        ResMeter(fraction: max(0.04, Double(l.count) / Double(maxCount)), color: over ? .warn : .brand)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .card()
        }
    }
}

private struct ResGlanceCell: View {
    let label: String
    let value: String
    let tip: String?
    @State private var showTip = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.muted)
                if tip != nil {
                    Button { showTip.toggle() } label: {
                        Image(systemName: "info.circle").font(.footnote).frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).foregroundStyle(.muted)
                    .padding(.vertical, -14).padding(.horizontal, -8)
                    .accessibilityLabel("About \(label)")
                }
            }
            Text(value).font(.title3.weight(.semibold).monospacedDigit())
            if showTip, let tip { Text(tip).font(.caption).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true) }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(14)
    }
}

/// One mistake category: name, count bar, and its mistakes behind a disclosure (web Collapsible row).
private struct ResErrorGroup: View {
    let category: String
    let errors: [AnalysisError]
    let maxCount: Int
    let player: Player
    let words: [Word]
    @State private var open = false

    var body: some View {
        VStack(spacing: 0) {
            Button { open.toggle() } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(resCategoryLabel(category)).font(.subheadline.weight(.medium)).foregroundStyle(.ink).multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        Text("\(errors.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.ink)
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.muted)
                    }
                    ResMeter(fraction: Double(errors.count) / Double(max(maxCount, 1)))
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(minHeight: 56)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(open ? "Hides the mistakes" : "Shows the mistakes")
            if open {
                VStack(spacing: 0) {
                    ForEach(Array(errors.enumerated()), id: \.element.id) { i, e in
                        if i > 0 { Divider() }
                        ErrorDetailsView(error: e, onPlay: playAction(e), hideCategory: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                    }
                }
                .background(Color.surface2)
            }
        }
    }

    private func playAction(_ e: AnalysisError) -> (() -> Void)? {
        guard player.isLoaded, let t = e.time else { return nil }
        return { player.seek(to: max(0, t - 0.3)) }
    }
}
