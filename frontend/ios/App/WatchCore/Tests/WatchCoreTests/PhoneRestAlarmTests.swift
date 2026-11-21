import XCTest
@testable import WatchCore

/// The iPhone's rest alarm while its page sleeps: a +15, −15 or Skip on the watch, or the rest a
/// set ticked there starts, moves it (owner's report: the watch's rest and the phone's drift apart
/// once the rest is changed on the watch).
final class PhoneRestAlarmTests: XCTestCase {
    let now: Double = 1_800_000_000_000
    /// The page booked the phone's alarm 30 s ago (its last change of the rest).
    var since: Double { now - 30_000 }

    func testPlusFifteenOnTheWatchMovesThePhonesAlarm() {
        // The watch's clock runs 2 s ahead of the phone's (`off`): its times go onto the phone's.
        let ev: [String: Any] = ["type": "rest", "wid": "w1", "endsAt": now + 2_000 + 75_000, "at": now + 2_000 - 1_000, "off": 2_000.0]
        XCTAssertEqual(PhoneRestAlarm.change(ev, wid: "w1", since: since, now: now), .init(at: now - 1_000, end: now + 75_000))
    }

    func testSkipOrMinusFifteenToNothingTakesTheAlarmAway() {
        let skip: [String: Any] = ["type": "rest", "wid": "w1", "endsAt": NSNull(), "at": now - 500, "off": 0.0]
        XCTAssertEqual(PhoneRestAlarm.change(skip, wid: "w1", since: since, now: now), .init(at: now - 500, end: nil))
        let over: [String: Any] = ["type": "rest", "wid": "w1", "endsAt": now + 200, "at": now - 500, "off": 0.0]
        XCTAssertEqual(PhoneRestAlarm.change(over, wid: "w1", since: since, now: now)?.end, nil, "an end this close is over")
        XCTAssertNil(PhoneRestAlarm.change(skip, wid: "w1", since: since, now: now)?.over, "a Skip has no end that passed")
    }

    func testAnEventThatCameAfterItsEndKeepsThatEnd() {
        // Not a Skip: the chain's phases follow this end, so cues that rang already are not rung again.
        let late: [String: Any] = ["type": "rest", "wid": "w1", "endsAt": now - 20_000, "at": now - 25_000, "off": 0.0]
        XCTAssertEqual(PhoneRestAlarm.change(late, wid: "w1", since: since, now: now), .init(at: now - 25_000, end: nil, over: now - 20_000))
    }

    func testASetTickedOnTheWatchBringsItsRest() {
        // A new rest: the Lock Screen counts it down, the old alarm (named for the set just done) only comes down.
        let tick: [String: Any] = ["type": "setDone", "wid": "w1", "restEnd": now + 90_000, "at": now, "off": 0.0]
        XCTAssertEqual(PhoneRestAlarm.change(tick, wid: "w1", since: since, now: now), .init(at: now, end: now + 90_000, sameRest: false))
        let none: [String: Any] = ["type": "setDone", "wid": "w1", "restEnd": 0.0, "at": now, "off": 0.0]
        XCTAssertEqual(PhoneRestAlarm.change(none, wid: "w1", since: since, now: now), .init(at: now, end: nil, sameRest: false), "no rest after it")
        let fix: [String: Any] = ["type": "setDone", "wid": "w1", "at": now, "off": 0.0]
        XCTAssertNil(PhoneRestAlarm.change(fix, wid: "w1", since: since, now: now), "a fixed set changes no rest")
    }

    func testAChangeOlderThanTheAlarmIsLeftAlone() {
        // Sent again after the page applied it (and booked since), or made before the phone's own change.
        let late: [String: Any] = ["type": "rest", "wid": "w1", "endsAt": now + 60_000, "at": since - 1, "off": 0.0]
        XCTAssertNil(PhoneRestAlarm.change(late, wid: "w1", since: since, now: now))
    }

    func testAnotherWorkoutOrAnotherEventIsLeftAlone() {
        let other: [String: Any] = ["type": "rest", "wid": "w2", "endsAt": now + 60_000, "at": now, "off": 0.0]
        XCTAssertNil(PhoneRestAlarm.change(other, wid: "w1", since: since, now: now))
        let hr: [String: Any] = ["type": "setHr", "wid": "w1", "at": now]
        XCTAssertNil(PhoneRestAlarm.change(hr, wid: "w1", since: since, now: now))
        let noTime: [String: Any] = ["type": "rest", "wid": "w1", "endsAt": now + 60_000]
        XCTAssertNil(PhoneRestAlarm.change(noTime, wid: "w1", since: since, now: now))
    }

    func testAClockFarOffIsLeftAsItIs() {
        // Over 12 h: a wrong clock, not one that is off (watch-sync.js phoneClock does the same).
        let off = 13 * 3600 * 1000.0
        let ev: [String: Any] = ["type": "rest", "wid": "w1", "endsAt": now + 60_000, "at": now, "off": off]
        XCTAssertEqual(PhoneRestAlarm.change(ev, wid: "w1", since: since, now: now), .init(at: now, end: now + 60_000))
    }

    func testNumbersAsJSONSerializationGivesThem() {
        let ev: [String: Any] = ["type": "rest", "wid": "w1", "endsAt": NSNumber(value: now + 60_000), "at": NSNumber(value: now), "off": NSNumber(value: 0)]
        XCTAssertEqual(PhoneRestAlarm.change(ev, wid: nil, since: since, now: now)?.end, now + 60_000)
    }
}
