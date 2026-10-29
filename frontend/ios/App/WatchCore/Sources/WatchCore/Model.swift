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

    var isTimed: Bool { mode == "time" }
    var isCardio: Bool { mode == "cardio" }
    var isBodyweight: Bool { bodyweight == true }
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
}

/// What a workout screen shows. Each nil means its default.
struct WatchShow: Codable, Equatable {
    /// The exercise's animation (on).
    var clip: Bool?
    /// The heart rate (on).
    var hr: Bool?
    /// What was lifted last time (on).
    var last: Bool?
    /// The time since the start (off).
    var elapsed: Bool?
    /// Calories so far (off).
    var kcal: Bool?
    /// The next exercise on the rest screen (on).
    var next: Bool?
    /// The rest as a ring with the countdown ("ring", default) or the countdown alone ("plain").
    var rest: String?

    var showClip: Bool { clip ?? true }
    var showHr: Bool { hr ?? true }
    var showLast: Bool { last ?? true }
    var showElapsed: Bool { elapsed ?? false }
    var showKcal: Bool { kcal ?? false }
    var showNext: Bool { next ?? true }
    var restRing: Bool { rest != "plain" }
}
