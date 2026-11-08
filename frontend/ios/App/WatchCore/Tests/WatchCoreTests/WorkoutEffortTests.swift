import XCTest
@testable import WatchCore

/// The whole workout's effort on the summary (the phone's lib/workout-effort.js).
final class WorkoutEffortTests: XCTestCase {
    private func summary(id: String?) -> WorkoutSummary {
        WorkoutSummary(name: "Push", unit: "kg", duration: 60, sets: 10, volume: 1000, prs: [], endedOnPhone: false, workoutId: id)
    }

    func testWordsFollowAppleFitnessBands() {
        XCTAssertEqual([1, 3, 4, 6, 7, 8, 9, 10].map(WorkoutEffort.word),
                       ["Easy", "Easy", "Moderate", "Moderate", "Hard", "Hard", "All out", "All out"])
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
}
