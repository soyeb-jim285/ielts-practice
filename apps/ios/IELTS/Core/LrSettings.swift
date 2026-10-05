import SwiftUI

/// Reading and Listening display settings, remembered per device (UserDefaults `lr.settings`, JSON `{"size":"std","scheme":"std"}`).
struct LrSettings: Codable, Equatable {
    enum Size: String, Codable, CaseIterable {
        case std, lg, xl
        var label: String { switch self { case .std: "Standard (100%)"; case .lg: "Large (125%)"; case .xl: "Extra large (150%)" } }
        /// Dynamic Type steps added inside the test content.
        var steps: Int { switch self { case .std: 0; case .lg: 2; case .xl: 4 } }
    }
    enum Scheme: String, Codable, CaseIterable {
        case std, bw, cream, yb
        var label: String { switch self { case .std: "Standard"; case .bw: "Black on white"; case .cream: "Black on cream"; case .yb: "Yellow on black" } }
    }

    var size: Size = .std
    var scheme: Scheme = .std

    init() {}
    init(size: Size, scheme: Scheme) { self.size = size; self.scheme = scheme }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        size = (try? c.decodeIfPresent(Size.self, forKey: .size)) ?? .std
        scheme = (try? c.decodeIfPresent(Scheme.self, forKey: .scheme)) ?? .std
    }

    static let key = "lr.settings"

    static func load(_ d: UserDefaults = .standard) -> LrSettings {
        guard let s = d.string(forKey: key), let v = try? JSONDecoder().decode(LrSettings.self, from: Data(s.utf8)) else { return LrSettings() }
        return v
    }

    func save(_ d: UserDefaults = .standard) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        if let data = try? enc.encode(self), let s = String(data: data, encoding: .utf8) { d.set(s, forKey: Self.key) }
    }
}

@Observable
final class LrSettingsStore {
    @ObservationIgnored private let defaults: UserDefaults
    var value: LrSettings { didSet { value.save(defaults) } }
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        value = LrSettings.load(defaults)
    }
}

private func lrHex(_ v: UInt32) -> Color {
    Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
}

/// Colours of the test content area for a scheme. The standard scheme is the app tokens.
struct LrStyle: Equatable {
    var ink = Color.ink
    var muted = Color.muted
    var surface = Color.surface
    var surface2 = Color.surface2
    var line = Color.line
    var background: Color?
    var hl = Color.warn.opacity(0.3)
    var hlText: Color?
    var scheme: ColorScheme?
    /// Input border width: 2 in the high-contrast schemes.
    var inputBorder: CGFloat = 1

    static func make(_ s: LrSettings.Scheme) -> LrStyle {
        switch s {
        case .std: return LrStyle()
        case .bw:
            return LrStyle(ink: lrHex(0x000000), muted: lrHex(0x333333), surface: lrHex(0xFFFFFF), surface2: lrHex(0xEFEFEF), line: lrHex(0x000000),
                           background: lrHex(0xFFFFFF), hl: lrHex(0xFFE14D), hlText: lrHex(0x000000), scheme: .light, inputBorder: 2)
        case .cream:
            return LrStyle(ink: lrHex(0x000000), muted: lrHex(0x333333), surface: lrHex(0xF5EFDC), surface2: lrHex(0xE6DDBE), line: lrHex(0x000000),
                           background: lrHex(0xF5EFDC), hl: lrHex(0xF2C200), hlText: lrHex(0x000000), scheme: .light, inputBorder: 2)
        case .yb:
            return LrStyle(ink: lrHex(0xFFE600), muted: lrHex(0xFFE600), surface: lrHex(0x000000), surface2: lrHex(0x1A1A1A), line: lrHex(0xFFE600),
                           background: lrHex(0x000000), hl: lrHex(0x00B3FF), hlText: lrHex(0x000000), scheme: .dark, inputBorder: 2)
        }
    }
}

private struct LrStyleKey: EnvironmentKey { static let defaultValue = LrStyle() }
private struct LrMarkerKey: EnvironmentKey { static let defaultValue: LrMarkStore? = nil }

extension EnvironmentValues {
    var lrStyle: LrStyle { get { self[LrStyleKey.self] } set { self[LrStyleKey.self] = newValue } }
    /// Set only while taking a test; review screens leave it nil, so their text is not markable.
    var lrMarker: LrMarkStore? { get { self[LrMarkerKey.self] } set { self[LrMarkerKey.self] = newValue } }
}

extension DynamicTypeSize {
    func shifted(_ n: Int) -> DynamicTypeSize {
        let all = Array(DynamicTypeSize.allCases)
        guard let i = all.firstIndex(of: self) else { return self }
        return all[min(all.count - 1, max(0, i + n))]
    }
}

// MARK: Reading clock

enum LrClockTone: Equatable { case neutral, warn, strong }

/// Reading exam countdown: warn tone from 10:00 left, strong from 5:00, a pulse and an announcement at each crossing.
/// Only when the whole limit is above 10 minutes. Listening never uses this.
enum LrClockRule {
    static func armed(limit: Int) -> Bool { limit > 600 }

    static func tone(left: Int, limit: Int) -> LrClockTone {
        guard armed(limit: limit) else { return .neutral }
        return left <= 300 ? .strong : left <= 600 ? .warn : .neutral
    }

    /// The mark (600 or 300 seconds left) the clock passed between `prev` and `now`.
    static func crossed(prev: Int, now: Int, limit: Int) -> Int? {
        guard armed(limit: limit) else { return nil }
        return [300, 600].first { prev > $0 && now <= $0 }
    }

    static func announcement(_ mark: Int) -> String { mark == 600 ? "10 minutes remaining" : "5 minutes remaining" }
}
