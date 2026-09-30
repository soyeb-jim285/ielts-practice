import SwiftUI

extension ShapeStyle where Self == Color {
    static var brand: Color { Color(red: 0x3B / 255, green: 0x5B / 255, blue: 0xDB / 255) }
    static var good: Color { Color(red: 0x2F / 255, green: 0x9E / 255, blue: 0x44 / 255) }
    static var warn: Color { Color(red: 0xE8 / 255, green: 0x89 / 255, blue: 0x0C / 255) }
    static var bad: Color { Color(red: 0xE0 / 255, green: 0x31 / 255, blue: 0x31 / 255) }
    static var surface: Color { Color(uiColor: .secondarySystemGroupedBackground) }
    static var canvas: Color { Color(uiColor: .systemGroupedBackground) }
}

enum Crit {
    static let labels = ["fc": "Fluency & Coherence", "lr": "Lexical Resource", "gra": "Grammar", "p": "Pronunciation",
                         "ta": "Task Achievement", "cc": "Coherence & Cohesion"]
    static func label(_ k: String) -> String { labels[k] ?? k.uppercased() }
    static func order(_ skill: String) -> [String] { skill == "speaking" ? ["fc", "lr", "gra", "p"] : ["ta", "cc", "lr", "gra"] }
}

func bandColor(_ band: Double, _ target: Double) -> Color { band >= target ? .good : band >= target - 1 ? .warn : .bad }

func clock(_ seconds: Int) -> String { String(format: "%@%d:%02d", seconds < 0 ? "-" : "", abs(seconds) / 60, abs(seconds) % 60) }

func fmt(_ x: Double, _ digits: Int = 1) -> String { String(format: "%.\(digits)f", x) }

func categoryLabel(_ c: String) -> String {
    c.split(separator: ".").last.map { $0.replacingOccurrences(of: "-", with: " ").capitalized } ?? c
}

func newSessionId() -> String { UUID().uuidString.lowercased() }

extension View {
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct BandPill: View {
    let band: Double
    var target = 7.0
    var body: some View {
        Text(Band.format(band))
            .font(.subheadline.weight(.bold).monospacedDigit())
            .padding(.horizontal, 10).padding(.vertical, 4)
            .foregroundStyle(bandColor(band, target))
            .background(bandColor(band, target).opacity(0.15), in: Capsule())
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
    var body: some View { Text(text).font(.title3.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading) }
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
