import XCTest
@testable import WatchCore

/// The sets logged here that the phone has not got yet, counted from the events still queued.
final class UnsentTests: XCTestCase {
    func set(_ ex: String = "0025", _ si: Int = 0, entry: Int = 0, wid: String = "w1", side: String? = nil, id: String = "e") -> String {
        var s = "{\"id\":\"\(id)\",\"type\":\"setDone\",\"wid\":\"\(wid)\",\"exId\":\"\(ex)\",\"entryIdx\":\(entry),\"setIdx\":\(si),\"at\":1000"
        if let side = side { s += ",\"side\":\"\(side)\"" }
        return s + "}"
    }

    func other(_ type: String) -> String { "{\"id\":\"x\",\"type\":\"\(type)\",\"wid\":\"w1\",\"at\":1000}" }

    func testNothingQueuedIsZero() {
        XCTAssertEqual(Unsent.sets(in: []), 0)
    }

    func testOnlySetsCount() {
        let events = [other("start"), set(), other("setHr"), other("watchStatus"), other("finish"), other("weighIn")]
        XCTAssertEqual(Unsent.sets(in: events), 1)
    }

    func testTheSameSetSentTwiceCountsOnce() {
        XCTAssertEqual(Unsent.sets(in: [set(id: "e1"), set(id: "e2")]), 1)
    }

    func testSidesAndOtherSetsCountSeparately() {
        XCTAssertEqual(Unsent.sets(in: [set(side: "L"), set(side: "R")]), 2)
        XCTAssertEqual(Unsent.sets(in: [set(), set("0426")]), 2, "another exercise")
        XCTAssertEqual(Unsent.sets(in: [set(), set(entry: 1)]), 2, "another entry")
        XCTAssertEqual(Unsent.sets(in: [set(), set(wid: "w2")]), 2, "another workout")
        XCTAssertEqual(Unsent.sets(in: [set(), set("0025", 1)]), 2, "another set")
    }

    func testGarbageIsIgnored() {
        let noEx = "{\"type\":\"setDone\",\"setIdx\":0}"
        let noSet = "{\"type\":\"setDone\",\"exId\":\"0025\"}"
        XCTAssertEqual(Unsent.sets(in: ["not json", "{}", noEx, noSet]), 0)
    }

    func testARealTickIsCounted() throws {
        let w = ActiveWorkout(id: "p1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil,
                              entries: [Entry(id: "0025", name: "Bench Press", mode: "reps", restSec: nil, last: nil,
                                              sets: [SetRow(w: 60, r: 8, sec: nil, done: false, warmup: false, at: nil)])])
        var s = SessionState()
        s.workout = w
        let event = try XCTUnwrap(SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1000, id: "e1").1)
        let json = String(data: try JSONSerialization.data(withJSONObject: event), encoding: .utf8)!
        XCTAssertEqual(Unsent.sets(in: [json]), 1)
    }
}
