import Foundation

/*
 * When the watch's Apple Health workout session (and with it the heart-rate sensor at workout
 * rate) is allowed to rest. A workout that is never finished (left open on the phone, the watch
 * forgotten on the charger) used to keep the session, and the sensor, running for good.
 *
 * Idle = no set ticked, no rest or hold running, no change to the workout from the phone, and
 * no start, for `idleLimit`. Then the session is PAUSED, not ended: nothing measured so far is
 * lost, the workout is still saved to Apple Health when it ends, and the next set, rest or
 * phone change resumes it (WorkoutManager.pause/resume). A saved workout restored at launch that
 * is already idle does not start a new session until something happens in it.
 */
enum SensorPlan {
    /// Three hours without anything happening in the workout.
    static let idleLimitMs: Double = 3 * 3600 * 1000

    /// The latest moment anything happened in this workout (ms since 1970): its start, when this
    /// watch first had it or last saw it change, each ticked set (and side), the rest's end.
    static func lastActivity(_ w: ActiveWorkout, seen: Double?) -> Double? {
        var last: Double? = nil
        func take(_ t: Double?) { if let t = t, t > (last ?? -.infinity) { last = t } }
        take(w.start)
        take(seen)
        take(w.rest?.endsAt)
        for e in w.entries {
            for s in e.sets { take(s.at) }
        }
        return last
    }

    /// Whether the session should rest now. `busy`: a rest or hold runs on the watch.
    /// Without any known time there is nothing to measure idleness from: not idle.
    static func idle(_ w: ActiveWorkout?, seen: Double?, now: Double, busy: Bool) -> Bool {
        guard let w = w else { return false }
        if busy { return false }
        guard let last = lastActivity(w, seen: seen) else { return false }
        return now - last >= idleLimitMs
    }

    /// When to look again (ms since 1970): the moment the workout turns idle without new activity.
    static func checkAt(_ w: ActiveWorkout?, seen: Double?) -> Double? {
        guard let w = w, let last = lastActivity(w, seen: seen) else { return nil }
        return last + idleLimitMs
    }
}
