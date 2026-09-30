import Foundation

/// Port of packages/core/src/band.ts. Keep the two in sync (BandTests mirrors band.test.ts).
enum Band {
    /// IELTS rounding: frac < .25 → floor, < .75 → .5, else next whole band.
    static func round(_ x: Double) -> Double {
        let f = (x + 1e-9).rounded(.down), frac = x - f + 1e-9
        return frac < 0.25 ? f : frac < 0.75 ? f + 0.5 : f + 1
    }

    static func speakingOverall(fc: Double, lr: Double, gra: Double, p: Double) -> (raw: Double, band: Double) {
        let raw = (fc + lr + gra + p) / 4
        return (raw, round(raw))
    }

    /// Task 2 counts double; a nil task (not attempted) leaves the other alone.
    static func writingOverall(t1: Double?, t2: Double?) -> (raw: Double, band: Double) {
        let raw: Double
        switch (t1, t2) {
        case let (a?, b?): raw = (a + 2 * b) / 3
        case let (a?, nil): raw = a
        case let (nil, b?): raw = b
        default: raw = 0
        }
        return (raw, round(raw))
    }

    static func format(_ b: Double) -> String {
        b.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(b)) : String(format: "%.1f", b)
    }
}
