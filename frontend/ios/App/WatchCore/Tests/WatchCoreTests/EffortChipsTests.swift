import XCTest
@testable import WatchCore

/// Rating a set from the rest: the four chips, the target they rate, and the setDone they re-send.
final class EffortChipsTests: XCTestCase {
    func row(_ w: Double? = 60, _ r: Double? = 8, done: Bool = true, at: Double? = 1000, warmup: Bool = false) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: warmup, at: at)
    }

    func entry(_ id: String, _ sets: [SetRow], mode: String = "reps", group: String? = nil, restSec: Double? = nil,
               unit: String? = nil, perSide: Bool = false) -> Entry {
        Entry(id: id, name: id, mode: mode, restSec: restSec, last: nil, sets: sets, perSide: perSide ? true : nil, group: group, unit: unit)
    }

    func state(_ entries: [Entry], restSec: Double = 90, unit: String = "kg") -> SessionState {
        var s = SessionState()
        s.workout = ActiveWorkout(id: "w1", name: "Push", unit: unit, cur: 0, restSec: restSec, rest: nil, entries: entries)
        return s
    }

    func sided(_ l: Bool, _ r: Bool, at: Double? = 1000) -> SetRow {
        var x = SetRow(w: 20, r: 16, sec: nil, done: l && r, warmup: false, at: at,
                       sides: Sides(L: SideRow(w: 20, r: 8, done: l), R: SideRow(w: 22.5, r: 7, done: r)))
        x.done = l && r
        return x
    }

    // MARK: the chips

    func testTheChipsRunHardestFirstOnTheProfilesScale() {
        XCTAssertEqual(Effort.chips("rir"), [0, 1, 2, 3])
        XCTAssertEqual(Effort.chips("rpe"), [10, 9, 8, 7])
        XCTAssertNil(Effort.chips("x"))
    }

    func testEveryChipIsAValueThePhoneAccepts() {
        for (kind, lo, hi) in [("rir", 0.0, 10.0), ("rpe", 1.0, 10.0)] {
            for v in Effort.chips(kind)! {
                XCTAssertTrue(v >= lo && v <= hi, "\(kind) \(v)")
                XCTAssertEqual(v * 2, (v * 2).rounded(), "on the 0.5 grid")
            }
        }
    }

    func testTheChipsSitInTheFourBandsOfBothScales() {
        let bands = (0..<4).map { Effort.band("rir", Effort.chips("rir")![$0]) }
        XCTAssertEqual(bands, (0..<4).map { Effort.band("rpe", Effort.chips("rpe")![$0]) })
        XCTAssertEqual(Set(bands).count, 4)
    }

    func testLabelsKeepThePlusAndTheLessThanOnTheirSideInRightToLeft() {
        XCTAssertEqual((0..<4).map { Effort.chipLabel("rir", $0) }, ["0", "1", "2", "\u{200E}3+"])
        XCTAssertEqual((0..<4).map { Effort.chipLabel("rpe", $0) }, ["10", "9", "8", "\u{200E}≤7"])
    }

    func testEachChipHasThePhonesSentence() {
        XCTAssertEqual((0..<4).map(Effort.feel), ["Nothing left, went to failure", "One more rep in the tank", "Two more reps", "Three more reps"])
    }

    // MARK: the target

    func testOnlyASetDoneHereWithATickCanBeRated() {
        let ok = state([entry("a", [row(), row(done: false, at: nil)])])
        XCTAssertNotNil(Effort.target(ok, entry: 0, set: 0, kind: "rir"))
        XCTAssertNil(Effort.target(ok, entry: 0, set: 0, kind: nil), "no scale")
        XCTAssertNil(Effort.target(ok, entry: 0, set: 0, kind: "x"), "a scale we do not know")
        XCTAssertNil(Effort.target(ok, entry: 0, set: 1, kind: "rir"), "not done")
        XCTAssertNil(Effort.target(ok, entry: 0, set: 5, kind: "rir"), "no such set")
        XCTAssertNil(Effort.target(ok, entry: 3, set: 0, kind: "rir"), "no such exercise")
        XCTAssertNil(Effort.target(state([entry("a", [row()], mode: "cardio")]), entry: 0, set: 0, kind: "rir"))
        XCTAssertNil(Effort.target(state([entry("a", [row(warmup: true)])]), entry: 0, set: 0, kind: "rir"))
        XCTAssertNil(Effort.target(state([entry("a", [row(at: nil)])]), entry: 0, set: 0, kind: "rir"), "no tick time")
        XCTAssertNil(Effort.target(state([entry("a", [sided(true, false)], perSide: true)]), entry: 0, set: 0, kind: "rir"), "one side only")
        XCTAssertNotNil(Effort.target(state([entry("a", [sided(true, true)], perSide: true)]), entry: 0, set: 0, kind: "rir"))
    }

    func testTheTargetIsTheSetAndItsOwnTick() {
        let t = Effort.target(state([entry("a", [row()]), entry("b", [row(), row(at: 4321)])]), entry: 1, set: 1, kind: "rpe")
        XCTAssertEqual(t, Effort.Target(wid: "w1", exId: "b", entryIdx: 1, setIdx: 1, at: 4321, sent: 0, value: nil))
    }

    // MARK: the events

    func ids() -> () -> String { var n = 0; return { n += 1; return "e\(n)" } }

    func testAPlainSetIsReSentWithItsOwnNumbersAndALaterTick() throws {
        let s = state([entry("a", [row(62.5, 6)])])
        let t = Effort.target(s, entry: 0, set: 0, kind: "rir")!
        let (next, events) = Effort.rate(t, 1, kind: "rir", in: s, id: ids())
        XCTAssertEqual(events.count, 1)
        let e = events[0]
        XCTAssertEqual(e["type"] as? String, "setDone")
        XCTAssertEqual(e["wid"] as? String, "w1")
        XCTAssertEqual(e["exId"] as? String, "a")
        XCTAssertEqual(e["entryIdx"] as? Int, 0)
        XCTAssertEqual(e["setIdx"] as? Int, 0)
        XCTAssertEqual(e["w"] as? Double, 62.5)
        XCTAssertEqual(e["r"] as? Double, 6)
        XCTAssertEqual(e["at"] as? Double, 1001)
        XCTAssertEqual(e["rir"] as? Double, 1)
        XCTAssertNil(e["rpe"], "one scale only")
        XCTAssertNil(e["hr"]); XCTAssertNil(e["side"]); XCTAssertNil(e["sec"])
        XCTAssertEqual(next.value, 1)
        XCTAssertEqual(next.sent, 1)
        let (_, rpe) = Effort.rate(Effort.target(s, entry: 0, set: 0, kind: "rpe")!, 8, kind: "rpe", in: s, id: ids())
        XCTAssertEqual(rpe[0]["rpe"] as? Double, 8)
        XCTAssertNil(rpe[0]["rir"])
    }

    func testAChangedMindIsLaterAgainAndTheSameChipIsNothing() {
        let s = state([entry("a", [row()])])
        let (t1, _) = Effort.rate(Effort.target(s, entry: 0, set: 0, kind: "rir")!, 2, kind: "rir", in: s, id: ids())
        let (t2, again) = Effort.rate(t1, 2, kind: "rir", in: s, id: ids())
        XCTAssertEqual(again.count, 0, "no duplicate")
        XCTAssertEqual(t2, t1)
        let (t3, other) = Effort.rate(t1, 0, kind: "rir", in: s, id: ids())
        XCTAssertEqual(other[0]["at"] as? Double, 1002)
        XCTAssertEqual(other[0]["rir"] as? Double, 0, "zero is a rating, not a clear")
        XCTAssertEqual(t3.value, 0)
    }

    func testOnlyAChipValueIsSent() {
        let s = state([entry("a", [row()])])
        let t = Effort.target(s, entry: 0, set: 0, kind: "rpe")!
        for v in [8.5, 4, 6.5, 11, -1] {
            let (next, events) = Effort.rate(t, v, kind: "rpe", in: s, id: ids())
            XCTAssertTrue(events.isEmpty, "\(v)")
            XCTAssertEqual(next, t)
        }
        XCTAssertTrue(Effort.rate(t, 8, kind: "x", in: s, id: ids()).1.isEmpty)
    }

    func testAPerSideSetRatesBothSidesEachWithItsOwnNumbers() {
        let s = state([entry("a", [sided(true, true)], perSide: true)])
        let t = Effort.target(s, entry: 0, set: 0, kind: "rir")!
        let (t1, ev) = Effort.rate(t, 2, kind: "rir", in: s, id: ids())
        XCTAssertEqual(ev.map { $0["side"] as? String }, ["L", "R"])
        XCTAssertEqual(ev.map { $0["w"] as? Double }, [20, 22.5])
        XCTAssertEqual(ev.map { $0["r"] as? Double }, [8, 7])
        XCTAssertEqual(ev.map { $0["at"] as? Double }, [1001, 1002])
        XCTAssertEqual(ev.map { $0["rir"] as? Double }, [2, 2])
        XCTAssertEqual(t1.sent, 2)
        let (_, next) = Effort.rate(t1, 1, kind: "rir", in: s, id: ids())
        XCTAssertEqual(next.map { $0["at"] as? Double }, [1003, 1004])
    }

    func testAHoldKeepsItsSecondsABodyweightSetItsZeroAndAnOwnUnitItsNumbers() {
        var hold = row(nil, nil); hold.sec = 45
        let h = state([entry("h", [hold], mode: "time")])
        let (_, he) = Effort.rate(Effort.target(h, entry: 0, set: 0, kind: "rir")!, 1, kind: "rir", in: h, id: ids())
        XCTAssertEqual(he[0]["sec"] as? Double, 45)
        XCTAssertNil(he[0]["w"]); XCTAssertNil(he[0]["r"])
        let b = state([entry("b", [row(0, 10)])])
        let (_, be) = Effort.rate(Effort.target(b, entry: 0, set: 0, kind: "rir")!, 1, kind: "rir", in: b, id: ids())
        XCTAssertEqual(be[0]["w"] as? Double, 0)
        let lb = state([entry("l", [row(135, 5)], unit: "lb")], unit: "kg")
        let (_, le) = Effort.rate(Effort.target(lb, entry: 0, set: 0, kind: "rir")!, 1, kind: "rir", in: lb, id: ids())
        XCTAssertEqual(le[0]["w"] as? Double, 135, "as in the row, never converted")
    }

    // MARK: rest and the disc

    func testWhichSetsGetARest() {
        let plain = state([entry("a", [row(), row(done: false)]), entry("b", [row(done: false)])])
        XCTAssertEqual(SessionCore.restSeconds(after: plain, entry: 0, set: 0), 90)
        let own = state([entry("a", [row(), row(done: false)], restSec: 120), entry("b", [row(done: false)])])
        XCTAssertEqual(SessionCore.restSeconds(after: own, entry: 0, set: 0), 120)
        let last = state([entry("a", [row()])])
        XCTAssertNil(SessionCore.restSeconds(after: last, entry: 0, set: 0), "after the last set of the workout")
        let none = state([entry("a", [row(), row(done: false)])], restSec: 0)
        XCTAssertNil(SessionCore.restSeconds(after: none, entry: 0, set: 0), "a rest of 0")
        XCTAssertNil(SessionCore.restSeconds(after: plain, entry: 9, set: 0))
    }

    func testASupersetRestsAfterTheRoundNotAfterEachMember() {
        let mid = state([entry("a", [row(), row(done: false)], group: "g"), entry("b", [row(done: false), row(done: false)], group: "g")])
        XCTAssertNil(SessionCore.restSeconds(after: mid, entry: 0, set: 0), "the partner is up next")
        let end = state([entry("a", [row(), row(done: false)], group: "g"), entry("b", [row(), row(done: false)], group: "g")])
        XCTAssertEqual(SessionCore.restSeconds(after: end, entry: 1, set: 0), 90, "the round's last member")
    }

    func testAPerSideSetRestsOnlyAfterItsSecondSide() {
        var half = sided(true, false)
        var s = state([entry("a", [half, sided(false, false)], perSide: true)])
        XCTAssertNil(SessionCore.restSeconds(after: s, entry: 0, set: 0), "the other side is up")
        half = sided(true, true)
        s = state([entry("a", [half, sided(false, false)], perSide: true)])
        XCTAssertEqual(SessionCore.restSeconds(after: s, entry: 0, set: 0), 90)
    }

    func testTheDiscIsLeftOnlyOnSetsWithNoRestToRateIn() {
        let mid = state([entry("a", [row(done: false), row(done: false)])])
        XCTAssertFalse(Effort.ratesBeforeDone(mid, entry: 0, set: 0), "a rest follows")
        let last = state([entry("a", [row(done: false)])])
        XCTAssertTrue(Effort.ratesBeforeDone(last, entry: 0, set: 0), "the workout's last set")
        let ss = state([entry("a", [row(done: false)], group: "g"), entry("b", [row(done: false)], group: "g")])
        XCTAssertTrue(Effort.ratesBeforeDone(ss, entry: 0, set: 0), "a superset's first member")
        let none = state([entry("a", [row(done: false), row(done: false)])], restSec: 0)
        XCTAssertTrue(Effort.ratesBeforeDone(none, entry: 0, set: 0), "no rest")
        // per side: side L never (the first side is not the set's end), side R when no rest follows
        let l = state([entry("a", [sided(false, false)], perSide: true)])
        XCTAssertFalse(Effort.ratesBeforeDone(l, entry: 0, set: 0))
        let r = state([entry("a", [sided(true, false)], perSide: true)])
        XCTAssertTrue(Effort.ratesBeforeDone(r, entry: 0, set: 0), "side R of the last set")
        let rRest = state([entry("a", [sided(true, false), sided(false, false)], perSide: true)])
        XCTAssertFalse(Effort.ratesBeforeDone(rRest, entry: 0, set: 0), "side R, a rest follows")
    }
}
