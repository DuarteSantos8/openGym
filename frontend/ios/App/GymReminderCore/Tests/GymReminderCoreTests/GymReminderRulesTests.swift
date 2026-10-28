import XCTest
@testable import GymReminderCore

/// The no-nag rule, case for case the same as frontend src/lib/gym-reminder.test.js.
final class GymReminderRulesTests: XCTestCase {
    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Zurich")!
        return c
    }()

    private func at(_ h: Int, _ m: Int) -> Date {
        cal.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: h, minute: m))!
    }

    private func reason(on: Bool = true, gyms: Int = 1, from: String? = nil, to: String? = nil, trained: String = "2026-10-14",
                        quiet: String = "", active: Double = 0, fired: String = "", now: Date) -> String? {
        GymReminderRules.skipReason(on: on, gyms: gyms, windowFrom: from, windowTo: to, trainedOn: trained, quietOn: quiet,
                                    activeSince: active, lastFired: fired, now: now, calendar: cal)
    }

    func testGoesOffOnANormalDay() {
        XCTAssertNil(reason(now: at(18, 0)))
    }

    func testOffOrNoGym() {
        XCTAssertEqual(reason(on: false, now: at(18, 0)), "off")
        XCTAssertEqual(reason(gyms: 0, now: at(18, 0)), "off")
    }

    func testOnceADay() {
        XCTAssertEqual(reason(fired: "2026-10-15", now: at(18, 0)), "fired")
        XCTAssertNil(reason(fired: "2026-10-14", now: at(18, 0)))
    }

    func testNotAfterTrainingNorOnAnExcusedDay() {
        XCTAssertEqual(reason(trained: "2026-10-15", now: at(18, 0)), "trained")
        XCTAssertEqual(reason(quiet: "2026-10-15", now: at(18, 0)), "quiet")
    }

    func testNotWhileAWorkoutRuns() {
        let now = at(18, 0)
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(reason(active: ms - 3_600_000, now: now), "active")
        XCTAssertNil(reason(active: ms - 13 * 3_600_000, now: now))
    }

    func testTimeWindowAlsoOvernight() {
        XCTAssertEqual(reason(from: "06:00", to: "12:00", now: at(18, 0)), "window")
        XCTAssertNil(reason(from: "06:00", to: "12:00", now: at(7, 0)))
        XCTAssertTrue(GymReminderRules.inWindow(from: "22:00", to: "02:00", minute: 23 * 60 + 30))
        XCTAssertTrue(GymReminderRules.inWindow(from: "22:00", to: "02:00", minute: 90))
        XCTAssertFalse(GymReminderRules.inWindow(from: "22:00", to: "02:00", minute: 12 * 60))
        XCTAssertTrue(GymReminderRules.inWindow(from: "06:00", to: "06:00", minute: 180))
        XCTAssertTrue(GymReminderRules.inWindow(from: "6:00", to: "22:00", minute: 180))
        XCTAssertFalse(GymReminderRules.inWindow(from: "06:00", to: "22:00", minute: 22 * 60))
    }

    func testIsoAndMinutes() {
        XCTAssertEqual(GymReminderRules.isoOf(at(0, 0), calendar: cal), "2026-10-15")
        XCTAssertNil(GymReminderRules.minuteOf("24:00"))
        XCTAssertNil(GymReminderRules.minuteOf("6:00"))
        XCTAssertEqual(GymReminderRules.minuteOf("06:05"), 365)
    }
}
