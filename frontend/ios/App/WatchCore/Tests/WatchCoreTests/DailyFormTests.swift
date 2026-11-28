import XCTest
@testable import WatchCore

/// #1535: the daily check-in before a workout started on the watch.
final class DailyFormTests: XCTestCase {
    func testAsksOnlyWhenOnAndNotAnsweredOrAskedToday() {
        XCTAssertTrue(DailyForm.due(on: true, answeredDay: nil, askedDay: nil, today: "2026-11-24"))
        XCTAssertTrue(DailyForm.due(on: true, answeredDay: "2026-11-23", askedDay: "2026-11-23", today: "2026-11-24"))
        XCTAssertFalse(DailyForm.due(on: nil, answeredDay: nil, askedDay: nil, today: "2026-11-24"), "an older phone never says so")
        XCTAssertFalse(DailyForm.due(on: false, answeredDay: nil, askedDay: nil, today: "2026-11-24"))
        XCTAssertFalse(DailyForm.due(on: true, answeredDay: "2026-11-24", askedDay: nil, today: "2026-11-24"), "done on the phone counts")
        XCTAssertFalse(DailyForm.due(on: true, answeredDay: nil, askedDay: "2026-11-24", today: "2026-11-24"), "never twice a day")
    }

    func testDayIsGregorianInTheGivenZone() {
        let zurich = TimeZone(identifier: "Europe/Zurich")!
        // 2026-11-24 23:30 UTC is already the 25th in Zurich.
        let at = Date(timeIntervalSince1970: 1_795_563_000)
        XCTAssertEqual(DailyForm.day(at, timeZone: TimeZone(identifier: "UTC")!), "2026-11-24")
        XCTAssertEqual(DailyForm.day(at, timeZone: zurich), "2026-11-25")
        XCTAssertEqual(DailyForm.day(Date(timeIntervalSince1970: 0), timeZone: TimeZone(identifier: "UTC")!), "1970-01-01")
    }

    func testEventCarriesOnlyTheAnswersGiven() {
        let ev = DailyForm.event(["sleep": 2, "energy": 9, "sore": 4, "stress": 3], at: 1000, id: "c1")
        XCTAssertNotNil(ev)
        XCTAssertEqual(ev?["type"] as? String, "dailyForm")
        XCTAssertEqual(ev?["id"] as? String, "c1")
        XCTAssertEqual(ev?["at"] as? Double, 1000)
        XCTAssertEqual(ev?["sleep"] as? Int, 2)
        XCTAssertEqual(ev?["sore"] as? Int, 4)
        XCTAssertNil(ev?["energy"], "out of range is left out")
        XCTAssertNil(ev?["stress"], "the watch does not ask it")
        XCTAssertNil(DailyForm.event([:], at: 1, id: "x"))
        XCTAssertNil(DailyForm.event(["energy": 0], at: 1, id: "x"))
    }
}
