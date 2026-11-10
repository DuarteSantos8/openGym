package ch.duartesantos.opengym.wear

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/*
 * What the phone sends the watch (frontend/src/lib/watch-sync.js buildSnapshot), as the watch reads
 * it: the very JSON the Apple Watch gets (ios/App/WatchCore Model.swift). Plain data, no media.
 * Every field the phone may leave out is optional and unknown fields are ignored, so an older or a
 * newer phone never makes the watch fail to read a snapshot.
 */

/** The one JSON setup for the snapshot, the saved state and the events. */
val WireJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    coerceInputValues = true
    isLenient = true
}

@Serializable
data class Snapshot(
    val v: Int = 1,
    val unit: String? = null,
    val restSec: Double? = null,
    val active: ActiveWorkout? = null,
    val ready: Ready? = null,
    val settings: WatchSettings? = null,
    /** Workouts discarded on the phone lately: one of these that leaves was not finished (#776). */
    val discarded: List<String>? = null,
    /** The week streak (lib/streak.js), for the Tile and the complication. Wear OS only so far. */
    val streak: Streak? = null,
) {
    companion object {
        fun parse(json: String): Snapshot? = try { WireJson.decodeFromString(serializer(), json) } catch (_: Exception) { null }
    }
}

@Serializable
data class Streak(val weeks: Int = 0, val thisWeekDone: Boolean = false)

/** What the watch can start by itself: today's planned session and a few other routines. */
@Serializable
data class Ready(val today: ReadySession? = null, val others: List<ReadySession> = emptyList())

@Serializable
data class ReadySession(
    val routineIds: List<String> = emptyList(),
    val name: String = "",
    val entries: List<Entry> = emptyList(),
    val healthType: String? = null,
)

@Serializable
data class ActiveWorkout(
    val id: String? = null,
    val name: String = "",
    val unit: String = "kg",
    val cur: Int = 0,
    val restSec: Double = 0.0,
    val rest: RestInfo? = null,
    val entries: List<Entry> = emptyList(),
    /** When it started (ms since 1970), for the summary's duration. */
    val start: Double? = null,
    val healthType: String? = null,
    /** When it was last worked on on the phone (ms, #904). */
    val activeAt: Double? = null,
)

@Serializable
data class RestInfo(val endsAt: Double)

@Serializable
data class Entry(
    val id: String,
    val name: String = "",
    /** "reps", "time" (a hold, `sec` per set) or "cardio" (logged on the phone). */
    val mode: String = "reps",
    val restSec: Double? = null,
    val last: String? = null,
    val sets: List<SetRow> = emptyList(),
    val bodyweight: Boolean? = null,
    val perSide: Boolean? = null,
    val group: String? = null,
    val best: BestSet? = null,
    val assisted: Boolean? = null,
    val step: Double? = null,
    /** Its own weight unit when it is not the workout's (#657). */
    val unit: String? = null,
) {
    val isTimed get() = mode == "time"
    val isCardio get() = mode == "cardio"
    val isBodyweight get() = bodyweight == true
    fun weightUnit(workoutUnit: String) = unit ?: workoutUnit
    /** What one of its kilos or pounds is in `workoutUnit`, for a total that mixes exercises. */
    fun factor(workoutUnit: String): Double {
        val own = weightUnit(workoutUnit)
        if (own == workoutUnit) return 1.0
        return if (own == "lb") 0.45359237 else 1 / 0.45359237
    }
    /** The step the weight moves in: the phone's, else 2.5 kg / 5 lb. */
    fun stepOr(workoutUnit: String) = step?.takeIf { it > 0 } ?: if (weightUnit(workoutUnit) == "lb") 5.0 else 2.5
}

@Serializable
data class BestSet(val w: Double? = null, val r: Double? = null, val sec: Double? = null)

@Serializable
data class SideRow(val w: Double? = null, val r: Double? = null, val done: Boolean = false)

@Serializable
data class Sides(val L: SideRow = SideRow(), val R: SideRow = SideRow()) {
    operator fun get(side: String) = if (side == "R") R else L
    fun with(side: String, row: SideRow) = if (side == "R") copy(R = row) else copy(L = row)
}

@Serializable
data class SetRow(
    val w: Double? = null,
    val r: Double? = null,
    val sec: Double? = null,
    val done: Boolean = false,
    val warmup: Boolean = false,
    val at: Double? = null,
    val sides: Sides? = null,
) {
    /** The side up next on a per-side set ("L", then "R"), or null. */
    val sideUp: String? get() = sides?.let { if (!it.L.done) "L" else if (!it.R.done) "R" else null }
}

/** The phone's watch settings (lib/watch-settings.js + watchExtras). */
@Serializable
data class WatchSettings(
    val health: Boolean? = null,
    val restHaptics: Boolean? = null,
    val crown: String? = null,
    val lang: String? = null,
    val weighIn: Boolean? = null,
    val lastBw: Double? = null,
    val show: WatchShow? = null,
    val effort: String? = null,
    val autoHolds: Boolean? = null,
)

@Serializable
data class WatchShow(
    val clip: Boolean? = null,
    val hr: Boolean? = null,
    val last: Boolean? = null,
    val elapsed: Boolean? = null,
    val kcal: Boolean? = null,
    val next: Boolean? = null,
    val rest: String? = null,
) {
    val showHr get() = hr ?: true
    val showLast get() = last ?: true
    val showNext get() = next ?: true
}
