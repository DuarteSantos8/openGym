import XCTest
@testable import WatchCore

/// The 1.4.5 sync protocol on the watch (docs/WATCH_SYNC.md): the outbox keeps every event until the
/// phone applied it, and what the phone says it applied (`acked`) settles the watch's own copy of
/// the session. Wear OS has the same cases (SyncProtocolTest.kt).
final class OutboxTests: XCTestCase {
    func ev(_ id: String) -> Event { ["id": id, "type": "setDone"] }

    func row(_ w: Double, _ r: Double, done: Bool = false, at: Double? = nil) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: false, at: at)
    }

    func workout(_ id: String) -> ActiveWorkout {
        ActiveWorkout(id: id, name: "Legs", unit: "kg", cur: 0, restSec: 90, rest: nil,
                      entries: [Entry(id: "sq", name: "Squat", mode: "reps", restSec: nil, last: nil, sets: [row(100, 5), row(100, 5)])])
    }

    func snap(_ w: ActiveWorkout?, acked: [String]? = nil, ready: Ready? = nil) -> Snapshot {
        var s = Snapshot(v: 1, unit: "kg", restSec: 90, active: w, ready: ready, settings: nil)
        s.acked = acked
        return s
    }

    func testEventsAreNumberedInOrderAndCarryTheirSeq() throws {
        let (o1, a) = try XCTUnwrap(OutboxCore.add(Outbox(), ev("a")))
        let (o2, b) = try XCTUnwrap(OutboxCore.add(o1, ev("b")))
        XCTAssertEqual(a.seq, 1)
        XCTAssertEqual(b.seq, 2)
        let parsed = try XCTUnwrap((try? JSONSerialization.jsonObject(with: Data(b.json.utf8))) as? [String: Any])
        XCTAssertEqual(parsed["seq"] as? Int, 2)
        XCTAssertEqual(parsed["id"] as? String, "b")
        XCTAssertEqual(OutboxCore.add(o2, ev("b"))?.0.items.count, 2)
        XCTAssertNil(OutboxCore.add(o2, ["type": "setDone"]))
    }

    func testAnEventStaysUntilThePhoneAppliedIt() throws {
        var o = Outbox()
        for id in ["a", "b", "c"] { o = try XCTUnwrap(OutboxCore.add(o, ev(id))).0 }
        XCTAssertEqual(OutboxCore.due(o, now: 1000).map { $0.id }, ["a", "b", "c"])
        o = OutboxCore.sent(o, ["a", "b", "c"], now: 1000)
        XCTAssertTrue(OutboxCore.due(o, now: 1000 + OutboxCore.resendMs - 1).isEmpty)
        XCTAssertEqual(OutboxCore.due(o, now: 1000 + OutboxCore.resendMs).count, 3)
        o = OutboxCore.delivered(o, ["a", "b"])
        XCTAssertEqual(OutboxCore.due(o, now: 1000 + OutboxCore.resendMs).map { $0.id }, ["c"])
        XCTAssertEqual(OutboxCore.due(o, now: 1000 + OutboxCore.redeliverMs).map { $0.id }, ["a", "b", "c"])
        XCTAssertEqual(OutboxCore.onReconnect(o, now: 1001).map { $0.id }, ["c"])
        o = OutboxCore.ack(o, ["a", "b", "zz"])
        XCTAssertEqual(o.items.map { $0.id }, ["c"])
        XCTAssertEqual(OutboxCore.waiting(o), 1)
    }

    func testOnlyTheNewestStatusWaitsAndNoSetEverGivesWayToOne() throws {
        var o = try XCTUnwrap(OutboxCore.add(Outbox(), ev("set-1"))).0
        for i in 1...5 {
            o = try XCTUnwrap(OutboxCore.add(o, ["id": "st-\(i)", "type": "watchStatus", "health": "on"])).0
        }
        o = try XCTUnwrap(OutboxCore.add(o, ev("set-2"))).0
        XCTAssertEqual(o.items.map { $0.id }, ["set-1", "st-5", "set-2"])
        // numbered on, so the phone still sorts what is left in the watch's order
        XCTAssertEqual(o.items.map { $0.seq }, [1, 6, 7])
        XCTAssertEqual(o.seq, 7)
        // a thousand launches without the phone: the sets are still there
        for i in 6...1100 {
            o = try XCTUnwrap(OutboxCore.add(o, ["id": "st-\(i)", "type": "watchStatus", "health": "on"])).0
        }
        XCTAssertEqual(o.items.map { $0.id }, ["set-1", "set-2", "st-1100"])
    }

    func testTheOutboxSurvivesARestart() throws {
        var o = try XCTUnwrap(OutboxCore.add(Outbox(), ev("a"))).0
        o = OutboxCore.sent(o, ["a"], now: 5)
        let back = try JSONDecoder().decode(Outbox.self, from: JSONEncoder().encode(o))
        XCTAssertEqual(back, o)
        XCTAssertEqual(OutboxCore.add(back, ev("b"))?.1.seq, 2)
    }

    func testAClockThatWentBackDoesNotStrandAnEvent() throws {
        let o = OutboxCore.sent(try XCTUnwrap(OutboxCore.add(Outbox(), ev("a"))).0, ["a"], now: 10_000)
        XCTAssertEqual(OutboxCore.due(o, now: 5_000).count, 1)
    }

    func testATickThePhoneAppliedIsThePhonesFromThenOn() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("w1")))
        s = SessionCore.tick(s, entry: 0, set: 0, w: 105, r: 5, at: 1000, id: "t1").0
        XCTAssertEqual(s.pending["sq#0"]?.id, "t1")
        // the phone applied it, then unticked the set there: the untick sticks here too
        s = SessionCore.applySnapshot(s, snap(workout("w1"), acked: ["t1"]))
        XCTAssertEqual(s.workout?.entries[0].sets[0].done, false)
        XCTAssertTrue(s.pending.isEmpty)
    }

    func testATickThePhoneHasNotAppliedStays() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("w1")))
        s = SessionCore.tick(s, entry: 0, set: 1, w: 110, r: 3, at: 2000, id: "t2").0
        s = SessionCore.applySnapshot(s, snap(workout("w1"), acked: ["other"]))
        XCTAssertEqual(s.workout?.entries[0].sets[1].done, true)
        XCTAssertEqual(s.workout?.entries[0].sets[1].w, 110)
    }

    func testAWorkoutStartedHereAndEndedOnThePhoneBeforeAnySnapshotShowedItEndsHereToo() throws {
        let session = ReadySession(routineIds: ["r"], name: "Legs", entries: workout("x").entries)
        var s = SessionCore.applySnapshot(SessionState(), snap(nil))
        s = SessionCore.start(s, session, wid: "watch-1", at: 10, id: "start-1").0
        XCTAssertEqual(SessionCore.applySnapshot(s, snap(nil)).workout?.id, "watch-1")
        let after = SessionCore.applySnapshot(s, snap(nil, acked: ["start-1"]))
        XCTAssertNil(after.workout)
        XCTAssertNil(after.startedHere)
    }

    func testOldSavedStateWithoutTheNewFieldsStillLoads() throws {
        let old = #"{"finishedHere":[],"pending":{"sq#0":{"w":1,"r":2,"at":3}},"startedHere":"watch-1","entryIndex":0,"unit":"kg","restSec":90,"settings":{}}"#
        let s = try JSONDecoder().decode(SessionState.self, from: Data(old.utf8))
        XCTAssertNil(s.startId)
        XCTAssertNil(s.pending["sq#0"]?.id)
    }

    func testOnlySetsNotDeliveredCountAsWaitingToSync() throws {
        var o = Outbox()
        for (id, type) in [("a", "setDone"), ("b", "watchStatus"), ("c", "setDone"), ("d", "setHr")] {
            o = try XCTUnwrap(OutboxCore.add(o, ["id": id, "type": type])).0
        }
        XCTAssertEqual(OutboxCore.waitingSets(o), 2, "the watch's status and a heart rate are not sets")
        XCTAssertEqual(OutboxCore.waiting(o), 4)
        o = OutboxCore.delivered(o, ["a"])
        XCTAssertEqual(OutboxCore.waitingSets(o), 1, "on the phone now")
        o = OutboxCore.ack(o, ["c"])
        XCTAssertEqual(OutboxCore.waitingSets(o), 0)
    }

    func testSyncStateSaysWhatTheLifterNeedsToKnow() {
        XCTAssertEqual(SyncState.of(waiting: 0, reachable: false), .synced, "nothing waits: all there, phone or not")
        XCTAssertEqual(SyncState.of(waiting: 3, reachable: true), .waiting(3))
        XCTAssertEqual(SyncState.of(waiting: 3, reachable: false), .away(3))
        XCTAssertEqual(SyncState.away(3).count, 3)
        XCTAssertEqual(SyncState.synced.count, 0)
    }
}
