import XCTest
@testable import WatchCore

/// The rest layer's numbers: ±15 s with a floor, the bar, and the set that comes after.
final class RestTests: XCTestCase {
    func row(_ w: Double = 62.5, _ r: Double = 8, done: Bool = false, warmup: Bool = false) -> SetRow {
        SetRow(w: w, r: r, sec: nil, done: done, warmup: warmup, at: done ? 1 : nil)
    }

    func entry(_ sets: [SetRow], mode: String = "reps", bodyweight: Bool = false) -> Entry {
        Entry(id: "a", name: "Bench Press", mode: mode, restSec: nil, last: nil, sets: sets, bodyweight: bodyweight ? true : nil)
    }

    func testAdjustAddsAndTakesOff15() {
        XCTAssertEqual(Rest.adjusted(left: 60, by: Rest.step), 75)
        XCTAssertEqual(Rest.adjusted(left: 60, by: -Rest.step), 45)
    }

    func testAdjustNeverGoesBelowZero() {
        XCTAssertEqual(Rest.adjusted(left: 10, by: -15), 0)
        XCTAssertEqual(Rest.adjusted(left: 15, by: -15), 0)
        XCTAssertEqual(Rest.adjusted(left: 0, by: -15), 0)
        XCTAssertEqual(Rest.adjusted(left: -0.4, by: -15), 0)          // a timer a moment late
    }

    func testAdjustUnderASecondIsASkip() {
        XCTAssertEqual(Rest.adjusted(left: 15.4, by: -15), 0)          // the clock would read 0:00 and ring
        XCTAssertEqual(Rest.adjusted(left: 16, by: -15), 1)
        XCTAssertEqual(Rest.adjusted(left: 0.5, by: Rest.step), 15.5)
    }

    func testPhoneEndIsFollowedOnlyWhenNewAndNotOverAnAdjust() {
        let a = Date(timeIntervalSince1970: 1000), b = Date(timeIntervalSince1970: 1060)
        XCTAssertTrue(Rest.follows(a, known: nil, adjusted: false, phoneTicked: false))      // the phone's first end
        XCTAssertFalse(Rest.follows(a, known: a, adjusted: false, phoneTicked: false))       // a later snapshot, same end
        XCTAssertTrue(Rest.follows(b, known: a, adjusted: false, phoneTicked: false))        // the phone moved it
        XCTAssertFalse(Rest.follows(a, known: nil, adjusted: true, phoneTicked: false))      // the first end after a ±15 here
        XCTAssertFalse(Rest.follows(b, known: a, adjusted: true, phoneTicked: false))        // a phone edit after a ±15 here
        XCTAssertTrue(Rest.follows(b, known: a, adjusted: true, phoneTicked: true))          // a set ticked on the phone: a new rest
        XCTAssertFalse(Rest.follows(a, known: a, adjusted: true, phoneTicked: true))
    }

    func testProgressIsWhatIsLeftOfTheWholeRest() {
        XCTAssertEqual(Rest.progress(left: 45, total: 90), 0.5)
        XCTAssertEqual(Rest.progress(left: 90, total: 90), 1)
        XCTAssertEqual(Rest.progress(left: 0, total: 90), 0)
    }

    func testProgressStaysInsideTheBar() {
        XCTAssertEqual(Rest.progress(left: 120, total: 90), 1)          // a rest whose start is not known
        XCTAssertEqual(Rest.progress(left: -1, total: 90), 0)
        XCTAssertEqual(Rest.progress(left: 30, total: 0), 0)
    }

    func testNextIsTheSetUpWithItsPlace() {
        let e = entry([row(40, 10, done: true, warmup: true), row(60, 8, done: true), row(), row()])
        let n = Rest.next(e, set: 2, unit: "kg")
        XCTAssertEqual(n?.name, "Bench Press")
        XCTAssertEqual(n?.position.number, 2)
        XCTAssertEqual(n?.position.total, 3)
        XCTAssertEqual(n?.load, "62.5 kg × 8")
        XCTAssertNil(n?.side)
    }

    func testNextWarmUpHasNoSetNumber() {
        let n = Rest.next(entry([row(40, 10, warmup: true), row()]), set: 0, unit: "lb")
        XCTAssertNil(n?.position.number)
        XCTAssertEqual(n?.load, "40 lb × 10")
    }

    func testNextPerSideSaysTheSideUpAndItsNumbers() {
        var s = row(20, 16)
        s.sides = Sides(L: SideRow(w: 20, r: 8, done: false), R: SideRow(w: 22.5, r: 8, done: false))
        XCTAssertEqual(Rest.next(entry([s]), set: 0, unit: "kg")?.side, "L")
        s.sides = Sides(L: SideRow(w: 20, r: 8, done: true), R: SideRow(w: 22.5, r: 7, done: false))
        let n = Rest.next(entry([s]), set: 0, unit: "kg")
        XCTAssertEqual(n?.side, "R")
        XCTAssertEqual(n?.load, "22.5 kg × 7")
    }

    func testNextBodyweightNamesAddedWeightOnlyWhenThereIsSome() {
        let bare = Rest.next(entry([row(0, 8)], bodyweight: true), set: 0, unit: "kg")
        XCTAssertEqual(bare?.load, "× 8")
        XCTAssertEqual(bare?.bodyweight, true)
        let added = Rest.next(entry([row(5, 6)], bodyweight: true), set: 0, unit: "kg")
        XCTAssertEqual(added?.load, "+5 kg × 6")
        XCTAssertEqual(added?.bodyweight, false)
    }

    func testNextHoldIsItsSecondsAndCardioHasNoLoad() {
        var hold = row(0, 0)
        hold.sec = 45
        XCTAssertEqual(Rest.next(entry([hold], mode: "time"), set: 0, unit: "kg")?.load, "45 s")
        XCTAssertNil(Rest.next(entry([row()], mode: "cardio"), set: 0, unit: "kg")?.load)
    }

    func testNextIsNilWithoutThatSet() {
        XCTAssertNil(Rest.next(entry([]), set: 0, unit: "kg"))
        XCTAssertNil(Rest.next(entry([row()]), set: 1, unit: "kg"))
    }
}
