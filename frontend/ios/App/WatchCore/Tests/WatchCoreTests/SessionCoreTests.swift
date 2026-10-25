import XCTest
@testable import WatchCore

/// The watch's session against the sync cases (SessionCore's header lists them).
final class SessionCoreTests: XCTestCase {
    func row(_ w: Double, _ r: Double, done: Bool = false, at: Double? = nil) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: false, at: at)
    }

    func workout(_ id: String, sets: [SetRow], cur: Int = 0) -> ActiveWorkout {
        ActiveWorkout(id: id, name: "Push", unit: "kg", cur: cur, restSec: 90, rest: nil,
                      entries: [Entry(id: "0025", name: "Bench Press", mode: "reps", restSec: nil, last: nil, sets: sets),
                                Entry(id: "0426", name: "Overhead Press", mode: "reps", restSec: nil, last: nil, sets: [row(40, 8)])])
    }

    func snap(_ w: ActiveWorkout?) -> Snapshot { Snapshot(v: 1, unit: "kg", restSec: 90, active: w, ready: nil, settings: nil) }

    func testPicksUpAWorkoutRunningOnThePhoneWhenFirstOpened() {
        let s = SessionCore.applySnapshot(SessionState(), snap(workout("p1", sets: [row(60, 8, done: true, at: 1), row(60, 8)], cur: 1)))
        XCTAssertEqual(s.workout?.id, "p1")
        XCTAssertEqual(s.entryIndex, 1)
        XCTAssertEqual(SessionCore.setIndex(s, entry: 0), 1)
    }

    func testATickStaysUntilTheSnapshotShowsItAndTheLaterTickWins() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("p1", sets: [row(60, 8), row(60, 8)])))
        let (t, event) = SessionCore.tick(s, entry: 0, set: 0, w: 62.5, r: 7, at: 1000, id: "e1")
        s = t
        XCTAssertEqual(event?["type"] as? String, "setDone")
        XCTAssertEqual(event?["wid"] as? String, "p1")
        // an older snapshot, sent before the phone applied the tick: the tick stays
        s = SessionCore.applySnapshot(s, snap(workout("p1", sets: [row(60, 8), row(60, 8)])))
        XCTAssertEqual(s.workout?.entries[0].sets[0], row(62.5, 7, done: true, at: 1000))
        XCTAssertNotNil(s.pending["0025#0"])
        // the phone changed that set itself earlier: the watch's later tick still wins
        s = SessionCore.applySnapshot(s, snap(workout("p1", sets: [row(55, 5, done: true, at: 500), row(60, 8)])))
        XCTAssertEqual(s.workout?.entries[0].sets[0].w, 62.5)
        // the phone has applied it: confirmed, no longer pending
        s = SessionCore.applySnapshot(s, snap(workout("p1", sets: [row(62.5, 7, done: true, at: 1000), row(60, 8)])))
        XCTAssertNil(s.pending["0025#0"])
        // a later change on the phone wins over the watch's tick
        s = SessionCore.tick(s, entry: 0, set: 1, w: 60, r: 8, at: 2000, id: "e2").0
        s = SessionCore.applySnapshot(s, snap(workout("p1", sets: [row(62.5, 7, done: true, at: 1000), row(65, 6, done: true, at: 3000)])))
        XCTAssertEqual(s.workout?.entries[0].sets[1].w, 65)
        XCTAssertNil(s.pending["0025#1"])
    }

    func testRelaunchRestoresTheSessionWithItsUnconfirmedTicks() throws {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("p1", sets: [row(60, 8), row(60, 8)])))
        s = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1000, id: "e1").0
        let saved = try JSONEncoder().encode(s)
        var back = try JSONDecoder().decode(SessionState.self, from: saved)
        XCTAssertEqual(back, s)
        // the latest context is the old snapshot: the tick survives
        back = SessionCore.applySnapshot(back, snap(workout("p1", sets: [row(60, 8), row(60, 8)])))
        XCTAssertTrue(back.workout?.entries[0].sets[0].done ?? false)
    }

    func testFinishedOnTheWatchStaysFinishedThoughThePhoneHasNotHeard() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("p1", sets: [row(60, 8)])))
        let (f, event) = SessionCore.finish(s, at: 5000, id: "f1")
        s = f
        XCTAssertEqual(event?["type"] as? String, "finish")
        XCTAssertNil(s.workout)
        s = SessionCore.applySnapshot(s, snap(workout("p1", sets: [row(60, 8)])))
        XCTAssertNil(s.workout, "a snapshot from before the phone applied the finish does not bring it back")
        s = SessionCore.applySnapshot(s, snap(workout("p2", sets: [row(60, 8)])))
        XCTAssertEqual(s.workout?.id, "p2", "the next workout does show")
    }

    func testFinishedOnThePhoneEndsItHere() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("p1", sets: [row(60, 8)])))
        s = SessionCore.applySnapshot(s, snap(nil))
        XCTAssertNil(s.workout)
        XCTAssertTrue(s.pending.isEmpty)
    }

    func testStartedOnTheWatchStaysUntilThePhoneHasIt() {
        let ready = ReadySession(routineIds: ["r1"], name: "Push", entries: workout("x", sets: [row(60, 8)]).entries)
        var (s, event) = SessionCore.start(SessionState(), ready, wid: "watch-1", at: 100, id: "s1")
        XCTAssertEqual(event["type"] as? String, "start")
        XCTAssertEqual(event["wid"] as? String, "watch-1")
        s = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 200, id: "e1").0
        s = SessionCore.applySnapshot(s, snap(nil))
        XCTAssertEqual(s.workout?.id, "watch-1", "the phone has not heard of it yet")
        s = SessionCore.applySnapshot(s, snap(workout("phone-other", sets: [row(1, 1)])))
        XCTAssertEqual(s.workout?.id, "watch-1", "another workout on the phone does not replace it")
        s = SessionCore.applySnapshot(s, snap(workout("watch-1", sets: [row(60, 8), row(40, 8)])))
        XCTAssertNil(s.startedHere, "the phone runs it now")
        XCTAssertTrue(s.workout?.entries[0].sets[0].done ?? false, "with the tick made before it heard")
    }

    func testAnotherWorkoutOnThePhoneStartsClean() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("p1", sets: [row(60, 8)])))
        s = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1, id: "e1").0
        s = SessionCore.applySnapshot(s, snap(workout("p2", sets: [row(70, 5)], cur: 1)))
        XCTAssertEqual(s.workout?.id, "p2")
        XCTAssertFalse(s.workout?.entries[0].sets[0].done ?? true, "an old tick never lands on another workout")
        XCTAssertEqual(s.entryIndex, 1)
    }

    func testProgressCountsWorkSetsOnly() {
        var w = workout("p1", sets: [row(60, 8, done: true, at: 1), row(60, 8)])
        w.entries[0].sets.insert(SetRow(w: 20, r: 10, sec: nil, done: true, warmup: true, at: 1), at: 0)
        let s = SessionCore.applySnapshot(SessionState(), snap(w))
        XCTAssertEqual(SessionCore.progress(s).done, 1)
        XCTAssertEqual(SessionCore.progress(s).total, 3)
    }

    func testReadsASnapshotWithFieldsItDoesNotKnowAndWithoutOptionalOnes() throws {
        let json = #"{"v":1,"future":true,"active":{"id":"p1","name":"Push","unit":"kg","cur":0,"restSec":90,"entries":[{"id":"0025","name":"Bench","mode":"reps","sets":[{"w":60,"r":8,"done":false,"warmup":false,"hr":{"avg":1}}]}]}}"#
        let snap = try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
        XCTAssertEqual(SessionCore.applySnapshot(SessionState(), snap).workout?.entries.first?.sets.count, 1)
    }
}
