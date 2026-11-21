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

    func testTheCrownIsIgnoredForUnderASecondAfterARestEndedUnderIt() {
        let t = Date(timeIntervalSince1970: 1000)
        var lock = TouchLock()
        XCTAssertTrue(lock.crownAllows(at: t))
        lock.lockCrown(at: t)
        XCTAssertFalse(lock.crownAllows(at: t.addingTimeInterval(0.5)))
        XCTAssertTrue(lock.crownAllows(at: t.addingTimeInterval(0.6)))
        XCTAssertTrue(lock.allows(at: t), "touches are a separate lock")
    }
}
