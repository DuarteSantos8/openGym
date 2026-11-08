import XCTest
@testable import WatchCore

final class GesturesTests: XCTestCase {
    private let all: [GestureScreen] = [.start, .weighIn, .countdown, .set, .timedSet, .holdRunning, .rest, .cardio, .fixing,
                                        .exerciseDone, .allDone, .overview, .metrics, .music, .stillTraining, .summary]

    func testSmartIsTheScreensMainNonDestructiveAction() {
        let want: [GestureScreen: GestureEffect?] = [
            .set: .logSet, .rest: .skipRest, .timedSet: .startHold, .holdRunning: .stopHold, .stillTraining: .keepGoing,
            .summary: .closeSummary, .exerciseDone: .nextExercise, .allDone: .goToOverview,
            .start: nil, .weighIn: nil, .cardio: nil, .fixing: nil, .overview: nil, .metrics: nil, .music: nil,
        ]
        for (screen, effect) in want {
            for input in [GestureInput.doubleTap, .actionButton] {
                XCTAssertEqual(Gestures.resolve(choice: "smart", input: input, screen: screen), effect, "\(screen) \(input)")
                XCTAssertEqual(Gestures.resolve(choice: nil, input: input, screen: screen), effect, "default \(screen)")
            }
        }
        XCTAssertEqual(Gestures.resolve(choice: "smart", input: .doubleTap, screen: .countdown), .startNow)
        XCTAssertNil(Gestures.resolve(choice: "smart", input: .actionButton, screen: .countdown))
    }

    func testAChoiceAppliesOnItsScreenAndOtherwiseFallsBackToSmart() {
        for input in [GestureInput.doubleTap, .actionButton] {
            XCTAssertEqual(Gestures.resolve(choice: "logSet", input: input, screen: .set), .logSet)
            XCTAssertEqual(Gestures.resolve(choice: "logSet", input: input, screen: .rest), .skipRest)
            XCTAssertEqual(Gestures.resolve(choice: "skipRest", input: input, screen: .rest), .skipRest)
            XCTAssertEqual(Gestures.resolve(choice: "skipRest", input: input, screen: .set), .logSet)
            XCTAssertEqual(Gestures.resolve(choice: "addRest", input: input, screen: .rest), .addRest)
            XCTAssertEqual(Gestures.resolve(choice: "addRest", input: input, screen: .timedSet), .startHold)
            XCTAssertEqual(Gestures.resolve(choice: "hold", input: input, screen: .timedSet), .startHold)
            XCTAssertEqual(Gestures.resolve(choice: "hold", input: input, screen: .holdRunning), .stopHold)
            XCTAssertEqual(Gestures.resolve(choice: "hold", input: input, screen: .rest), .skipRest)
            for s: GestureScreen in [.set, .timedSet, .rest, .exerciseDone] {
                XCTAssertEqual(Gestures.resolve(choice: "nextExercise", input: input, screen: s), .nextExercise)
            }
            XCTAssertEqual(Gestures.resolve(choice: "nextExercise", input: input, screen: .holdRunning), .stopHold)
            XCTAssertNil(Gestures.resolve(choice: "nextExercise", input: input, screen: .overview))
        }
    }

    func testNoneAndUnknownValues() {
        for s in all { XCTAssertNil(Gestures.resolve(choice: "none", input: .actionButton, screen: s)) }
        for bad in ["finish", "", "Smart", "discard"] {
            XCTAssertEqual(Gestures.resolve(choice: bad, input: .doubleTap, screen: .rest), .skipRest)
        }
        XCTAssertEqual(GestureAction(setting: "garbage"), .smart)
        XCTAssertEqual(GestureAction(setting: nil), .smart)
        XCTAssertEqual(GestureAction.allCases.map(\.rawValue), ["smart", "logSet", "skipRest", "addRest", "hold", "nextExercise", "showMetrics", "none"])
    }

    func testDoubleTapNeverShowsMetricsAndTheActionButtonDoes() {
        for s in all {
            XCTAssertNotEqual(Gestures.resolve(choice: "showMetrics", input: .doubleTap, screen: s), .showMetrics, "\(s)")
        }
        XCTAssertEqual(Gestures.resolve(choice: "showMetrics", input: .doubleTap, screen: .rest), .skipRest)
        XCTAssertNil(Gestures.resolve(choice: "showMetrics", input: .doubleTap, screen: .overview))
        XCTAssertEqual(Gestures.resolve(choice: "showMetrics", input: .actionButton, screen: .overview), .showMetrics)
        XCTAssertEqual(Gestures.resolve(choice: "showMetrics", input: .actionButton, screen: .rest), .showMetrics)
        // Already there, or not in a workout: Smart.
        XCTAssertNil(Gestures.resolve(choice: "showMetrics", input: .actionButton, screen: .metrics))
        XCTAssertNil(Gestures.resolve(choice: "showMetrics", input: .actionButton, screen: .start))
        XCTAssertEqual(Gestures.resolve(choice: "showMetrics", input: .actionButton, screen: .summary), .closeSummary)
    }

    func testNothingResolvesToFinishOrDiscard() {
        // The effect list has no such case; the overview, where Finish lives, resolves to nothing blind.
        XCTAssertNil(Gestures.resolve(choice: "smart", input: .doubleTap, screen: .overview))
        XCTAssertNil(Gestures.resolve(choice: "smart", input: .actionButton, screen: .overview))
    }

    func testTheNewSettingsAreOptionalAndDecodeLoosely() throws {
        let st = try JSONDecoder().decode(WatchSettings.self, from: Data(#"{"doubleTap":"skipRest","actionButton":"weird","gestureTest":1234}"#.utf8))
        XCTAssertEqual(st.doubleTap, "skipRest")
        XCTAssertEqual(GestureAction(setting: st.actionButton), .smart)
        XCTAssertEqual(st.gestureTest, 1234)
        let none = try JSONDecoder().decode(WatchSettings.self, from: Data("{}".utf8))
        XCTAssertNil(none.doubleTap); XCTAssertNil(none.actionButton); XCTAssertNil(none.gestureTest)
        XCTAssertEqual(Gestures.testOkEvent, "gestureTestOk")
        XCTAssertEqual(Gestures.buttonSeenEvent, "actionButtonSeen")
    }
}
