import XCTest
@testable import WatchCore

/// What the watch says about whether its sets reached the iPhone.
final class SyncStateTests: XCTestCase {
    func row(done: Bool = false, warmup: Bool = false, sides: Sides? = nil) -> SetRow {
        SetRow(w: 60, r: 8, sec: nil, done: done, warmup: warmup, at: done ? 1 : nil, sides: sides)
    }

    func workout(_ sets: [SetRow]) -> ActiveWorkout {
        ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil,
                      entries: [Entry(id: "0025", name: "Bench Press", mode: "reps", restSec: nil, last: nil, sets: sets)])
    }

    func testCountHidesWhenReachable() {
        XCTAssertEqual(SyncState.count(reachable: true, unsent: 5), 0)
        XCTAssertEqual(SyncState.count(reachable: false, unsent: 5), 5)
    }

    func testWaitingWhenAwayWithUnsent() {
        for logged in [true, false, nil] as [Bool?] {
            XCTAssertEqual(SyncState.state(reachable: false, unsent: 3, logged: logged), .waiting(3))
        }
    }

    func testReachableNeverWaiting() {
        XCTAssertEqual(SyncState.state(reachable: true, unsent: 3, logged: true), .onPhone)
    }

    func testOnPhone() {
        XCTAssertEqual(SyncState.state(reachable: false, unsent: 0, logged: true), .onPhone)
        XCTAssertEqual(SyncState.state(reachable: true, unsent: 0, logged: true), .onPhone)
    }

    func testNoneBeforeAnySet() {
        XCTAssertEqual(SyncState.state(reachable: true, unsent: 0, logged: false), .none)
        XCTAssertEqual(SyncState.state(reachable: true, unsent: 0, logged: nil), .none)
        XCTAssertEqual(SyncState.state(reachable: false, unsent: 0, logged: nil), .none)
    }

    func testAway() {
        XCTAssertEqual(SyncState.state(reachable: false, unsent: 0, logged: false), .away)
    }

    func testComplicationAndPillAgree() {
        for reachable in [true, false] {
            for unsent in [0, 1, 150] {
                for logged in [nil, true, false] as [Bool?] {
                    XCTAssertEqual(SyncState.state(reachable: reachable, unsent: unsent, logged: logged).unsent,
                                   SyncState.count(reachable: reachable, unsent: unsent))
                }
            }
        }
    }

    func testCountText() {
        XCTAssertEqual(SyncState.waiting(1).countText, "1")
        XCTAssertEqual(SyncState.waiting(99).countText, "99")
        XCTAssertEqual(SyncState.waiting(100).countText, "99+")
        XCTAssertEqual(SyncState.none.countText, "0")
    }

    func testAnySet() {
        XCTAssertFalse(SyncState.anySet(workout([row(), row()])))
        XCTAssertTrue(SyncState.anySet(workout([row(), row(done: true)])))
        XCTAssertTrue(SyncState.anySet(workout([row(done: true, warmup: true)])))
        let oneSide = Sides(L: SideRow(w: 20, r: 8, done: true), R: SideRow(w: 20, r: 8, done: false))
        XCTAssertTrue(SyncState.anySet(workout([row(sides: oneSide)])))
    }

    func testRealTickCounts() {
        var s = SessionState()
        s.workout = workout([row(), row()])
        XCTAssertFalse(SyncState.anySet(s.workout!))
        let (t, _) = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1000, id: "e1")
        XCTAssertTrue(SyncState.anySet(t.workout!))
    }
}
