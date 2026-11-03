import XCTest
@testable import WatchCore

/// What the set page says about the set up next: its place, last time's part, the plan still ahead.
final class SetPageTests: XCTestCase {
    func row(_ w: Double = 60, _ r: Double = 8, done: Bool = false, warmup: Bool = false) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: warmup, at: done ? 1 : nil)
    }

    func entry(_ sets: [SetRow], mode: String = "reps", last: String? = nil, bodyweight: Bool = false) -> Entry {
        Entry(id: "a", name: "a", mode: mode, restSec: nil, last: last, sets: sets, bodyweight: bodyweight ? true : nil)
    }

    func planned(_ e: Entry, _ si: Int, unit: String = "kg", skipped: Set<Int> = []) -> SetPage.Planned? {
        SetPage.planned(e, set: si, unit: unit) { skipped.contains($0) }
    }

    func testPositionCountsWorkingSetsOnly() {
        let e = entry([row(done: true, warmup: true), row(done: true), row(), row()])
        XCTAssertEqual(SetPage.position(e, set: 0), SetPage.Position(number: nil, total: 3, done: 1))
        XCTAssertEqual(SetPage.position(e, set: 2).number, 2)
        XCTAssertEqual(SetPage.position(e, set: 3).number, 3)
        XCTAssertEqual(SetPage.position(entry([row(warmup: true)]), set: 0), SetPage.Position(number: nil, total: 0, done: 0))
    }

    func testNoSetsAtAll() {
        let e = entry([])
        XCTAssertEqual(SetPage.position(e, set: 0), SetPage.Position(number: nil, total: 0, done: 0))
        XCTAssertNil(planned(e, 0))
        XCTAssertNil(SetPage.lastTime("60 kg × 8", SetPage.position(e, set: 0)))
    }

    func testAPerSideSetIsDoneWhenBothSidesAre() {
        var s = row()
        s.sides = Sides(L: SideRow(w: 20, r: 8, done: false), R: SideRow(w: 20, r: 8, done: false))
        s = SessionCore.markSide(s, "L", w: 20, r: 8, at: 1)
        XCTAssertEqual(SetPage.position(entry([s]), set: 0), SetPage.Position(number: 1, total: 1, done: 0))
        s = SessionCore.markSide(s, "R", w: 20, r: 8, at: 2)
        XCTAssertEqual(SetPage.position(entry([s]), set: 0), SetPage.Position(number: 1, total: 1, done: 1))
    }

    func testLastTimeTakesThePartForThisSet() {
        let last = "60 kg × 8, 60 kg × 8, 60 kg × 7"
        func at(_ n: Int?) -> String? { SetPage.lastTime(last, SetPage.Position(number: n, total: 3, done: 0)) }
        XCTAssertEqual(at(1), "60 kg × 8")
        XCTAssertEqual(at(3), "60 kg × 7")
        XCTAssertEqual(at(5), "60 kg × 7", "more sets than last time: the last part")
        XCTAssertNil(at(nil), "a warm-up has no last time")
    }

    func testLastTimeOtherShapes() {
        let p = SetPage.Position(number: 2, total: 2, done: 0)
        XCTAssertEqual(SetPage.lastTime("62,5 kg × 8, 60 kg × 6", p), "60 kg × 6", "a comma decimal is not a split")
        XCTAssertEqual(SetPage.lastTime("45s", p), "45s")
        XCTAssertNil(SetPage.lastTime(nil, p))
        XCTAssertNil(SetPage.lastTime("", p))
    }

    func testPlannedIsWhatIsLeft() throws {
        let e = entry([row(60, 8, done: true), row(62.5, 8), row(62.5, 8), row(62.5, 7)])
        let p = try XCTUnwrap(planned(e, 1))
        XCTAssertEqual(p.text, "62.5 kg × 8-8-7")
        XCTAssertEqual(p.head, "62.5 kg × ")
        XCTAssertEqual(p.now, "8")
        XCTAssertEqual(p.tail, "-8-7")
        XCTAssertEqual(p.spoken, "62.5 kg × 8, 8, 7")
    }

    func testPlannedSkipsSkippedSetsExceptTheOneUp() throws {
        let e = entry([row(62.5, 8), row(62.5, 8), row(62.5, 7)])
        XCTAssertEqual(try XCTUnwrap(planned(e, 0, skipped: [1])).text, "62.5 kg × 8-7")
        let up = try XCTUnwrap(planned(e, 1, skipped: [1]))
        XCTAssertEqual(up.text, "62.5 kg × 8-7")
        XCTAssertEqual(up.now, "8")
    }

    func testPlannedWithAWarmUpUpBoldsNothing() throws {
        let e = entry([row(40, 10, warmup: true), row(62.5, 8), row(62.5, 8)])
        let p = try XCTUnwrap(planned(e, 0))
        XCTAssertEqual(p.now, "")
        XCTAssertEqual(p.text, "62.5 kg × 8-8")
    }

    func testPlannedRunsEqualWeightsTogether() throws {
        let pyramid = entry([row(60, 10), row(70, 8), row(80, 6)])
        XCTAssertEqual(try XCTUnwrap(planned(pyramid, 0)).text, "60 kg × 10 · 70 kg × 8 · 80 kg × 6")
        let two = entry([row(60, 10), row(60, 10), row(70, 8)])
        XCTAssertEqual(try XCTUnwrap(planned(two, 0)).text, "60 kg × 10-10 · 70 kg × 8")
        XCTAssertEqual(try XCTUnwrap(planned(entry([row(135, 5)]), 0, unit: "lb")).text, "135 lb × 5")
    }

    func testPlannedBodyweightShowsAddedWeightOnly() throws {
        let plain = entry([row(0, 8), row(0, 8)], bodyweight: true)
        XCTAssertEqual(try XCTUnwrap(planned(plain, 0)).text, "8-8")
        let added = entry([row(0, 8), row(5, 6)], bodyweight: true)
        XCTAssertEqual(try XCTUnwrap(planned(added, 0)).text, "8 · +5 kg × 6")
    }

    func testPlannedPerSideUsesTheSideUp() throws {
        var s = row(20, 16)
        s.sides = Sides(L: SideRow(w: 20, r: 8, done: true), R: SideRow(w: 20, r: 8, done: false))
        XCTAssertEqual(try XCTUnwrap(planned(entry([s]), 0)).text, "20 kg × 8")
    }

    func testPlannedIsNothingForOtherModesOrWhenNothingIsLeft() {
        XCTAssertNil(planned(entry([row()], mode: "time"), 0))
        XCTAssertNil(planned(entry([row()], mode: "cardio"), 0))
        XCTAssertNil(planned(entry([row(done: true)]), 0))
        XCTAssertNil(planned(entry([row()]), 5))
    }

    func testFormatNumber() {
        XCTAssertEqual(formatNumber(62.5), "62.5")
        XCTAssertEqual(formatNumber(60), "60")
        XCTAssertEqual(formatNumber(0), "0")
    }
}
