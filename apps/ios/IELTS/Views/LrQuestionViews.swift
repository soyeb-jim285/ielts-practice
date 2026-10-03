import SwiftUI

/// Everything a question group needs from its screen: the answers, how to change them, figures, and (after submission) the marks.
struct LrCtx {
    var responses: [String: String]
    var set: (Int, String) -> Void = { _, _ in }
    var replace: ([String: String]) -> Void = { _ in }
    var assets: [String: String] = [:]
    var review: [Int: LrMark]?
    var active: Int?
    var onFocus: (Int) -> Void = { _ in }

    func value(_ n: Int) -> String { responses[String(n)] ?? "" }
    func mark(_ n: Int) -> LrMark? { review?[n] }
    var isReview: Bool { review != nil }
}

private func markFill(_ m: LrMark?, selected: Bool = false) -> Color {
    guard let m else { return selected ? .brandSoft : .surface }
    return m.correct ? Color.good.opacity(0.14) : Color.bad.opacity(0.12)
}
private func markStroke(_ m: LrMark?, active: Bool, selected: Bool = false) -> Color {
    if let m { return m.correct ? .good : .bad }
    return active || selected ? .brand : .line
}

/// Number chip in front of an item: teal once answered, green or red once marked.
struct LrQNum: View {
    let n: Int
    var done = false
    var mark: LrMark?
    var body: some View {
        Text("\(n)")
            .font(.subheadline.weight(.semibold).monospacedDigit())
            .foregroundStyle(mark.map { $0.correct ? Color.goodText : Color.bad } ?? (done ? Color.brand : Color.muted))
            .frame(minWidth: 28, minHeight: 28)
            .padding(.horizontal, 2)
            .background(mark.map { $0.correct ? Color.good.opacity(0.14) : Color.bad.opacity(0.12) } ?? (done ? Color.brandSoft : Color.surface2),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityHidden(true)
    }
}

private struct LrExpected: View {
    let mark: LrMark?
    var body: some View {
        if let m = mark, !m.correct {
            Label(m.answer.joined(separator: " / "), systemImage: "checkmark")
                .font(.caption.weight(.semibold)).foregroundStyle(Color.goodText)
                .accessibilityLabel("Correct answer: \(m.answer.joined(separator: " or "))")
        }
    }
}

private struct LrStatus: View {
    let mark: LrMark?
    var body: some View {
        if let m = mark {
            Image(systemName: m.correct ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(m.correct ? Color.goodText : Color.bad)
                .accessibilityLabel(m.correct ? "Correct" : "Wrong")
        }
    }
}

// MARK: Gap field and picker

struct LrGapField: View {
    let n: Int
    let ctx: LrCtx
    var wordLimit: String?
    @FocusState private var focused: Bool
    @ScaledMetric private var unit: CGFloat = 9

    var body: some View {
        let v = ctx.value(n), m = ctx.mark(n)
        HStack(spacing: 6) {
            TextField("", text: Binding(get: { ctx.value(n) }, set: { ctx.set(n, $0) }), prompt: Text("\(n)").foregroundStyle(Color.muted))
                .focused($focused)
                .font(.body.weight(.medium))
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .allowsHitTesting(!ctx.isReview)
                .padding(.horizontal, 8)
                .frame(width: max(84, min(230, CGFloat(v.count + 3) * unit)), height: 40 * max(1, unit / 9))
                .background(markFill(m), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(markStroke(m, active: ctx.active == n || focused), lineWidth: m != nil || ctx.active == n || focused ? 2 : 1))
                .accessibilityLabel("Question \(n)" + (wordLimit.map { ", \($0.lowercased())" } ?? ""))
                .onChange(of: focused) { _, on in if on { ctx.onFocus(n) } }
            LrStatus(mark: m)
            LrExpected(mark: m)
        }
        .id(n)
    }
}

/// A match item or word-box gap: a menu of the group's option letters.
struct LrPick: View {
    let n: Int
    let options: [LrOption]
    let ctx: LrCtx
    var fullWidth = false

    var body: some View {
        let v = ctx.value(n), m = ctx.mark(n)
        HStack(spacing: 6) {
            if ctx.isReview {
                pill(v, m)
            } else {
                Menu {
                    if !v.isEmpty { Button("Clear answer", role: .destructive) { ctx.set(n, "") } }
                    ForEach(options, id: \.key) { o in
                        Button { ctx.set(n, o.key) } label: { Text(o.text.isEmpty ? o.key : "\(o.key)  \(o.text)") }
                    }
                } label: { pill(v, nil) }
                .accessibilityLabel("Question \(n)")
                .accessibilityValue(v.isEmpty ? "No answer" : v)
            }
            LrStatus(mark: m)
            LrExpected(mark: m)
        }
        .id(n)
    }

    private func pill(_ v: String, _ m: LrMark?) -> some View {
        HStack(spacing: 6) {
            Text(v.isEmpty ? (m != nil ? "No answer" : "\(n)") : v)
                .font(.body.weight(.semibold).monospacedDigit())
                .foregroundStyle(v.isEmpty ? Color.muted : Color.ink)
            if m == nil { Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.bold)).foregroundStyle(Color.muted) }
        }
        .padding(.horizontal, 12)
        .frame(minWidth: 72, minHeight: 44, alignment: .center)
        .frame(maxWidth: fullWidth ? .infinity : nil)
        .background(markFill(m, selected: !v.isEmpty), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(markStroke(m, active: ctx.active == n, selected: !v.isEmpty), lineWidth: m != nil || ctx.active == n ? 2 : 1))
    }
}

// MARK: Inline content with gaps (words flow like text, gaps are fields)

/// Text that wraps like a paragraph with {{n}} placeholders replaced by `gap(n)`.
struct LrInline<Gap: View>: View {
    let items: [Lr.Inline]
    var bold = false
    @ViewBuilder let gap: (Int) -> Gap

    private enum Tok: Hashable { case word(String, bold: Bool, label: String?, hidden: Bool), gap(Int) }

    private var tokens: [Tok] {
        var out: [Tok] = []
        for it in items {
            switch it {
            case let .gap(n): out.append(.gap(n))
            case let .text(t), let .bold(t):
                var isBold = bold
                if case .bold = it { isBold = true }
                let words = t.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init)
                for (i, w) in words.enumerated() { out.append(.word(w, bold: isBold, label: i == 0 ? t.trimmingCharacters(in: .whitespaces) : nil, hidden: i > 0)) }
            }
        }
        return out
    }

    var body: some View {
        FlowLayout(spacing: 4, lineSpacing: 8) {
            ForEach(Array(tokens.enumerated()), id: \.offset) { _, t in
                switch t {
                case let .word(w, b, label, hidden):
                    // VoiceOver reads each run of words once (on its first word) instead of word by word.
                    Text(w).font(.body.weight(b ? .bold : .regular)).foregroundStyle(Color.ink)
                        .accessibilityLabel(label ?? w).accessibilityHidden(hidden)
                case let .gap(n): gap(n)
                }
            }
        }
    }
}

private struct LrContent: View {
    let blocks: [Lr.Block]
    let gap: (Int) -> AnyView

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in
                switch b {
                case let .p(items): LrInline(items: items) { gap($0) }
                case let .list(ordered, items):
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(items.enumerated()), id: \.offset) { i, it in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(ordered ? "\(i + 1)." : "•").font(.body.weight(.semibold)).foregroundStyle(Color.muted)
                                LrInline(items: it) { gap($0) }
                            }
                        }
                    }
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) { Rectangle().fill(Color.line).frame(width: 2) }
                case let .table(head, rows):
                    table(head, rows)
                }
            }
        }
    }

    private func table(_ head: [[Lr.Inline]], _ rows: [[[Lr.Inline]]]) -> some View {
        VStack(spacing: 0) {
            if head.contains(where: { !$0.isEmpty }) {
                row(head, bold: true).background(Color.surface2)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                Divider().overlay(Color.line)
                row(r, firstBold: true)
            }
        }
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.line))
    }

    private func row(_ cells: [[Lr.Inline]], bold: Bool = false, firstBold: Bool = false) -> some View {
        HStack(alignment: .center, spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { i, c in
                LrInline(items: c, bold: bold || (firstBold && i == 0)) { gap($0) }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12).padding(.vertical, 10)
            }
        }
    }
}

// MARK: Group

struct LrGroupView: View {
    let group: LrGroup
    let ctx: LrCtx
    @State private var zoom: LrZoomItem?

    private var wordBox: Bool { group.type == "gap" && !(group.options ?? []).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            if let t = group.title { Text(t).font(.display(.headline)).foregroundStyle(Color.ink) }
            figure
            if (group.type == "match" || wordBox), let o = group.options, o.contains(where: { !$0.text.isEmpty }) {
                optionList(wordBox ? "Word box" : o.contains { $0.key.range(of: "^[ivx]+$", options: [.regularExpression, .caseInsensitive]) != nil } ? "List of headings" : "Options", o)
            }
            bodyView
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fullScreenCover(item: $zoom) { LrZoomView(url: $0.url) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(group.from == group.to ? "Question \(group.from)" : "Questions \(group.from) to \(group.to)")
                .font(.display(.title3)).foregroundStyle(Color.ink).accessibilityAddTraits(.isHeader)
            Text(group.instructions.replacingOccurrences(of: #"^Questions? [\d\s–\-and]+\.\s*"#, with: "", options: [.regularExpression, .caseInsensitive]))
                .font(.subheadline).foregroundStyle(Color.ink.opacity(0.8))
            if let w = group.wordLimit, !group.instructions.uppercased().contains(w.uppercased()) {
                Text("Write \(w).").font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
            }
        }
    }

    @ViewBuilder private var figure: some View {
        if let key = group.image, let url = Lr.assetURL(ctx.assets[key]) {
            Button { zoom = LrZoomItem(url: url) } label: {
                // The one literal white of the app: raster exam figures are drawn on white.
                AsyncImage(url: url) { img in
                    img.resizable().scaledToFit()
                } placeholder: {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 160)
                }
                .padding(8)
                .frame(maxWidth: .infinity)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right").font(.caption.weight(.bold)).padding(8)
                        .background(.regularMaterial, in: Circle()).padding(8).foregroundStyle(Color.ink)
                }
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.line))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(group.title ?? "Figure for the questions below")
            .accessibilityHint("Opens the figure full screen to zoom")
        }
    }

    private func optionList(_ title: String, _ options: [LrOption]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline).foregroundStyle(Color.ink)
            ForEach(options, id: \.key) { o in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(o.key).font(.body.weight(.semibold).monospacedDigit()).foregroundStyle(Color.brand).frame(minWidth: 24, alignment: .leading)
                    Text(o.text).font(.body).foregroundStyle(Color.ink)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func gapItems(_ q: LrQuestion) -> [Lr.Inline] {
        var items = Lr.parseInline(q.text ?? "")
        if q.text?.contains("{{\(q.n)}}") != true { items.append(.gap(q.n)) }
        return items
    }

    private func gapNode(_ n: Int) -> AnyView {
        wordBox ? AnyView(LrPick(n: n, options: group.options ?? [], ctx: ctx)) : AnyView(LrGapField(n: n, ctx: ctx, wordLimit: group.wordLimit))
    }

    @ViewBuilder private var bodyView: some View {
        switch group.type {
        case "gap":
            if let c = group.content {
                LrContent(blocks: Lr.parseContent(c), gap: gapNode)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(group.questions, id: \.n) { q in
                        let items = gapItems(q)
                        HStack(alignment: .top, spacing: 10) {
                            LrQNum(n: q.n, done: !ctx.value(q.n).isEmpty, mark: ctx.mark(q.n))
                            LrInline(items: items) { gapNode($0) }
                        }
                        .padding(6).background(ctx.active == q.n ? Color.brandSoft : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
        case "mcq":
            VStack(alignment: .leading, spacing: 22) {
                ForEach(group.questions, id: \.n) { q in
                    HStack(alignment: .top, spacing: 10) {
                        LrQNum(n: q.n, done: !ctx.value(q.n).isEmpty, mark: ctx.mark(q.n))
                        VStack(alignment: .leading, spacing: 10) {
                            Text(q.text ?? "").font(.body.weight(.medium)).foregroundStyle(Color.ink)
                            choices(q.n, q.options ?? [])
                        }
                    }
                    .id(q.n)
                }
            }
        case "mcq-multi":
            multi
        case "tfng", "ynng":
            let keys = group.type == "tfng" ? ["TRUE", "FALSE", "NOT GIVEN"] : ["YES", "NO", "NOT GIVEN"]
            VStack(alignment: .leading, spacing: 22) {
                ForEach(group.questions, id: \.n) { q in
                    HStack(alignment: .top, spacing: 10) {
                        LrQNum(n: q.n, done: !ctx.value(q.n).isEmpty, mark: ctx.mark(q.n))
                        VStack(alignment: .leading, spacing: 10) {
                            Text(q.text ?? "").font(.body).foregroundStyle(Color.ink)
                            segmented(q.n, keys)
                        }
                    }
                    .id(q.n)
                }
            }
        default: // match
            VStack(alignment: .leading, spacing: 8) {
                ForEach(group.questions, id: \.n) { q in
                    HStack(alignment: .center, spacing: 10) {
                        LrQNum(n: q.n, done: !ctx.value(q.n).isEmpty, mark: ctx.mark(q.n))
                        Text(q.text ?? "").font(.body).foregroundStyle(Color.ink).frame(maxWidth: .infinity, alignment: .leading)
                        LrPick(n: q.n, options: group.options ?? [], ctx: ctx)
                    }
                    .padding(6).background(ctx.active == q.n ? Color.brandSoft : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .id(q.n)
                }
            }
        }
    }

    // MARK: Choices

    /// Option card; tapping the chosen one again clears it.
    private func choices(_ n: Int, _ opts: [LrOption]) -> some View {
        let v = ctx.value(n), m = ctx.mark(n)
        let correct = Set((m?.answer ?? []).map { $0.uppercased() })
        return VStack(spacing: 8) {
            ForEach(opts, id: \.key) { o in
                let key = o.key, text = o.text
                let on = v.uppercased() == key.uppercased()
                let right = m != nil && correct.contains(key.uppercased())
                let mm: LrMark? = m != nil && (on || right) ? LrMark(n: n, given: v, correct: right, answer: []) : nil
                Button { if !ctx.isReview { ctx.set(n, on ? "" : key) } } label: {
                    HStack(spacing: 12) {
                        Text(key).font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(on ? Color.onBrand : Color.muted).frame(minWidth: 28, minHeight: 28)
                            .background(on ? Color.brand : Color.surface2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        Text(text).font(.body).foregroundStyle(Color.ink).multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading)
                        if m != nil, right, !on { Image(systemName: "checkmark").foregroundStyle(Color.goodText).accessibilityLabel("Correct answer") }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10).frame(minHeight: 44)
                    .background(markFill(mm, selected: on), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(markStroke(mm, active: ctx.active == n, selected: on), lineWidth: on || mm != nil || ctx.active == n ? 2 : 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(key), \(text)")
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    /// TRUE / FALSE / NOT GIVEN as a three-way control that can be cleared by tapping the chosen one again.
    private func segmented(_ n: Int, _ keys: [String]) -> some View {
        let v = ctx.value(n), m = ctx.mark(n)
        let correct = Set((m?.answer ?? []).map { $0.uppercased() })
        return HStack(spacing: 4) {
            ForEach(keys, id: \.self) { k in
                let on = v.uppercased() == k
                let right = m != nil && correct.contains(k)
                Button { if !ctx.isReview { ctx.set(n, on ? "" : k) } } label: {
                    Text(k == "NOT GIVEN" ? "Not given" : k.capitalized)
                        .font(.subheadline.weight(.medium)).lineLimit(2).minimumScaleFactor(0.8).multilineTextAlignment(.center)
                        .foregroundStyle(m != nil && on ? (right ? Color.goodText : Color.bad) : on ? Color.ink : Color.muted)
                        .frame(maxWidth: .infinity, minHeight: 44).padding(.horizontal, 4)
                        .background(on ? (m == nil ? Color.surface : (right ? Color.good.opacity(0.18) : Color.bad.opacity(0.16))) : Color.clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(on ? (m == nil ? Color.brand : (right ? Color.good : Color.bad)) : (right ? Color.good : Color.clear), lineWidth: on || right ? 1.5 : 0))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(k.capitalized)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Color.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(ctx.active == n ? Color.brand : Color.line, lineWidth: ctx.active == n ? 2 : 1))
    }

    /// "Choose TWO letters": one stem, shared options, up to N picks stored one letter per question slot.
    @ViewBuilder private var multi: some View {
        let picks = Lr.multiPicks(group, ctx.responses)
        let maxPicks = group.questions.count
        let correct = Set((group.questions.first?.answer ?? []).map { $0.uppercased() })
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                HStack(spacing: 4) { ForEach(group.questions, id: \.n) { LrQNum(n: $0.n, done: !ctx.value($0.n).isEmpty, mark: ctx.mark($0.n)).id($0.n) } }
                Text(group.questions.first?.text ?? "Choose \(maxPicks) answers").font(.body.weight(.medium)).foregroundStyle(Color.ink)
            }
            Text(ctx.isReview ? "Choose \(maxPicks)." : "Choose \(maxPicks). \(picks.count) of \(maxPicks) selected\(picks.count >= maxPicks ? "; untick one to change" : "").")
                .font(.footnote).foregroundStyle(picks.count >= maxPicks && !ctx.isReview ? Color.brand : Color.muted)
            ForEach(group.options ?? [], id: \.key) { o in
                let on = picks.contains(o.key)
                let full = picks.count >= maxPicks && !on
                let right = ctx.isReview && correct.contains(o.key.uppercased())
                let mm: LrMark? = ctx.isReview && (on || right) ? LrMark(n: group.from, given: o.key, correct: right, answer: []) : nil
                Button {
                    guard !ctx.isReview, !full else { return }
                    ctx.replace(Lr.setMultiPicks(group, ctx.responses, on ? picks.filter { $0 != o.key } : picks + [o.key]))
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: on ? "checkmark.square.fill" : "square").font(.title3).foregroundStyle(on ? Color.brand : Color.muted)
                        Text(o.key).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(Color.muted).frame(minWidth: 18)
                        Text(o.text).font(.body).foregroundStyle(Color.ink).multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading)
                        if right && !on { Image(systemName: "checkmark").foregroundStyle(Color.goodText).accessibilityLabel("Correct answer") }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10).frame(minHeight: 44)
                    .background(markFill(mm, selected: on), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(markStroke(mm, active: false, selected: on), lineWidth: on || mm != nil ? 2 : 1))
                    .opacity(full ? 0.55 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(o.key), \(o.text)")
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(ctx.active.map { a in group.questions.contains { $0.n == a } } == true ? 6 : 0)
        .overlay { if ctx.active.map({ a in group.questions.contains { $0.n == a } }) == true { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.brand, lineWidth: 2) } }
    }
}

struct LrZoomItem: Identifiable { let url: URL; var id: URL { url } }

/// Full-screen figure with pinch to zoom and drag to pan.
struct LrZoomView: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var base: CGFloat = 1

    var body: some View {
        NavigationStack {
            ScrollView([.horizontal, .vertical]) {
                AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                    .frame(width: UIScreen.main.bounds.width * scale)
                    .padding(8)
                    .background(Color.white)
                    .gesture(MagnifyGesture().onChanged { scale = min(5, max(1, base * $0.magnification)) }.onEnded { _ in base = scale })
                    .onTapGesture(count: 2) { withAnimation { scale = scale > 1 ? 1 : 2.5; base = scale } }
            }
            .background(Color.canvas)
            .navigationTitle("Figure")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
