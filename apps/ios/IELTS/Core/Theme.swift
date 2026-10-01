import SwiftUI
import UIKit

// Ocean Teal palette, mirroring the web tokens in apps/web/src/styles.css (light / dark). WCAG AA pairs are checked there.
// Teal means "act here" or "you are here"; green/amber/rose are band thresholds and real errors only.
private func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
    func ui(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
    return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? ui(dark) : ui(light) })
}

extension ShapeStyle where Self == Color {
    static var brand: Color { dyn(0x0F766E, 0x2DD4BF) }
    static var brandSoft: Color { dyn(0xDDF3EF, 0x0E2F33) }
    /// Text/icons on a solid brand fill.
    static var onBrand: Color { dyn(0xFFFFFF, 0x042F2C) }
    static var good: Color { dyn(0x15803D, 0x4ADE80) }
    static var goodText: Color { dyn(0x166534, 0x4ADE80) }
    static var warn: Color { dyn(0xB45309, 0xFBBF24) }
    static var warnText: Color { dyn(0x92400E, 0xFBBF24) }
    static var bad: Color { dyn(0xBE123C, 0xFB7185) }
    /// Second data colour for charts only; never a UI accent.
    static var sky: Color { dyn(0x0284C7, 0x38BDF8) }
    static var ink: Color { dyn(0x0F172A, 0xE6EDF5) }
    static var muted: Color { dyn(0x5B6B80, 0x8C9AAE) }
    static var line: Color { dyn(0xE3E8EF, 0x1D293B) }
    /// Page background (web --bg).
    static var canvas: Color { dyn(0xF7F9FB, 0x0A111C) }
    /// Cards and grouped rows (web --surface).
    static var surface: Color { dyn(0xFFFFFF, 0x111B2B) }
    /// Inset wells, tracks, segmented backgrounds (web --surface-2).
    static var surface2: Color { dyn(0xEEF2F6, 0x172338) }
}

/// Serif display face (New York), the native counterpart of the web's Newsreader headings.
extension Font {
    static func display(_ style: Font.TextStyle, weight: Font.Weight = .semibold) -> Font { .system(style, design: .serif, weight: weight) }
}

// MARK: Liquid Glass (iOS 26) with pre-26 fallbacks. Glass is for the control layer (floating bars, primary actions), never for content cards.

extension View {
    /// Prominent call to action: glass prominent on iOS 26, bordered prominent before.
    @ViewBuilder func primaryButton() -> some View {
        if #available(iOS 26.0, *) { self.buttonStyle(.glassProminent) } else { self.buttonStyle(.borderedProminent) }
    }

    /// Secondary action: glass on iOS 26, bordered before.
    @ViewBuilder func secondaryButton() -> some View {
        if #available(iOS 26.0, *) { self.buttonStyle(.glass) } else { self.buttonStyle(.bordered) }
    }

    /// Floating control surface (tab strips, audio bar, recorder controls).
    @ViewBuilder func glassBar<S: Shape>(_ shape: S, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            self.background(.regularMaterial, in: shape)
        }
    }

    /// Lists and forms on the app canvas instead of the system grouped grey.
    func canvasList() -> some View { scrollContentBackground(.hidden).background(Color.canvas) }

    /// Demo screenshots: `-anchor bottom|center` starts scroll views there so long screens can be captured in parts.
    func demoScroll() -> some View {
        defaultScrollAnchor(Demo.arg("anchor").flatMap { ["bottom": UnitPoint.bottom, "center": UnitPoint.center][$0] })
    }
}

enum Crit {
    static let labels = ["fc": "Fluency & Coherence", "lr": "Lexical Resource", "gra": "Grammar", "p": "Pronunciation",
                         "ta": "Task Achievement", "cc": "Coherence & Cohesion"]
    static func label(_ k: String) -> String { labels[k] ?? k.uppercased() }
    static func order(_ skill: String) -> [String] { skill == "speaking" ? ["fc", "lr", "gra", "p"] : ["ta", "cc", "lr", "gra"] }
}

func bandColor(_ band: Double, _ target: Double) -> Color { band >= target ? .good : band >= target - 1 ? .warn : .bad }
/// Text-safe variant (AA on soft fills).
func bandTextColor(_ band: Double, _ target: Double) -> Color { band >= target ? .goodText : band >= target - 1 ? .warnText : .bad }

func clock(_ seconds: Int) -> String { String(format: "%@%d:%02d", seconds < 0 ? "-" : "", abs(seconds) / 60, abs(seconds) % 60) }

func fmt(_ x: Double, _ digits: Int = 1) -> String { String(format: "%.\(digits)f", x) }

func categoryLabel(_ c: String) -> String {
    c.split(separator: ".").last.map { $0.replacingOccurrences(of: "-", with: " ").capitalized } ?? c
}

func newSessionId() -> String { UUID().uuidString.lowercased() }

extension View {
    /// Content card: surface fill with a hairline edge (web: bg-card + border-line).
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.line))
    }
}

struct BandPill: View {
    let band: Double
    var target = 7.0
    var body: some View {
        Text(Band.format(band))
            .font(.subheadline.weight(.bold).monospacedDigit())
            .padding(.horizontal, 10).padding(.vertical, 4)
            .foregroundStyle(bandTextColor(band, target))
            .background(bandColor(band, target).opacity(0.14), in: Capsule())
            .accessibilityLabel("Band \(Band.format(band))")
    }
}

struct Chip: View {
    let text: String
    var color: Color = .secondary
    var body: some View {
        Text(text).font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }
}

struct ErrorLine: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill").font(.callout).foregroundStyle(.bad)
    }
}

struct SectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.display(.title3)).foregroundStyle(.ink).frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Wraps children onto new lines like text (transcript words, chips).
struct FlowLayout: Layout {
    var spacing: CGFloat = 4
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let r = arrange(proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? r.width, height: r.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let r = arrange(bounds.width, subviews)
        for (i, p) in r.points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
        }
    }

    private func arrange(_ maxWidth: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], width: CGFloat, height: CGFloat) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, width: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                x = 0
                y += rowHeight + lineSpacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            width = max(width, x - spacing)
        }
        return (points, width, y + rowHeight)
    }
}

/// Mic permission denied → alert with a deep link to Settings.
struct MicDeniedAlert: ViewModifier {
    @Binding var isPresented: Bool
    func body(content: Content) -> some View {
        content.alert("Microphone access is off", isPresented: $isPresented) {
            Button("Open Settings") { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("IELTS Practice needs the microphone to record your answers. Turn it on in Settings › IELTS Practice.")
        }
    }
}

extension View {
    func micDeniedAlert(_ isPresented: Binding<Bool>) -> some View { modifier(MicDeniedAlert(isPresented: isPresented)) }
}
