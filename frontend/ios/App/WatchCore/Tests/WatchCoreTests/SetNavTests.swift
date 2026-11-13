import XCTest
@testable import WatchCore

/// The set page: its place line, the arrows, a logged set fixed, and the keypad.
final class SetNavTests: XCTestCase {
    func row(_ w: Double, _ r: Double, done: Bool = false, warmup: Bool = false, at: Double? = nil) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: warmup, at: at)
    }

    func state(_ e: Entry) -> SessionState {
        var s = SessionState()
        s.workout = ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: [e])
        return s
    }

    func testPlaceCountsWorkSetsAndWarmupsApart() {
        let e = Entry(id: "b", name: "Bench", mode: "reps", restSec: nil, last: nil,
                      sets: [row(40, 10, warmup: true), row(60, 8), row(62.5, 8), row(62.5, 8)])
        XCTAssertEqual(SetNav.place(e, 0).n, 1)
        XCTAssertEqual(SetNav.place(e, 0).of, 1)
        XCTAssertEqual(SetNav.place(e, 2).n, 2)
        XCTAssertEqual(SetNav.place(e, 2).of, 3)
        XCTAssertEqual(SetNav.step(e, from: 0, by: -1), nil)
        XCTAssertEqual(SetNav.step(e, from: 0, by: 1), 1)
        XCTAssertEqual(SetNav.step(e, from: 3, by: 1), nil)
    }

    func testAFixIsTheSameSetDoneAgainLaterWithoutHeartRate() throws {
        let e = Entry(id: "b", name: "Bench", mode: "reps", restSec: nil, last: nil, sets: [row(60, 8, done: true, at: 5000), row(60, 8)])
        let (s, ev) = SetFix.correct(state(e), entry: 0, set: 0, side: nil, to: .init(w: 62.5, r: 7, sec: nil), now: 1000, id: "fix1")
        let event = try XCTUnwrap(ev)
        XCTAssertEqual(event["type"] as? String, "setDone")
        XCTAssertEqual(event["w"] as? Double, 62.5)
        XCTAssertEqual(event["r"] as? Double, 7)
        XCTAssertEqual(event["at"] as? Double, 5001, "later than the set's own tick, also with a clock behind")
        XCTAssertNil(event["hr"], "the phone keeps the set's heart rate")
        XCTAssertNil(event["sec"])
        // only the keys a setDone already has
        let known: Set<String> = ["id", "type", "wid", "exId", "entryIdx", "setIdx", "at", "w", "r", "sec", "side", "hr", "rpe", "rir"]
        XCTAssertTrue(Set(event.keys).isSubset(of: known))
        XCTAssertEqual(s.workout?.entries[0].sets[0].w, 62.5)
        XCTAssertEqual(s.workout?.entries[0].sets[0].done, true)
        XCTAssertEqual(s.pending[SessionCore.key("b", 0)]?.id, "fix1", "kept until the phone has it")
    }

    func testOnlyALoggedSetCanBeFixedAndNeverCardio() {
        let e = Entry(id: "b", name: "Bench", mode: "reps", restSec: nil, last: nil, sets: [row(60, 8)])
        XCTAssertNil(SetFix.correct(state(e), entry: 0, set: 0, side: nil, to: .init(w: 1, r: 1), now: 1, id: "x").1)
        let bike = Entry(id: "bike", name: "Bike", mode: "cardio", restSec: nil, last: nil, sets: [row(0, 0, done: true, at: 1)])
        XCTAssertNil(SetFix.correct(state(bike), entry: 0, set: 0, side: nil, to: .init(w: 1, r: 1), now: 9, id: "x").1)
    }

    func testAHoldKeepsItsSecondsAndGetsNoWeightItNeverHad() throws {
        let plank = Entry(id: "p", name: "Plank", mode: "time", restSec: nil, last: nil,
                          sets: [SetRow(w: nil, r: nil, sec: 45, done: true, warmup: false, at: 10)])
        let ev = try XCTUnwrap(SetFix.correct(state(plank), entry: 0, set: 0, side: nil, to: .init(w: 0, r: 0, sec: 60), now: 100, id: "h").1)
        XCTAssertEqual(ev["sec"] as? Double, 60)
        XCTAssertNil(ev["w"])
        XCTAssertNil(ev["r"])
    }

    func testOneSideOfAPerSideSet() throws {
        var r0 = row(20, 16, at: 10)
        r0.sides = Sides(L: SideRow(w: 20, r: 8, done: true), R: SideRow(w: 20, r: 8, done: false))
        let e = Entry(id: "s", name: "Split", mode: "reps", restSec: nil, last: nil, sets: [r0])
        let (s, ev) = SetFix.correct(state(e), entry: 0, set: 0, side: "L", to: .init(w: 22.5, r: 7), now: 50, id: "l")
        XCTAssertEqual(try XCTUnwrap(ev)["side"] as? String, "L")
        XCTAssertEqual(s.workout?.entries[0].sets[0].sides?.L.w, 22.5)
        XCTAssertEqual(s.workout?.entries[0].sets[0].r, 15, "the row's reps follow its sides")
        XCTAssertNil(SetFix.correct(state(e), entry: 0, set: 0, side: "R", to: .init(w: 1, r: 1), now: 50, id: "r").1, "the right side is not logged yet")
    }

    func testKeypadTypesNumbersAndKeepsThemSane() {
        var k = Keypad(decimals: 2)
        for key in ["0", "6", "2", ".", "2", "5", "9"] { k.press(key) }
        XCTAssertEqual(k.text, "62.25", "no leading zero, two decimals at most")
        XCTAssertEqual(k.value, 62.25)
        k.press(".")
        XCTAssertEqual(k.text, "62.25", "one point")
        k.back(); k.back(); k.back()
        XCTAssertEqual(k.text, "62")
        k.press(".")
        XCTAssertEqual(k.value, 62, "a trailing point is the whole number")
        XCTAssertTrue(k.fits(0...700))
        XCTAssertFalse(k.fits(0...50))

        var reps = Keypad(decimals: 0)
        reps.press(".")
        XCTAssertEqual(reps.text, "", "no point for reps")
        for key in ["1", "2", "3", "4", "5"] { reps.press(key) }
        XCTAssertEqual(reps.text, "1234", "four digits at most")
        reps.press("x")
        XCTAssertEqual(reps.text, "1234")
        XCTAssertNil(Keypad(decimals: 1).value)
        XCTAssertFalse(Keypad(decimals: 1).fits(0...10), "nothing typed is nothing to save")

        var lead = Keypad(decimals: 1)
        lead.press(".")
        lead.press("5")
        XCTAssertEqual(lead.text, "0.5")
    }

    func testCrownWheelIsTheWholeGridPlusAnOffGridValue() {
        let kg = CrownWheel.choices(step: 2.5, range: 0...700, current: 62.25)
        XCTAssertEqual(kg.first, 0); XCTAssertEqual(kg.last, 700)
        XCTAssertEqual(kg.count, 282, "281 grid steps and the keypad's 62.25")
        XCTAssertEqual(Array(kg[24...26]), [60, 62.25, 62.5])
        XCTAssertTrue(CrownWheel.choices(step: 0.1, range: 0...10, current: 7.3).contains(7.3), "no float drift off the grid")
        XCTAssertEqual(CrownWheel.choices(step: 1, range: 0...200, current: 8).count, 201)
        XCTAssertEqual(CrownWheel.choices(step: 0, range: 0...10, current: 3), [3])
    }

    func testLastTimeKeepsOneLoadAndTheReps() {
        XCTAssertEqual(LastTime.compact("60 kg × 8, 60 kg × 8, 60 kg × 7"), "60 kg × 8, 8, 7")
        XCTAssertEqual(LastTime.compact("135×5, 135×5"), "135×5, 5")
        XCTAssertEqual(LastTime.compact("60 kg × 8, 62.5 kg × 6"), "60 kg × 8, 62.5 kg × 6") // mixed loads as sent
        XCTAssertEqual(LastTime.compact("60 kg × 8"), "60 kg × 8")
        XCTAssertEqual(LastTime.compact("30 s, 30 s"), "30 s, 30 s") // no ×: as sent
        // review 2026-11-12: drops, failure, bursts stay as sent
        XCTAssertEqual(LastTime.compact("100×8 ↘ 80×6, 100×8 ↘ 80×5"), "100×8 ↘ 80×6, 100×8 ↘ 80×5")
        XCTAssertEqual(LastTime.compact("60×8 F, 60×8"), "60×8 F, 60×8")
        XCTAssertEqual(LastTime.compact("60×10+4+2, 60×10+4+2"), "60×10+4+2, 60×10+4+2")
    }
}
