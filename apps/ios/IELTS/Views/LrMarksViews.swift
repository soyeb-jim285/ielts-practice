import SwiftUI
import UIKit

/// Text style shared by the markable text view (UIKit) and its plain SwiftUI fallback.
struct LrFont {
    enum W { case regular, medium, semibold, bold }
    var style: Font.TextStyle = .body
    var w: W = .regular
    var serif = false
    var italic = false

    private var weightUI: UIFont.Weight { switch w { case .regular: .regular; case .medium: .medium; case .semibold: .semibold; case .bold: .bold } }
    private var weightSwift: Font.Weight { switch w { case .regular: .regular; case .medium: .medium; case .semibold: .semibold; case .bold: .bold } }
    private var base: CGFloat {
        switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        default: 17
        }
    }

    var swift: Font {
        let f = Font.system(style, design: serif ? Font.Design.serif : Font.Design.default, weight: weightSwift)
        return italic ? f.italic() : f
    }

    /// `scale` is the Dynamic Type factor against the 17 pt body.
    func ui(scale: CGFloat) -> UIFont {
        let size = base * scale
        var f = UIFont.systemFont(ofSize: size, weight: weightUI)
        if serif, let d = f.fontDescriptor.withDesign(.serif) { f = UIFont(descriptor: d, size: size) }
        if italic, let d = f.fontDescriptor.withSymbolicTraits(.traitItalic) { f = UIFont(descriptor: d, size: size) }
        return f
    }
}

/// Selectable text whose edit menu gains Highlight and Add note, and which draws the marks of its region.
struct LrTextView: UIViewRepresentable {
    struct Key: Equatable {
        let text: String
        let marks: [LrAnnot]
        let font: String
        let ink: String
        let hl: String
        let hlText: String
        let spacing: CGFloat
    }

    let text: String
    let font: UIFont
    let ink: UIColor
    let hl: UIColor
    let hlText: UIColor?
    let spacing: CGFloat
    let marks: [LrAnnot]
    /// Selected range in plain-text offsets, and whether the user chose Add note.
    let onSelect: (NSRange, Bool) -> Void
    let onTapMark: (String) -> Void
    var onPlainTap: (() -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UITextView {
        let v = UITextView()
        v.isEditable = false
        v.isSelectable = true
        v.isScrollEnabled = false
        v.backgroundColor = .clear
        v.textContainerInset = .zero
        v.textContainer.lineFragmentPadding = 0
        v.delegate = context.coordinator
        v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delegate = context.coordinator
        v.addGestureRecognizer(tap)
        return v
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        let c = context.coordinator
        c.parent = self
        let key = Key(text: text, marks: marks, font: "\(font.fontName) \(font.pointSize)", ink: "\(ink)", hl: "\(hl)", hlText: "\(String(describing: hlText))", spacing: spacing)
        guard c.key != key else { return }
        c.key = key
        let built = Self.build(text: text, marks: marks, font: font, ink: ink, hl: hl, hlText: hlText, spacing: spacing, traits: tv.traitCollection)
        c.inserts = built.inserts
        c.noted = built.noted
        tv.attributedText = built.text
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        var w: CGFloat = 320
        if let pw = proposal.width, pw.isFinite { w = max(pw, 1) }
        let s = uiView.sizeThatFits(CGSize(width: w, height: .greatestFiniteMagnitude))
        return CGSize(width: w, height: ceil(s.height))
    }

    struct Built { let text: NSAttributedString; let inserts: [Int]; let noted: [LrAnnot] }

    static func build(text: String, marks: [LrAnnot], font: UIFont, ink: UIColor, hl: UIColor, hlText: UIColor?, spacing: CGFloat, traits: UITraitCollection) -> Built {
        let ns = text as NSString
        let para = NSMutableParagraphStyle()
        para.lineSpacing = spacing
        let inkNow = ink.resolvedColor(with: traits)
        let base: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: ink, .paragraphStyle: para]
        let noted = marks.filter { $0.note != nil }.sorted { $0.e < $1.e }
        let inserts = noted.map { min(max($0.e, 0), ns.length) }
        let out = NSMutableAttributedString()
        var prev = 0
        for pos in inserts {
            out.append(NSAttributedString(string: ns.substring(with: NSRange(location: prev, length: pos - prev)), attributes: base))
            let att = NSTextAttachment()
            let sz = font.pointSize * 0.8
            att.image = UIImage(systemName: "note.text")?.withTintColor(inkNow, renderingMode: .alwaysOriginal)
            att.bounds = CGRect(x: 1, y: -1, width: sz, height: sz)
            let a = NSMutableAttributedString(attachment: att)
            a.addAttributes(base, range: NSRange(location: 0, length: a.length))
            out.append(a)
            prev = pos
        }
        out.append(NSAttributedString(string: ns.substring(from: prev), attributes: base))
        for m in marks {
            let s = LrOffsets.dispStart(m.s, inserts), e = LrOffsets.dispEnd(m.e, inserts)
            guard e > s, e <= out.length else { continue }
            let r = NSRange(location: s, length: e - s)
            out.addAttribute(.backgroundColor, value: hl, range: r)
            if let t = hlText { out.addAttribute(.foregroundColor, value: t, range: r) }
            if m.note != nil {
                out.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: r)
                out.addAttribute(.underlineColor, value: inkNow, range: r)
            }
        }
        return Built(text: out, inserts: inserts, noted: noted)
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: LrTextView?
        var key: Key?
        var inserts: [Int] = []
        var noted: [LrAnnot] = []

        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let p = parent, range.length > 0 else { return nil }
            let lo = LrOffsets.plain(range.location, inserts), hi = LrOffsets.plain(range.location + range.length, inserts)
            guard hi > lo else { return nil }
            let r = NSRange(location: lo, length: hi - lo)
            let highlight = UIAction(title: "Highlight", image: UIImage(systemName: "highlighter")) { [weak textView] _ in
                textView?.selectedTextRange = nil
                p.onSelect(r, false)
            }
            let note = UIAction(title: "Add note", image: UIImage(systemName: "note.text.badge.plus")) { [weak textView] _ in
                textView?.selectedTextRange = nil
                p.onSelect(r, true)
            }
            let own: [UIMenuElement] = [highlight, note]
            return UIMenu(children: own + suggestedActions)
        }

        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let tv = g.view as? UITextView, let p = parent, tv.selectedRange.length == 0 else { return }
            let pt = g.location(in: tv)
            let lm = tv.layoutManager, tc = tv.textContainer
            guard lm.numberOfGlyphs > 0 else { p.onPlainTap?(); return }
            let gi = lm.glyphIndex(for: pt, in: tc)
            let rect = lm.boundingRect(forGlyphRange: NSRange(location: gi, length: 1), in: tc)
            guard rect.contains(pt) else { p.onPlainTap?(); return }
            let ci = lm.characterIndexForGlyph(at: gi)
            if let k = inserts.indices.first(where: { inserts[$0] + $0 == ci }) { p.onTapMark(noted[k].id); return }
            let pi = LrOffsets.plain(ci, inserts)
            if let m = p.marks.first(where: { $0.s <= pi && pi < $0.e }) { p.onTapMark(m.id) } else { p.onPlainTap?() }
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

/// Markable text when taking a test (long-press, select, then Highlight or Add note); plain selectable text elsewhere (review).
struct LrMarkText: View {
    let text: String
    let region: String
    var p = 0
    var font = LrFont()
    var spacing: CGFloat = 0
    var alpha = 1.0
    /// A tap that lands on no mark, for rows that are also buttons (answer options).
    var onPlainTap: (() -> Void)?
    @Environment(\.lrMarker) private var marker
    @Environment(\.lrStyle) private var st
    @ScaledMetric(relativeTo: .body) private var unit: CGFloat = 17

    var body: some View {
        let ink = st.ink.opacity(alpha)
        if let m = marker {
            LrTextView(
                text: text, font: font.ui(scale: unit / 17), ink: UIColor(ink), hl: UIColor(st.hl), hlText: st.hlText.map { UIColor($0) },
                spacing: spacing, marks: m.marks(in: region),
                onSelect: { r, note in
                    let x = LrMarkStore.Pending(region: region, p: p, s: r.location, e: r.location + r.length, text: text)
                    if note { m.note(x) } else { m.highlight(x) }
                },
                onTapMark: { m.editor = .edit($0) },
                onPlainTap: onPlainTap)
        } else {
            Text(text).font(font.swift).lineSpacing(spacing).foregroundStyle(ink).textSelection(.enabled)
        }
    }
}

/// One word of inline content (form and table text with gap fields): a long-press menu marks the whole word.
struct LrWordText: View {
    let word: String
    let region: String
    var bold = false
    @Environment(\.lrMarker) private var marker
    @Environment(\.lrStyle) private var st

    var body: some View {
        let m = marker?.marks(in: region).first
        let label = HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(word).font(.body.weight(bold ? .bold : .regular))
                .foregroundStyle(m != nil ? (st.hlText ?? st.ink) : st.ink)
                .background(m != nil ? st.hl : Color.clear)
            if m?.note != nil {
                Image(systemName: "note.text").font(.caption2).foregroundStyle(st.ink).accessibilityLabel("Has a note")
            }
        }
        if let mk = marker {
            label
                .onTapGesture { if let m { mk.editor = .edit(m.id) } }
                .contextMenu {
                    let x = LrMarkStore.Pending(region: region, p: 0, s: 0, e: (word as NSString).length, text: word)
                    if let m {
                        Button { mk.editor = .edit(m.id) } label: { Label(m.note == nil ? "Add note" : "Edit note", systemImage: "note.text") }
                        Button(role: .destructive) { mk.remove(m.id) } label: { Label("Remove highlight", systemImage: "trash") }
                    } else {
                        Button { mk.highlight(x) } label: { Label("Highlight", systemImage: "highlighter") }
                        Button { mk.note(x) } label: { Label("Add note", systemImage: "note.text.badge.plus") }
                    }
                }
        } else {
            label
        }
    }
}

extension View {
    /// The test content area: marks, colour scheme, and the in-app text size. Chrome (bars, tabs) stays outside.
    func lrThemed(_ st: LrStyle, size: LrSettings.Size, marks: LrMarkStore, system: ColorScheme) -> some View {
        self
            .environment(\.lrMarker, marks)
            .environment(\.lrStyle, st)
            .transformEnvironment(\.dynamicTypeSize) { $0 = $0.shifted(size.steps) }
            .environment(\.colorScheme, st.scheme ?? system)
            .background(st.background ?? Color.clear)
    }
}

// MARK: Sheets

/// Add or edit a note (max 500 characters), or remove the mark.
struct LrMarkEditor: View {
    let store: LrMarkStore
    let editor: LrMarkStore.Editor
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    private var existing: LrAnnot? { if case let .edit(id) = editor { store.mark(id) } else { nil } }
    private var excerpt: String {
        switch editor {
        case let .new(x): LrMarkOps.excerpt(x.text, x.s, x.e)
        case .edit: existing?.ex ?? ""
        }
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                if !excerpt.isEmpty {
                    Text("\u{201C}\(excerpt)\u{201D}").font(.subheadline).foregroundStyle(Color.muted).lineLimit(3)
                }
                TextEditor(text: $text)
                    .focused($focused)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 120, maxHeight: 220)
                    .background(Color.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.line))
                    .accessibilityLabel("Note")
                    .onChange(of: text) { _, t in if t.count > LrMarkOps.maxNote { text = String(t.prefix(LrMarkOps.maxNote)) } }
                Text("\(text.count) of \(LrMarkOps.maxNote). Notes stay on this device.").font(.caption).foregroundStyle(Color.muted)
                if let m = existing {
                    Button(role: .destructive) { store.remove(m.id); dismiss() } label: { Label(m.note == nil ? "Remove highlight" : "Delete note and highlight", systemImage: "trash") }
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(Color.canvas)
            .navigationTitle(existing?.note == nil && existing != nil ? "Highlight" : "Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { store.save(editor, note: text); dismiss() }.fontWeight(.semibold) }
            }
            .onAppear {
                text = existing?.note ?? ""
                focused = true
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// Every mark of the attempt with its place; tap to jump to it.
struct LrNotesSheet: View {
    let store: LrMarkStore
    let test: LrTest
    let canJump: (LrAnnot) -> Bool
    let onJump: (LrAnnot) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let rows = store.marks.sorted { $0.sortKey(test).lexicographicallyPrecedes($1.sortKey(test)) }
        NavigationStack {
            Group {
                if rows.isEmpty {
                    ContentUnavailableView("No notes yet", systemImage: "note.text", description: Text("Select text, then choose Highlight or Add note."))
                } else {
                    List {
                        ForEach(rows) { m in row(m) }.listRowBackground(Color.surface)
                    }
                    .canvasList()
                }
            }
            .navigationTitle("Notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .sheet(item: Binding<LrMarkStore.Editor?>(get: { store.editor }, set: { store.editor = $0 })) { LrMarkEditor(store: store, editor: $0) }
    }

    private func row(_ m: LrAnnot) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Button { onJump(m) } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(LrMarkOps.place(m.region)).font(.caption.weight(.semibold)).foregroundStyle(Color.muted)
                    Text("\u{201C}\(m.ex ?? "")\u{201D}").font(.subheadline).foregroundStyle(Color.ink).lineLimit(3)
                    if let n = m.note { Text(n).font(.body).foregroundStyle(Color.ink) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!canJump(m))
            .accessibilityHint(canJump(m) ? "Jumps to this text" : "This text is in another part")
            Menu {
                Button { store.editor = .edit(m.id) } label: { Label(m.note == nil ? "Add note" : "Edit note", systemImage: "pencil") }
                Button(role: .destructive) { store.remove(m.id) } label: { Label("Delete", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis.circle").frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Actions for this mark")
        }
    }
}

private extension LrAnnot {
    func sortKey(_ test: LrTest) -> [Int] { LrMarkOps.sortKey(self, test) }
}
