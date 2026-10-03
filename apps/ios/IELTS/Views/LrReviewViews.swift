import SwiftUI

// Review panels of a submitted Listening / Reading attempt (web components/lr/ReviewPanels.tsx).

/// Plain text with one span marked as "where the answer is" (soft teal fill and underline, so it is not colour alone).
func lrMarked(_ text: String, _ span: LrReview.Span?) -> AttributedString {
    var a = AttributedString(text)
    guard let span, span.e > span.s, let r = Range(NSRange(location: span.s, length: span.e - span.s), in: a) else { return a }
    a[r].backgroundColor = Color.brandSoft
    a[r].underlineStyle = Text.LineStyle(pattern: .solid, color: Color.brand)
    return a
}

/// Where a question's answer sits in the transcript: a "Q7" pill is inserted there (tappable link; right / wrong by symbol, not colour alone).
struct LrQPin: Hashable { let p: Int, s: Int, n: Int, correct: Bool }

func lrPinned(_ line: String, _ span: LrReview.Span?, _ pins: [LrQPin]) -> AttributedString {
    var a = lrMarked(line, span)
    for pin in pins.sorted(by: { $0.s > $1.s }) {
        guard let r = Range(NSRange(location: min(pin.s, line.utf16.count), length: 0), in: a) else { continue }
        var chip = AttributedString("Q\(pin.n)\(pin.correct ? "\u{2713}" : "\u{2717}")")
        chip.font = .caption.weight(.bold)
        chip.foregroundColor = pin.correct ? Color.goodText : Color.bad
        chip.backgroundColor = (pin.correct ? Color.good : Color.bad).opacity(0.15)
        chip.link = URL(string: "ieltsq://\(pin.n)")
        chip.underlineStyle = nil
        a.insert(chip + AttributedString(" "), at: r.lowerBound)
    }
    return a
}

/// The listening transcript, one paragraph per line, with the evidence marked and a Q badge before each question's evidence.
struct LrTranscriptView: View {
    let text: String
    var evidence: LrReview.Span?
    var pins: [LrQPin] = []
    var onPin: (Int) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { i, line in
                if !line.trimmingCharacters(in: .whitespaces).isEmpty {
                    let mine = pins.filter { $0.p == i }
                    Text(lrPinned(line, evidence?.p == i ? evidence : nil, mine))
                        .font(.body).fontDesign(.serif).lineSpacing(5).foregroundStyle(Color.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .id(evidence?.p == i ? "ev" : "t\(i)")
                        .accessibilityLabel(mine.isEmpty ? (evidence?.p == i ? "Where the answer is: \(line)" : line) : line)
                        .environment(\.openURL, OpenURLAction { url in
                            if url.scheme == "ieltsq", let n = Int(url.host ?? "") { onPin(n); return .handled }
                            return .systemAction
                        })
                }
            }
        }
    }
}

private struct Block<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(0.6).foregroundStyle(Color.muted).accessibilityAddTraits(.isHeader)
            content
        }
    }
}

func lrTimesText(_ n: Int) -> String { n == 1 ? "once" : n == 2 ? "2 times" : "\(n) times" }

/// What went wrong and where to look, for the selected question.
struct LrQuestionDetail: View {
    let q: LrQuestion
    let mark: LrMark?
    let entry: LrGapEntry?
    let listening: Bool
    let window: LrReview.AudioWindow?
    let canDictate: Bool
    var onShow: () -> Void
    var onPlay: () -> Void
    var onDictate: () -> Void
    var onClose: () -> Void

    private var r: LrQuestionReview? { q.review }
    private var wrong: String? { mark?.correct == false ? LrReview.wrongNote(q, given: mark!.given) : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Question \(q.n)").font(.display(.title3)).foregroundStyle(Color.ink).accessibilityAddTraits(.isHeader)
                    if let m = mark {
                        Text(m.correct ? "Correct" : "You wrote \(m.given.isEmpty ? "nothing" : m.given), the answer is \(m.answer.joined(separator: " / "))")
                            .font(.subheadline.weight(.medium)).foregroundStyle(m.correct ? Color.goodText : Color.bad)
                    }
                }
                Spacer(minLength: 8)
                Button("Close", action: onClose).font(.subheadline.weight(.medium)).frame(minHeight: 44)
            }
            if let e = entry {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Chip(text: e.label, color: .warnText)
                        if let w = e.word, let t = e.typed {
                            (Text(t).strikethrough().foregroundStyle(Color.bad) + Text("  →  ").foregroundStyle(Color.muted) + Text(w).bold().foregroundStyle(Color.goodText))
                                .font(.subheadline.monospacedDigit())
                                .accessibilityLabel("\(t), should be \(w)")
                        }
                    }
                    Text(e.message).font(.subheadline).foregroundStyle(Color.ink)
                    if e.kind == "spelling", let b = e.before, b > 0, let w = e.word {
                        Text("You've misspelt '\(w)' \(lrTimesText(b)) before.").font(.subheadline.weight(.semibold)).foregroundStyle(Color.warnText)
                    }
                    if e.kind == "plural", let b = e.before, b > 0, let w = e.word {
                        Text("You've slipped on the ending of '\(w)' \(lrTimesText(b)) before.").font(.subheadline.weight(.semibold)).foregroundStyle(Color.warnText)
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.warn.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityElement(children: .combine)
            }
            if let why = r?.why { Block(title: "Why") { Text(why).font(.body).foregroundStyle(Color.ink) } }
            if let w = wrong, let g = mark?.given {
                Block(title: "Why \(g.count <= 3 ? g.uppercased() : "\"\(g)\"") is wrong") { Text(w).font(.body).foregroundStyle(Color.ink) }
            }
            if let pairs = r?.paraphrase, !pairs.isEmpty {
                Block(title: "Same idea, different words") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(pairs.enumerated()), id: \.offset) { _, p in
                            if p.count >= 2 {
                                FlowLayout(spacing: 6, lineSpacing: 4) {
                                    Text(p[0]).padding(.horizontal, 6).padding(.vertical, 2).background(Color.surface2, in: RoundedRectangle(cornerRadius: 6))
                                    Text("=").foregroundStyle(Color.muted).accessibilityLabel("means")
                                    Text(p[1]).padding(.horizontal, 6).padding(.vertical, 2).foregroundStyle(Color.brand).background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 6))
                                }
                                .font(.subheadline)
                                .accessibilityElement(children: .combine)
                            }
                        }
                    }
                }
            }
            if let ev = r?.evidence {
                Block(title: listening ? "In the recording" : "In the passage") {
                    Text(ev).font(.system(.callout, design: .serif)).foregroundStyle(Color.ink)
                        .padding(.leading, 10).overlay(alignment: .leading) { Rectangle().fill(Color.brand).frame(width: 2) }
                }
            }
            if r == nil && entry == nil && window == nil { Text("No extra notes for this question.").font(.footnote).foregroundStyle(Color.muted) }
            FlowLayout(spacing: 8, lineSpacing: 8) {
                if r?.evidence != nil || !listening {
                    Button(action: onShow) { Label("Show \(listening ? "in transcript" : "in passage")", systemImage: "text.magnifyingglass") }.secondaryButton().controlSize(.regular)
                }
                if let w = window {
                    Button(action: onPlay) { Label("Play from \(clock(Int(w.from)))", systemImage: "play.fill") }.secondaryButton().controlSize(.regular)
                    Text("Answer heard at \(clock(Int(w.start)))" + (w.exact ? "" : " (approx.)")).font(.footnote.monospacedDigit()).foregroundStyle(Color.muted)
                }
                if canDictate {
                    Button(action: onDictate) { Label("Dictation", systemImage: "ear") }.secondaryButton().controlSize(.regular)
                }
            }
        }
        .card()
        .accessibilityElement(children: .contain)
    }
}

/// The word-by-word comparison: correct / wrong / missing / extra, each marked by text and shape as well as colour.
struct LrDictationResult: View {
    let typed: String
    let expected: String

    var body: some View {
        let ops = LrReview.dictationDiff(typed, expected)
        let s = LrReview.dictationScore(ops)
        VStack(alignment: .leading, spacing: 10) {
            Text("\(s.right) of \(s.total) \(s.total == 1 ? "word" : "words") right").font(.display(.headline)).foregroundStyle(Color.ink)
            FlowLayout(spacing: 6, lineSpacing: 8) {
                ForEach(Array(ops.enumerated()), id: \.offset) { _, o in
                    switch o.status {
                    case .correct: Text(o.word).foregroundStyle(Color.goodText).accessibilityLabel(o.word)
                    case .wrong:
                        (Text(o.typed ?? "").strikethrough().foregroundStyle(Color.bad) + Text(" ") + Text(o.word).bold().foregroundStyle(Color.goodText))
                            .padding(.horizontal, 4).background(Color.bad.opacity(0.12), in: RoundedRectangle(cornerRadius: 5))
                            .accessibilityLabel("\(o.word), you wrote \(o.typed ?? ""). Wrong.")
                    case .missing:
                        Text(o.word).foregroundStyle(Color.bad).padding(.horizontal, 4)
                            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Color.bad, style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
                            .accessibilityLabel("\(o.word). Missing.")
                    case .extra:
                        Text(o.typed ?? "").strikethrough().foregroundStyle(Color.muted).padding(.horizontal, 4)
                            .background(Color.surface2, in: RoundedRectangle(cornerRadius: 5))
                            .accessibilityLabel("\(o.typed ?? ""). Extra word.")
                    }
                }
            }
            .font(.system(.body, design: .serif))
            Text("Dashed = you missed it, struck through = not in the recording.").font(.caption).foregroundStyle(Color.muted)
        }
        .accessibilityElement(children: .contain)
    }
}

/// Plays the evidence segment and lets you type what you hear. Needs word timings.
struct LrDictationSheet: View {
    let q: LrQuestion
    let section: LrSection
    let url: URL?
    @Environment(\.dismiss) private var dismiss
    @State private var player = LrPracticePlayer()
    @State private var typed = ""
    @State private var checked = false
    @State private var slow = false

    private var win: LrReview.AudioWindow? { LrReview.audioWindow(section.timings, q) }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let win {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Question \(q.n). Play the sentence with the answer in it, as many times as you like, and type what you hear.")
                            .font(.subheadline).foregroundStyle(Color.muted)
                        HStack(spacing: 10) {
                            Button {
                                player.rate = slow ? 0.75 : 1
                                player.play(from: max(0, win.start - 0.3), to: win.end + 0.4)
                            } label: { Label("Play sentence", systemImage: "speaker.wave.2.fill") }
                                .primaryButton().controlSize(.large)
                            Button { slow.toggle() } label: { Label("Slow (0.75×)", systemImage: slow ? "checkmark" : "tortoise") }
                                .secondaryButton().controlSize(.large)
                                .accessibilityValue(slow ? "On" : "Off")
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("What do you hear?").font(.subheadline.weight(.medium)).foregroundStyle(Color.ink)
                            TextField("Type the sentence", text: $typed, axis: .vertical)
                                .lineLimit(3...6).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .padding(12).background(Color.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.line))
                                .onChange(of: typed) { _, _ in checked = false }
                        }
                        Button("Check") { checked = true }.primaryButton().controlSize(.large).disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
                        if checked { LrDictationResult(typed: typed, expected: LrReview.wordsBetween(section.timings, win.start, win.end)).card() }
                    }
                    .padding(16)
                }
            }
            .background(Color.canvas)
            .navigationTitle("Dictation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Close") { dismiss() }.fontWeight(.semibold) } }
        }
        .task {
            player.load(url)
            if Demo.screen == "lr-dictation" { // demo: a typed attempt, already checked
                typed = "record the wait of each hive week"
                try? await Task.sleep(for: .milliseconds(300))
                checked = true
            }
        }
        .onDisappear { player.teardown() }
    }
}

/// Confusion table (the answer vs what you chose) per statement type, the fixed rules, and your pattern across attempts.
struct LrTfngPanel: View {
    let rows: [LrTfngRow]
    let pattern: String?

    var body: some View {
        let kinds = ["tfng", "ynng"].filter { k in rows.contains { $0.kind == k } }
        if !kinds.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle("True / False / Not Given")
                if let p = pattern {
                    (Text(p).fontWeight(.medium) + Text(" Across all your attempts.").foregroundStyle(Color.muted))
                        .font(.subheadline).foregroundStyle(Color.warnText)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.warn.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                ForEach(kinds, id: \.self) { k in
                    let rules = LrReview.tfngRules[k] ?? []
                    let vals = rules.map(\.value)
                    let mine = rows.filter { $0.kind == k }
                    VStack(alignment: .leading, spacing: 14) {
                        Text("This attempt: the answer (rows) against what you chose (columns)").font(.caption).foregroundStyle(Color.muted)
                        Grid(alignment: .center, horizontalSpacing: 6, verticalSpacing: 6) {
                            GridRow {
                                Text("Answer").font(.caption.weight(.semibold)).foregroundStyle(Color.muted).gridColumnAlignment(.leading)
                                ForEach(vals, id: \.self) { Text($0 == "NOT GIVEN" ? "NOT\nGIVEN" : $0).font(.caption2.weight(.semibold)).multilineTextAlignment(.center).foregroundStyle(Color.muted) }
                            }
                            ForEach(vals, id: \.self) { a in
                                GridRow {
                                    Text(a).font(.caption.weight(.semibold)).foregroundStyle(Color.ink).gridColumnAlignment(.leading)
                                    ForEach(vals, id: \.self) { c in
                                        let n = mine.filter { $0.answer == a && $0.chose == c }.count
                                        Text(n > 0 ? "\(n)" : "·").font(.subheadline.weight(n > 0 ? .bold : .regular).monospacedDigit())
                                            .foregroundStyle(a == c ? (n > 0 ? Color.goodText : Color.muted) : (n > 0 ? Color.bad : Color.muted))
                                            .frame(maxWidth: .infinity, minHeight: 34)
                                            .background(n > 0 && a != c ? Color.bad.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                                            .accessibilityLabel("Answer \(a), you chose \(c): \(n)\(n > 0 && a != c ? " wrong" : "")")
                                    }
                                }
                            }
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(rules, id: \.value) { r in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(r.value).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
                                    Text(r.rule).font(.footnote).foregroundStyle(Color.muted)
                                }
                                .accessibilityElement(children: .combine)
                            }
                        }
                        .padding(.top, 4)
                    }
                    .card()
                }
            }
        }
    }
}

/// Time per part against an even split, answer changes, last-minute answers and blanks. Reading is 60 minutes.
struct LrPacingPanel: View {
    let stats: LrStats
    let parts: [(part: Int, questions: [Int])]
    let noun: String
    let totalS: Double?
    let marks: [Int: LrMark]
    let blank: [Int]

    private func dur(_ s: Double) -> String { ShellDate.duration(Int(s * 1000)) }
    private func list(_ ns: [Int]) -> String { ns.sorted().map(String.init).joined(separator: ", ") }

    private var times: [(part: Int, s: Double)] { parts.map { (part: $0.part, s: stats.partS[String($0.part)] ?? 0) } }
    private var split: Double? { totalS.map { $0 / Double(max(1, parts.count)) } }
    private var changed: [(n: Int, c: Int)] {
        var out: [(n: Int, c: Int)] = []
        for (k, v) in stats.changes where v > 0 { if let n = Int(k) { out.append((n: n, c: v)) } }
        return out.sorted { $0.c != $1.c ? $0.c > $1.c : $0.n < $1.n }
    }

    var body: some View {
        let spent: Double = times.reduce(0) { $0 + $1.s }
        if spent >= 5 || !stats.changes.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle("Pacing")
                VStack(alignment: .leading, spacing: 14) {
                    bars
                    Divider().overlay(Color.line)
                    changesFact
                    lateFact
                    fact("Left blank") {
                        Text(blank.isEmpty ? "None." : "\(blank.count): \(list(blank)). There is no penalty for guessing.")
                    }
                }
                .card()
            }
        }
    }

    @ViewBuilder private var bars: some View {
        let mx: Double = max(1, split ?? 0, times.map(\.s).max() ?? 0)
        let head: String = "Time per \(noun.lowercased())" + (split.map { ", against \(dur($0)) each" } ?? "")
        Text(head).font(.caption).foregroundStyle(Color.muted)
        ForEach(times, id: \.part) { t in bar(t.part, t.s, mx) }
        if split != nil { Text("The marker is an even split of the 60 minutes.").font(.caption).foregroundStyle(Color.muted) }
    }

    private func bar(_ part: Int, _ s: Double, _ mx: Double) -> some View {
        let over: Bool = split.map { s > $0 * 1.15 } ?? false
        return VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("\(noun) \(part)").font(.body).foregroundStyle(Color.ink)
                Spacer()
                Text(dur(s)).font(.subheadline.monospacedDigit()).fontWeight(over ? .semibold : .regular).foregroundStyle(over ? Color.warnText : Color.muted)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.surface2)
                    Capsule().fill(over ? Color.warn : Color.brand).frame(width: g.size.width * min(1, s / mx))
                    if let sp = split { Capsule().fill(Color.ink).frame(width: 2, height: 14).offset(x: min(max(g.size.width * sp / mx - 1, 0), g.size.width - 2)) }
                }
            }
            .frame(height: 8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(noun) \(part): \(dur(s))" + (over ? ", over the suggested time" : ""))
    }

    private var changesFact: some View {
        fact("Answers you changed") {
            if changed.isEmpty {
                Text("None. You stuck with your first answers.")
            } else {
                let total: Int = changed.reduce(0) { $0 + $1.c }
                let top: String = changed.prefix(5).map { "Q\($0.n) (\($0.c)×)" }.joined(separator: ", ")
                Text("\(total) changes across \(changed.count) \(changed.count == 1 ? "question" : "questions")")
                Text("Most: \(top)").font(.caption).foregroundStyle(Color.muted)
            }
        }
    }

    private var lateFact: some View {
        let lateWrong: [Int] = stats.late.filter { marks[$0]?.correct == false }
        return fact("Answered in the last 5 minutes") {
            if stats.late.isEmpty {
                Text("None.")
            } else {
                Text("\(stats.late.count) \(stats.late.count == 1 ? "question" : "questions"): \(list(stats.late))")
                if !lateWrong.isEmpty { Text("\(lateWrong.count) of them wrong (\(list(lateWrong))). Rushed guesses cost marks.").font(.caption).foregroundStyle(Color.warnText) }
            }
        }
    }

    private func fact<C: View>(_ title: String, @ViewBuilder _ body: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(Color.muted)
            body().font(.body).foregroundStyle(Color.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Key words of a part, each with an explicit "Add to review". Guests have no deck, so they only read.
struct LrVocabList: View {
    @Environment(APIClient.self) private var api
    let vocab: [LrVocab]
    @State private var added: Set<String> = []
    @State private var busy: String?
    @State private var failed = false

    var body: some View {
        if !vocab.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Key vocabulary").font(.display(.headline)).foregroundStyle(Color.ink).accessibilityAddTraits(.isHeader)
                VStack(spacing: 0) {
                    ForEach(Array(vocab.enumerated()), id: \.element.word) { i, v in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(v.word).font(.body.weight(.semibold)).foregroundStyle(Color.ink)
                                Text(v.meaning).font(.subheadline).foregroundStyle(Color.ink)
                                if let e = v.example { Text(e).font(.system(.footnote, design: .serif).italic()).foregroundStyle(Color.muted) }
                            }
                            Spacer(minLength: 8)
                            if api.isSignedIn {
                                let done = added.contains(v.word)
                                Button { Task { await add(v) } } label: {
                                    if busy == v.word { ProgressView() } else { Label(done ? "In review" : "Add to review", systemImage: done ? "checkmark" : "plus").font(.subheadline) }
                                }
                                .buttonStyle(.bordered).disabled(done || busy != nil)
                                .accessibilityLabel(done ? "\(v.word) is in review" : "Add \(v.word) to review")
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        if i < vocab.count - 1 { Divider().overlay(Color.line) }
                    }
                }
                .card(padding: 0)
            }
            .alert("Could not add the card", isPresented: $failed) { Button("OK", role: .cancel) {} }
        }
    }

    private func add(_ v: LrVocab) async {
        busy = v.word
        defer { busy = nil }
        do {
            try await api.addCard(front: v.word, back: v.example.map { "\(v.meaning)\n\n\($0)" } ?? v.meaning, source: "vocab")
            added.insert(v.word)
        } catch is CancellationError {
        } catch {
            failed = true
        }
    }
}
