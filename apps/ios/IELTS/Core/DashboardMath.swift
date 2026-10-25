import Foundation

/// Band arithmetic of the dashboard (web components/dashboard/overall.ts and result/SkillBandStrip weakestSkill).
enum DashboardMath {
    /// Band of the last up-to-5 results (oldest first in), rounded to the nearest half band; nil with no results.
    static func averageBand(_ bands: [Double]) -> (band: Double?, n: Int) {
        let last = bands.suffix(5)
        return (last.isEmpty ? nil : Band.round(last.reduce(0, +) / Double(last.count)), last.count)
    }

    /// Overall estimate from the skill bands that exist. Needs at least two skills, so one lucky test never poses as an overall band.
    static func overallEstimate(_ bands: [Double?]) -> (value: Double?, count: Int) {
        let have = bands.compactMap { $0 }
        return (have.count >= 2 ? Band.round(have.reduce(0, +) / Double(have.count)) : nil, have.count)
    }

    /// Last minus first; nil with fewer than two results.
    static func changeSinceFirst(_ bands: [Double]) -> Double? {
        guard bands.count > 1, let a = bands.first, let b = bands.last else { return nil }
        return b - a
    }

    /// Index of the lowest band; nil unless at least two have one. Ties go to the first.
    static func weakestSkill(_ bands: [Double?]) -> Int? {
        let have = bands.enumerated().compactMap { i, b in b.map { (i, $0) } }
        guard have.count >= 2 else { return nil }
        return have.reduce(have[0]) { $1.1 < $0.1 ? $1 : $0 }.0
    }

    /// "+1.0 since your first", "−0.5 since your first", "Same as your first"; nil with one result.
    static func changeText(_ bands: [Double]) -> String? {
        guard let d = changeSinceFirst(bands) else { return nil }
        return d == 0 ? "Same as your first" : "\(d > 0 ? "+" : "−")\(fmt(abs(d))) since your first"
    }
}
