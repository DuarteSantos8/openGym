import XCTest
@testable import WatchCore

/// The rest screen: −15, following the phone's rest, the bar, and the effort chips.
final class RestMathTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_000)

    func testMinusFifteenOrASkipNearTheEnd() {
        XCTAssertEqual(RestMath.minus(end: now.addingTimeInterval(60), now: now), now.addingTimeInterval(45))
        XCTAssertNil(RestMath.minus(end: now.addingTimeInterval(15), now: now), "15 s left: that is a skip")
        XCTAssertNil(RestMath.minus(end: now.addingTimeInterval(10), now: now))
        XCTAssertNotNil(RestMath.minus(end: now.addingTimeInterval(16), now: now))
    }

    func testFollowsOnlyARestEndThePhoneHasNotSentBefore() {
        XCTAssertTrue(RestMath.follows(5000, last: nil))
        XCTAssertFalse(RestMath.follows(5000, last: 5000), "the same end again leaves a ±15 alone")
        XCTAssertTrue(RestMath.follows(9000, last: 5000), "a new rest on the phone is followed")
    }

    // Wear/Garmin bug, same on the Apple Watch: +15 or Skip right after Done was undone a few
    // seconds later by the phone's copy of that same rest.
    func testThePhonesEchoOfOurOwnRestNeverResetsIt() {
        let echo = RestMath.phoneRest(5000, last: nil, echo: true)
        XCTAssertEqual(echo.last, 5000)
        XCTAssertFalse(echo.start, "the echo is remembered, not started over the +15 pressed here")
        let again = RestMath.phoneRest(5000, last: echo.last, echo: false)
        XCTAssertEqual(again.last, 5000)
        XCTAssertFalse(again.start, "the same end in a later snapshot changes nothing either")
        let changed = RestMath.phoneRest(9000, last: again.last, echo: false)
        XCTAssertEqual(changed.last, 9000)
        XCTAssertTrue(changed.start, "a rest the phone really changed (its own +15) is followed")
        let fresh = RestMath.phoneRest(7000, last: nil, echo: false)
        XCTAssertTrue(fresh.start, "a rest started on the phone runs here too")
        let none = RestMath.phoneRest(nil, last: 9000, echo: false)
        XCTAssertNil(none.last)
        XCTAssertFalse(none.start)
    }

    func testWhatIsLeftOfTheRest() {
        let start = now, end = now.addingTimeInterval(100)
        XCTAssertEqual(RestMath.left(start: start, end: end, now: now), 1)
        XCTAssertEqual(RestMath.left(start: start, end: end, now: now.addingTimeInterval(25)), 0.75, accuracy: 0.0001)
        XCTAssertEqual(RestMath.left(start: start, end: end, now: now.addingTimeInterval(200)), 0)
        XCTAssertEqual(RestMath.left(start: end, end: start, now: now), 0, "a backwards rest is over")
    }

    func testChipsAreRatingsThePhoneLogs() {
        XCTAssertEqual(Effort.chips("rir"), [0, 1, 2, 3])
        XCTAssertEqual(Effort.chips("rpe"), [10, 9, 8, 7])
        for kind in ["rir", "rpe"] {
            let notches = Effort.notches(kind) ?? []
            for v in Effort.chips(kind) { XCTAssertTrue(notches.contains(v), "\(kind) \(v)") }
        }
        XCTAssertEqual(Effort.chipLabel("rir", 3), "3+")
        XCTAssertEqual(Effort.chipLabel("rir", 1), "1")
        XCTAssertEqual(Effort.chipLabel("rpe", 7), "≤7")
        XCTAssertEqual(Effort.chipLabel("rpe", 9), "9")
    }
}
