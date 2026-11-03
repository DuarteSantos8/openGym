import XCTest
@testable import WatchCore

/// The Overview page's rows: every exercise with its working sets done, and where the lifter is.
final class OverviewTests: XCTestCase {
    func row(done: Bool = false, warmup: Bool = false) -> SetRow {
        SetRow(w: 60, r: 8, sec: nil, done: done, warmup: warmup, at: done ? 1 : nil)
    }

    func entry(_ id: String, _ sets: [SetRow], group: String? = nil) -> Entry {
        Entry(id: id, name: id, mode: "reps", restSec: nil, last: nil, sets: sets, group: group)
    }

    func state(_ entries: [Entry], at index: Int = 0) -> SessionState {
        var s = SessionState()
        s.workout = ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: entries)
        s.entryIndex = index
        return s
    }

    func testCountsWorkingSetsOnly() {
        let s = state([entry("a", [row(done: true, warmup: true), row(done: true), row(), row()])])
        let r = Overview.rows(s)[0]
        XCTAssertEqual(r.done, 1)
        XCTAssertEqual(r.total, 3)
    }

    func testAPerSideSetCountsWhenBothSidesAreDone() {
        var side = row()
        side.sides = Sides(L: SideRow(w: 20, r: 8, done: false), R: SideRow(w: 20, r: 8, done: false))
        side = SessionCore.markSide(side, "L", w: 20, r: 8, at: 1)
        XCTAssertEqual(Overview.rows(state([entry("a", [side])]))[0].done, 0)
        side = SessionCore.markSide(side, "R", w: 20, r: 8, at: 2)
        XCTAssertEqual(Overview.rows(state([entry("a", [side])]))[0].done, 1)
    }

    func testStatesAreDoneCurrentTodo() {
        let es = [entry("a", [row(done: true), row(done: true)]),
                  entry("b", [row(done: true), row()]),
                  entry("c", [row(), row()])]
        XCTAssertEqual(Overview.rows(state(es, at: 1)).map(\.state), [.done, .current, .todo])
        XCTAssertEqual(Overview.rows(state(es, at: 0)).map(\.state), [.done, .todo, .todo], "a done exercise is never the current one")
    }

    func testNothingIsCurrentAtTheEnd() {
        let es = [entry("a", [row(done: true)]), entry("b", [row(done: true)])]
        let s = state(es, at: 2)
        XCTAssertFalse(Overview.rows(s).contains { $0.state == .current })
        XCTAssertTrue(SessionCore.atEnd(s))
    }

    func testSupersetMembersAreFlagged() {
        let es = [entry("a", [row()]), entry("b", [row()], group: "s1"), entry("c", [row()], group: "s1")]
        XCTAssertEqual(Overview.rows(state(es)).map(\.superset), [false, true, true])
    }

    func testTheLastSetDoneFlipsTheRow() {
        var s = state([entry("a", [row(done: true), row()])])
        XCTAssertEqual(Overview.rows(s)[0].state, .current)
        s = SessionCore.tick(s, entry: 0, set: 1, w: 60, r: 8, at: 2000, id: "e1").0
        XCTAssertEqual(Overview.rows(s)[0].state, .done)
        XCTAssertEqual(Overview.rows(s)[0].done, 2)
    }

    func testSkippedSetsStayUndone() {
        var s = state([entry("a", [row(done: true), row()])])
        s = SessionCore.skip(s, entry: 0, set: 1)
        let r = Overview.rows(s)[0]
        XCTAssertEqual(r.done, 1)
        XCTAssertEqual(r.state, .current)
    }

    func testAnExerciseOfOnlyWarmupsIsDoneWhenTheyAre() {
        var s = state([entry("a", [row(warmup: true)]), entry("b", [row()])], at: 1)
        XCTAssertEqual(Overview.rows(s)[0].total, 0)
        XCTAssertEqual(Overview.rows(s)[0].state, .todo)
        s = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1, id: "e1").0
        XCTAssertEqual(Overview.rows(s)[0].state, .done)
    }

    func testNoWorkoutNoRowsAndNotAtEnd() {
        XCTAssertEqual(Overview.rows(SessionState()), [])
        XCTAssertFalse(SessionCore.atEnd(SessionState()))
    }

    func testAtEndFalseMidWorkout() {
        let es = [entry("a", [row()]), entry("b", [row()])]
        XCTAssertFalse(SessionCore.atEnd(state(es, at: 1)))
        XCTAssertTrue(SessionCore.atEnd(state(es, at: 2)))
    }
}
