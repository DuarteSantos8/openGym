import AppIntents

/*
 * The Apple Watch Ultra's Action Button, for a lifter who set it to Workout → openGym (Watch
 * Settings → Action Button; the app cannot do that step for them). The system offers
 * StartGymWorkoutIntent as the first press; once a workout runs, a later press runs the intent
 * donated with the start (WorkoutNextActionIntent), which does what the phone's Settings → Apple
 * Watch chose, through WatchCore's Gestures rules. Action + side button pause and resume.
 *
 * These live in the watch app, not an extension: the system needs them in the app that holds the
 * workout session. Each runs in the app's process, on the one SessionStore.
 */

enum GymWorkoutStyle: String, AppEnum {
    // The watch starts a routine the phone planned, so there is one style: today's.
    case today

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Workout"
    static let caseDisplayRepresentations: [GymWorkoutStyle: DisplayRepresentation] = [.today: "Today’s workout"]
}

/// The first press. Starts today's workout the way the Start button does, within the 30 seconds
/// the system gives. Apple Health's permission is asked by the phone's switch (WorkoutManager),
/// as Apple's sample asks it up front; until it is answered the system only opens the app.
struct StartGymWorkoutIntent: StartWorkoutIntent {
    static let title: LocalizedStringResource = "Start workout"

    @Parameter(title: "Workout") var workoutStyle: GymWorkoutStyle

    init() {}

    static var suggestedWorkouts: [StartGymWorkoutIntent] { GymWorkoutStyle.allCases.map { StartGymWorkoutIntent(style: $0) } }

    var displayRepresentation: DisplayRepresentation { GymWorkoutStyle.caseDisplayRepresentations[workoutStyle] ?? "Workout" }

    @MainActor
    func perform() async throws -> some IntentResult {
        SessionStore.shared.startFromActionButton()
        return .result(actionButtonIntent: WorkoutNextActionIntent())
    }
}

/// Every later press while a workout runs.
struct WorkoutNextActionIntent: AppIntent {
    static let title: LocalizedStringResource = "Workout action"

    @MainActor
    func perform() async throws -> some IntentResult {
        SessionStore.shared.actionButtonPressed()
        return .result()
    }
}

/// Action Button and side button together: the workout session pauses, as it does when nothing
/// happens for a long while (SessionStore.noteActivity brings it back with the next set).
struct PauseGymWorkoutIntent: PauseWorkoutIntent {
    static let title: LocalizedStringResource = "Pause workout"

    @MainActor
    func perform() async throws -> some IntentResult {
        SessionStore.shared.health.pause()
        return .result()
    }
}

struct ResumeGymWorkoutIntent: ResumeWorkoutIntent {
    static let title: LocalizedStringResource = "Resume workout"

    @MainActor
    func perform() async throws -> some IntentResult {
        SessionStore.shared.health.resume()
        return .result()
    }
}

enum ActionButton {
    /// Tells the system what a later press runs. Only the newest donation counts; called when a
    /// workout starts (here, from the intent or from the phone). The intent reads the setting when it
    /// runs, so a change of setting needs no new donation.
    static func donate(_ store: SessionStore) {
        guard !store.isDemo else { return }
        Task {
            // Failing is not fatal: the later press then does nothing, the first one still starts.
            _ = try? await StartGymWorkoutIntent(style: .today).donate(result: .result(actionButtonIntent: WorkoutNextActionIntent()))
        }
    }
}
