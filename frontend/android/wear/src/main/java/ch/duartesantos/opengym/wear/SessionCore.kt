package ch.duartesantos.opengym.wear

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.max
import kotlin.math.min

/*
 * The session as the watch keeps it, and every change to it, as pure functions: a port of the
 * Apple Watch's WatchCore (ios/App/WatchCore/Sources/WatchCore/SessionCore.swift), so both watches
 * handle the phone's snapshots and send the phone the same events. SessionStore only calls these,
 * saves the state after each and sends the events they return. Tested on the JVM (src/test).
 *
 * The sync, in short (the long version is in SessionCore.swift):
 *   - a tick made here stays pending until a snapshot shows that set done at the tick's time or
 *     later; until then the snapshot's copy of the set is replaced by the watch's;
 *   - the same set changed on both sides: the later tick (`at`) wins, on both sides;
 *   - finished here: gone at once, a stale snapshot that still shows it does not bring it back;
 *   - started here: kept until the phone reports it back, a snapshot without it does not end it.
 */

@Serializable
data class PendingTick(val w: Double? = null, val r: Double? = null, val at: Double, val sec: Double? = null)

@Serializable
data class SessionState(
    val workout: ActiveWorkout? = null,
    val ready: Ready? = null,
    val settings: WatchSettings = WatchSettings(),
    val unit: String = "kg",
    val restSec: Double = 90.0,
    /** A session started here that the phone has not reported back running yet. */
    val startedHere: String? = null,
    /** Sessions finished here that the phone may still report running for a while. */
    val finishedHere: List<String> = emptyList(),
    /** Ticks made here, by "exerciseId#setIndex", until a snapshot shows them. */
    val pending: Map<String, PendingTick> = emptyMap(),
    /** The exercise on screen; entries.size is the Finish page. */
    val entryIndex: Int = 0,
    /** Sets passed over here ("exerciseId#setIndex"): the next one comes up instead. */
    val skipped: List<String> = emptyList(),
    /** The week streak and whether anything at all came from the phone yet. */
    val streak: Streak? = null,
    val synced: Boolean = false,
)

/** The end of a workout, on one screen. */
@Serializable
data class WorkoutSummary(
    val name: String,
    val unit: String,
    /** Seconds. */
    val duration: Double? = null,
    val sets: Int,
    val volume: Double,
    val prs: List<String>,
    val hrAvg: Int? = null,
    val hrMax: Int? = null,
    val endedOnPhone: Boolean = false,
)

typealias Event = JsonObject

object SessionCore {
    fun key(exId: String, si: Int, side: String? = null) = if (side != null) "$exId#$si#$side" else "$exId#$si"

    /** A snapshot from the phone, over what the watch has. */
    fun applySnapshot(s0: SessionState, snap: Snapshot): SessionState {
        var s = s0.copy(ready = snap.ready, synced = true)
        snap.unit?.let { s = s.copy(unit = it) }
        snap.restSec?.let { if (it > 0) s = s.copy(restSec = it) }
        snap.settings?.let { s = s.copy(settings = it) }
        snap.streak?.let { s = s.copy(streak = it) }

        val wid = s.workout?.id
        val droppedThere = wid != null && snap.discarded?.contains(wid) == true
        if (droppedThere && wid == s.startedHere) s = s.copy(startedHere = null)
        val unconfirmed = wid != null && wid == s.startedHere
        val next0 = snap.active
        if (next0 == null || (next0.id != null && s.finishedHere.contains(next0.id))) {
            // No workout on the phone, or one the watch has finished already.
            if (unconfirmed) return s
            return s.copy(workout = null, pending = emptyMap())
        }
        val same = next0.id != null && next0.id == wid
        if (next0.id != null && next0.id == s.startedHere) s = s.copy(startedHere = null)
        // The phone runs a different workout than the one started here: the watch keeps its own.
        if (!same && unconfirmed) return s
        if (!same) s = s.copy(pending = emptyMap(), skipped = emptyList(), entryIndex = next0.cur)

        val pending = s.pending.toMutableMap()
        val entries = next0.entries.map { e ->
            e.copy(sets = e.sets.mapIndexed { si, row0 ->
                var row = row0
                val k = key(e.id, si)
                pending[k]?.let { p ->
                    if (row0.done && (row0.at ?: Double.POSITIVE_INFINITY) >= p.at) pending.remove(k)
                    else row = row.copy(done = true, w = p.w ?: row.w, r = p.r ?: row.r, sec = p.sec ?: row.sec, at = p.at)
                }
                for (side in listOf("L", "R")) {
                    val ks = key(e.id, si, side)
                    val p = pending[ks] ?: continue
                    if (row.sides?.get(side)?.done == true && (row0.at ?: Double.POSITIVE_INFINITY) >= p.at) pending.remove(ks)
                    else if (row.sides != null) row = markSide(row, side, p.w, p.r, p.at)
                    else pending.remove(ks)
                }
                row
            })
        }
        val next = next0.copy(entries = entries)
        return s.copy(workout = next, pending = pending, entryIndex = s.entryIndex.coerceIn(0, entries.size))
    }

    /** One side of a per-side set done, the row following both sides (the phone's syncSideAggregate). */
    fun markSide(row0: SetRow, side: String, w: Double?, r: Double?, at: Double): SetRow {
        val sides0 = row0.sides ?: return row0
        var one = sides0[side].copy(done = true)
        if (w != null) one = one.copy(w = w)
        if (r != null) one = one.copy(r = r)
        val sides = sides0.with(side, one)
        return row0.copy(
            sides = sides,
            done = sides.L.done && sides.R.done,
            r = (sides.L.r ?: 0.0) + (sides.R.r ?: 0.0),
            w = max(sides.L.w ?: 0.0, sides.R.w ?: 0.0),
            at = max(row0.at ?: 0.0, at),
        )
    }

    /** A set ticked here: the state with it done, and the event for the phone (watch-sync.js setDone). */
    fun tick(
        s0: SessionState, ei: Int, si: Int, side: String? = null, w: Double?, r: Double?, sec: Double? = null,
        at: Double, id: String, hr: Pair<Int, Int>? = null,
    ): Pair<SessionState, Event?> {
        val workout = s0.workout ?: return s0 to null
        val e = workout.entries.getOrNull(ei) ?: return s0 to null
        val row = e.sets.getOrNull(si) ?: return s0 to null
        val oneSide = side?.takeIf { row.sides != null }
        val newRow = if (oneSide != null) markSide(row, oneSide, w, r, at)
        else row.copy(done = true, w = w ?: row.w, r = r ?: row.r, sec = sec ?: row.sec, at = at)
        val entries = workout.entries.toMutableList()
        entries[ei] = e.copy(sets = e.sets.toMutableList().also { it[si] = newRow })
        val s = s0.copy(
            workout = workout.copy(entries = entries),
            pending = s0.pending + (key(e.id, si, oneSide) to PendingTick(w, r, at, sec)),
        )
        val event = buildJsonObject {
            put("id", id); put("type", "setDone"); put("wid", workout.id ?: ""); put("exId", e.id)
            put("entryIdx", ei); put("setIdx", si); put("at", at.toLong())
            if (w != null) put("w", w)
            if (r != null) put("r", r)
            if (sec != null) put("sec", sec)
            if (oneSide != null) put("side", oneSide)
            if (hr != null) put("hr", buildJsonObject { put("avg", hr.first); put("max", hr.second) })
        }
        return s to event
    }

    /** A set passed over here: not done, the next one comes up. */
    fun skip(s0: SessionState, ei: Int, si: Int): SessionState {
        val e = s0.workout?.entries?.getOrNull(ei) ?: return s0
        if (e.sets.getOrNull(si) == null) return s0
        return s0.copy(skipped = (s0.skipped + key(e.id, si)).distinct().sorted())
    }

    fun isSkipped(s: SessionState, exId: String, si: Int) = s.skipped.contains(key(exId, si))

    /** The set to do next in an exercise: the one picked, or the first not done and not skipped. */
    fun setIndex(s: SessionState, ei: Int, picked: Int? = null): Int? {
        val e = s.workout?.entries?.getOrNull(ei) ?: return null
        if (picked != null && e.sets.getOrNull(picked)?.done == false) return picked
        return e.sets.indices.firstOrNull { !e.sets[it].done && !isSkipped(s, e.id, it) }
    }

    /**
     * Where to go after set `si` of exercise `ei`, and whether a rest comes first:
     *   per-side set with a side to go   the same exercise, no rest
     *   superset                          the next exercise of the group in turn; rest after a round
     *   otherwise                         this exercise while it has sets, then the next that has;
     *                                     after the last, the Finish page (index = count)
     */
    fun next(s: SessionState, ei: Int, si: Int): Pair<Int, Boolean> {
        val w = s.workout ?: return s.entryIndex to false
        val e = w.entries.getOrNull(ei) ?: return s.entryIndex to false
        val count = w.entries.size
        if (e.sets.getOrNull(si)?.sideUp != null) return ei to false
        val open = { i: Int -> setIndex(s, i) != null }
        val g = e.group
        if (g != null) {
            var lo = ei; var hi = ei
            while (lo > 0 && w.entries[lo - 1].group == g) lo--
            while (hi + 1 < count && w.entries[hi + 1].group == g) hi++
            if (hi > lo) {
                val members = (lo..hi).toList()
                val inTurn = members.filter { it > ei } + members.filter { it <= ei }
                inTurn.firstOrNull(open)?.let { return it to (it <= ei) }
                (((hi + 1) until count).firstOrNull(open) ?: (0 until lo).firstOrNull(open))?.let { return it to true }
                return count to true
            }
        }
        if (open(ei)) return ei to true
        (((ei + 1) until count).firstOrNull(open) ?: (0 until ei).firstOrNull(open))?.let { return it to true }
        return count to true
    }

    /** A ready session started here (watch-sync.js start). */
    fun start(s0: SessionState, session: ReadySession, wid: String, at: Double, id: String): Pair<SessionState, Event> {
        val workout = ActiveWorkout(id = wid, name = session.name, unit = s0.unit, cur = 0, restSec = s0.restSec,
            entries = session.entries, start = at, healthType = session.healthType)
        val s = s0.copy(workout = workout, startedHere = wid, pending = emptyMap(), skipped = emptyList(), entryIndex = 0)
        val event = buildJsonObject {
            put("id", id); put("type", "start")
            put("routineIds", JsonArray(session.routineIds.map { JsonPrimitive(it) }))
            put("wid", wid); put("at", at.toLong())
        }
        return s to event
    }

    /** The session finished here, or discarded here (the phone drops it unsaved). */
    fun finish(s0: SessionState, at: Double, id: String, discard: Boolean = false): Pair<SessionState, Event?> {
        val w = s0.workout ?: return s0 to null
        val s = s0.copy(
            workout = null, pending = emptyMap(), skipped = emptyList(), startedHere = null,
            finishedHere = if (w.id != null) (s0.finishedHere + w.id).takeLast(5) else s0.finishedHere,
        )
        val event = buildJsonObject {
            put("id", id); put("type", if (discard) "discard" else "finish"); put("wid", w.id ?: ""); put("at", at.toLong())
        }
        return s to event
    }

    /** Work sets done and in all, for the Tile's and the complication's ring. */
    fun progress(s: SessionState): Pair<Int, Int> {
        val all = s.workout?.entries?.flatMap { it.sets }?.filter { !it.warmup } ?: return 0 to 0
        return all.count { it.done } to all.size
    }

    /** The workout as the summary shows it at its end. */
    fun summary(w: ActiveWorkout, end: Double, endedOnPhone: Boolean = false, hr: Pair<Int, Int>? = null): WorkoutSummary {
        var sets = 0
        var volume = 0.0
        val prs = mutableListOf<String>()
        for (e in w.entries) {
            val work = e.sets.filter { !it.warmup }
            val f = e.factor(w.unit)
            for (row in work) {
                val sides = row.sides
                if (sides != null) {
                    for (one in listOf(sides.L, sides.R)) if (one.done) volume += (one.w ?: 0.0) * (one.r ?: 0.0) * f
                    if (row.done) sets++
                } else if (row.done) {
                    sets++
                    if (!e.isTimed && !e.isCardio) volume += (row.w ?: 0.0) * (row.r ?: 0.0) * f
                }
            }
            val best = e.best
            if (best != null && beatsBest(e, work.filter { it.done }, best)) prs += e.name
        }
        return WorkoutSummary(w.name, w.unit, w.start?.let { max(0.0, (end - it) / 1000) }, sets, volume, prs,
            hr?.first, hr?.second, endedOnPhone)
    }

    /** A heavier weight (lighter when assisted), or more reps at the same; a longer hold. */
    fun beatsBest(e: Entry, done: List<SetRow>, best: BestSet): Boolean {
        if (e.isTimed) {
            val b = best.sec ?: return false
            if (b <= 0) return false
            return done.any { (it.sec ?: 0.0) > b }
        }
        val bw = best.w; val br = best.r
        if (e.isCardio || bw == null || br == null || (bw <= 0 && br <= 0)) return false
        val assisted = e.assisted == true
        return done.any { row ->
            val w = row.w ?: 0.0; val r = row.r ?: 0.0
            if (w != bw) w > 0 && (if (assisted) w < bw else w > bw) else r > br
        }
    }

    /** A weight moved by `steps` on the exercise's grid (an off-grid weight lands on it first), never below zero. */
    fun stepWeight(w: Double?, step: Double, steps: Int): Double {
        val base = w ?: 0.0
        if (steps == 0 || step <= 0) return base
        val k = base / step
        val idx = if (steps > 0) kotlin.math.floor(k + 1e-9) + steps else kotlin.math.ceil(k - 1e-9) + steps
        return max(0.0, Math.round(idx * step * 100) / 100.0)
    }

    fun stepReps(r: Double?, steps: Int) = min(999.0, max(0.0, (r ?: 0.0) + steps))
}
