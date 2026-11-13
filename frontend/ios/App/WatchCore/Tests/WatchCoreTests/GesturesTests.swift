import XCTest
@testable import WatchCore

final class GesturesTests: XCTestCase {
    private let all: [GestureScreen] = [.start, .weighIn, .countdown, .set, .timedSet, .holdRunning, .rest, .cardio, .fixing,
                                        .exerciseDone, .allDone, .overview, .metrics, .music, .stillTraining, .summary]

    func testSmartIsTheScreensMainNonDestructiveAction() {
        let want: [GestureScreen: GestureEffect?] = [
            .set: .logSet, .rest: .skipRest, .timedSet: .startHold, .holdRunning: .stopHold, .stillTraining: .keepGoing,
            .summary: .closeSummary, .allDone: .goToOverview,
            .start: nil, .weighIn: nil, .cardio: nil, .fixing: nil, .overview: nil, .metrics: nil, .music: nil,
        ]
        for (screen, effect) in want {
            for input in [GestureInput.doubleTap, .actionButton] {
                XCTAssertEqual(Gestures.resolve(choice: "smart", input: input, screen: screen), effect, "\(screen) \(input)")
            }
            XCTAssertEqual(Gestures.resolve(choice: nil, input: .actionButton, screen: screen), effect, "default \(screen)")
        }
        // Next exercise has no button to press: the Action Button only, and only with another exercise to go to.
        XCTAssertEqual(Gestures.resolve(choice: "smart", input: .actionButton, screen: .exerciseDone), .nextExercise)
        XCTAssertNil(Gestures.resolve(choice: "smart", input: .doubleTap, screen: .exerciseDone))
        XCTAssertNil(Gestures.resolve(choice: "smart", input: .actionButton, screen: .exerciseDone, canGoNext: false))
        XCTAssertEqual(Gestures.resolve(choice: "smart", input: .doubleTap, screen: .countdown), .startNow)
        XCTAssertNil(Gestures.resolve(choice: "smart", input: .actionButton, screen: .countdown))
    }

    func testAChoiceAppliesOnItsScreenAndOtherwiseFallsBackToSmart() {
        for input in [GestureInput.doubleTap, .actionButton] {
            XCTAssertEqual(Gestures.resolve(choice: "logSet", input: input, screen: .set), .logSet)
            XCTAssertEqual(Gestures.resolve(choice: "logSet", input: input, screen: .rest), .skipRest)
            XCTAssertEqual(Gestures.resolve(choice: "skipRest", input: input, screen: .rest), .skipRest)
            XCTAssertEqual(Gestures.resolve(choice: "addRest", input: input, screen: .rest), .addRest)
            XCTAssertEqual(Gestures.resolve(choice: "addRest", input: input, screen: .timedSet), .startHold)
            XCTAssertEqual(Gestures.resolve(choice: "hold", input: input, screen: .timedSet), .startHold)
            XCTAssertEqual(Gestures.resolve(choice: "hold", input: input, screen: .holdRunning), .stopHold)
            XCTAssertEqual(Gestures.resolve(choice: "hold", input: input, screen: .rest), .skipRest)
            XCTAssertEqual(Gestures.resolve(choice: "nextExercise", input: input, screen: .holdRunning), .stopHold)
            XCTAssertNil(Gestures.resolve(choice: "nextExercise", input: input, screen: .overview))
        }
        for s: GestureScreen in [.set, .timedSet, .rest, .exerciseDone] {
            XCTAssertEqual(Gestures.resolve(choice: "nextExercise", input: .actionButton, screen: s), .nextExercise)
            XCTAssertNotEqual(Gestures.resolve(choice: "nextExercise", input: .doubleTap, screen: s), .nextExercise, "no button on screen")
        }
        // Nothing to go to: what Smart does here (nothing, when that is the same).
        XCTAssertEqual(Gestures.resolve(choice: "nextExercise", input: .actionButton, screen: .set, canGoNext: false), .logSet)
        XCTAssertNil(Gestures.resolve(choice: "nextExercise", input: .actionButton, screen: .exerciseDone, canGoNext: false))
    }

    func testAPinchTheLifterDidNotChooseNeverLogsASet() {
        // The default for Double Tap is Skip rest: gripping a bar, a pinch on a set does nothing.
        XCTAssertNil(Gestures.resolve(choice: nil, input: .doubleTap, screen: .set))
        XCTAssertNil(Gestures.resolve(choice: "skipRest", input: .doubleTap, screen: .set))
        XCTAssertNil(Gestures.resolve(choice: "hold", input: .doubleTap, screen: .set))
        XCTAssertEqual(Gestures.resolve(choice: nil, input: .doubleTap, screen: .rest), .skipRest)
        XCTAssertEqual(Gestures.resolve(choice: nil, input: .doubleTap, screen: .summary), .closeSummary)
        // Chosen on purpose (Smart, Complete set), or a button press: it does.
        XCTAssertEqual(Gestures.resolve(choice: "smart", input: .doubleTap, screen: .set), .logSet)
        XCTAssertEqual(Gestures.resolve(choice: "logSet", input: .doubleTap, screen: .set), .logSet)
        XCTAssertEqual(Gestures.resolve(choice: "skipRest", input: .actionButton, screen: .set), .logSet)
    }

    func testNoneAndUnknownValues() {
        for s in all { XCTAssertNil(Gestures.resolve(choice: "none", input: .actionButton, screen: s)) }
        for bad in ["finish", "", "Smart", "discard"] {
            XCTAssertEqual(Gestures.resolve(choice: bad, input: .doubleTap, screen: .rest), .skipRest)
            XCTAssertEqual(Gestures.resolve(choice: bad, input: .actionButton, screen: .set), .logSet)
        }
        XCTAssertEqual(GestureAction(setting: "garbage", input: .actionButton), .smart)
        XCTAssertEqual(GestureAction(setting: nil, input: .actionButton), .smart)
        XCTAssertEqual(GestureAction(setting: nil, input: .doubleTap), .skipRest)
        // The ids the phone's GESTURE_ACTIONS sends.
        for id in ["smart", "logSet", "skipRest", "addRest", "hold", "nextExercise", "showMetrics", "none"] {
            XCTAssertEqual(GestureAction(rawValue: id)?.rawValue, id)
        }
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
        XCTAssertEqual(GestureAction(setting: st.actionButton, input: .actionButton), .smart)
        XCTAssertEqual(st.gestureTest, 1234)
        let none = try JSONDecoder().decode(WatchSettings.self, from: Data("{}".utf8))
        XCTAssertNil(none.doubleTap); XCTAssertNil(none.actionButton); XCTAssertNil(none.gestureTest)
        XCTAssertEqual(Gestures.testOkEvent, "gestureTestOk")
        XCTAssertEqual(Gestures.buttonSeenEvent, "actionButtonSeen")
    }

    func testTheEventsCarryWhatThePhoneReads() {
        // The phone (noteGestureEvent) trusts `stamp` over the watch's clock `at`.
        let ok = Gestures.event(Gestures.testOkEvent, id: "i", at: 5_000, stamp: 1_234)
        XCTAssertEqual(ok["type"] as? String, "gestureTestOk")
        XCTAssertEqual(ok["stamp"] as? Double, 1_234)
        XCTAssertEqual(ok["at"] as? Double, 5_000)
        XCTAssertEqual(ok["id"] as? String, "i")
        XCTAssertNil(Gestures.event(Gestures.buttonSeenEvent, id: "i", at: 5_000)["stamp"])
    }

    // MARK: where the watch is

    func testScreenFollowsTheOrderTheViewsPick() {
        var s = GestureSituation()
        XCTAssertEqual(Gestures.screen(s), .start)
        s.countdown = true
        XCTAssertEqual(Gestures.screen(s), .countdown)
        s.summary = true
        XCTAssertEqual(Gestures.screen(s), .summary, "a summary comes before the countdown")
        s.weighIn = true
        XCTAssertEqual(Gestures.screen(s), .weighIn)

        s = GestureSituation(workout: true, entry: .reps)
        XCTAssertEqual(Gestures.screen(s), .set)
        s.entry = .timed
        XCTAssertEqual(Gestures.screen(s), .timedSet)
        s.entry = .cardio
        XCTAssertEqual(Gestures.screen(s), .cardio)
        s.setOpen = false
        XCTAssertEqual(Gestures.screen(s), .exerciseDone)
        s.entry = nil
        XCTAssertEqual(Gestures.screen(s), .allDone)

        s = GestureSituation(workout: true, entry: .reps)
        s.resting = true
        XCTAssertEqual(Gestures.screen(s), .rest)
        s.fixing = true
        XCTAssertEqual(Gestures.screen(s), .fixing, "a set being fixed hides the rest")
        s.holdRunning = true
        XCTAssertEqual(Gestures.screen(s), .holdRunning)
        s.countdown = true
        XCTAssertEqual(Gestures.screen(s), .countdown, "the hold's 3-2-1 comes first")
    }

    func testOtherPagesAndThePromptWinOverTheSetPage() {
        var s = GestureSituation(workout: true, entry: .reps)
        s.resting = true
        for (page, screen) in [(GesturePage.overview, GestureScreen.overview), (.metrics, .metrics), (.music, .music)] {
            s.page = page
            XCTAssertEqual(Gestures.screen(s), screen)
        }
        s.stillTraining = true
        XCTAssertEqual(Gestures.screen(s), .stillTraining)
    }

    // MARK: next exercise

    private func entry(_ id: String, done: [Bool], group: String? = nil, mode: String = "reps") -> Entry {
        var e = Entry(id: id, name: id, mode: mode, restSec: nil, last: nil,
                      sets: done.map { SetRow(w: 50, r: 8, sec: nil, done: $0, warmup: false) })
        e.group = group
        return e
    }

    func testNextExerciseSkipsFinishedCardioAndSupersetPartners() {
        let list = [entry("a", done: [true, false]), entry("b", done: [true]), entry("c", done: [false], mode: "cardio"),
                    entry("d", done: [false], group: "g"), entry("e", done: [false], group: "g")]
        XCTAssertEqual(Gestures.nextExercise(list, from: 0), 3, "b is finished and c is cardio")
        XCTAssertEqual(Gestures.nextExercise(list, from: 3), 0, "not its partner e: wraps round to a")
        XCTAssertNil(Gestures.nextExercise([entry("a", done: [false])], from: 0), "the only one")
        XCTAssertNil(Gestures.nextExercise([entry("a", done: [false]), entry("b", done: [true])], from: 0))
        XCTAssertNil(Gestures.nextExercise(list, from: 9))
        XCTAssertNil(Gestures.nextExercise([], from: 0))
    }

    // MARK: the test ping

    func testAPingOpensTheSheetOnlyOnceAndOnlyWhenFresh() {
        let now = 1_000_000_000_000.0
        XCTAssertTrue(GestureTest.shows(stamp: now - 5_000, seen: nil, now: now))
        XCTAssertTrue(GestureTest.shows(stamp: now - 5_000, seen: now - 60_000, now: now))
        XCTAssertFalse(GestureTest.shows(stamp: now - 5_000, seen: now - 5_000, now: now), "answered already")
        XCTAssertFalse(GestureTest.shows(stamp: now - 5_000, seen: now, now: now), "an older one than the last")
        XCTAssertFalse(GestureTest.shows(stamp: now - GestureTest.freshMs - 1, seen: nil, now: now), "it sat in the queue")
        XCTAssertFalse(GestureTest.shows(stamp: nil, seen: nil, now: now))
        XCTAssertFalse(GestureTest.shows(stamp: 0, seen: nil, now: now))
        XCTAssertFalse(GestureTest.shows(stamp: .infinity, seen: nil, now: now))
        XCTAssertTrue(GestureTest.shows(stamp: now + 3_000, seen: nil, now: now), "a clock a little ahead")
    }
}
