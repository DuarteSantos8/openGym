import XCTest
@testable import WatchCore

/// An exercise in a weight unit of its own (#657): the phone sends its weights in that unit with
/// `unit` on the entry, and the summary still counts the workout in the workout's unit.
final class ExUnitTests: XCTestCase {
    func testTheEntryUnitIsReadAndAnOlderPhoneSendsNone() throws {
        let json = #"{"id":"0025","name":"Bench","mode":"reps","sets":[{"w":135,"r":5,"done":false,"warmup":false}],"unit":"lb"}"#
        let e = try JSONDecoder().decode(Entry.self, from: Data(json.utf8))
        XCTAssertEqual(e.weightUnit("kg"), "lb")
        let old = try JSONDecoder().decode(Entry.self, from: Data(#"{"id":"0043","name":"Squat","mode":"reps","sets":[]}"#.utf8))
        XCTAssertNil(old.unit)
        XCTAssertEqual(old.weightUnit("kg"), "kg")
        XCTAssertEqual(old.factor(to: "kg"), 1)
    }

    func testTheSummaryCountsAPinnedExerciseInTheWorkoutsUnit() {
        var bench = Entry(id: "0025", name: "Bench", mode: "reps", restSec: nil, last: nil,
                          sets: [SetRow(w: 100, r: 10, sec: nil, done: true, warmup: false, at: 1)])
        bench.unit = "lb"
        let squat = Entry(id: "0043", name: "Squat", mode: "reps", restSec: nil, last: nil,
                          sets: [SetRow(w: 100, r: 5, sec: nil, done: true, warmup: false, at: 2)])
        let w = ActiveWorkout(id: "w1", name: "Mixed", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: [bench, squat], start: 0)
        // 100 lb × 10 is 453.59 kg, beside the squat's 500 kg.
        XCTAssertEqual(SessionCore.summary(w, end: 1).volume, 953.59237, accuracy: 1e-6)
    }
}
