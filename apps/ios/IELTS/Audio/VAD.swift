import Foundation

/// Energy VAD: speech starts after `startAfter` s above threshold; the turn ends after `endAfter` s of silence following speech.
struct VAD {
    var threshold = 0.3
    var startAfter = 0.15
    var endAfter = 1.2
    private(set) var speaking = false
    private(set) var heardSpeech = false
    private var above = 0.0, below = 0.0

    /// Feed one level sample (0…1) covering `dt` seconds. Returns true exactly once when a turn ends.
    mutating func feed(level: Double, dt: Double) -> Bool {
        if level > threshold {
            above += dt
            below = 0
            if above >= startAfter { speaking = true; heardSpeech = true }
        } else {
            above = 0
            guard speaking else { return false }
            below += dt
            if below >= endAfter { speaking = false; below = 0; return true }
        }
        return false
    }
}
