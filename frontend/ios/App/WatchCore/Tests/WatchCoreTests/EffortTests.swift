import XCTest
@testable import WatchCore

/// RPE / RIR on the watch: the dial's half steps, the event, the phone's colour bands.
final class EffortTests: XCTestCase {
    func testTheScalesAreRIR0To5AndRPE6To10() {
        XCTAssertEqual(Effort.range("rir"), 0...5)
        XCTAssertEqual(Effort.range("rpe"), 6...10)
        XCTAssertNil(Effort.range("none"))
    }

    func testAStepIsAHalfAndHoldsAtTheEnds() {
        XCTAssertEqual(Effort.nudged("rir", 1, by: 1, clear: false), 1.5)
        XCTAssertEqual(Effort.nudged("rir", 1.5, by: -1, clear: false), 1)
        XCTAssertEqual(Effort.nudged("rpe", 8, by: 1, clear: false), 8.5)
        XCTAssertEqual(Effort.nudged("rpe", 8, by: -2, clear: false), 7)
        XCTAssertEqual(Effort.nudged("rir", 5, by: 1, clear: false), 5, "no wrap at the top")
        XCTAssertEqual(Effort.nudged("rir", 0, by: -1, clear: false), 0, "nor at the bottom")
        XCTAssertEqual(Effort.nudged("rpe", 6, by: -3, clear: false), 6)
        XCTAssertEqual(Effort.nudged("rpe", 9.5, by: 3, clear: false), 10)
        XCTAssertEqual(Effort.nudged("rir", 2, by: 0, clear: false), 2)
    }

    func testFromNotRatedTheFirstStepLandsOnAHardWorkingSet() {
        XCTAssertEqual(Effort.nudged("rir", nil, by: 1, clear: true), 2)
        XCTAssertEqual(Effort.nudged("rir", nil, by: -1, clear: true), 2)
        XCTAssertEqual(Effort.nudged("rpe", nil, by: 1, clear: true), 8)
    }

    func testOneStepBelowTheFloorClearsItOnlyWhereItCanBeCleared() {
        XCTAssertNil(Effort.nudged("rir", 0, by: -1, clear: true))
        XCTAssertNil(Effort.nudged("rpe", 6, by: -1, clear: true))
        XCTAssertEqual(Effort.nudged("rir", 0.5, by: -2, clear: true), 0, "a fast spin stops at the floor first")
        XCTAssertEqual(Effort.nudged("rir", 0, by: 1, clear: true), 0.5)
    }

    func testAValueOutsideTheScaleOrOffTheGridComesInOnTheFirstStep() {
        XCTAssertEqual(Effort.nudged("rir", 7, by: -1, clear: false), 5, "a phone's RIR 7")
        XCTAssertEqual(Effort.nudged("rpe", 5, by: 1, clear: false), 6)
        XCTAssertEqual(Effort.nudged("rpe", 8.4, by: 1, clear: false), 9, "8.4 + 0.5 lands on the grid")
    }

    func testTheCrownsDetentsMatchTheSteps() {
        XCTAssertEqual(Effort.slots("rir", clear: false), 10)
        XCTAssertEqual(Effort.slots("rpe", clear: true), 9)
        XCTAssertEqual(Effort.slot("rir", 0, clear: false), 0)
        XCTAssertEqual(Effort.slot("rir", 1.5, clear: false), 3)
        XCTAssertEqual(Effort.slot("rir", nil, clear: true), 0, "not rated is the first detent")
        XCTAssertEqual(Effort.slot("rir", 0, clear: true), 1)
        XCTAssertEqual(Effort.slot("rir", 7, clear: false), 10, "outside the scale sits at its end")
        for k in ["rir", "rpe"] { XCTAssertEqual(Effort.slot(k, Effort.start(k), clear: false) , Effort.slot(k, Effort.nudged(k, nil, by: 1, clear: false), clear: false)) }
    }

    func testTheRatingGoesOutOnTheTickAndOnlyWhenThereIsOne() {
        let set = SetRow(w: 60, r: 8, sec: nil, done: false, warmup: false, at: nil)
        var s = SessionState()
        s.workout = ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil,
                                  entries: [Entry(id: "0025", name: "Bench Press", mode: "reps", restSec: nil, last: nil, sets: [set, set])])
        let (_, rated) = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1, id: "e1", effort: Effort.Rating(kind: "rpe", value: 8.5))
        XCTAssertEqual(rated?["rpe"] as? Double, 8.5)
        XCTAssertNil(rated?["rir"])
        let (_, plain) = SessionCore.tick(s, entry: 0, set: 1, w: 60, r: 8, at: 2, id: "e2")
        XCTAssertNil(plain?["rpe"])
        XCTAssertNil(plain?["rir"])
        let (_, odd) = SessionCore.tick(s, entry: 0, set: 1, w: 60, r: 8, at: 2, id: "e3", effort: Effort.Rating(kind: "x", value: 3))
        XCTAssertNil(odd?["x"], "a scale the phone does not know is not sent")
    }

    func testColoursFollowThePhonesBandsInEitherScale() {
        XCTAssertEqual(Effort.band("rir", 0), 0)
        XCTAssertEqual(Effort.band("rpe", 10), 0, "RPE 10 is RIR 0")
        XCTAssertEqual(Effort.band("rpe", 8), Effort.band("rir", 2))
        XCTAssertEqual(Effort.band("rir", 5), 5)
    }

    func testTheProfilesScaleArrivesInTheSettings() throws {
        let snap = try JSONDecoder().decode(Snapshot.self, from: Data(#"{"v":1,"settings":{"effort":"rir"}}"#.utf8))
        XCTAssertEqual(snap.settings?.effort, "rir")
        let old = try JSONDecoder().decode(Snapshot.self, from: Data(#"{"v":1,"settings":{}}"#.utf8))
        XCTAssertNil(old.settings?.effort)
    }
}

/// The dial's timing: one update per burst, settled after 5 s, let go at once on any exit.
final class EffortDialTests: XCTestCase {
    private let t = Date(timeIntervalSince1970: 1000)

    func testABurstOfChangesGoesOutOnceAfterTheLastOne() {
        var d = EffortDial()
        d.arm(at: t)
        XCTAssertFalse(d.sendDue(at: t.addingTimeInterval(1)), "nothing changed: nothing to send")
        d.change(at: t.addingTimeInterval(1))
        d.change(at: t.addingTimeInterval(1.4))
        XCTAssertFalse(d.sendDue(at: t.addingTimeInterval(1.9)), "0.5 s after the last change")
        XCTAssertTrue(d.sendDue(at: t.addingTimeInterval(2.0)), "0.6 s after the last change")
        d.sent()
        XCTAssertFalse(d.sendDue(at: t.addingTimeInterval(3)))
    }

    func testItSettlesFiveSecondsAfterTheLastTouchAndAChangeRestartsThat() {
        var d = EffortDial()
        XCTAssertFalse(d.settleDue(at: t.addingTimeInterval(60)), "never armed")
        d.arm(at: t)
        XCTAssertFalse(d.settleDue(at: t.addingTimeInterval(4.9)))
        d.change(at: t.addingTimeInterval(4))
        XCTAssertFalse(d.settleDue(at: t.addingTimeInterval(5)))
        XCTAssertTrue(d.settleDue(at: t.addingTimeInterval(9)))
        d.sent()
        d.touch(at: t.addingTimeInterval(8))
        XCTAssertFalse(d.settleDue(at: t.addingTimeInterval(9)), "a touch at the end of the scale keeps it armed")
        XCTAssertFalse(d.sendDue(at: t.addingTimeInterval(9)), "and sends nothing")
    }

    func testLettingGoSaysWhetherAValueIsStillWaiting() {
        var d = EffortDial()
        d.arm(at: t)
        d.change(at: t.addingTimeInterval(1))
        XCTAssertTrue(d.disarm(), "flush it now")
        XCTAssertFalse(d.armed)
        XCTAssertFalse(d.sendDue(at: t.addingTimeInterval(9)), "and it is not sent twice")
        d.arm(at: t)
        XCTAssertFalse(d.disarm(), "nothing changed since the chip: the chip already sent it")
    }
}
