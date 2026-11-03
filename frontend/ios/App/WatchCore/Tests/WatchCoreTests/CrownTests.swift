import XCTest
@testable import WatchCore

/// The Crown as whole steps, which box it turns, and the numbers a snapshot must not take back.
final class CrownTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1000)
    func at(_ s: Double) -> Date { t0.addingTimeInterval(s) }

    func testOneDetentIsOneStep() {
        var g = CrownGate()
        XCTAssertEqual(g.steps(to: 1, at: at(0), allowed: true), 1)
        XCTAssertEqual(g.steps(to: 0, at: at(1), allowed: true), -1, "turning back")
    }

    func testAFastSpinIsCappedAndTheRestDropped() {
        var g = CrownGate()
        XCTAssertEqual(g.steps(to: 5, at: at(0), allowed: true), 2)
        XCTAssertEqual(g.steps(to: 6, at: at(0.05), allowed: true), 0, "the window is used up")
        XCTAssertEqual(g.steps(to: 7, at: at(0.15), allowed: true), 1, "a new window: one step, not the 4 left over")
        XCTAssertEqual(g.steps(to: 12, at: at(0.5), allowed: true), 2, "a later window gives 2 again")
    }

    func testASwallowedTurnIsNotOwedLater() {
        var g = CrownGate()
        XCTAssertEqual(g.steps(to: 3, at: at(0), allowed: false), 0)
        XCTAssertEqual(g.last, 3)
        XCTAssertEqual(g.steps(to: 4, at: at(1), allowed: true), 1)
    }

    func testArmedByATapKeypadOnTheSecond() {
        var a = CrownArm()
        XCTAssertEqual(a.tap(.weight, key: "k", at: at(0)), .armed)
        XCTAssertEqual(a.tap(.weight, key: "k", at: at(1)), .keypad)
        XCTAssertEqual(a.tap(.reps, key: "k", at: at(2)), .armed, "the other box: the arm moves")
        XCTAssertEqual(a.armed(at: at(2), key: "k"), .reps)
    }

    func testTheArmExpires() {
        var a = CrownArm()
        _ = a.tap(.weight, key: "k", at: at(0))
        XCTAssertEqual(a.armed(at: at(3.9), key: "k"), .weight)
        XCTAssertNil(a.armed(at: at(4), key: "k"))
        var b = CrownArm()
        _ = b.tap(.weight, key: "k", at: at(0))
        b.touch(at: at(3))
        XCTAssertEqual(b.armed(at: at(6.9), key: "k"), .weight, "a turn keeps it armed")
        XCTAssertNil(b.armed(at: at(7), key: "k"))
    }

    func testAnExpiredArmTappedAgainArmsAgain() {
        var a = CrownArm()
        _ = a.tap(.weight, key: "k", at: at(0))
        XCTAssertEqual(a.tap(.weight, key: "k", at: at(10)), .armed)
    }

    func testAnotherSetDisarmsAndSoDoesDisarm() {
        var a = CrownArm()
        _ = a.tap(.weight, key: "k", at: at(0))
        XCTAssertNil(a.armed(at: at(1), key: "other"))
        XCTAssertNil(a.armed(at: at(1), key: nil), "an empty key never arms")
        a.disarm()
        XCTAssertNil(a.armed(at: at(1), key: "k"))
        a.touch(at: at(2))
        XCTAssertNil(a.field)
    }

    func testTheDemoNeverExpires() {
        var a = CrownArm(idle: .infinity)
        _ = a.tap(.weight, key: "k", at: at(0))
        XCTAssertEqual(a.armed(at: at(100_000), key: "k"), .weight)
    }

    func testADraftKeepsTouchedNumbersForTheSameSet() {
        var d = SetDraft()
        d.follow("a")
        XCTAssertTrue(d.touch(.weight, key: "a"))
        XCTAssertTrue(d.keeps(.weight))
        XCTAssertFalse(d.keeps(.reps), "an untouched number follows the plan")
        d.follow("a")
        XCTAssertTrue(d.keeps(.weight), "a snapshot on the same set")
        d.follow("b")
        XCTAssertFalse(d.keeps(.weight), "another set: a clean draft")
    }

    func testAStaleKeyTouchesNothing() {
        var d = SetDraft()
        d.follow("b")
        XCTAssertFalse(d.touch(.weight, key: "a"), "a keypad value cannot land on a set that changed under it")
        XCTAssertFalse(d.keeps(.weight))
    }
}
