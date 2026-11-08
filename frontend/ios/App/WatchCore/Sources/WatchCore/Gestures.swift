import Foundation

/// What a lifter may pick for Double Tap or the Action Button (frontend lib/watch-settings.js
/// GESTURE_ACTIONS: same ids). Never Finish, Discard or anything destructive.
enum GestureAction: String, CaseIterable {
    case smart, logSet, skipRest, addRest, hold, nextExercise, showMetrics, none

    /// An unknown or missing value (an older or newer phone) reads as Smart.
    init(setting: String?) { self = setting.flatMap(GestureAction.init(rawValue:)) ?? .smart }
}

enum GestureInput: Equatable { case doubleTap, actionButton }

/// Where the watch is, as the app fills it from its state (RootView.screen, SessionTab, store.restEndsAt ...).
enum GestureScreen: Equatable {
    case start          // idle start screen: the system's start intent owns the first Action Button press
    case weighIn        // would save a number the lifter never saw
    case countdown      // 3-2-1
    case set            // an open work set, nothing else running
    case timedSet       // a timed hold ready to start
    case holdRunning
    case rest
    case cardio, fixing // logged on the phone / editing a logged set: nothing blind
    case exerciseDone, allDone
    case overview, metrics, music // scrolling pages: Apple HIG sets no primary action there
    case stillTraining
    case summary
}

/// What the watch then does. Smart can mean more than the pickable ids (keep going, close), so this
/// is its own list.
enum GestureEffect: Equatable {
    case logSet, skipRest, addRest, startHold, stopHold, nextExercise, showMetrics
    case keepGoing, closeSummary, startNow, goToOverview
}

enum Gestures {
    /// Watch to phone events (frontend GESTURE_EVENTS).
    static let testOkEvent = "gestureTestOk"
    static let buttonSeenEvent = "actionButtonSeen"

    /// The chosen action if it applies to what the watch shows now, otherwise Smart. nil: do nothing
    /// (also for "none"). Never showMetrics for Double Tap: it can only press a button on screen.
    static func resolve(choice: String?, input: GestureInput, screen: GestureScreen) -> GestureEffect? {
        let action = GestureAction(setting: choice)
        if action == .none { return nil }
        return picked(action, input, screen) ?? smart(input, screen)
    }

    private static func picked(_ a: GestureAction, _ input: GestureInput, _ s: GestureScreen) -> GestureEffect? {
        switch (a, s) {
        case (.logSet, .set): return .logSet
        case (.skipRest, .rest): return .skipRest
        case (.addRest, .rest): return .addRest
        case (.hold, .timedSet): return .startHold
        case (.hold, .holdRunning): return .stopHold
        case (.nextExercise, .set), (.nextExercise, .timedSet), (.nextExercise, .rest), (.nextExercise, .exerciseDone): return .nextExercise
        case (.showMetrics, .set), (.showMetrics, .timedSet), (.showMetrics, .holdRunning), (.showMetrics, .rest),
             (.showMetrics, .exerciseDone), (.showMetrics, .allDone), (.showMetrics, .overview), (.showMetrics, .music):
            return input == .actionButton ? .showMetrics : nil
        default: return nil
        }
    }

    private static func smart(_ input: GestureInput, _ s: GestureScreen) -> GestureEffect? {
        switch s {
        case .set: return .logSet
        case .timedSet: return .startHold
        case .holdRunning: return .stopHold
        case .rest: return .skipRest
        case .stillTraining: return .keepGoing
        case .summary: return .closeSummary
        case .exerciseDone: return .nextExercise
        case .allDone: return .goToOverview
        // Harmless to start early; the Action Button's press there already belongs to the system.
        case .countdown: return input == .doubleTap ? .startNow : nil
        case .start, .weighIn, .cardio, .fixing, .overview, .metrics, .music: return nil
        }
    }
}
