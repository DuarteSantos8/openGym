import XCTest
@testable import WatchCore

final class SetMenuTests: XCTestCase {
    func row(done: Bool = false, warmup: Bool = false, sid: String? = nil, w: Double = 60) -> SetRow {
        SetRow(w: w, r: 8, sec: nil, done: done, warmup: warmup, at: nil, sid: sid)
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
        let o = SetMenu.offer(entry([row(sid: "a"), row(sid: "b")]), set: 0)
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
        XCTAssertFalse(SetMenu.offer(entry([row(sid: "a")]), set: 0).canRemove)
    }

    // What the phone's removeWatchSet takes: never a done set, nor one with a side done, nor one it has not named.
    func testRemoveIsNotOfferedOnADoneSet() {
        XCTAssertFalse(SetMenu.offer(entry([row(done: true, sid: "a"), row(sid: "b")]), set: 0).canRemove)
        var half = row(sid: "a"); half.sides = Sides(L: SideRow(w: 20, r: 8, done: true), R: SideRow(w: 20, r: 8, done: false))
        XCTAssertFalse(SetMenu.offer(entry([half, row(sid: "b")]), set: 0).canRemove)
        XCTAssertFalse(SetMenu.offer(entry([row(), row()]), set: 0).canRemove)
        XCTAssertTrue(SetMenu.offer(entry([row(sid: "a"), row(sid: "b")]), set: 0).canRemove)
    }

    func testMenuNeedsThePhonesFlag() {
        var s = SessionState()
        XCTAssertFalse(SetMenu.available(s))
        s.settings.setMenu = true
        XCTAssertTrue(SetMenu.available(s))
        s.settings.setMenu = false
        XCTAssertFalse(SetMenu.available(s))
    }

    // Edits on the watch's own state, by the set's id (protocol 2)

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
    /// Three sets the phone has named.
    var abc: [SetRow] { [row(sid: "a"), row(sid: "b", w: 50), row(sid: "c", w: 70)] }

    func testAMarkGoesOutByItsSetsId() throws {
        let (s, ev) = SetMenu.mark(state(abc), entry: 0, set: 1, .failure, on: true, at: 5, id: "m1")
        XCTAssertEqual(rows(s)[1].failure, true)
        let e = try XCTUnwrap(ev)
        XCTAssertEqual(e["id"] as? String, "m1"); XCTAssertEqual(e["type"] as? String, "setMark")
        XCTAssertEqual(e["wid"] as? String, "w1"); XCTAssertEqual(e["exId"] as? String, "x")
        XCTAssertEqual(e["entryIdx"] as? Int, 0); XCTAssertEqual(e["setIdx"] as? Int, 1); XCTAssertEqual(e["sid"] as? String, "b")
        XCTAssertEqual(e["at"] as? Double, 5); XCTAssertEqual(e["failure"] as? Bool, true)
        XCTAssertEqual(e.count, 9)   // no w, r or done: the id is the set's identity
    }

    func testAnEditSurvivesASnapshotWithoutItAndGoesOnceAcked() {
        let (s1, _) = SetMenu.mark(state(abc), entry: 0, set: 0, .failure, on: true, at: 5, id: "m1")
        let s2 = SessionCore.applySnapshot(s1, snap(workout(abc)))
        XCTAssertEqual(rows(s2)[0].failure, true); XCTAssertEqual(s2.edits?.count, 1)
        let s3 = SessionCore.applySnapshot(s2, snap(workout(abc), acked: ["m1"]))
        XCTAssertNil(rows(s3)[0].failure); XCTAssertNil(s3.edits)
    }

    func testAMarkFollowsItsSetWhereverThePhoneMovedIt() {
        let (s1, _) = SetMenu.mark(state(abc), entry: 0, set: 0, .failure, on: true, at: 5, id: "m1")
        let moved = workout([abc[1], abc[2], abc[0]])   // the phone moved "a" to the end
        XCTAssertEqual(rows(SessionCore.applySnapshot(s1, snap(moved))).map { $0.failure == true }, [false, false, true])
    }

    func testAMarkWithoutAnIdFallsBackToItsPlace() {
        let (s1, ev) = SetMenu.mark(state([row(), row(w: 50)]), entry: 0, set: 1, .failure, on: true, at: 5, id: "m1")
        XCTAssertNil(ev?["sid"])
        let s2 = SessionCore.applySnapshot(s1, snap(workout([row(), row(w: 50)])))
        XCTAssertEqual(rows(s2).map { $0.failure == true }, [false, true])
    }

    func testAWarmupMoveKeepsTheSetsIdAndItsPendingTickFollows() {
        var s0 = state(abc)
        s0.skipped = ["x#2"]
        let (t, _) = SessionCore.tick(s0, entry: 0, set: 1, w: 50, r: 8, at: 4, id: "t1")   // "b" done here
        let (s1, ev) = SetMenu.mark(t, entry: 0, set: 1, .warmup, on: true, at: 5, id: "m1")
        XCTAssertEqual(ev?["warmup"] as? Bool, true)
        XCTAssertEqual(rows(s1).map(\.sid), ["b", "a", "c"]); XCTAssertTrue(rows(s1)[0].warmup)
        XCTAssertEqual(s1.skipped, ["x#2"])
        XCTAssertNotNil(s1.pending["s:b"])
        // the phone has neither yet: the move is replayed, and the tick lands on "b" where it is now
        let s2 = SessionCore.applySnapshot(s1, snap(workout(abc)))
        XCTAssertEqual(rows(s2).map(\.sid), ["b", "a", "c"])
        XCTAssertEqual(rows(s2).map(\.done), [true, false, false])
        // and back: it becomes the first work set, where it is already
        let (b, _) = SetMenu.mark(s2, entry: 0, set: 0, .warmup, on: false, at: 6, id: "m2")
        XCTAssertEqual(rows(b).map(\.sid), ["b", "a", "c"]); XCTAssertFalse(rows(b)[0].warmup)
    }

    func testAWarmupMoveRemapsSkippedAndEfforts() {
        var s0 = state(abc)
        s0.skipped = ["x#0"]
        s0.efforts = ["x#0": 8]
        let (s, _) = SetMenu.mark(s0, entry: 0, set: 2, .warmup, on: true, at: 5, id: "m1")   // "c" to the top
        XCTAssertEqual(rows(s).map(\.sid), ["c", "a", "b"])
        XCTAssertEqual(s.skipped, ["x#1"]); XCTAssertEqual(s.efforts, ["x#1": 8])
    }

    func testAWarmupMoveRemapsAPendingTickKeyedByPlace() {
        let (t, _) = SessionCore.tick(state([row(), row(w: 50), row(w: 70)]), entry: 0, set: 1, w: 50, r: 8, at: 4, id: "t1")   // no ids: keyed "e0:x#1"
        XCTAssertNotNil(t.pending["e0:x#1"])
        let (s, _) = SetMenu.mark(t, entry: 0, set: 2, .warmup, on: true, at: 5, id: "m1")   // the third row to the top
        XCTAssertEqual(rows(s).map(\.w), [70, 60, 50])
        XCTAssertNil(s.pending["e0:x#1"]); XCTAssertNotNil(s.pending["e0:x#2"])
    }

    func testWarmupOffGoesToTheEdgeOfTheWarmups() {
        let s0 = state([row(warmup: true), SetRow(w: 30, r: 5, sec: nil, done: false, warmup: true, at: nil), row()])
        let (s, _) = SetMenu.mark(s0, entry: 0, set: 0, .warmup, on: false, at: 5, id: "m1")
        XCTAssertEqual(rows(s).map(\.w), [30, 60, 60]); XCTAssertEqual(rows(s).map(\.warmup), [true, false, false])
    }

    func testWarmupClearsFailureAndDrop() {
        var f = row(sid: "a"); f.failure = true
        let (s, _) = SetMenu.mark(state([f, row()]), entry: 0, set: 0, .warmup, on: true, at: 5, id: "m1")
        XCTAssertTrue(rows(s)[0].warmup); XCTAssertNil(rows(s)[0].failure); XCTAssertNil(rows(s)[0].drop); XCTAssertNil(rows(s)[0].drops)
        XCTAssertEqual(rows(s)[0].sid, "a")
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

    func testAddAppendsACopyOfTheLastSetWithAnIdOfItsOwn() throws {
        var last = SetRow(w: 70, r: 6, sec: nil, done: true, warmup: false, at: 3, sid: "c"); last.failure = true
        let (s, ev) = SetMenu.addSet(state([row(done: true, sid: "a"), last]), entry: 0, at: 5, id: "a1")
        XCTAssertEqual(rows(s).count, 3)
        let n = rows(s)[2]
        let sid = try XCTUnwrap(n.sid)
        XCTAssertTrue(sid.hasPrefix("w-")); XCTAssertLessThanOrEqual(sid.count, 40)   // the phone's sidOk
        XCTAssertEqual(n, SetRow(w: 70, r: 6, sec: nil, done: false, warmup: false, at: nil, sid: sid))
        let e = try XCTUnwrap(ev)
        XCTAssertEqual(e["type"] as? String, "addSet"); XCTAssertEqual(e["sid"] as? String, sid)
        XCTAssertEqual(e["w"] as? Double, 70); XCTAssertEqual(e["r"] as? Double, 6)
        XCTAssertNil(e["setIdx"]); XCTAssertNil(e["after"])   // at the end of the exercise
    }

    func testATickOnAWatchAddedSetIsKeyedByItsIdAndLands() {
        let (s1, ev) = SetMenu.addSet(state(abc), entry: 0, at: 5, id: "a1", sid: "w-new")
        XCTAssertEqual(ev?["sid"] as? String, "w-new")
        let (s2, _) = SessionCore.tick(s1, entry: 0, set: 3, w: 70, r: 8, at: 6, id: "t1")
        XCTAssertNotNil(s2.pending["s:w-new"])
        let s3 = SessionCore.applySnapshot(s2, snap(workout(abc)))   // the phone has neither yet
        XCTAssertEqual(rows(s3).map(\.sid), ["a", "b", "c", "w-new"])
        XCTAssertEqual(rows(s3).map(\.done), [false, false, false, true])
        // the phone added it (once) and has the tick
        var there = abc; var added = row(done: true, sid: "w-new", w: 70); added.at = 7; there.append(added)
        let s4 = SessionCore.applySnapshot(s3, snap(workout(there), acked: ["a1", "t1"]))
        XCTAssertEqual(rows(s4).count, 4); XCTAssertNil(s4.edits); XCTAssertTrue(s4.pending.isEmpty)
    }

    func testAHeldRemovalIsReplayedAndUndoPutsTheSetBack() throws {
        var s0 = state(abc)
        s0.skipped = ["x#2"]
        let s1 = try XCTUnwrap(SetMenu.removeSet(s0, entry: 0, set: 1, at: 5, id: "r1"))
        XCTAssertEqual(rows(s1).map(\.sid), ["a", "c"]); XCTAssertEqual(s1.skipped, ["x#1"])
        XCTAssertEqual(SetMenu.held(s1), ["r1"])
        // a snapshot meanwhile does not bring it back, nor end the Undo
        let s2 = SessionCore.applySnapshot(s1, snap(workout(abc)))
        XCTAssertEqual(rows(s2).map(\.sid), ["a", "c"]); XCTAssertEqual(SetMenu.held(s2), ["r1"])
        // Undo: the set in its place, nothing to send
        let u = SetMenu.undo(s2, id: "r1")
        XCTAssertEqual(rows(u).map(\.sid), ["a", "b", "c"]); XCTAssertNil(u.edits); XCTAssertEqual(u.skipped, ["x#2"])
        // or its time is over: it goes out, by the set's id, and stays until acked
        let (s3, ev) = SetMenu.release(s2, id: "r1")
        XCTAssertEqual(ev?["type"] as? String, "removeSet"); XCTAssertEqual(ev?["sid"] as? String, "b"); XCTAssertEqual(ev?["setIdx"] as? Int, 1)
        XCTAssertEqual(SetMenu.held(s3), []); XCTAssertNil(s3.edits?.first?.row)
        XCTAssertEqual(rows(SessionCore.applySnapshot(s3, snap(workout(abc)))).map(\.sid), ["a", "c"])
        XCTAssertNil(SetMenu.release(s3, id: "r1").1)   // once
    }

    func testARemovalThePhoneRefusedComesBack() throws {
        let s1 = try XCTUnwrap(SetMenu.removeSet(state(abc), entry: 0, set: 1, at: 5, id: "r1"))
        let (s2, _) = SetMenu.release(s1, id: "r1")
        // the phone ticked "b" meanwhile: it is not taken out there, nor here
        var there = abc; there[1].done = true; there[1].at = 6
        XCTAssertEqual(rows(SessionCore.applySnapshot(s2, snap(workout(there)))).map(\.sid), ["a", "b", "c"])
    }

    func testRefusedEditsDoNothing() {
        let s0 = state([row(warmup: true), row()])
        let (s, ev) = SetMenu.mark(s0, entry: 0, set: 1, .warmup, on: true, at: 5, id: "m1")
        XCTAssertNil(ev); XCTAssertEqual(s, s0)
        XCTAssertNil(SetMenu.removeSet(state([row(sid: "a")]), entry: 0, set: 0, at: 5, id: "r1"))
        XCTAssertNil(SetMenu.removeSet(state([row(done: true, sid: "a"), row(sid: "b")]), entry: 0, set: 0, at: 5, id: "r1"))
        XCTAssertNil(SetMenu.mark(state([row(), row()]), entry: 0, set: 0, .failure, on: false, at: 5, id: "m2").1)
    }

    func testATimedPerSidePairIsOneSet() {
        func half(_ side: String) -> SetRow { var r = SetRow(w: nil, r: nil, sec: 30, done: false, warmup: false, at: nil, sid: side); r.side = side; return r }
        var s0 = state([half("L"), half("R")])
        s0.workout!.entries[0].mode = "time"
        let o = SetMenu.offer(s0.workout!.entries[0], set: 1)
        XCTAssertFalse(o.canAdd); XCTAssertFalse(o.canRemove)
        let (s, ev) = SetMenu.mark(s0, entry: 0, set: 1, .failure, on: true, at: 5, id: "m1")
        XCTAssertNotNil(ev)
        XCTAssertEqual(rows(s).map(\.failure), [true, true])
    }

    func testAnEditOnTheSecondCopyOfAnExerciseStaysThere() {
        var s0 = state([row(sid: "a"), row(sid: "b")])
        s0.workout!.entries.append(entry([row(sid: "c"), row(sid: "d")]))   // the same exercise again (a combined routine)
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

    func testEditsSurviveARelaunch() throws {
        let s1 = try XCTUnwrap(SetMenu.removeSet(state(abc), entry: 0, set: 1, at: 5, id: "r1"))
        let back = try JSONDecoder().decode(SessionState.self, from: JSONEncoder().encode(s1))
        XCTAssertEqual(back, s1); XCTAssertEqual(SetMenu.held(back), ["r1"])
    }
}

final class UndoWindowTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1000)

    func testDueAfterFourSecondsNotBefore() {
        var u = UndoWindow(); u.begin("a", at: t0)
        XCTAssertNil(u.due(at: t0.addingTimeInterval(3.9)))
        XCTAssertEqual(u.due(at: t0.addingTimeInterval(4)), "a")
    }
    func testUndoCancels() {
        var u = UndoWindow(); u.begin("a", at: t0); u.undo()
        XCTAssertNil(u.due(at: t0.addingTimeInterval(10))); XCTAssertNil(u.flush())
    }
    func testFlushReturnsItOnce() {
        var u = UndoWindow(); u.begin("a", at: t0)
        XCTAssertEqual(u.flush(), "a"); XCTAssertNil(u.flush()); XCTAssertNil(u.due(at: t0.addingTimeInterval(10)))
    }
}
