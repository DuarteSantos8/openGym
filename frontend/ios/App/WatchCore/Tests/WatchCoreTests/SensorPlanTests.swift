import XCTest
@testable import WatchCore

/// When the watch's workout session (the heart-rate sensor) rests in a workout nobody finishes.
final class SensorPlanTests: XCTestCase {
    let h: Double = 3600 * 1000

    func row(done: Bool = false, at: Double? = nil) -> SetRow {
        SetRow(w: 60, r: 8, sec: nil, done: done, warmup: false, at: at)
    }

    func workout(start: Double?, sets: [SetRow], rest: Double? = nil) -> ActiveWorkout {
        ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: rest.map { RestInfo(endsAt: $0) },
                      entries: [Entry(id: "0025", name: "Bench Press", mode: "reps", restSec: nil, last: nil, sets: sets),
                                Entry(id: "0426", name: "Overhead Press", mode: "reps", restSec: nil, last: nil, sets: [row()])],
                      start: start)
    }

    func testTheLastTickedSetIsTheLastActivity() {
        let w = workout(start: 1000, sets: [row(done: true, at: 5000), row(done: true, at: 9000), row()])
        XCTAssertEqual(SensorPlan.lastActivity(w, seen: nil), 9000)
        XCTAssertEqual(SensorPlan.lastActivity(w, seen: 20000), 20000)
        XCTAssertEqual(SensorPlan.lastActivity(workout(start: 1000, sets: [row()], rest: 7000), seen: nil), 7000)
    }

    func testAWorkoutLeftOpenTurnsIdleAfterTheLimitNotBefore() {
        let w = workout(start: 0, sets: [row(done: true, at: 10 * 60 * 1000), row()])
        let last = 10.0 * 60 * 1000
        XCTAssertFalse(SensorPlan.idle(w, seen: nil, now: last + 2 * h, busy: false))
        XCTAssertFalse(SensorPlan.idle(w, seen: nil, now: last + 3 * h - 1, busy: false))
        XCTAssertTrue(SensorPlan.idle(w, seen: nil, now: last + 3 * h, busy: false))
        XCTAssertEqual(SensorPlan.checkAt(w, seen: nil), last + 3 * h)
    }

    func testARunningRestOrHoldIsNeverIdle() {
        let w = workout(start: 0, sets: [row()])
        XCTAssertTrue(SensorPlan.idle(w, seen: nil, now: 10 * h, busy: false))
        XCTAssertFalse(SensorPlan.idle(w, seen: nil, now: 10 * h, busy: true))
    }

    func testANewTickOrAPhoneChangeMakesItActiveAgain() {
        var w = workout(start: 0, sets: [row(), row()])
        XCTAssertTrue(SensorPlan.idle(w, seen: nil, now: 4 * h, busy: false))
        // a change from the phone just now
        XCTAssertFalse(SensorPlan.idle(w, seen: 4 * h, now: 4 * h + 1, busy: false))
        // a set ticked just now
        w.entries[0].sets[0] = row(done: true, at: 4 * h)
        XCTAssertFalse(SensorPlan.idle(w, seen: nil, now: 4 * h + 1, busy: false))
    }

    func testNoWorkoutOrNoTimeIsNotIdle() {
        XCTAssertFalse(SensorPlan.idle(nil, seen: nil, now: 100 * h, busy: false))
        XCTAssertNil(SensorPlan.checkAt(nil, seen: nil))
        let w = workout(start: nil, sets: [row()])
        XCTAssertNil(SensorPlan.lastActivity(w, seen: nil))
        XCTAssertFalse(SensorPlan.idle(w, seen: nil, now: 100 * h, busy: false))
    }

    func testARestoredWorkoutFromYesterdayStartsIdle() {
        // Saved state from a workout started yesterday and never finished: at relaunch the
        // session does not start until something happens in it.
        let yesterday = 1_700_000_000_000.0
        let w = workout(start: yesterday, sets: [row(done: true, at: yesterday + 600_000), row()])
        XCTAssertTrue(SensorPlan.idle(w, seen: nil, now: yesterday + 20 * h, busy: false))
    }
}
