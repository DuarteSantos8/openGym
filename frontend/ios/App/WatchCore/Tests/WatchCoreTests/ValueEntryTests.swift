import XCTest
@testable import WatchCore

/// The bounds, steps and keypad rules of the three numbers the Crown and the keypad edit.
final class ValueEntryTests: XCTestCase {
    let kg = ValueSpec.of(.weight, step: nil, unit: "kg")
    let lb = ValueSpec.of(.weight, step: nil, unit: "lb")
    let reps = ValueSpec.of(.reps, step: nil, unit: "kg")
    let sec = ValueSpec.of(.seconds, step: nil, unit: "kg")

    func testBoundsAndSteps() {
        XCTAssertEqual([kg.lo, kg.hi, kg.step], [0, 700, 2.5])
        XCTAssertEqual([lb.lo, lb.hi, lb.step], [0, 1500, 5])
        XCTAssertEqual([reps.lo, reps.hi, reps.step], [0, 200, 1])
        XCTAssertEqual([sec.lo, sec.hi, sec.step], [5, 3600, 5])
        XCTAssertEqual(ValueSpec.of(.weight, step: 1.25, unit: "kg").step, 1.25)
        XCTAssertEqual(ValueSpec.of(.weight, step: 0, unit: "kg").step, 2.5)
        XCTAssertEqual(ValueSpec.of(.weight, step: -1, unit: "lb").step, 5)
    }

    func testTurnedOnTheGrid() {
        XCTAssertEqual(kg.turned(60, by: 1), 62.5)
        XCTAssertEqual(kg.turned(60, by: -1), 57.5)
        XCTAssertEqual(kg.turned(60, by: 3), 67.5)
        XCTAssertEqual(kg.turned(60, by: 0), 60)
    }

    func testAnOffGridValueFirstGoesToTheGridInTheTurnsDirection() {
        XCTAssertEqual(kg.turned(61, by: 1), 62.5)
        XCTAssertEqual(kg.turned(61, by: -1), 60)
        XCTAssertEqual(kg.turned(61, by: -2), 57.5)
        XCTAssertEqual(kg.turned(61, by: 2), 65)
    }

    func testTurnedClamps() {
        XCTAssertEqual(kg.turned(700, by: 1), 700)
        XCTAssertEqual(kg.turned(2.5, by: -3), 0)
        XCTAssertEqual(sec.turned(5, by: -1), 5)
        XCTAssertEqual(sec.turned(3598, by: 1), 3600)
        XCTAssertEqual(reps.turned(200, by: 1), 200)
    }

    func testASmallStepDoesNotDrift() {
        XCTAssertEqual(ValueSpec(lo: 0, hi: 10, step: 0.1, decimals: 2).turned(0.2, by: 1), 0.3)
    }

    func testTypedBuildsANumber() {
        XCTAssertEqual("62.5".reduce("") { kg.typed($0, adding: $1) }, "62.5")
        XCTAssertEqual(kg.typed("62.5", adding: "7"), "62.57", "two decimals are kept")
        XCTAssertEqual(kg.typed("62.55", adding: "7"), "62.55", "a third decimal is ignored")
        XCTAssertEqual(kg.typed("62.5", adding: "."), "62.5", "a second point is ignored")
        XCTAssertEqual(kg.typed("", adding: "."), "0.")
        XCTAssertEqual(kg.typed("0", adding: "5"), "5")
        XCTAssertEqual(kg.typed("0", adding: "0"), "0")
        XCTAssertEqual(kg.typed("", adding: "⌫"), "")
        XCTAssertEqual(kg.typed("62", adding: "⌫"), "6")
        XCTAssertEqual(kg.typed("62", adding: "x"), "62")
    }

    func testDigitsAllowed() {
        XCTAssertEqual(kg.typed("123", adding: "4"), "123", "kg takes three integer digits")
        XCTAssertEqual(lb.typed("1234", adding: "5"), "1234", "lb takes four")
        XCTAssertEqual(lb.typed("123", adding: "4"), "1234")
        XCTAssertEqual(sec.typed("123", adding: "4"), "1234", "seconds take four")
        XCTAssertEqual(sec.typed("1234", adding: "5"), "1234")
    }

    func testRepsAndSecondsHaveNoPoint() {
        XCTAssertEqual(reps.typed("1", adding: "."), "1")
        XCTAssertEqual(sec.typed("", adding: "."), "")
    }

    func testValueOfAcceptsWhatWasTypedExactly() {
        XCTAssertEqual(kg.value(of: "62.5"), 62.5)
        XCTAssertEqual(kg.value(of: "62.25"), 62.25)
        XCTAssertEqual(kg.value(of: "62."), 62)
        XCTAssertEqual(kg.value(of: "700"), 700)
        XCTAssertNil(kg.value(of: "701"))
        XCTAssertEqual(lb.value(of: "1500"), 1500)
        XCTAssertNil(lb.value(of: "1501"))
        XCTAssertNil(sec.value(of: "4"))
        XCTAssertEqual(sec.value(of: "5"), 5)
        XCTAssertNil(reps.value(of: "12.5"))
        for bad in ["", ".", "1e3", "--", "6.2.5", "62.255"] { XCTAssertNil(kg.value(of: bad), bad) }
    }

    func testTooHighOnlyAboveTheTop() {
        XCTAssertTrue(kg.tooHigh("701"))
        XCTAssertFalse(kg.tooHigh("700"))
        XCTAssertFalse(sec.tooHigh("3"))
        XCTAssertFalse(kg.tooHigh(""))
    }
}
