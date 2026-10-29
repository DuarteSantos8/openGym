import XCTest
@testable import WatchCore

/// The touch lock after a page the watch turned by itself.
final class TouchLockTests: XCTestCase {
    func testATapWithinASecondOfAnAutomaticPageChangeIsIgnored() {
        let t = Date(timeIntervalSince1970: 1000)
        var lock = TouchLock()
        XCTAssertTrue(lock.allows(at: t), "nothing locked before the first page change")
        lock.lock(at: t)
        XCTAssertFalse(lock.allows(at: t.addingTimeInterval(0.8)), "a slower second tap (0.7 to 1 s) is still ignored")
        XCTAssertTrue(lock.allows(at: t.addingTimeInterval(1)), "after a second the new page takes taps")
    }

    func testASwipeByHandUnlocksAtOnce() {
        let t = Date(timeIntervalSince1970: 1000)
        var lock = TouchLock()
        lock.lock(at: t)
        lock.unlock()
        XCTAssertTrue(lock.allows(at: t.addingTimeInterval(0.1)))
    }

    func testLockedAgainAfterAnUnlock() {
        let t = Date(timeIntervalSince1970: 1000)
        var lock = TouchLock()
        lock.unlock()
        lock.lock(at: t)
        XCTAssertFalse(lock.allows(at: t.addingTimeInterval(0.5)), "a row picked by tap waits a second even after a swipe unlocked")
        XCTAssertTrue(lock.allows(at: t.addingTimeInterval(1)))
    }

    func testTheCrownIsLockedForLessThanTheTouches() {
        let t = Date(timeIntervalSince1970: 1000)
        var lock = TouchLock()
        lock.lock(at: t)
        XCTAssertFalse(lock.allows(at: t.addingTimeInterval(0.5)))
        XCTAssertFalse(lock.allowsCrown(at: t.addingTimeInterval(0.5)))
        XCTAssertFalse(lock.allows(at: t.addingTimeInterval(0.7)))
        XCTAssertTrue(lock.allowsCrown(at: t.addingTimeInterval(0.7)), "the Crown is back after 0.6 s")
        XCTAssertTrue(lock.allows(at: t.addingTimeInterval(1)))
        XCTAssertTrue(lock.allowsCrown(at: t.addingTimeInterval(1)))
    }

    func testUnlockFreesTheCrownToo() {
        let t = Date(timeIntervalSince1970: 1000)
        var lock = TouchLock()
        lock.lock(at: t)
        lock.unlock()
        XCTAssertTrue(lock.allows(at: t.addingTimeInterval(0.1)))
        XCTAssertTrue(lock.allowsCrown(at: t.addingTimeInterval(0.1)))
        lock.lock(at: t)
        XCTAssertFalse(lock.allows(at: t.addingTimeInterval(0.1)))
        XCTAssertFalse(lock.allowsCrown(at: t.addingTimeInterval(0.1)))
    }
}
