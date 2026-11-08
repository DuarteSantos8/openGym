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

/// The page of the session screen on show (the watch's SessionTab, without the UI).
enum GesturePage { case overview, set, metrics, music }

enum GestureEntryKind { case reps, timed, cardio }

/// What the watch shows, as plain flags the app fills from its state, in the order RootView and
/// LivePage pick their screen.
struct GestureSituation: Equatable {
    var weighIn = false
    var summary = false
    /// A workout runs.
    var workout = false
    /// The 3-2-1 before a workout, or before a hold that starts by itself.
    var countdown = false
    var stillTraining = false
    var page: GesturePage = .set
    var holdRunning = false
    var fixing = false
    var resting = false
    /// The exercise on the set page; nil: past the last one.
    var entry: GestureEntryKind?
    /// The exercise has a set left to do on the set page.
    var setOpen = true
}

extension Gestures {
    static func screen(_ s: GestureSituation) -> GestureScreen {
        if s.weighIn { return .weighIn }
        if s.summary { return .summary }
        if !s.workout { return s.countdown ? .countdown : .start }
        if s.stillTraining { return .stillTraining }
        switch s.page {
        case .overview: return .overview
        case .metrics: return .metrics
        case .music: return .music
        case .set: break
        }
        // The set page's panels, in the order LivePage shows them.
        if s.countdown { return .countdown }
        if s.holdRunning { return .holdRunning }
        if s.fixing { return .fixing }
        if s.resting { return .rest }
        guard let kind = s.entry else { return .allDone }
        if !s.setOpen { return .exerciseDone }
        switch kind {
        case .cardio: return .cardio
        case .timed: return .timedSet
        case .reps: return .set
        }
    }

    /// The exercise "next exercise" goes to: the next one after `current` with a work set left
    /// (wrapping round), not a partner of the same superset and not cardio (that is logged on the
    /// phone). nil when there is none.
    static func nextExercise(_ entries: [Entry], from current: Int) -> Int? {
        guard entries.indices.contains(current) else { return nil }
        let group = entries[current].group
        for step in 1..<max(entries.count, 1) {
            let i = (current + step) % entries.count
            let e = entries[i]
            if e.isCardio || (group != nil && e.group == group) { continue }
            if e.sets.contains(where: { !$0.done }) { return i }
        }
        return nil
    }
}

/// The phone's "test it" ping (settings.gestureTest, an ms stamp).
enum GestureTest {
    /// How long the watch waits for the pinch before it closes the sheet by itself.
    static let seconds: Double = 30
    /// A stamp older than this is not a ping meant for now (a snapshot that sat in the queue).
    static let freshMs: Double = 120_000

    /// Whether a stamp from the phone opens the sheet: newer than the last one answered, and fresh.
    static func shows(stamp: Double?, seen: Double?, now: Double) -> Bool {
        guard let stamp = stamp, stamp.isFinite, stamp > 0 else { return false }
        if let seen = seen, stamp <= seen { return false }
        return now - stamp <= freshMs
    }
}
