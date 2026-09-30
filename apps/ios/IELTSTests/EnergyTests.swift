import XCTest
@testable import IELTS

/// Energy bytes must match web useRecorder (√rms·255) so the server's voiceThreshold (60) is platform-neutral.
final class EnergyTests: XCTestCase {
    func testEnergyUsesWebScale() {
        XCTAssertEqual(Recorder.energyByte(rms: 0.055), 60) // web: round(√0.055·255) = 60
        XCTAssertEqual(Recorder.energyByte(db: 0), 255)
        XCTAssertEqual(Recorder.energyByte(db: -160), 0) // AVAudioRecorder floor
        XCTAssertLessThan(Recorder.energyByte(db: -45), Recorder.voice) // breathing / room noise stays unvoiced
        XCTAssertGreaterThanOrEqual(Recorder.energyByte(db: -25), Recorder.voice) // speech is voiced
    }

    func testEstimateWpmCountsSpacedPeaksAboveVoice() {
        XCTAssertEqual(Recorder.estimateWpm(Array(repeating: 80, count: 30)), 0) // too short
        let quiet = (0..<200).map { $0 % 4 == 0 ? 50 : 10 } // peaks below threshold
        XCTAssertEqual(Recorder.estimateWpm(quiet), 0)
        let speech = (0..<200).map { $0 % 4 == 0 ? 120 : 20 } // 49 peaks in 10 s
        XCTAssertEqual(Recorder.estimateWpm(speech), 196)
    }
}
