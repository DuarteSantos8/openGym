import XCTest
@testable import WatchCore

/// The 3-2-1 before a workout started on the watch.
final class CountdownTests: XCTestCase {
    func testCountsThreeTwoOneThenGo() {
        XCTAssertEqual(Countdown.number(at: 0), 3)
        XCTAssertEqual(Countdown.number(at: 0.99), 3)
        XCTAssertEqual(Countdown.number(at: 1), 2)
        XCTAssertEqual(Countdown.number(at: 2.5), 1)
        XCTAssertEqual(Countdown.number(at: 3), 0)
        XCTAssertEqual(Countdown.number(at: 60), 0, "never below go")
        XCTAssertEqual(Countdown.number(at: -1), 3, "a clock a moment behind still shows 3")
    }
}
