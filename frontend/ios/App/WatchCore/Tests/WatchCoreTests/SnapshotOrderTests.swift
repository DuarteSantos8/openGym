import XCTest
@testable import WatchCore

/// A late application context never undoes a newer message (REDDIT-146 watch sync).
final class SnapshotOrderTests: XCTestCase {
    func testNewerAndEqualGoOn() {
        XCTAssertTrue(SnapshotOrder.accept(100, after: nil))
        XCTAssertTrue(SnapshotOrder.accept(100, after: 99))
        XCTAssertTrue(SnapshotOrder.accept(100, after: 100), "the same snapshot as message and context")
    }

    func testALateOlderOneIsSkipped() {
        XCTAssertFalse(SnapshotOrder.accept(98.5, after: 100))
    }

    func testUnstampedAlwaysGoesOn() {
        XCTAssertTrue(SnapshotOrder.accept(nil, after: 100))
        XCTAssertTrue(SnapshotOrder.accept(.nan, after: 100))
        XCTAssertEqual(SnapshotOrder.next(nil, after: 100), 100)
    }

    func testAClockThatWentBackStartsAfresh() {
        XCTAssertTrue(SnapshotOrder.accept(1000, after: 1000 + SnapshotOrder.clockJump + 1))
        XCTAssertEqual(SnapshotOrder.next(1000, after: 50_000), 1000)
    }

    func testStampReadsAnyNumber() {
        XCTAssertEqual(SnapshotOrder.stamp(["at": 12.5]), 12.5)
        XCTAssertEqual(SnapshotOrder.stamp(["at": NSNumber(value: 7)]), 7)
        XCTAssertNil(SnapshotOrder.stamp(["snapshot": "{}"]))
    }
}
