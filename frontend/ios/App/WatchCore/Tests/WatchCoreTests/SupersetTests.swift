import XCTest
@testable import WatchCore

/// Supersets as SessionCore.next walks them: the partner a set's Done takes the lifter to.
final class SupersetTests: XCTestCase {
    func row(done: Bool = false) -> SetRow {
        SetRow(w: 60, r: 8, sec: nil, done: done, warmup: false, at: done ? 1 : nil)
    }

    func entry(_ id: String, _ sets: [SetRow] = [SetRow(w: 60, r: 8, sec: nil, done: false, warmup: false, at: nil)], group: String? = nil) -> Entry {
        Entry(id: id, name: id, mode: "reps", restSec: nil, last: nil, sets: sets, group: group)
    }

    func state(_ entries: [Entry], at index: Int = 0) -> SessionState {
        var s = SessionState()
        s.workout = ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: entries)
        s.entryIndex = index
        return s
    }

    func testTwoMembersNameEachOther() {
        let s = state([entry("a", group: "g"), entry("b", group: "g")])
        XCTAssertEqual(Superset.partner(s, entry: 0), 1)
        XCTAssertEqual(Superset.partner(s, entry: 1), 0)
    }

    func testThreeMembersGoInTurn() {
        let s = state([entry("a", group: "g"), entry("b", group: "g"), entry("c", group: "g")])
        XCTAssertEqual([0, 1, 2].map { Superset.partner(s, entry: $0) }, [1, 2, 0])
    }

    func testAFinishedMemberIsSkipped() {
        var s = state([entry("a", group: "g"), entry("b", [row(done: true)], group: "g"), entry("c", group: "g")])
        XCTAssertEqual(Superset.partner(s, entry: 0), 2)
        XCTAssertEqual(Superset.partner(s, entry: 2), 0)
        s.workout?.entries[0].sets[0].done = true
        XCTAssertNil(Superset.partner(s, entry: 2))
    }

    func testPartnerFinished() {
        let s = state([entry("a", group: "g"), entry("b", [row(done: true)], group: "g")])
        XCTAssertNil(Superset.partner(s, entry: 0))
    }

    func testASkippedOnlySetCountsAsFinished() {
        var s = state([entry("a", group: "g"), entry("b", group: "g")])
        s = SessionCore.skip(s, entry: 1, set: 0)
        XCTAssertNil(Superset.partner(s, entry: 0))
    }

    func testNonAdjacentSameGroupIsNoSuperset() {
        let s = state([entry("a", group: "g1"), entry("x"), entry("c", group: "g1")])
        XCTAssertNil(Superset.partner(s, entry: 0))
        XCTAssertNil(Superset.partner(s, entry: 2))
        XCTAssertEqual(Superset.runs(s.workout!.entries), [0...0, 1...1, 2...2])
    }

    func testALoneGroupMemberHasNoPartner() {
        let s = state([entry("a", group: "g1"), entry("x")])
        XCTAssertNil(Superset.partner(s, entry: 0))
    }

    func testRunsKeepOrderAndSingles() {
        let es = [entry("x"), entry("a", group: "g1"), entry("b", group: "g1"), entry("y"),
                  entry("c", group: "g2"), entry("d", group: "g2"), entry("e", group: "g2")]
        XCTAssertEqual(Superset.runs(es), [0...0, 1...2, 3...3, 4...6])
        let adjacent = [entry("a", group: "g1"), entry("b", group: "g2")]
        XCTAssertEqual(Superset.runs(adjacent), [0...0, 1...1])
    }

    /// The line must not drift from SessionCore.next: the partner it names is where Done goes.
    func testTheLineTellsWhereDoneGoes() {
        let two = [row(), row()]
        var s = state([entry("a", two, group: "g"), entry("b", two, group: "g"), entry("c", group: "g")])
        var at = 1.0
        while !SessionCore.atEnd(s) {
            let ei = s.entryIndex
            guard let si = SessionCore.setIndex(s, entry: ei) else { XCTFail("page without an open set"); return }
            let named = Superset.partner(s, entry: ei)
            s = SessionCore.tick(s, entry: ei, set: si, w: 60, r: 8, at: at, id: "e\(at)").0
            at += 1
            let n = SessionCore.next(after: s, entry: ei, set: si)
            XCTAssertEqual(named, n.entry != ei && (0...2).contains(n.entry) ? n.entry : nil, "step \(at)")
            s.entryIndex = n.entry
        }
        XCTAssertEqual(at, 6)
    }

    func testAPerSideSetStillNamesItsPartner() {
        var side = row()
        side.sides = Sides(L: SideRow(w: 20, r: 8, done: false), R: SideRow(w: 20, r: 8, done: false))
        var s = state([entry("a", [side], group: "g"), entry("b", group: "g")])
        s = SessionCore.tick(s, entry: 0, set: 0, side: "L", w: 20, r: 8, at: 1, id: "e1").0
        XCTAssertEqual(SessionCore.next(after: s, entry: 0, set: 0).entry, 0)
        XCTAssertEqual(Superset.partner(s, entry: 0), 1)
    }
}
