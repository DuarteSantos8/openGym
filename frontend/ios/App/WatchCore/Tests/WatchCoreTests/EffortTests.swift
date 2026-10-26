import XCTest
@testable import WatchCore

/// RPE / RIR on the watch: the crown's notches, the event, the phone's colour bands.
final class EffortTests: XCTestCase {
    func testTheCrownGoesFromNotRatedThroughTheScaleEasyToHard() {
        XCTAssertNil(Effort.value("rpe", at: 0), "position 0 is not rated")
        XCTAssertEqual(Effort.value("rpe", at: 1), 6)
        XCTAssertEqual(Effort.value("rpe", at: 2), 6.5)
        XCTAssertEqual(Effort.value("rpe", at: 9), 10)
        XCTAssertEqual(Effort.value("rpe", at: 40), 10, "past the end it stays at the top")
        XCTAssertEqual(Effort.value("rir", at: 1), 5, "RIR starts easy too")
        XCTAssertEqual(Effort.value("rir", at: 6), 0)
        XCTAssertNil(Effort.value("none", at: 3))
    }

    func testAValueFindsItsNotchBack() {
        XCTAssertEqual(Effort.position("rpe", of: nil), 0)
        XCTAssertEqual(Effort.position("rpe", of: 8), 5)
        XCTAssertEqual(Effort.position("rpe", of: 8.4), 6, "the nearest notch, 8.5")
        XCTAssertEqual(Effort.position("rir", of: 2), 4)
        XCTAssertEqual(Effort.position("rir", of: 9), 1, "a phone value above the watch's RIR 5 lands on 5")
        for k in ["rpe", "rir"] {
            XCTAssertEqual(Effort.value(k, at: Effort.position(k, of: Effort.start(k))), Effort.start(k))
        }
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
