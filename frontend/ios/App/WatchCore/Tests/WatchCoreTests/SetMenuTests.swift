import XCTest
@testable import WatchCore

final class SetMenuTests: XCTestCase {
    func row(done: Bool = false, warmup: Bool = false) -> SetRow {
        SetRow(w: 60, r: 8, sec: nil, done: done, warmup: warmup, at: nil)
    }
    func entry(_ sets: [SetRow], mode: String = "reps") -> Entry {
        Entry(id: "x", name: "X", mode: mode, restSec: nil, last: nil, sets: sets)
    }
    let dec = JSONDecoder()

    func testOldSnapshotDecodes() throws {
        let r = try dec.decode(SetRow.self, from: Data(#"{"w":60,"r":8,"done":false,"warmup":false}"#.utf8))
        XCTAssertNil(r.failure); XCTAssertNil(r.drop); XCTAssertNil(r.drops); XCTAssertNil(r.rp)
        XCTAssertNil(try dec.decode(WatchSettings.self, from: Data("{}".utf8)).setMenu)
    }

    func testNewFieldsDecode() throws {
        let r = try dec.decode(SetRow.self, from: Data(#"{"w":60,"r":8,"done":false,"warmup":false,"failure":true,"drop":50,"drops":2,"rp":true}"#.utf8))
        XCTAssertEqual(r.failure, true); XCTAssertEqual(r.drop, 50); XCTAssertEqual(r.drops, 2); XCTAssertEqual(r.rp, true)
        XCTAssertEqual(try dec.decode(WatchSettings.self, from: Data(#"{"setMenu":true}"#.utf8)).setMenu, true)
    }

    func testWorkSetOffersAllThree() {
        let o = SetMenu.offer(entry([row(), row()]), set: 0)
        XCTAssertEqual(o, MenuOffer(warmup: .off, failure: .off, drop: .off, dropWeight: nil, canAdd: true, canRemove: true))
    }

    func testWarmupLocksFailureAndDrop() {
        let o = SetMenu.offer(entry([row(warmup: true), row()]), set: 0)
        XCTAssertEqual(o.warmup, .on); XCTAssertEqual(o.failure, .locked); XCTAssertEqual(o.drop, .locked)
    }

    func testLastWorkSetCannotBecomeWarmup() {
        XCTAssertEqual(SetMenu.offer(entry([row(warmup: true), row()]), set: 1).warmup, .locked)
        XCTAssertEqual(SetMenu.offer(entry([row()]), set: 0).warmup, .locked)
    }

    func testDropSetAndRestPauseCannotBecomeWarmup() {
        var d = row(); d.drop = 50
        let od = SetMenu.offer(entry([d, row()]), set: 0)
        XCTAssertEqual(od.warmup, .locked); XCTAssertEqual(od.drop, .on); XCTAssertEqual(od.dropWeight, 50)
        var p = row(); p.rp = true
        let op = SetMenu.offer(entry([p, row()]), set: 0)
        XCTAssertEqual(op.warmup, .locked); XCTAssertEqual(op.drop, .hidden)
    }

    func testDoneSetHasNoWarmupSwitch() {
        XCTAssertEqual(SetMenu.offer(entry([row(done: true), row()]), set: 0).warmup, .off)
    }

    func testTwoDropsLockTheDropDisc() {
        var d = row(); d.drop = 50; d.drops = 2
        let o = SetMenu.offer(entry([d, row()]), set: 0)
        XCTAssertEqual(o.drop, .locked); XCTAssertEqual(o.dropWeight, 50)
    }

    func testFailureMarkShowsOn() {
        var f = row(); f.failure = true
        XCTAssertEqual(SetMenu.offer(entry([f, row()]), set: 0).failure, .on)
    }

    func testTimedHasNoDropCardioOnlyNothing() {
        let t = SetMenu.offer(entry([row(), row()], mode: "time"), set: 0)
        XCTAssertEqual(t.drop, .hidden); XCTAssertEqual(t.warmup, .hidden); XCTAssertEqual(t.failure, .off); XCTAssertTrue(t.canAdd)
        let c = SetMenu.offer(entry([row(), row()], mode: "cardio"), set: 0)
        XCTAssertEqual(c.failure, .hidden); XCTAssertEqual(c.drop, .hidden); XCTAssertEqual(c.warmup, .hidden); XCTAssertFalse(c.canAdd)
    }

    func testOnlySetCannotBeRemoved() {
        XCTAssertFalse(SetMenu.offer(entry([row()]), set: 0).canRemove)
    }

    func testMenuNeedsThePhonesFlag() {
        var s = SessionState()
        XCTAssertFalse(SetMenu.available(s))
        s.settings.setMenu = true
        XCTAssertTrue(SetMenu.available(s))
        s.settings.setMenu = false
        XCTAssertFalse(SetMenu.available(s))
    }

    // Edits on the watch's own state (Task 5)

    func workout(_ sets: [SetRow], id: String = "w1") -> ActiveWorkout {
        ActiveWorkout(id: id, name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: [entry(sets)])
    }
    func state(_ sets: [SetRow]) -> SessionState {
        var s = SessionState(); s.workout = workout(sets); s.settings.setMenu = true
        return s
    }
    func snap(_ w: ActiveWorkout, acked: [String]? = nil) -> Snapshot {
        Snapshot(v: 1, unit: "kg", restSec: 90, active: w, ready: nil, settings: nil, acked: acked)
    }
    func rows(_ s: SessionState) -> [SetRow] { s.workout!.entries[0].sets }

    func testFailureMarkEmitsEventAndShowsAtOnce() {
        let (s, ev) = SetMenu.mark(state([row(done: true), row()]), entry: 0, set: 0, .failure, on: true, at: 5, id: "m1")
        XCTAssertEqual(rows(s)[0].failure, true)
        let e = try! XCTUnwrap(ev)
        XCTAssertEqual(e["id"] as? String, "m1"); XCTAssertEqual(e["type"] as? String, "setMark")
        XCTAssertEqual(e["wid"] as? String, "w1"); XCTAssertEqual(e["exId"] as? String, "x")
        XCTAssertEqual(e["entryIdx"] as? Int, 0); XCTAssertEqual(e["setIdx"] as? Int, 0)
        XCTAssertEqual(e["at"] as? Double, 5); XCTAssertEqual(e["w"] as? Double, 60); XCTAssertEqual(e["r"] as? Double, 8)
        XCTAssertEqual(e["done"] as? Bool, true); XCTAssertEqual(e["failure"] as? Bool, true)
        XCTAssertEqual(e.count, 11)
        XCTAssertEqual(s.edits, [PendingEdit(id: "m1", exId: "x", op: "mark", setIdx: 0, kind: .failure, on: true, w: 60, r: 8, done: true, entryIdx: 0)])
    }

    func testWarmupMovesTheRowAndRemapsKeys() {
        var s0 = state([row(done: true), SetRow(w: 40, r: 10, sec: nil, done: false, warmup: false, at: nil), row()])
        s0.pending = ["x#0": PendingTick(w: 60, r: 8, at: 1, id: "t1")]
        s0.skipped = ["x#1", "x#2"]
        s0.efforts = ["x#0": 8]
        let (s, ev) = SetMenu.mark(s0, entry: 0, set: 1, .warmup, on: true, at: 5, id: "m1")
        XCTAssertNotNil(ev); XCTAssertEqual(ev?["warmup"] as? Bool, true)
        XCTAssertEqual(rows(s).map(\.w), [40, 60, 60])
        XCTAssertTrue(rows(s)[0].warmup)
        XCTAssertEqual(Array(s.pending.keys), ["x#1"])
        XCTAssertEqual(s.skipped, ["x#0", "x#2"])
        XCTAssertEqual(s.efforts, ["x#1": 8])
        // and back: it becomes the first work set, where it is already
        let (b, _) = SetMenu.mark(s, entry: 0, set: 0, .warmup, on: false, at: 6, id: "m2")
        XCTAssertEqual(rows(b).map(\.w), [40, 60, 60]); XCTAssertFalse(rows(b)[0].warmup)
    }

    func testWarmupOffGoesToTheEdgeOfTheWarmups() {
        let s0 = state([row(warmup: true), SetRow(w: 30, r: 5, sec: nil, done: false, warmup: true, at: nil), row()])
        let (s, _) = SetMenu.mark(s0, entry: 0, set: 0, .warmup, on: false, at: 5, id: "m1")
        XCTAssertEqual(rows(s).map(\.w), [30, 60, 60]); XCTAssertEqual(rows(s).map(\.warmup), [true, false, false])
    }

    func testWarmupClearsFailureAndDrop() {
        var f = row(); f.failure = true
        let (s, _) = SetMenu.mark(state([f, row()]), entry: 0, set: 0, .warmup, on: true, at: 5, id: "m1")
        XCTAssertTrue(rows(s)[0].warmup); XCTAssertNil(rows(s)[0].failure); XCTAssertNil(rows(s)[0].drop); XCTAssertNil(rows(s)[0].drops)
    }

    func testDropOnShowsDropWithoutAWeight() {
        let (s, ev) = SetMenu.mark(state([row(), row()]), entry: 0, set: 0, .drop, on: true, at: 5, id: "m1")
        XCTAssertEqual(ev?["drop"] as? Bool, true)
        XCTAssertEqual(rows(s)[0].drops, 1); XCTAssertNil(rows(s)[0].drop)
        let o = SetMenu.offer(s.workout!.entries[0], set: 0)
        XCTAssertEqual(o.drop, .on); XCTAssertEqual(o.warmup, .locked); XCTAssertNil(o.dropWeight)
        let (off, _) = SetMenu.mark(s, entry: 0, set: 0, .drop, on: false, at: 6, id: "m2")
        XCTAssertNil(rows(off)[0].drops); XCTAssertNil(rows(off)[0].drop)
    }

    func testAddAppendsACopyOfTheLastSet() {
        var last = SetRow(w: 70, r: 6, sec: nil, done: true, warmup: false, at: 3); last.failure = true
        let (s, ev) = SetMenu.addSet(state([row(done: true), row(done: true), row(), last]), entry: 0, at: 5, id: "a1")
        XCTAssertEqual(rows(s).count, 5)
        let n = rows(s)[4]
        XCTAssertEqual(n, SetRow(w: 70, r: 6, sec: nil, done: false, warmup: false, at: nil))
        XCTAssertEqual(ev?["type"] as? String, "addSet"); XCTAssertNil(ev?["setIdx"]); XCTAssertEqual(ev?.count, 6)
        XCTAssertEqual(s.edits?.first?.op, "add")
    }

    func testRemoveDeletesTheRowAndItsPendingTick() {
        var s0 = state([row(done: true), row(done: true), row()])
        s0.pending = ["x#0": PendingTick(w: 60, r: 8, at: 1), "x#1": PendingTick(w: 60, r: 8, at: 2)]
        s0.skipped = ["x#2"]
        let (s, ev) = SetMenu.removeSet(s0, entry: 0, set: 1, at: 5, id: "r1")
        XCTAssertEqual(rows(s).count, 2)
        XCTAssertEqual(Array(s.pending.keys), ["x#0"]); XCTAssertEqual(s.skipped, ["x#1"])
        XCTAssertEqual(ev?["type"] as? String, "removeSet"); XCTAssertEqual(ev?["setIdx"] as? Int, 1)
        XCTAssertEqual(ev?["done"] as? Bool, true); XCTAssertEqual(ev?["w"] as? Double, 60)
    }

    func testRefusedMarkEmitsNothing() {
        let s0 = state([row(warmup: true), row()])
        let (s, ev) = SetMenu.mark(s0, entry: 0, set: 1, .warmup, on: true, at: 5, id: "m1")
        XCTAssertNil(ev); XCTAssertEqual(s, s0)
        XCTAssertNil(SetMenu.removeSet(state([row()]), entry: 0, set: 0, at: 5, id: "r1").1)
        XCTAssertNil(SetMenu.mark(state([row(), row()]), entry: 0, set: 0, .failure, on: false, at: 5, id: "m2").1)
    }

    func testOlderSnapshotDoesNotRevertAnEdit() {
        let (s1, _) = SetMenu.mark(state([row(), row()]), entry: 0, set: 0, .failure, on: true, at: 5, id: "m1")
        let s2 = SessionCore.applySnapshot(s1, snap(workout([row(), row()])))
        XCTAssertEqual(rows(s2)[0].failure, true); XCTAssertEqual(s2.edits?.count, 1)
        let s3 = SessionCore.applySnapshot(s2, snap(workout([row(), row()]), acked: ["m1"]))
        XCTAssertNil(rows(s3)[0].failure); XCTAssertNil(s3.edits)
    }

    func testReplaySkipsAnEditWhoseSetChanged() {
        let (s1, _) = SetMenu.mark(state([row(), row()]), entry: 0, set: 0, .failure, on: true, at: 5, id: "m1")
        let changed = workout([SetRow(w: 65, r: 8, sec: nil, done: false, warmup: false, at: nil), row()])
        XCTAssertNil(SetMenu.replay(s1.edits!, on: changed).entries[0].sets[0].failure)
        let s2 = SessionCore.applySnapshot(s1, snap(changed))
        XCTAssertNil(rows(s2)[0].failure); XCTAssertNil(s2.edits)
    }

    func testReplayKeepsAnAddAndARemoveUntilAcked() {
        let (a, _) = SetMenu.addSet(state([row(), row()]), entry: 0, at: 5, id: "a1")
        XCTAssertEqual(rows(SessionCore.applySnapshot(a, snap(workout([row(), row()])))).count, 3)
        var b0 = state([row(), SetRow(w: 50, r: 8, sec: nil, done: false, warmup: false, at: nil)])
        b0.workout!.id = "w1"
        let (b, _) = SetMenu.removeSet(b0, entry: 0, set: 1, at: 5, id: "r1")
        let older = SessionCore.applySnapshot(b, snap(b0.workout!))
        XCTAssertEqual(rows(older).map(\.w), [60])
    }

    // Review 2026-11-12: ticks made after an unapplied add or remove are keyed in the watch's rows.

    func testATickAfterARemoveStaysOnItsSet() {
        let b = SetRow(w: 50, r: 8, sec: nil, done: false, warmup: false, at: nil)
        let c = SetRow(w: 70, r: 6, sec: nil, done: false, warmup: false, at: nil)
        let s0 = state([row(), b, c])
        let (s1, _) = SetMenu.removeSet(s0, entry: 0, set: 1, at: 5, id: "r1")
        let (s2, _) = SessionCore.tick(s1, entry: 0, set: 1, w: 70, r: 6, at: 6, id: "t1")
        let s3 = SessionCore.applySnapshot(s2, snap(s0.workout!))   // the phone has neither yet
        XCTAssertEqual(rows(s3).map(\.w), [60, 70])
        XCTAssertEqual(rows(s3).map(\.done), [false, true])
        XCTAssertEqual(s3.edits?.count, 1)
    }

    func testATickOnAnAddedSetStays() {
        let s0 = state([row(), row()])
        let (s1, _) = SetMenu.addSet(s0, entry: 0, at: 5, id: "a1")
        let (s2, _) = SessionCore.tick(s1, entry: 0, set: 2, w: 60, r: 8, at: 6, id: "t1")
        let s3 = SessionCore.applySnapshot(s2, snap(s0.workout!))
        XCTAssertEqual(rows(s3).map(\.done), [false, false, true])
        XCTAssertNotNil(s3.pending["x#2"])
    }

    func testAMarkAfterATickOnTheSameSetStays() {
        let s0 = state([row(), row()])
        let (s1, _) = SessionCore.tick(s0, entry: 0, set: 0, w: 60, r: 8, at: 5, id: "t1")
        let (s2, _) = SetMenu.mark(s1, entry: 0, set: 0, .failure, on: true, at: 6, id: "m1")
        let s3 = SessionCore.applySnapshot(s2, snap(s0.workout!))
        XCTAssertEqual(rows(s3)[0].done, true); XCTAssertEqual(rows(s3)[0].failure, true)
    }

    func testATickAfterAWarmupMoveStaysOnItsSet() {
        let w40 = SetRow(w: 40, r: 10, sec: nil, done: false, warmup: false, at: nil)
        let s0 = state([row(), w40, row()])
        let (s1, _) = SetMenu.mark(s0, entry: 0, set: 1, .warmup, on: true, at: 5, id: "m1")   // 40 moves to the top
        let (s2, _) = SessionCore.tick(s1, entry: 0, set: 1, w: 60, r: 8, at: 6, id: "t1")      // the first work set
        let s3 = SessionCore.applySnapshot(s2, snap(s0.workout!))
        XCTAssertEqual(rows(s3).map(\.w), [40, 60, 60])
        XCTAssertEqual(rows(s3).map(\.done), [false, true, false])
    }

    func testATimedPerSidePairIsOneSet() {
        func half(_ side: String) -> SetRow { var r = SetRow(w: nil, r: nil, sec: 30, done: false, warmup: false, at: nil); r.side = side; return r }
        var s0 = state([half("L"), half("R")])
        s0.workout!.entries[0].mode = "time"
        let o = SetMenu.offer(s0.workout!.entries[0], set: 1)
        XCTAssertFalse(o.canAdd); XCTAssertFalse(o.canRemove)
        let (s, ev) = SetMenu.mark(s0, entry: 0, set: 1, .failure, on: true, at: 5, id: "m1")
        XCTAssertNotNil(ev)
        XCTAssertEqual(rows(s).map(\.failure), [true, true])
    }

    func testAnEditOnTheSecondCopyOfAnExerciseStaysThere() {
        var s0 = state([row(), row()])
        s0.workout!.entries.append(entry([row(), row()]))   // the same exercise again (a combined routine)
        let (s1, _) = SetMenu.mark(s0, entry: 1, set: 0, .failure, on: true, at: 5, id: "m1")
        let s2 = SessionCore.applySnapshot(s1, snap(s0.workout!))
        XCTAssertNil(s2.workout!.entries[0].sets[0].failure)
        XCTAssertEqual(s2.workout!.entries[1].sets[0].failure, true)
    }

    func testANewWorkoutDropsTheEdits() {
        let (s1, _) = SetMenu.mark(state([row(), row()]), entry: 0, set: 0, .failure, on: true, at: 5, id: "m1")
        XCTAssertNil(SessionCore.applySnapshot(s1, snap(workout([row(), row()], id: "w2"))).edits)
        XCTAssertNil(SessionCore.finish(s1, at: 9, id: "f1").0.edits)
    }
}

final class UndoWindowTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1000)
    let e = PendingEdit(id: "a", exId: "x", op: "remove", setIdx: 1, w: 60, r: 8, done: false)

    func testDueAfterFourSecondsNotBefore() {
        var u = UndoWindow(); u.begin(e, at: t0)
        XCTAssertNil(u.due(at: t0.addingTimeInterval(3.9)))
        XCTAssertEqual(u.due(at: t0.addingTimeInterval(4)), e)
    }
    func testUndoCancels() {
        var u = UndoWindow(); u.begin(e, at: t0); u.undo()
        XCTAssertNil(u.due(at: t0.addingTimeInterval(10))); XCTAssertNil(u.flush())
    }
    func testFlushReturnsItOnce() {
        var u = UndoWindow(); u.begin(e, at: t0)
        XCTAssertEqual(u.flush(), e); XCTAssertNil(u.flush()); XCTAssertNil(u.due(at: t0.addingTimeInterval(10)))
    }
}
