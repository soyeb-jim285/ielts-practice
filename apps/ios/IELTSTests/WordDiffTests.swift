import XCTest
@testable import IELTS

final class WordDiffTests: XCTestCase {
    func testReplacementShowsRemovedThenAdded() {
        let d = wordDiff("The data has risen  sharply", "The data have risen sharply since 2000")
        XCTAssertEqual(d.map { $0.op }, [.same, .removed, .added, .same, .added])
        XCTAssertEqual(d.map { $0.text }, ["The data", "has", "have", "risen sharply", "since 2000"])
    }

    func testEdgeCases() {
        XCTAssertTrue(wordDiff("", "").isEmpty)
        XCTAssertEqual(wordDiff("", "new words").map { $0.op }, [.added])
        XCTAssertEqual(wordDiff("old words", "").map { $0.op }, [.removed])
        XCTAssertEqual(wordDiff("same\ntext", "same text").map { $0.op }, [.same])
    }
}
