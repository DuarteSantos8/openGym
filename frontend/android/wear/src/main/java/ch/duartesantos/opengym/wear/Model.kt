package ch.duartesantos.opengym.wear

// What the phone sends and what the watch logs against it. No Android in here, so all of it (and
// Engine, which moves through it) runs in plain JVM unit tests. The wire format is documented at
// the top of frontend/src/lib/wear-bridge.js.

data class Drop(val w: Double, val r: Int)
data class Cluster(val r: Int, val restSec: Int)

data class PlannedSet(
    val w: Double,
    val r: Int,
    val sec: Int,
    val timed: Boolean,
    val warmup: Boolean,
    val side: String?,
    /** "straight", "dropset" or "restpause" */
    val type: String,
    val failure: Boolean,
    val max: Boolean,
    /** Seconds of rest this set earns, resolved by the phone with the workout screen's rules. */
    val rest: Int,
    val drops: List<Drop>,
    val clusters: List<Cluster>,
) {
    /** How many things are logged for this set: the main set and its drops, or each mini-set. */
    val steps: Int
        get() = when (type) {
            "dropset" -> 1 + drops.size
            "restpause" -> maxOf(1, clusters.size)
            else -> 1
        }
}

data class Exercise(
    val id: String,
    val name: String,
    val timed: Boolean,
    val perSide: Boolean,
    /** What one click of the crown changes the load by (seconds, for a timed exercise). */
    val step: Double,
    /** The phone's bookkeeping for the exercise, echoed back untouched in the finished session. */
    val ctx: String,
    val sets: List<PlannedSet>,
)

data class Snapshot(
    val routineId: String,
    val name: String,
    val unit: String,
    val ts: Long,
    /** Names of the exercises the phone left out because the watch does not do them (cardio). */
    val skipped: List<String>,
    val exercises: List<Exercise>,
)

data class RoutineRef(val id: String, val name: String, val exercises: Int)
data class Index(val unit: String, val ts: Long, val routines: List<RoutineRef>)

/** One value as typed on the crown: a load and a rep count or, for a timed set, seconds. */
data class StepValue(val w: Double, val r: Int, val sec: Int)

/** A set as it ended: done with these numbers, or left undone. */
data class SetResult(
    val ex: Int,
    val set: Int,
    val w: Double,
    val r: Int,
    val sec: Int,
    val done: Boolean,
    val at: Long,
    val drops: List<Drop>,
    val clusters: List<Cluster>,
)

/** Where a workout in progress stands. Plain data, persisted as JSON after every change. */
data class Session(
    val id: String,
    val routineId: String,
    val name: String,
    val unit: String,
    val start: Long,
    val ex: Int,
    val set: Int,
    /** Which step of the set at (ex, set) is being logged; steps already confirmed are in [partial]. */
    val step: Int,
    val partial: List<StepValue>,
    val results: List<SetResult>,
    /** Epoch ms the running rest ends; 0 when none is running. */
    val restEndsAt: Long,
    val restTotalSec: Int,
    val finished: Boolean,
)

/** A workout in progress: the snapshot it was started from (kept whole, the phone may change meanwhile) and where it stands. */
data class ActiveWorkout(val snapshotJson: String, val snapshot: Snapshot, val session: Session)
