import Foundation

/*
 * What the phone sends the watch (frontend lib/watch-sync.js buildSnapshot), as the watch reads
 * it. Plain data, no media. Every field the phone may leave out is optional, so an older or a
 * newer phone never makes the watch fail to read a snapshot.
 */

struct Snapshot: Codable, Equatable {
    var v: Int
    var unit: String?
    var restSec: Double?
    var active: ActiveWorkout?
    var ready: Ready?
    var settings: WatchSettings?
    /// Apple Health sync ids of workouts deleted in openGym ("opengym-w-<id>", newest first): the
    /// watch takes out the copies it saved itself, which the phone may not delete.
    var healthGone: [String]?
    /// Workouts discarded on the phone lately (their ids): one of these that leaves the snapshot
    /// was not finished, so the watch drops its Apple Health workout instead of saving it (#776).
    var discarded: [String]?
    /// The ids of this watch's events the phone has applied lately (1.4.5): the outbox lets go of
    /// them, and the watch's own copy of a set it ticked gives way to the phone's.
    var acked: [String]?
}

/// What the watch can start by itself: today's planned session and a few other routines.
struct Ready: Codable, Equatable {
    var today: ReadySession?
    var others: [ReadySession]
}

struct ReadySession: Codable, Equatable {
    var routineIds: [String]
    var name: String
    var entries: [Entry]
    /// Apple Health's workout type for it (lib/health-connect.js plannedType, #799); none from an older phone.
    var healthType: String?
}

struct ActiveWorkout: Codable, Equatable {
    var id: String?
    var name: String
    var unit: String
    var cur: Int
    var restSec: Double
    var rest: RestInfo?
    var entries: [Entry]
    /// When it started (ms since 1970), for the summary's duration.
    var start: Double?
    /// Apple Health's workout type for it (#799); none: strength training, as before.
    var healthType: String?
    /// When it was last worked on on the phone (ms): a set ticked, an edit, the app opened with it
    /// (#904). The forgotten-workout check counts from it as from a set logged here.
    var activeAt: Double? = nil
    /// Paused on the phone at this moment (ms, #976): the workout clock stands still until it
    /// resumes, when `start` moves on by the pause. Older phones never send it.
    var pausedAt: Double? = nil
    /// The phone walked out of the gym at this moment (ms) during this workout (forgotten
    /// workouts, 1.4.5): "Looks like you left the gym" at once. Older phones never send it.
    var leftGymAt: Double? = nil
}

struct RestInfo: Codable, Equatable {
    var endsAt: Double
}

struct Entry: Codable, Equatable {
    var id: String
    var name: String
    /// "reps", "time" (a hold, `sec` per set) or "cardio" (logged on the phone).
    var mode: String
    var restSec: Double?
    var last: String?
    var sets: [SetRow]
    /// No load of its own: `w` is added weight, shown only when there is some.
    var bodyweight: Bool?
    /// Unilateral: each set is done one side at a time (`sides`).
    var perSide: Bool?
    /// A superset: neighbours with the same group are done in turns, the rest after each round.
    var group: String?
    /// The best set before this workout, for the PRs at the finish.
    var best: BestSet?
    /// Assisted (a lighter weight is the better one).
    var assisted: Bool?
    /// The weight step this exercise moves in on the phone (its plates or machine stack).
    var step: Double?
    /// Its own weight unit, "kg" or "lb", when it is not the workout's (#657): its weights, last
    /// time, best and step are in it, and so is what the watch sends back. None: the workout's.
    var unit: String?

    var isTimed: Bool { mode == "time" }
    var isCardio: Bool { mode == "cardio" }
    var isBodyweight: Bool { bodyweight == true }
    /// The unit this exercise's weights are shown and typed in.
    func weightUnit(_ workoutUnit: String) -> String { unit ?? workoutUnit }
    /// What one of its kilos or pounds is in `workoutUnit`, for a total that mixes exercises.
    func factor(to workoutUnit: String) -> Double {
        let own = weightUnit(workoutUnit)
        if own == workoutUnit { return 1 }
        return own == "lb" ? 0.45359237 : 1 / 0.45359237
    }
}

struct BestSet: Codable, Equatable {
    var w: Double?
    var r: Double?
    var sec: Double?
}

/// One side of a per-side set.
struct SideRow: Codable, Equatable {
    var w: Double?
    var r: Double?
    var done: Bool
}

struct Sides: Codable, Equatable {
    var L: SideRow
    var R: SideRow

    subscript(_ side: String) -> SideRow {
        get { side == "R" ? R : L }
        set { if side == "R" { R = newValue } else { L = newValue } }
    }
}

struct SetRow: Codable, Equatable {
    var w: Double?
    var r: Double?
    var sec: Double?
    var done: Bool
    var warmup: Bool
    /// When it was ticked (ms since 1970), on whichever side ticked it: the later tick wins.
    var at: Double?
    /// A per-side set's two sides; `done` is both of them.
    var sides: Sides?
    /// The bands the set is done with, as the phone names them ("Red + Yellow"), shown only.
    var band: String?
    /// Taken to failure, planned or marked (the phone's isFailureSet). Omitted when false.
    var failure: Bool?
    /// A drop set: the first drop's weight in the exercise's unit (0: none set yet).
    var drop: Double?
    /// How many drops it has; nil with `drop` set means one.
    var drops: Int?
    /// A rest-pause or cluster set: the menu offers no Drop and no Warm-up for it.
    var rp: Bool?
    /// "L" or "R": one half of a timed per-side pair, which the phone treats as one set (setSpanAt).
    var side: String?

    /// The side up next on a per-side set ("L", then "R"), or nil.
    var sideUp: String? {
        guard let s = sides else { return nil }
        if !s.L.done { return "L" }
        if !s.R.done { return "R" }
        return nil
    }
}

/// The phone's Settings → Apple Watch (frontend lib/watch-settings.js).
struct WatchSettings: Codable, Equatable {
    /// Apple Health workout session (live heart rate, saved workouts).
    var health: Bool?
    /// The wrist taps when a rest is over.
    var restHaptics: Bool?
    /// What the Digital Crown turns first on a set: "reps" or "weight" (older phones).
    var crown: String?
    /// The app's language ("en", "de", "pt-BR", …): the watch shows its words in it.
    var lang: String?
    /// Whether a workout started here asks for the body weight first (the phone's check-in).
    var weighIn: Bool?
    /// The last body weight logged, where the weigh-in's crown starts.
    var lastBw: Double?
    /// What the watch shows during a workout (Settings → Apple Watch); nil is the default.
    var show: WatchShow?
    /// The effort the profile logs per set, "rpe" or "rir"; nil: none (no effort tile).
    var effort: String?
    /// Timed holds start by themselves (the phone's Settings → Workout): rest over, 3-2-1, hold.
    var autoHolds: Bool?
    /// The app's accent colour ("#rrggbb", the dark theme's) and the ink that reads on it (1.4.5).
    var accent: String?
    var onAccent: String?
    /// The phone's Settings → Workout → Forgotten workouts (1.4.5); nil from an older phone.
    var forgotten: ForgottenSettings?
    /// The phone handles setMark / addSet / removeSet; without it the watch hides the set menu.
    var setMenu: Bool?
}

/// When "Still training?" comes and how long it waits for an answer (lib/forgotten-workout.js).
struct ForgottenSettings: Codable, Equatable {
    /// Minutes without a set before asking; 0: never asks, never ends by itself.
    var askMin: Double?
    /// Minutes the question waits before the workout finishes by itself.
    var graceMin: Double?
    /// Leaving the gym asks at once (the phone's gym reminder, set up and switched on).
    var leaveGym: Bool?
}

/// What a workout screen shows. Each nil means its default.
struct WatchShow: Codable, Equatable {
    /// The exercise's animation (on).
    var clip: Bool?
    /// The heart rate (on).
    var hr: Bool?
    /// What was lifted last time (on).
    var last: Bool?
    /// Calories so far (on).
    var kcal: Bool?
    /// The next exercise on the rest screen (on).
    var next: Bool?
    /// The heart-rate zones page, from the age in Apple Health (on). Off: the age is not used.
    var zones: Bool?
    /// The rest as a ring with the countdown ("ring", default) or the countdown alone ("plain").
    var rest: String?

    var showClip: Bool { clip ?? true }
    var showHr: Bool { hr ?? true }
    var showLast: Bool { last ?? true }
    var showKcal: Bool { kcal ?? true }
    var showNext: Bool { next ?? true }
    var showZones: Bool { zones ?? true }
    var restRing: Bool { rest != "plain" }
}
