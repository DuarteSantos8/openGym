import XCTest
@testable import WatchCore

/// The Overview beside the set: rows, supersets and the end of the session.
final class OverviewTests: XCTestCase {
    func row(done: Bool = false, warmup: Bool = false) -> SetRow {
        SetRow(w: 50, r: 8, sec: nil, done: done, warmup: warmup)
    }

    func entry(_ id: String, _ sets: [SetRow], group: String? = nil) -> Entry {
        var e = Entry(id: id, name: id.capitalized, mode: "reps", restSec: nil, last: nil, sets: sets)
        e.group = group
        return e
    }

    func workout(_ entries: [Entry]) -> ActiveWorkout {
        ActiveWorkout(id: "w", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: entries)
    }

    func testCountsWorkSetsAndMarksTheCurrentAndFinished() {
        let w = workout([
            entry("bench", [row(done: true, warmup: true), row(done: true), row(done: true)]),
            entry("press", [row(done: true), row(), row()]),
            entry("warm", [row(warmup: true)]),
        ])
        let rows = Overview.rows(w, current: 1)
        XCTAssertEqual(rows.map { $0.done }, [2, 1, 0])
        XCTAssertEqual(rows.map { $0.total }, [2, 3, 1], "an exercise of warm-ups only counts them")
        XCTAssertEqual(rows.map { $0.current }, [false, true, false])
        XCTAssertEqual(rows.map { $0.finished }, [true, false, false])
    }

    func testASupersetIsTwoOrMoreNeighboursAndNamesItsPartners() {
        let entries = [
            entry("curl", [row()], group: "a"), entry("pushdown", [row()], group: "a"), entry("raise", [row()], group: "a"),
            entry("alone", [row()], group: "b"),
            entry("squat", [row()]),
        ]
        let rows = Overview.rows(workout(entries), current: 0)
        XCTAssertEqual(rows.map { $0.supersetStart }, [true, false, false, false, false])
        XCTAssertEqual(rows.map { $0.inSuperset }, [true, true, true, false, false], "a group of one is no superset")
        XCTAssertEqual(Overview.partners(entries, 1), ["Curl", "Raise"])
        XCTAssertEqual(Overview.partners(entries, 3), [])
        XCTAssertEqual(Overview.partners(entries, 4), [])
    }

    func testAtTheEndPastTheLastExercise() {
        var s = SessionState()
        XCTAssertFalse(Overview.atEnd(s), "no workout, no end")
        s.workout = workout([entry("bench", [row(done: true)])])
        s.entryIndex = 0
        XCTAssertFalse(Overview.atEnd(s))
        s.entryIndex = 1
        XCTAssertTrue(Overview.atEnd(s))
    }
}
