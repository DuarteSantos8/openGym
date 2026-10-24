import XCTest
@testable import WatchCore

/// A forgotten workout: asked about at 20 minutes, ended at 45, at its last set.
final class IdleTests: XCTestCase {
    let min: Double = 60 * 1000

    func workout(start: Double?, ats: [Double?]) -> ActiveWorkout {
        let sets = ats.map { SetRow(w: 60, r: 8, sec: nil, done: $0 != nil, warmup: false, at: $0) }
        return ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil,
                             entries: [Entry(id: "0025", name: "Bench Press", mode: "reps", restSec: nil, last: nil, sets: sets)],
                             start: start)
    }

    func testAsksAt20MinutesAndEndsAt45() {
        XCTAssertEqual(Idle.state(since: 0, now: 19 * min), .active)
        XCTAssertEqual(Idle.state(since: 0, now: 20 * min), .ask)
        XCTAssertEqual(Idle.state(since: 0, now: 44 * min), .ask)
        XCTAssertEqual(Idle.state(since: 0, now: 45 * min), .end)
    }

    func testTheLastSetIsTheNewestTickWhereverItIs() {
        let w = workout(start: 1000, ats: [5 * min, 30 * min, nil, 12 * min])
        XCTAssertEqual(Idle.lastSet(w), 30 * min, "the newest tick, not the last row")
    }

    func testOneSideOfAPerSideSetCounts() {
        var w = workout(start: 1000, ats: [nil])
        w.entries[0].sets[0].sides = Sides(L: SideRow(w: 20, r: 8, done: true), R: SideRow(w: 20, r: 8, done: false))
        w.entries[0].sets[0].at = 7 * min
        XCTAssertEqual(Idle.lastSet(w), 7 * min)
    }

    func testNothingLoggedFallsBackToTheStart() {
        XCTAssertEqual(Idle.lastSet(workout(start: 1000, ats: [nil, nil])), 1000)
        XCTAssertNil(Idle.lastSet(workout(start: 0, ats: [nil])), "a phone that sent no start: the watch's own time then")
    }
}
