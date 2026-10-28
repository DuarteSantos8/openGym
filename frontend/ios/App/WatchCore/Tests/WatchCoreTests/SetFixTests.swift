import XCTest
@testable import WatchCore

/// A logged set opened again and fixed: the same setDone sent once more, later, nothing new in the format.
final class SetFixTests: XCTestCase {
    func row(_ w: Double, _ r: Double, done: Bool = true, at: Double? = 1000) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: false, at: at)
    }

    func state(_ entries: [Entry]) -> SessionState {
        var s = SessionState()
        s.workout = ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: entries)
        return s
    }

    func bench(_ sets: [SetRow]) -> Entry { Entry(id: "0025", name: "Bench Press", mode: "reps", restSec: nil, last: nil, sets: sets) }

    /// Every key a setDone has ever had (watch-sync.js): a fix adds none.
    static let setDoneKeys: Set<String> = ["id", "type", "wid", "exId", "entryIdx", "setIdx", "at", "w", "r", "sec", "side", "hr", "rpe", "rir"]

    func testOnlyALoggedSetOpensAndWithItsNumbersAsLogged() {
        let s = state([bench([row(60, 8), row(62.5, 8, done: false, at: nil)]),
                       Entry(id: "run", name: "Run", mode: "cardio", restSec: nil, last: nil, sets: [row(0, 0)])])
        XCTAssertNil(SetFix.open(s, entry: 0, set: 1), "a set not done is not a fix: Done logs it")
        XCTAssertNil(SetFix.open(s, entry: 1, set: 0), "cardio has no numbers on the watch")
        XCTAssertNil(SetFix.open(s, entry: 0, set: 9))
        let f = SetFix.open(s, entry: 0, set: 0)
        XCTAssertEqual(f?.value(.weight), 60)
        XCTAssertEqual(f?.value(.reps), 8)
        XCTAssertNil(f?.side)
        XCTAssertEqual(f?.key, "0025#0")
        XCTAssertNil(f?.effort, "the watch does not know an effort it did not send")
    }

    func testSavingResendsTheSameSetDoneLaterAndOnlyWhenSomethingChanged() {
        let s = state([bench([row(60, 8, at: 5000), row(60, 8, done: false, at: nil)])])
        var f = SetFix.open(s, entry: 0, set: 0)!
        let (same, none) = f.save(s, at: 9000, id: { "e1" }, effort: nil)
        XCTAssertTrue(none.isEmpty, "Save with nothing changed sends nothing")
        XCTAssertEqual(same, s)
        f.set(.reps, 7)
        // the watch's clock behind the set's own time: the resend is still the later one
        let (next, events) = f.save(s, at: 3000, id: { "e2" }, effort: nil)
        XCTAssertEqual(events.count, 1)
        let e = events[0]
        XCTAssertEqual(e["type"] as? String, "setDone")
        XCTAssertEqual(e["id"] as? String, "e2")
        XCTAssertEqual(e["wid"] as? String, "w1")
        XCTAssertEqual(e["exId"] as? String, "0025")
        XCTAssertEqual(e["entryIdx"] as? Int, 0)
        XCTAssertEqual(e["setIdx"] as? Int, 0)
        XCTAssertGreaterThan(e["at"] as! Double, 5000)
        XCTAssertEqual(e["w"] as? Double, 60)
        XCTAssertEqual(e["r"] as? Double, 7)
        XCTAssertNil(e["hr"], "no heart rate: the phone keeps the set's own")
        XCTAssertNil(e["rpe"]); XCTAssertNil(e["rir"]); XCTAssertNil(e["side"])
        XCTAssertTrue(Set(e.keys).isSubset(of: SetFixTests.setDoneKeys))
        XCTAssertEqual(next.workout?.entries[0].sets[0].r, 7)
        XCTAssertEqual(next.workout?.entries[0].sets[0].done, true)
        XCTAssertNotNil(next.pending["0025#0"], "kept against an older snapshot, as any tick")
        XCTAssertEqual(next.entryIndex, s.entryIndex, "a fix moves nothing")
        // a snapshot from before the phone had the fix does not take it back
        var old = next.workout!
        old.entries[0].sets[0] = row(60, 8, at: 5000)
        let after = SessionCore.applySnapshot(next, Snapshot(v: 1, unit: "kg", restSec: 90, active: old, ready: nil, settings: nil))
        XCTAssertEqual(after.workout?.entries[0].sets[0].r, 7)
    }

    func testTheEffortTheWatchSentComesBackAndGoesOutAgain() {
        var s = state([bench([row(60, 8, done: false, at: nil)])])
        s = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1000, id: "t", effort: Effort.Rating(kind: "rpe", value: 8)).0
        var f = SetFix.open(s, entry: 0, set: 0)!
        XCTAssertEqual(f.effort, 8)
        XCTAssertEqual(f.wasEffort, 8)
        f.set(.weight, 62.5)
        XCTAssertEqual(f.save(s, at: 2000, id: { "e" }, effort: "rpe").1.first?["rpe"] as? Double, 8, "kept, not dropped")
        f.effort = 9
        let (next, events) = f.save(s, at: 2000, id: { "e" }, effort: "rpe")
        XCTAssertEqual(events.first?["rpe"] as? Double, 9)
        XCTAssertEqual(SetFix.open(next, entry: 0, set: 0)?.effort, 9)
        // another workout forgets them
        let other = SessionCore.applySnapshot(next, Snapshot(v: 1, unit: "kg", restSec: 90,
            active: ActiveWorkout(id: "w2", name: "Pull", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: [bench([row(60, 8)])]), ready: nil, settings: nil))
        XCTAssertNil(other.rated)
    }

    func testAHoldSendsItsSecondsAndNotItsWeight() {
        let plank = Entry(id: "plank", name: "Plank", mode: "time", restSec: nil, last: nil,
                          sets: [SetRow(w: 10, r: nil, sec: 45, done: true, warmup: false, at: 1000)])
        let s = state([plank])
        var f = SetFix.open(s, entry: 0, set: 0)!
        XCTAssertEqual(f.value(.seconds), 45)
        f.set(.seconds, 52)
        let e = f.save(s, at: 2000, id: { "e" }, effort: nil).1[0]
        XCTAssertEqual(e["sec"] as? Double, 52)
        XCTAssertNil(e["w"], "a weighted hold keeps its weight on the phone")
        XCTAssertNil(e["r"])
    }

    func testAPerSideSetFixesEachSideByItself() {
        let one = SideRow(w: 20, r: 8, done: true)
        var set = row(20, 16)
        set.sides = Sides(L: one, R: one)
        let s = state([Entry(id: "split", name: "Split Squat", mode: "reps", restSec: nil, last: nil, sets: [set], perSide: true)])
        var f = SetFix.open(s, entry: 0, set: 0)!
        XCTAssertEqual(f.side, "L")
        XCTAssertEqual(f.key, "split#0#L")
        f.side = "R"
        f.set(.reps, 7)
        XCTAssertEqual(f.value(.reps), 7)
        f.side = "L"
        XCTAssertEqual(f.value(.reps), 8, "the other side is untouched")
        var n = 0
        let (next, only) = f.save(s, at: 2000, id: { n += 1; return "e\(n)" }, effort: nil)
        XCTAssertEqual(only.count, 1)
        XCTAssertEqual(only[0]["side"] as? String, "R")
        XCTAssertEqual(next.workout?.entries[0].sets[0].sides?.R.r, 7)
        XCTAssertEqual(next.workout?.entries[0].sets[0].r, 15, "the row follows its sides")
        f.set(.weight, 22.5)
        let both = f.save(s, at: 2000, id: { n += 1; return "e\(n)" }, effort: nil).1
        XCTAssertEqual(both.map { $0["side"] as? String }, ["L", "R"])
        XCTAssertNotEqual(both[0]["id"] as? String, both[1]["id"] as? String)
    }

    func testAChangeFromThePhoneSinceItOpenedStopsSave() {
        var s = state([bench([row(60, 8, at: 1000)])])
        var f = SetFix.open(s, entry: 0, set: 0)!
        f.set(.reps, 6)
        XCTAssertTrue(f.still(s))
        s.workout?.entries[0].sets[0] = row(60, 9, at: 1500)        // edited on the phone meanwhile
        XCTAssertFalse(f.still(s))
        XCTAssertTrue(f.save(s, at: 2000, id: { "e" }, effort: nil).1.isEmpty, "the phone's newer numbers are not overwritten")
        s.workout?.entries[0].sets[0] = row(60, 8, done: false, at: nil)  // un-logged there
        XCTAssertFalse(f.still(s))
        s.workout = nil                                                     // finished there
        XCTAssertFalse(f.still(s))
    }
}
