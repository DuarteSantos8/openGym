import XCTest
@testable import WatchCore

/// The Metrics page's arithmetic: the clock, the heart-rate freshness, and that its volume and
/// sets are the summary's and progress's own numbers.
final class MetricsTests: XCTestCase {
    func testClock() {
        let cases: [(Double, String)] = [(0, "0:00"), (5.9, "0:05"), (59, "0:59"), (60, "1:00"), (3133, "52:13"),
                                         (3599.9, "59:59"), (3600, "1:00:00"), (3913, "1:05:13"), (36000, "10:00:00")]
        for (t, text) in cases { XCTAssertEqual(Metrics.clock(t), text, "\(t)") }
    }

    func testClockNeverShowsNonsense() {
        for t in [-5, .nan, .infinity] { XCTAssertEqual(Metrics.clock(t), "0:00") }
        XCTAssertFalse(Metrics.clock(1e12).isEmpty)
    }

    func testClockWithoutSeconds() {
        XCTAssertEqual(Metrics.clock(3133, seconds: false), "52:––")
        XCTAssertEqual(Metrics.clock(3913, seconds: false), "1:05:––")
        XCTAssertEqual(Metrics.clock(5, seconds: false), "0:––")
    }

    func testHeartIsShownWhileFresh() {
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(Metrics.heart(127.6, at: now.addingTimeInterval(-3), now: now), 128)
        XCTAssertEqual(Metrics.heart(127.6, at: now.addingTimeInterval(-15), now: now), 128)
        XCTAssertNil(Metrics.heart(127.6, at: now.addingTimeInterval(-15.1), now: now))
        XCTAssertEqual(Metrics.heart(127.6, at: now.addingTimeInterval(5), now: now), 128, "ahead of the clock counts as fresh")
    }

    func testHeartIsNilWithoutAReading() {
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertNil(Metrics.heart(nil, at: now, now: now))
        XCTAssertNil(Metrics.heart(120, at: nil, now: now))
        XCTAssertNil(Metrics.heart(0, at: now, now: now))
    }

    // MARK: the numbers the page shares with the summary

    func row(_ w: Double, _ r: Double, done: Bool = false, warmup: Bool = false) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: warmup, at: done ? 1 : nil)
    }

    func ex(_ id: String, _ sets: [SetRow], mode: String = "reps") -> Entry {
        Entry(id: id, name: id, mode: mode, restSec: nil, last: nil, sets: sets)
    }

    func state(_ entries: [Entry], unit: String = "kg") -> SessionState {
        var s = SessionState()
        s.workout = ActiveWorkout(id: "w1", name: "Push", unit: unit, cur: 0, restSec: 90, rest: nil, entries: entries, start: 0)
        return s
    }

    func testSetsDoneAndTotalAgreeWithTheSummary() {
        var side = row(20, 8)
        side.sides = Sides(L: SideRow(w: 20, r: 8, done: false), R: SideRow(w: 20, r: 8, done: false))
        side = SessionCore.markSide(side, "L", w: 20, r: 8, at: 1)
        let s = state([ex("a", [row(40, 10, done: true, warmup: true), row(60, 8, done: true), row(60, 8)]),
                       ex("hold", [SetRow(w: nil, r: nil, sec: 45, done: true, warmup: false, at: 2)], mode: "time"),
                       ex("side", [side]),
                       ex("run", [SetRow(w: nil, r: nil, sec: nil, done: false, warmup: false, at: nil)], mode: "cardio")])
        let p = SessionCore.progress(s)
        XCTAssertEqual(p.done, SessionCore.summary(s.workout!, end: 0).sets)
        XCTAssertEqual(p.done, 2)
        XCTAssertEqual(p.total, 5)
    }

    func testALaterSetDoneOverwritesTheEarlierOne() {
        var s = state([ex("a", [row(60, 8)])])
        s = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1000, id: "e1").0
        s = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 6, at: 2000, id: "e2").0
        XCTAssertEqual(SessionCore.summary(s.workout!, end: 0).volume, 360)
        XCTAssertEqual(SessionCore.summary(s.workout!, end: 0).sets, 1)
        XCTAssertEqual(SessionCore.progress(s).done, 1)
    }

    func testAWarmUpIsNotCounted() {
        let s = state([ex("a", [row(40, 10, done: true, warmup: true)])])
        XCTAssertEqual(SessionCore.summary(s.workout!, end: 0).volume, 0)
        XCTAssertEqual(SessionCore.summary(s.workout!, end: 0).sets, 0)
        XCTAssertEqual(SessionCore.progress(s).total, 0)
    }

    func testAnExerciseInItsOwnUnitIsCountedInTheWorkoutsUnit() {
        var e = ex("bench", [row(100, 10, done: true)])
        e.unit = "lb"
        let w = state([e]).workout!
        XCTAssertEqual(SessionCore.summary(w, end: 0).volume, 453.59237, accuracy: 1e-6)
        XCTAssertEqual(SessionCore.summary(w, end: 0).unit, "kg", "the page shows the volume in the workout's unit")
    }
}
