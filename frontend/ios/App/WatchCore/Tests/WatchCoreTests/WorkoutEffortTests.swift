import XCTest
@testable import WatchCore

/// The whole workout's effort on the summary (the phone's lib/workout-effort.js).
final class WorkoutEffortTests: XCTestCase {
    private func summary(id: String?) -> WorkoutSummary {
        WorkoutSummary(name: "Push", unit: "kg", duration: 60, sets: 10, volume: 1000, prs: [], endedOnPhone: false, workoutId: id)
    }

    func testWordsFollowAppleFitnessBands() {
        XCTAssertEqual([1, 3, 4, 6, 7, 8, 9, 10].map(WorkoutEffort.word),
                       ["Easy", "Easy", "Moderate", "Moderate", "Hard effort", "Hard effort", "All out", "All out"])
    }

    func testStepStartsInTheMiddleAndStaysInRange() {
        XCTAssertEqual(WorkoutEffort.step(nil, by: 1), 5)
        XCTAssertEqual(WorkoutEffort.step(nil, by: -1), 5)
        XCTAssertEqual(WorkoutEffort.step(5, by: 1), 6)
        XCTAssertEqual(WorkoutEffort.step(10, by: 1), 10)
        XCTAssertEqual(WorkoutEffort.step(1, by: -1), 1)
    }

    func testAsksOnlyWhenThePhoneSaysSoAndTheWorkoutHasAnId() {
        var settings = WatchSettings()
        XCTAssertFalse(WorkoutEffort.asks(settings, summary(id: "w1")))
        settings.workoutEffort = "ask"
        XCTAssertTrue(WorkoutEffort.asks(settings, summary(id: "w1")))
        XCTAssertFalse(WorkoutEffort.asks(settings, summary(id: nil)))
        settings.workoutEffort = "auto"
        XCTAssertFalse(WorkoutEffort.asks(settings, summary(id: "w1")))
    }

    func testTheSettingComesFromThePhonesJSON() throws {
        let s = try JSONDecoder().decode(WatchSettings.self, from: Data(#"{"lang":"en","workoutEffort":"ask"}"#.utf8))
        XCTAssertEqual(s.workoutEffort, "ask")
        let none = try JSONDecoder().decode(WatchSettings.self, from: Data(#"{"lang":"en"}"#.utf8))
        XCTAssertNil(none.workoutEffort)
    }

    private func workout(_ entries: [Entry]) -> ActiveWorkout {
        ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: entries, start: 0)
    }
    private func entry(_ id: String, mode: String = "reps", sets: Int, warmups: Int = 0) -> Entry {
        let rows = (0..<sets).map { i in SetRow(w: 60, r: 8, sec: nil, done: true, warmup: i < warmups, at: 1) }
        return Entry(id: id, name: id, mode: mode, restSec: nil, last: nil, sets: rows)
    }
    private func rated(_ id: String, _ values: [Double]) -> [String: Double] {
        Dictionary(uniqueKeysWithValues: values.enumerated().map { (SessionCore.key(id, $0.offset), $0.element) })
    }

    func testPresetReadsASessionTheWayThePhoneDoes() {
        let w = workout([entry("0025", sets: 3)])
        // Mean RIR 2 → RPE 8, less 1.5 → 6.5, a half: the easier word (Moderate).
        XCTAssertEqual(WorkoutEffort.preset(w, efforts: rated("0025", [2, 2, 2]), kind: "rir"), 6)
        XCTAssertEqual(WorkoutEffort.preset(w, efforts: rated("0025", [1, 1, 1]), kind: "rir"), 7)
        XCTAssertEqual(WorkoutEffort.preset(w, efforts: rated("0025", [0, 0, 0]), kind: "rir"), 8)
        // RPE straight: 8 less 1.5.
        XCTAssertEqual(WorkoutEffort.preset(w, efforts: rated("0025", [8, 8, 8]), kind: "rpe"), 6)
    }

    func testPresetTakesNoOffsetOffCardioAndLeavesWarmUpsOut() {
        XCTAssertEqual(WorkoutEffort.preset(workout([entry("run", mode: "cardio", sets: 3)]), efforts: rated("run", [7, 7, 7]), kind: "rpe"), 7)
        // The warm-up's RIR 5 does not count; three work sets at RIR 2 do.
        XCTAssertEqual(WorkoutEffort.preset(workout([entry("0025", sets: 4, warmups: 1)]), efforts: rated("0025", [5, 2, 2, 2]), kind: "rir"), 6)
    }

    func testNoPresetWithTooFewRatedSets() {
        let w = workout([entry("0025", sets: 3)])
        XCTAssertNil(WorkoutEffort.preset(w, efforts: rated("0025", [2, 2]), kind: "rir"))
        XCTAssertNil(WorkoutEffort.preset(w, efforts: nil, kind: "rir"))
        XCTAssertNil(WorkoutEffort.preset(w, efforts: rated("0025", [2, 2, 2]), kind: nil))
    }
}
