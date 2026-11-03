import XCTest
@testable import WatchCore

/// Every kind of set the phone can send, through the watch's session: holds, bodyweight, per-side,
/// warm-ups, supersets, skipped sets, cardio; and the summary at the end.
final class SetTypesTests: XCTestCase {
    func row(_ w: Double?, _ r: Double?, sec: Double? = nil, done: Bool = false, warmup: Bool = false, at: Double? = nil) -> SetRow {
        SetRow(w: w, r: r, sec: sec, done: done, warmup: warmup, at: at)
    }

    func sideRow(_ w: Double, _ r: Double) -> SetRow {
        var s = row(w, r * 2)
        s.sides = Sides(L: SideRow(w: w, r: r, done: false), R: SideRow(w: w, r: r, done: false))
        return s
    }

    func entry(_ id: String, _ name: String, mode: String = "reps", sets: [SetRow], group: String? = nil) -> Entry {
        Entry(id: id, name: name, mode: mode, restSec: nil, last: nil, sets: sets, group: group)
    }

    func state(_ entries: [Entry], start: Double? = 0) -> SessionState {
        let w = ActiveWorkout(id: "w1", name: "Mixed", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: entries, start: start)
        return SessionCore.applySnapshot(SessionState(), Snapshot(v: 1, unit: "kg", restSec: 90, active: w, ready: nil, settings: nil))
    }

    func testAHoldIsTickedWithItsSeconds() {
        let s0 = state([entry("plank", "Plank", mode: "time", sets: [row(nil, nil, sec: 45), row(nil, nil, sec: 45)])])
        XCTAssertTrue(s0.workout!.entries[0].isTimed)
        let (s, ev) = SessionCore.tick(s0, entry: 0, set: 0, w: nil, r: nil, sec: 38, at: 10, id: "h1")
        XCTAssertEqual(s.workout?.entries[0].sets[0].sec, 38)
        XCTAssertEqual(ev?["sec"] as? Double, 38)
        XCTAssertNil(ev?["w"])
        XCTAssertNil(ev?["r"])
        // an old snapshot keeps the watch's seconds until the phone has them
        let back = SessionCore.applySnapshot(s, Snapshot(v: 1, unit: "kg", restSec: 90, active: s0.workout, ready: nil, settings: nil))
        XCTAssertEqual(back.workout?.entries[0].sets[0].sec, 38)
        XCTAssertEqual(SessionCore.setIndex(back, entry: 0), 1)
    }

    func testBodyweightCountsOnlyTheAddedWeight() {
        var e = entry("pullup", "Pull-up", sets: [row(0, 10), row(5, 8)])
        e.bodyweight = true
        var s = state([e])
        XCTAssertTrue(s.workout!.entries[0].isBodyweight)
        s = SessionCore.tick(s, entry: 0, set: 0, w: 0, r: 10, at: 1, id: "a").0
        s = SessionCore.tick(s, entry: 0, set: 1, w: 5, r: 8, at: 2, id: "b").0
        let sum = SessionCore.summary(s.workout!, end: 60_000)
        XCTAssertEqual(sum.sets, 2)
        XCTAssertEqual(sum.volume, 40)
    }

    func testAPerSideSetIsDoneOneSideAtATime() {
        var e = entry("split", "Split squat", sets: [sideRow(20, 8), sideRow(20, 8)])
        e.perSide = true
        var s = state([e, entry("calf", "Calf raise", sets: [row(40, 12)])])
        XCTAssertEqual(s.workout?.entries[0].sets[0].sideUp, "L")
        let (s1, ev) = SessionCore.tick(s, entry: 0, set: 0, side: "L", w: 20, r: 8, at: 5, id: "l")
        XCTAssertEqual(ev?["side"] as? String, "L")
        XCTAssertFalse(s1.workout!.entries[0].sets[0].done, "one side is not the set")
        XCTAssertEqual(s1.workout?.entries[0].sets[0].sideUp, "R")
        // the other side next, on the same exercise, without a rest between
        let n = SessionCore.next(after: s1, entry: 0, set: 0)
        XCTAssertEqual(n.entry, 0)
        XCTAssertFalse(n.rest)
        s = SessionCore.tick(s1, entry: 0, set: 0, side: "R", w: 20, r: 7, at: 6, id: "r").0
        let row0 = s.workout!.entries[0].sets[0]
        XCTAssertTrue(row0.done)
        XCTAssertEqual(row0.r, 15)
        XCTAssertEqual(SessionCore.setIndex(s, entry: 0), 1)
        // an old snapshot keeps both sides the watch did
        let back = SessionCore.applySnapshot(s, Snapshot(v: 1, unit: "kg", restSec: 90, active: state([e]).workout, ready: nil, settings: nil))
        XCTAssertEqual(back.workout?.entries[0].sets[0].sides?.R.r, 7)
        XCTAssertTrue(back.workout!.entries[0].sets[0].done)
        // and the phone having them confirms them
        var phone = state([e]).workout!
        phone.entries[0].sets[0] = row0
        let confirmed = SessionCore.applySnapshot(back, Snapshot(v: 1, unit: "kg", restSec: 90, active: phone, ready: nil, settings: nil))
        XCTAssertNil(confirmed.pending["split#0#L"])
        XCTAssertNil(confirmed.pending["split#0#R"])
        XCTAssertEqual(SessionCore.summary(s.workout!, end: 1).volume, 300)   // 20×8 + 20×7
    }

    func testWarmUpsAreNotWorkSets() {
        var s = state([entry("bench", "Bench", sets: [row(40, 10, warmup: true), row(60, 8)])])
        XCTAssertEqual(SessionCore.progress(s).total, 1)
        s = SessionCore.tick(s, entry: 0, set: 0, w: 40, r: 10, at: 1, id: "w").0
        XCTAssertEqual(SessionCore.progress(s).done, 0)
        XCTAssertEqual(SessionCore.summary(s.workout!, end: 1).volume, 0)
        XCTAssertEqual(SessionCore.setIndex(s, entry: 0), 1)
    }

    func testASupersetGoesInTurnsAndRestsAfterTheRound() {
        let s0 = state([
            entry("curl", "Curl", sets: [row(12, 10), row(12, 10)], group: "a"),
            entry("push", "Pushdown", sets: [row(20, 12), row(20, 12)], group: "a"),
            entry("raise", "Lateral raise", sets: [row(8, 15)]),
        ])
        var s = SessionCore.tick(s0, entry: 0, set: 0, w: 12, r: 10, at: 1, id: "1").0
        var n = SessionCore.next(after: s, entry: 0, set: 0)
        XCTAssertEqual(n.entry, 1, "on to the partner")
        XCTAssertFalse(n.rest, "no rest inside a round")
        s = SessionCore.tick(s, entry: 1, set: 0, w: 20, r: 12, at: 2, id: "2").0
        n = SessionCore.next(after: s, entry: 1, set: 0)
        XCTAssertEqual(n.entry, 0, "back to the first for the next round")
        XCTAssertTrue(n.rest, "the rest after the round")
        s = SessionCore.tick(s, entry: 0, set: 1, w: 12, r: 10, at: 3, id: "3").0
        s = SessionCore.tick(s, entry: 1, set: 1, w: 20, r: 12, at: 4, id: "4").0
        n = SessionCore.next(after: s, entry: 1, set: 1)
        XCTAssertEqual(n.entry, 2, "the superset done: the next exercise")
        s = SessionCore.tick(s, entry: 2, set: 0, w: 8, r: 15, at: 5, id: "5").0
        XCTAssertEqual(SessionCore.next(after: s, entry: 2, set: 0).entry, 3, "all done: the Finish page")
    }

    func testASkippedSetIsPassedOverNotDone() {
        var s = state([entry("bench", "Bench", sets: [row(60, 8), row(60, 8), row(60, 8)])])
        s = SessionCore.skip(s, entry: 0, set: 0)
        XCTAssertEqual(SessionCore.setIndex(s, entry: 0), 1)
        XCTAssertFalse(s.workout!.entries[0].sets[0].done)
        // picked by hand, it is back
        XCTAssertEqual(SessionCore.setIndex(s, entry: 0, picked: 0), 0)
        // a new workout forgets it
        let other = ActiveWorkout(id: "w2", name: "Other", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: s.workout!.entries)
        let s2 = SessionCore.applySnapshot(s, Snapshot(v: 1, unit: "kg", restSec: 90, active: other, ready: nil, settings: nil))
        XCTAssertNil(s2.skipped)
        XCTAssertEqual(SessionCore.summary(s.workout!, end: 1).sets, 0)
    }

    func testCardioIsTickedWithoutNumbers() {
        let s0 = state([entry("run", "Treadmill", mode: "cardio", sets: [row(nil, nil)])])
        let (s, ev) = SessionCore.tick(s0, entry: 0, set: 0, w: nil, r: nil, at: 1, id: "c")
        XCTAssertTrue(s.workout!.entries[0].sets[0].done)
        XCTAssertNil(ev?["w"])
        XCTAssertNil(ev?["r"])
    }

    func testTheSummaryCountsTimeVolumeAndRecords() {
        var bench = entry("bench", "Bench", sets: [row(40, 10, warmup: true), row(80, 5), row(80, 6)])
        bench.best = BestSet(w: 80, r: 5, sec: nil)
        var row1 = entry("row", "Row", sets: [row(60, 8)])
        row1.best = BestSet(w: 70, r: 8, sec: nil)
        var assist = entry("dip", "Assisted dip", sets: [row(20, 8)])
        assist.best = BestSet(w: 25, r: 8, sec: nil)
        assist.assisted = true
        var plank = entry("plank", "Plank", mode: "time", sets: [row(nil, nil, sec: 60)])
        plank.best = BestSet(w: nil, r: nil, sec: 50)
        let fresh = entry("new", "New thing", sets: [row(100, 1)])
        var s = state([bench, row1, assist, plank, fresh], start: 1_000)
        for (ei, si) in [(0, 0), (0, 1), (0, 2), (1, 0), (2, 0), (3, 0), (4, 0)] {
            let r = s.workout!.entries[ei].sets[si]
            s = SessionCore.tick(s, entry: ei, set: si, w: r.w, r: r.r, sec: r.sec, at: 2, id: "\(ei)\(si)").0
        }
        let sum = SessionCore.summary(s.workout!, end: 1_000 + 45 * 60_000)
        XCTAssertEqual(sum.duration, 45 * 60)
        XCTAssertEqual(sum.sets, 6, "warm-ups are not counted")
        let expected: Double = 400 + 480 + 480 + 160 + 100   // 80×5, 80×6, 60×8, 20×8, 100×1
        XCTAssertEqual(sum.volume, expected)
        XCTAssertEqual(sum.prs, ["Bench", "Assisted dip", "Plank"], "more reps at the best weight, lighter assistance, a longer hold; no history is no PR")
        XCTAssertFalse(sum.endedOnPhone)
    }

    func testAnOlderPhoneWithoutTheNewFieldsStillReads() throws {
        let json = #"{"v":1,"active":{"id":"w","name":"A","unit":"kg","cur":0,"restSec":90,"entries":[{"id":"x","name":"X","mode":"reps","sets":[{"w":1,"r":2,"done":false,"warmup":false}]}]}}"#
        let snap = try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
        XCTAssertNil(snap.active?.start)
        XCTAssertNil(snap.active?.entries[0].group)
        XCTAssertNil(snap.active?.entries[0].sets[0].sides)
        let newer = #"{"v":1,"active":{"id":"w","name":"A","unit":"kg","cur":0,"restSec":90,"start":5,"entries":[{"id":"x","name":"X","mode":"reps","perSide":true,"group":"g","best":{"w":10,"r":5},"sets":[{"w":1,"r":2,"done":false,"warmup":false,"sides":{"L":{"w":1,"r":1,"done":true},"R":{"w":1,"r":1,"done":false}}}]}]}}"#
        let snap2 = try JSONDecoder().decode(Snapshot.self, from: Data(newer.utf8))
        XCTAssertEqual(snap2.active?.entries[0].sets[0].sideUp, "R")
        XCTAssertEqual(snap2.active?.start, 5)
    }

    func testAStateSavedByTheLastBuildStillLoads() throws {
        let saved = #"{"settings":{},"unit":"kg","restSec":90,"finishedHere":[],"pending":{"x#0":{"w":1,"r":2,"at":3}},"entryIndex":0}"#
        let s = try JSONDecoder().decode(SessionState.self, from: Data(saved.utf8))
        XCTAssertNil(s.skipped)
        XCTAssertNil(s.pending["x#0"]?.sec)
    }
}

/// The weigh-in, the app's language and the display choices the phone sends.
final class SettingsAndWeighInTests: XCTestCase {
    func testTheWeighInGoesOutAndRidesOnTheStart() {
        let ev = SessionCore.weighIn(81.44, at: 5, id: "b")
        XCTAssertEqual(ev?["type"] as? String, "weighIn")
        XCTAssertEqual(ev?["w"] as? Double, 81.4)
        XCTAssertNil(SessionCore.weighIn(0, at: 5, id: "x"))
        let ready = ReadySession(routineIds: ["r"], name: "Push", entries: [])
        let (_, start) = SessionCore.start(SessionState(), ready, wid: "watch-1", at: 5, id: "s", bw: 81.44)
        XCTAssertEqual(start["bw"] as? Double, 81.4)
        let (_, noBw) = SessionCore.start(SessionState(), ready, wid: "watch-2", at: 5, id: "s2")
        XCTAssertNil(noBw["bw"])
    }

    func testTheSettingsReadWithAndWithoutTheNewFields() throws {
        let json = #"{"v":1,"settings":{"health":true,"lang":"pt-BR","weighIn":false,"lastBw":80.5,"show":{"clip":false,"elapsed":true,"rest":"plain"}},"active":{"id":"w","name":"A","unit":"kg","cur":0,"restSec":90,"entries":[{"id":"x","name":"X","mode":"reps","step":1.25,"sets":[]}]}}"#
        let snap = try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
        let s = SessionCore.applySnapshot(SessionState(), snap)
        XCTAssertEqual(s.settings.lang, "pt-BR")
        XCTAssertEqual(s.settings.weighIn, false)
        XCTAssertEqual(s.settings.lastBw, 80.5)
        let show = s.settings.show ?? WatchShow()
        XCTAssertFalse(show.showClip)
        XCTAssertTrue(show.showHr)
        XCTAssertTrue(show.showElapsed)
        XCTAssertFalse(show.restRing)
        XCTAssertEqual(s.workout?.entries[0].step, 1.25)
        let old = try JSONDecoder().decode(Snapshot.self, from: Data(#"{"v":1,"settings":{"health":false}}"#.utf8))
        let d = old.settings?.show ?? WatchShow()
        XCTAssertTrue(d.showClip && d.showHr && d.showLast && d.showNext && d.restRing)
        XCTAssertFalse(d.showElapsed || d.showKcal)
        XCTAssertNil(old.settings?.lang)
    }
}

/// Workouts deleted in openGym: the watch takes its own copies out of Apple Health, once.
final class HealthDeleteTests: XCTestCase {
    func testOnlyWorkoutIdsNotDoneYetOnceEach() {
        let todo = SessionCore.healthToDelete(gone: ["opengym-w-a", "opengym-bw-2026-10-01", "opengym-w-b", "opengym-w-a"], done: ["opengym-w-b"])
        XCTAssertEqual(todo, ["opengym-w-a"])
        XCTAssertEqual(SessionCore.healthToDelete(gone: nil, done: []), [])
    }

    func testDoneIsKeptBoundedAndANewRoundIsANoOp() {
        var done: [String] = []
        done = SessionCore.healthDeleted(done, adding: ["opengym-w-a"])
        done = SessionCore.healthDeleted(done, adding: ["opengym-w-a"])
        XCTAssertEqual(done, ["opengym-w-a"])
        XCTAssertEqual(SessionCore.healthToDelete(gone: ["opengym-w-a"], done: done), [])
        let many = (0..<400).map { "opengym-w-\($0)" }
        XCTAssertEqual(SessionCore.healthDeleted([], adding: many).count, 300)
        let ev = SessionCore.healthDeletedEvent(["opengym-w-a"], id: "e")
        XCTAssertEqual(ev?["type"] as? String, "healthDeleted")
        XCTAssertNil(SessionCore.healthDeletedEvent([], id: "e"))
    }

    func testASnapshotWithTheListReads() throws {
        let snap = try JSONDecoder().decode(Snapshot.self, from: Data(#"{"v":1,"healthGone":["opengym-w-x"]}"#.utf8))
        XCTAssertEqual(snap.healthGone, ["opengym-w-x"])
    }
}
