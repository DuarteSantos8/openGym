import XCTest
@testable import WatchCore

/// Protocol 2 on the Apple Watch (docs/WATCH_SYNC.md, "For the native sides"): one rest by its
/// stamp, the clocks' offset, sets named by their id, the rest events, and a phone tick on another
/// exercise moving the watch (#1101). The JS port of the same rules is lib/watch-sim.js.
final class ProtocolTwoTests: XCTestCase {
    func row(_ w: Double, _ r: Double, done: Bool = false, at: Double? = nil, sid: String? = nil) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: false, at: at, sid: sid)
    }

    func entry(_ id: String, _ sets: [SetRow]) -> Entry {
        Entry(id: id, name: id, mode: "reps", restSec: nil, last: nil, sets: sets)
    }

    func workout(_ id: String, _ entries: [Entry], cur: Int = 0, restAt: Double? = nil, rest: RestInfo? = nil,
                 paused: Bool? = nil, left: Double? = nil) -> ActiveWorkout {
        ActiveWorkout(id: id, name: "Push", unit: "kg", cur: cur, restSec: 90, rest: rest, entries: entries,
                      restAt: restAt, restPaused: paused, restLeft: left)
    }

    func snap(_ w: ActiveWorkout?, now: Double? = nil, acked: [String]? = nil) -> Snapshot {
        Snapshot(v: 1, unit: "kg", restSec: 90, active: w, ready: nil, settings: nil, acked: acked, now: now)
    }

    /* ---------- rule 1: the clocks ---------- */

    func testTheOffsetIsTheSmallestRecentGapAndNothingWithoutSamples() {
        XCTAssertEqual(ClockOffset.offset([], now: 1000), 0)
        var s: [ClockSample] = []
        s = ClockOffset.add(s, phoneNow: 10_000, watchNow: 13_500)   // 3.5 s late in transit, or 3.5 s off
        s = ClockOffset.add(s, phoneNow: 20_000, watchNow: 23_000)   // 3 s: the better bound
        s = ClockOffset.add(s, phoneNow: 30_000, watchNow: 34_000)
        XCTAssertEqual(ClockOffset.offset(s, now: 35_000), 3000)
        // a watch 90 s behind the phone
        let behind = ClockOffset.add([], phoneNow: 100_000, watchNow: 10_000)
        XCTAssertEqual(ClockOffset.offset(behind, now: 10_000), -90_000)
    }

    func testOnlyTheLastEightAreKeptAndOldOnesGiveWayToTheNewest() {
        var s: [ClockSample] = []
        for i in 0..<12 { s = ClockOffset.add(s, phoneNow: Double(i) * 1000 + 1, watchNow: Double(i) * 1000 + 1 + Double(100 + i)) }
        XCTAssertEqual(s.count, ClockOffset.keep)
        XCTAssertEqual(s.first?.gap, 104)
        // ten minutes later nothing is recent: the newest stands (a clock set since is followed)
        let later = ClockOffset.add(s, phoneNow: nil, watchNow: 0)
        XCTAssertEqual(later, s, "a snapshot without the phone's clock adds nothing")
        XCTAssertEqual(ClockOffset.offset(s, now: 11_000 + 10 * 60_000), 111)
    }

    func testANonsenseClockAddsNothing() {
        XCTAssertTrue(ClockOffset.add([], phoneNow: .nan, watchNow: 5).isEmpty)
        XCTAssertTrue(ClockOffset.add([], phoneNow: 0, watchNow: 5).isEmpty)
        XCTAssertTrue(ClockOffset.add([], phoneNow: 5, watchNow: .infinity).isEmpty)
    }

    func testTheSnapshotsNewFieldsAreReadAndAnOlderPhoneStillWorks() throws {
        let json = #"{"v":1,"now":1700000000500,"active":{"id":"w","name":"A","unit":"kg","cur":0,"restSec":90,"restAt":1700000000000,"restPaused":true,"restLeft":42,"rest":{"endsAt":1700000090000,"total":90},"entries":[{"id":"x","name":"X","mode":"reps","sets":[{"w":1,"r":2,"done":false,"warmup":false,"sid":"a1"}]}]}}"#
        let s = try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
        XCTAssertEqual(s.now, 1_700_000_000_500)
        XCTAssertEqual(s.active?.restAt, 1_700_000_000_000)
        XCTAssertEqual(s.active?.restPaused, true)
        XCTAssertEqual(s.active?.restLeft, 42, "seconds, as the phone's timer holds them (watch-sync.js buildSnapshot)")
        XCTAssertEqual(s.active?.rest?.total, 90)
        XCTAssertEqual(s.active?.entries[0].sets[0].sid, "a1")
        let old = #"{"v":1,"active":{"id":"w","name":"A","unit":"kg","cur":0,"restSec":90,"entries":[]}}"#
        let o = try JSONDecoder().decode(Snapshot.self, from: Data(old.utf8))
        XCTAssertNil(o.now)
        XCTAssertNil(o.active?.restAt)
    }

    /* ---------- rule 3: following the phone's rest ---------- */

    func testAnOlderPhoneLeavesTheOldRulesInCharge() {
        XCTAssertNil(RestMath.follow(restAt: nil, mine: 0, rest: RestInfo(endsAt: 5000), paused: nil, left: nil, off: 0, current: nil, now: 0))
    }

    func testOnlyAChangeNewerThanTheWatchsOwnIsFollowed() {
        // opening the phone, a late snapshot or a relaunch: the same stamp, nothing restarts
        let same = RestMath.follow(restAt: 100, mine: 100, rest: RestInfo(endsAt: 90_000), paused: nil, left: nil, off: 0, current: 60_000, now: 1000)
        XCTAssertEqual(same?.action, .ignore)
        XCTAssertEqual(same?.restAt, 100)
        let older = RestMath.follow(restAt: 50, mine: 100, rest: nil, paused: nil, left: nil, off: 0, current: 60_000, now: 1000)
        XCTAssertEqual(older?.action, .ignore, "an older Skip never ends a newer rest here")
    }

    func testANewerRestRunsToThePhonesEndOnTheWatchsClock() {
        let f = RestMath.follow(restAt: 200, mine: 100, rest: RestInfo(endsAt: 90_000), paused: nil, left: nil, off: 3000, current: nil, now: 10_000)
        XCTAssertEqual(f?.restAt, 200)
        XCTAssertEqual(f?.action, .run(end: 93_000))
        // the watch's own end already, within 250 ms: the countdown is left alone
        let keep = RestMath.follow(restAt: 200, mine: 100, rest: RestInfo(endsAt: 90_000), paused: nil, left: nil, off: 3000, current: 93_200, now: 10_000)
        XCTAssertEqual(keep?.action, .keep)
        let moved = RestMath.follow(restAt: 200, mine: 100, rest: RestInfo(endsAt: 105_000), paused: nil, left: nil, off: 0, current: 90_000, now: 10_000)
        XCTAssertEqual(moved?.action, .run(end: 105_000), "+15 on the phone moves the watch's rest")
    }

    func testAPauseHoldsAndASkipOrAnEndThatPassedEndsTheRest() {
        // restLeft is seconds (the phone timer's `left`): 42 stays 42, never 0.042
        let pause = RestMath.follow(restAt: 200, mine: 100, rest: nil, paused: true, left: 42, off: 0, current: 90_000, now: 10_000)
        XCTAssertEqual(pause?.action, .pause(left: 42))
        let noLeft = RestMath.follow(restAt: 200, mine: 100, rest: nil, paused: true, left: nil, off: 0, current: 90_000, now: 10_000)
        XCTAssertEqual(noLeft?.action, .pause(left: 0))
        let skip = RestMath.follow(restAt: 200, mine: 100, rest: nil, paused: nil, left: nil, off: 0, current: 90_000, now: 10_000)
        XCTAssertEqual(skip?.action, .end)
        let past = RestMath.follow(restAt: 200, mine: 100, rest: RestInfo(endsAt: 9000), paused: nil, left: nil, off: 0, current: 90_000, now: 10_000)
        XCTAssertEqual(past?.action, .end)
    }

    func testAPausedRestShowsWhatIsLeft() {
        XCTAssertEqual(RestMath.clock(65), "1:05")
        XCTAssertEqual(RestMath.clock(64.2), "1:05", "rounded up, as a countdown")
        XCTAssertEqual(RestMath.clock(0), "0:00")
        XCTAssertEqual(RestMath.clock(-3), "0:00")
        XCTAssertEqual(RestMath.clock(.nan), "0:00")
    }

    /* ---------- rule 2: the stamp is the workout's ---------- */

    func testTheRestStampStartsAfreshWithAnotherWorkoutAndWithNone() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [entry("a", [row(60, 8)])], restAt: 500)))
        s.restAt = 500
        s.restEnd = 99_000
        s = SessionCore.applySnapshot(s, snap(workout("w1", [entry("a", [row(60, 8)])], restAt: 500)))
        XCTAssertEqual(s.restAt, 500, "the same workout keeps it")
        XCTAssertEqual(s.restEnd, 99_000)
        let other = SessionCore.applySnapshot(s, snap(workout("w2", [entry("a", [row(60, 8)])])))
        XCTAssertNil(other.restAt)
        XCTAssertNil(other.restEnd, "the rest before was the other workout's")
        let none = SessionCore.applySnapshot(s, snap(nil))
        XCTAssertNil(none.restAt)
        XCTAssertNil(none.restEnd)
        let finished = SessionCore.finish(s, at: 1, id: "f").0
        XCTAssertNil(finished.restAt)
    }

    /* ---------- rule 4: the watch's own changes ---------- */

    func testADoneCarriesItsRestTheSetsIdAndTheOffset() throws {
        let s = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [entry("a", [row(60, 8, sid: "s1"), row(60, 8, sid: "s2")])])))
        let (t, ev) = SessionCore.tick(s, entry: 0, set: 0, w: 62.5, r: 8, at: 10_000, id: "e1", off: 2000, restEnd: 100_000)
        let event = try XCTUnwrap(ev)
        XCTAssertEqual(event["sid"] as? String, "s1")
        XCTAssertEqual(event["restEnd"] as? Double, 100_000)
        XCTAssertEqual(event["off"] as? Double, 2000)
        XCTAssertEqual(event["at"] as? Double, 10_000, "the event's time is the watch's clock")
        XCTAssertEqual(t.workout?.entries[0].sets[0].at, 8000, "the row keeps the phone's clock, as a snapshot's")
        XCTAssertEqual(t.pending["s:s1"]?.off, 2000)
        // no restEnd asked for: none sent (a correction)
        XCTAssertNil(SessionCore.tick(s, entry: 0, set: 1, w: 1, r: 1, at: 1, id: "e2").1?["restEnd"])
        XCTAssertEqual(SessionCore.tick(s, entry: 0, set: 1, w: 1, r: 1, at: 1, id: "e2", restEnd: 0).1?["restEnd"] as? Double, 0)
    }

    func testPlusFifteenAndSkipAreRestEventsThatStampTheWatchsRest() throws {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [entry("a", [row(60, 8)])])))
        s.restAt = 1000
        let (moved, ev) = try XCTUnwrap(SessionCore.rest(s, endsAt: 120_000, at: 50_000, off: 3000, id: "r1"))
        XCTAssertEqual(ev["type"] as? String, "rest")
        XCTAssertEqual(ev["wid"] as? String, "w1")
        XCTAssertEqual(ev["endsAt"] as? Double, 120_000)
        XCTAssertEqual(ev["at"] as? Double, 50_000)
        XCTAssertEqual(ev["off"] as? Double, 3000)
        XCTAssertEqual(moved.restAt, 47_000, "the moment, on the phone's clock")
        let (_, skip) = try XCTUnwrap(SessionCore.rest(moved, endsAt: nil, at: 60_000, off: 3000, id: "r2"))
        XCTAssertTrue(skip["endsAt"] is NSNull, "a Skip sends null")
        XCTAssertTrue(JSONSerialization.isValidJSONObject(skip))
        XCTAssertNil(SessionCore.rest(SessionState(), endsAt: nil, at: 1, off: 0, id: "x"), "no workout, no event")
        // the phone's echo of it, stamped at the same moment, is not newer: nothing moves back
        XCTAssertEqual(RestMath.follow(restAt: 47_000, mine: moved.restAt ?? 0, rest: RestInfo(endsAt: 117_000), paused: nil, left: nil,
                                       off: 3000, current: 120_000, now: 50_000)?.action, .ignore)
    }

    func testAFixOfADoneSetIsLaterThanItOnThePhonesClockAndStartsNoRest() throws {
        let e = entry("b", [row(60, 8, done: true, at: 5000, sid: "s1")])
        let s = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [e])))
        // the watch 2 s ahead: the phone's 5000 is the watch's 7000
        let (_, ev) = SetFix.correct(s, entry: 0, set: 0, side: nil, to: .init(w: 62.5, r: 8, sec: nil), now: 6000, id: "fix", off: 2000)
        let event = try XCTUnwrap(ev)
        XCTAssertEqual(event["at"] as? Double, 7001)
        XCTAssertNil(event["restEnd"])
        XCTAssertEqual(event["sid"] as? String, "s1")
    }

    /* ---------- rule 5: sets by their id ---------- */

    func testAPendingTickFollowsItsSetWhenARowIsAddedBeforeIt() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [entry("a", [row(60, 8, sid: "s1"), row(60, 8, sid: "s2")])])))
        s = SessionCore.tick(s, entry: 0, set: 1, w: 70, r: 5, at: 10_000, id: "e1").0
        // the phone put a warm-up in front: s2 is the third row now, and has not got the tick yet
        let shifted = workout("w1", [entry("a", [row(40, 10, sid: "w0"), row(60, 8, sid: "s1"), row(60, 8, sid: "s2")])])
        s = SessionCore.applySnapshot(s, snap(shifted))
        let sets = s.workout!.entries[0].sets
        XCTAssertFalse(sets[1].done, "the tick never lands on another set's place")
        XCTAssertTrue(sets[2].done)
        XCTAssertEqual(sets[2].w, 70)
        XCTAssertNotNil(s.pending["s:s2"])
    }

    func testTheSameExerciseTwiceKeepsItsTicksApart() {
        let a = entry("a", [row(60, 8), row(60, 8)])
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [a, entry("b", [row(20, 10)]), a])))
        s = SessionCore.tick(s, entry: 2, set: 0, w: 50, r: 10, at: 10_000, id: "e1").0
        s = SessionCore.applySnapshot(s, snap(workout("w1", [a, entry("b", [row(20, 10)]), a])))
        XCTAssertFalse(s.workout!.entries[0].sets[0].done, "the first copy is untouched")
        XCTAssertTrue(s.workout!.entries[2].sets[0].done)
        XCTAssertNotNil(s.pending["e2:a#0"])
    }

    func testATickIsDroppedOnceThePhoneShowsItOnItsOwnClock() {
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [entry("a", [row(60, 8, sid: "s1")])])))
        // the watch 3 s ahead of the phone
        s = SessionCore.tick(s, entry: 0, set: 0, w: 62.5, r: 8, at: 13_000, id: "e1", off: 3000).0
        // the phone applied it at its 10_000: confirmed, not a newer change
        let applied = SessionCore.applySnapshot(s, snap(workout("w1", [entry("a", [row(62.5, 8, done: true, at: 10_000, sid: "s1")])])))
        XCTAssertTrue(applied.pending.isEmpty)
        // an older phone change (9_000 there) does not undo the tick
        let older = SessionCore.applySnapshot(s, snap(workout("w1", [entry("a", [row(55, 5, done: true, at: 9000, sid: "s1")])])))
        XCTAssertEqual(older.workout?.entries[0].sets[0].w, 62.5)
        XCTAssertEqual(older.workout?.entries[0].sets[0].at, 10_000)
        XCTAssertNotNil(older.pending["s:s1"])
    }

    func testATickSavedByTheLastBuildStillCounts() throws {
        let saved = #"{"settings":{},"unit":"kg","restSec":90,"finishedHere":[],"pending":{"a#0":{"w":70,"r":5,"at":3000}},"entryIndex":0,"workout":{"id":"w1","name":"P","unit":"kg","cur":0,"restSec":90,"entries":[{"id":"a","name":"a","mode":"reps","sets":[{"w":60,"r":8,"done":false,"warmup":false}]}]}}"#
        var s = try JSONDecoder().decode(SessionState.self, from: Data(saved.utf8))
        s = SessionCore.applySnapshot(s, snap(workout("w1", [entry("a", [row(60, 8, sid: "s1")])])))
        XCTAssertTrue(s.workout!.entries[0].sets[0].done)
        XCTAssertEqual(s.workout!.entries[0].sets[0].w, 70)
        // ticked again here: one pending tick for the set, under its id
        s = SessionCore.tick(s, entry: 0, set: 0, w: 72.5, r: 5, at: 4000, id: "e2").0
        XCTAssertEqual(Array(s.pending.keys), ["s:s1"])
    }

    func testPerSideTicksKeepTheirSideInTheKey() {
        var r = row(20, 16, sid: "p1")
        r.sides = Sides(L: SideRow(w: 20, r: 8, done: false), R: SideRow(w: 20, r: 8, done: false))
        var s = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [entry("a", [r])])))
        s = SessionCore.tick(s, entry: 0, set: 0, side: "L", w: 20, r: 8, at: 1000, id: "l").0
        XCTAssertNotNil(s.pending["s:p1#L"])
        s = SessionCore.applySnapshot(s, snap(workout("w1", [entry("a", [r])])))
        XCTAssertEqual(s.workout!.entries[0].sets[0].sides?.L.done, true)
        XCTAssertEqual(s.workout!.entries[0].sets[0].sides?.R.done, false)
    }

    func testAPhoneTickNamesTheSetsId() {
        let before = workout("w1", [entry("a", [row(60, 8, sid: "s1")])])
        let after = workout("w1", [entry("a", [row(60, 8, done: true, at: 5, sid: "s1")])])
        XCTAssertEqual(SessionCore.phoneTicks(before, after).first?.sid, "s1")
    }

    /* ---------- #1101: a phone tick on any exercise moves the watch ---------- */

    func testAPhoneTickOnAnotherExerciseMovesTheWatchThere() {
        let squat = entry("sq", [row(100, 5), row(100, 5)])
        let bench = entry("be", [row(60, 8), row(60, 8)])
        func done(_ e: Entry, _ n: Int) -> Entry {
            var e = e
            for i in 0..<n { e.sets[i].done = true; e.sets[i].at = Double(i + 1) }
            return e
        }
        // the watch shows the squat; the phone ticked bench set 1: the watch goes to the bench
        let a = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [squat, done(bench, 1)])))
        XCTAssertEqual(SessionCore.followTick(a, entry: 1, set: 0), 1)
        // the phone ticked squat set 1, set 2 is open: the watch stays
        let b = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [done(squat, 1), bench])))
        XCTAssertNil(SessionCore.followTick(b, entry: 0, set: 0))
        // the squat's last set while the phone stays on it: on to the bench, not "All sets done"
        let c = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [done(squat, 2), bench])))
        XCTAssertEqual(SessionCore.followTick(c, entry: 0, set: 1), 1)
        // the very last set: the Overview's Finish, not a page past the end
        let d = SessionCore.applySnapshot(SessionState(), snap(workout("w1", [done(squat, 2), done(bench, 2)], cur: 1)))
        XCTAssertNil(SessionCore.followTick(d, entry: 1, set: 1))
    }
}
