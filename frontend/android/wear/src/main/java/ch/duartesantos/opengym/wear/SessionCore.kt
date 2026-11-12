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
 *   - started here: kept until the phone reports it back, a snapshot without it does not end it;
 *   - the phone names the events it has applied (`acked`): a tick it applied is the phone's from
 *     then on (an untick or an edit there sticks), and a start it applied counts as reported back,
 *     so a workout the phone started and ended before any snapshot showed it does not run on here.
 * Every event also goes into the Outbox below until the phone has applied it (docs/WATCH_SYNC.md).
 */

@Serializable
data class PendingTick(val w: Double? = null, val r: Double? = null, val at: Double, val sec: Double? = null, val id: String? = null)

@Serializable
data class SessionState(
    val workout: ActiveWorkout? = null,
    val ready: Ready? = null,
    val settings: WatchSettings = WatchSettings(),
    val unit: String = "kg",
    val restSec: Double = 90.0,
    /** A session started here that the phone has not reported back running yet. */
    val startedHere: String? = null,
    /** The id of that session's start event: once the phone has applied it, it is reported back. */
    val startId: String? = null,
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

/** A set the phone ticked, which the watch did not: its heart rate is the watch's to work out. `at`: ms since 1970. */
data class PhoneTick(val exId: String, val entryIdx: Int, val setIdx: Int, val at: Double)

object SessionCore {
    fun key(exId: String, si: Int, side: String? = null) = if (side != null) "$exId#$si#$side" else "$exId#$si"

    /** A snapshot from the phone, over what the watch has. */
    fun applySnapshot(s0: SessionState, snap: Snapshot): SessionState {
        var s = s0.copy(ready = snap.ready, synced = true)
        snap.unit?.let { s = s.copy(unit = it) }
        snap.restSec?.let { if (it > 0) s = s.copy(restSec = it) }
        snap.settings?.let { s = s.copy(settings = it) }
        snap.streak?.let { s = s.copy(streak = it) }

        val acked = snap.acked?.toSet() ?: emptySet()
        // The phone applied the start: it had this workout, whatever its snapshot shows now.
        if (s.startedHere != null && s.startId != null && s.startId in acked) s = s.copy(startedHere = null, startId = null)
        // Ticks the phone applied: its copy of those sets is the one that counts from now on.
        if (acked.isNotEmpty()) s = s.copy(pending = s.pending.filterValues { it.id == null || it.id !in acked })
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
        if (next0.id != null && next0.id == s.startedHere) s = s.copy(startedHere = null, startId = null)
        // The phone runs a different workout than the one started here: the watch keeps its own.
        if (!same && unconfirmed) return s
        if (!same) s = s.copy(pending = emptyMap(), skipped = emptyList(), entryIndex = next0.cur)
        // The phone moved to another exercise (its Next, or the last set of one ticked there): the watch
        // goes along, as after a tick here. A page opened on the wrist stays while the phone stays put.
        val was = s0.workout?.cur
        if (same && was != null && was != next0.cur) s = s.copy(entryIndex = next0.cur)

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
        // The phone put an exercise in, took one out or moved one (its own `cur` staying put): the
        // watch stays on the exercise it shows, wherever that is now. By the row's index alone the
        // set page would change exercise under the thumb, and Done would log the wrong one.
        var at = s.entryIndex.coerceIn(0, entries.size)
        val shown = s0.workout?.entries?.getOrNull(s0.entryIndex)?.id
        if (same && was == next0.cur && shown != null && entries.getOrNull(at)?.id != shown) {
            // The same exercise twice in a workout: the first stays the first, the second the second.
            val nth = s0.workout.entries.take(s0.entryIndex).count { it.id == shown }
            val now = entries.indices.filter { entries[it].id == shown }
            (now.getOrNull(nth) ?: now.lastOrNull())?.let { at = it }
        }
        return s.copy(workout = next, pending = pending, entryIndex = at)
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
        at: Double, id: String, hr: Pair<Int, Int>? = null, effort: EffortRating? = null,
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
            pending = s0.pending + (key(e.id, si, oneSide) to PendingTick(w, r, at, sec, id)),
        )
        val event = buildJsonObject {
            put("id", id); put("type", "setDone"); put("wid", workout.id ?: ""); put("exId", e.id)
            put("entryIdx", ei); put("setIdx", si); put("at", at.toLong())
            if (w != null) put("w", w)
            if (r != null) put("r", r)
            if (sec != null) put("sec", sec)
            if (oneSide != null) put("side", oneSide)
            if (hr != null) put("hr", buildJsonObject { put("avg", hr.first); put("max", hr.second) })
            // "rpe": 8.5 or "rir": 2, never both; the phone puts it on the set (watch-sync.js effortFrom)
            if (effort != null && Effort.notches(effort.kind) != null) put(effort.kind, effort.value)
        }
        return s to event
    }

    /**
     * The sets done in `after` and not in `before`, the same workout on both sides, oldest tick
     * first (the Apple Watch's phoneTicks). A set the watch ticked itself is done in `before`
     * already, so only the phone's show up; one without the phone's `at` is left out (no time to
     * measure up to). One side of a per-side set counts too: the row's `at` is that side's tick.
     */
    fun phoneTicks(before: ActiveWorkout?, after: ActiveWorkout?): List<PhoneTick> {
        val b = before ?: return emptyList()
        val a = after ?: return emptyList()
        val wid = a.id ?: return emptyList()
        if (wid != b.id) return emptyList()
        val out = mutableListOf<PhoneTick>()
        a.entries.forEachIndexed { ei, e ->
            val old = b.entries.getOrNull(ei)?.takeIf { it.id == e.id }?.sets ?: return@forEachIndexed
            e.sets.forEachIndexed { si, row ->
                val at = row.at ?: return@forEachIndexed
                val was = old.getOrNull(si) ?: return@forEachIndexed
                val newSide = listOf("L", "R").any { row.sides?.get(it)?.done == true && was.sides?.get(it)?.done != true }
                if ((row.done && !was.done) || newSide) out += PhoneTick(e.id, ei, si, at)
            }
        }
        return out.sortedBy { it.at }
    }

    /**
     * Heart rate on a set for the phone (watch-sync.js setHr; the watch has the sensor): `hr` for a
     * set ticked on the phone, `restHr` for the rest after a set, once that rest is over.
     */
    fun setHrEvent(wid: String, exId: String, entryIdx: Int, setIdx: Int, id: String,
                   hr: Pair<Int, Int>? = null, restHr: Pair<Int, Int>? = null): Event = buildJsonObject {
        put("id", id); put("type", "setHr"); put("wid", wid); put("exId", exId)
        put("entryIdx", entryIdx); put("setIdx", setIdx)
        if (hr != null) put("hr", buildJsonObject { put("avg", hr.first); put("max", hr.second) })
        if (restHr != null) put("restHr", buildJsonObject { put("avg", restHr.first); put("max", restHr.second) })
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

    /**
     * Where the watch goes when the phone ticks set `si` of exercise `ei`: the set after it, on
     * whichever exercise the lifter is (#1149), or null to stay where it is.
     */
    fun followTick(s: SessionState, ei: Int, si: Int): Int? {
        val count = s.workout?.entries?.size ?: return null
        return next(s, ei, si).first.takeIf { it < count && it != s.entryIndex }
    }

    /** A ready session started here (watch-sync.js start). */
    fun start(s0: SessionState, session: ReadySession, wid: String, at: Double, id: String, bw: Double? = null): Pair<SessionState, Event> {
        val workout = ActiveWorkout(id = wid, name = session.name, unit = s0.unit, cur = 0, restSec = s0.restSec,
            entries = session.entries, start = at, healthType = session.healthType)
        val s = s0.copy(workout = workout, startedHere = wid, startId = id, pending = emptyMap(), skipped = emptyList(), entryIndex = 0)
        val event = buildJsonObject {
            put("id", id); put("type", "start")
            put("routineIds", JsonArray(session.routineIds.map { JsonPrimitive(it) }))
            put("wid", wid); put("at", at.toLong())
            // the body weight just weighed in, for the session (SessionCore.swift start)
            if (bw != null && bw > 0) put("bw", Math.round(bw * 10) / 10.0)
        }
        return s to event
    }

    /** The session finished here, or discarded here (the phone drops it unsaved). */
    fun finish(s0: SessionState, at: Double, id: String, discard: Boolean = false, idle: Boolean = false, left: Boolean = false): Pair<SessionState, Event?> {
        val w = s0.workout ?: return s0 to null
        val s = s0.copy(
            workout = null, pending = emptyMap(), skipped = emptyList(), startedHere = null, startId = null,
            finishedHere = if (w.id != null) (s0.finishedHere + w.id).takeLast(5) else s0.finishedHere,
        )
        val event = buildJsonObject {
            put("id", id); put("type", if (discard) "discard" else "finish"); put("wid", w.id ?: ""); put("at", at.toLong())
            // Ended as forgotten (Idle), not by a hold: the phone checks it against its own log
            // (lib/watch-sync.js staleWatchFinish) and saves it ending at `at` (the last set + rest).
            if (idle && !discard) put("idle", true)
            if (idle && left && !discard) put("left", true)
        }
        return s to event
    }

    /** "Keep going" on "Still training?": the phone stops asking too (lib/watch-sync.js stillHere). */
    fun stillHere(s: SessionState, at: Double, id: String): Event? {
        val w = s.workout ?: return null
        return buildJsonObject { put("id", id); put("type", "stillHere"); put("wid", w.id ?: ""); put("at", at.toLong()) }
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

/** One event on its way to the phone: its JSON (with its `seq`), when it last went out, and whether
 *  the phone's side has stored it (the Data Layer item deleted there; on iOS, the transfer done). */
@Serializable
data class OutItem(val id: String, val seq: Long, val json: String, val sentAt: Long = 0, val delivered: Boolean = false,
                   /** How often it went out: each resend waits twice as long as the one before (OutboxCore.wait). */
                   val tries: Int = 0)

@Serializable
data class Outbox(val items: List<OutItem> = emptyList(), val seq: Long = 0)

/*
 * The watch's outbox, as pure functions (ios/App/WatchCore Outbox in SessionCore.swift is its twin):
 * every event goes in before it is sent, numbered in the order it happened (`seq`, also written
 * into the event for the phone to sort by), and stays until the phone has applied it (its id in a
 * snapshot's `acked`). Until then it is sent again: soon while nothing says it got there, rarely
 * once it did (the phone's page may simply not have run yet), always on reconnect and at launch.
 */
object OutboxCore {
    const val MAX = 1000
    /** Not delivered yet: sent again after this long. */
    const val RESEND_MS = 20_000L
    /** Delivered to the phone's queue but not applied by its page: once more after this long. */
    const val REDELIVER_MS = 10 * 60_000L

    /** The outbox with `event` added (unsent), and that event as it goes out, with its seq. */
    fun add(o: Outbox, event: Event): Pair<Outbox, OutItem>? {
        val id = (event["id"] as? JsonPrimitive)?.content?.takeIf { it.isNotEmpty() } ?: return null
        o.items.firstOrNull { it.id == id }?.let { return o to it }
        val seq = o.seq + 1
        val json = JsonObject(event + ("seq" to JsonPrimitive(seq))).toString()
        val item = OutItem(id, seq, json)
        // Only the newest watchStatus waits (the Apple Watch's outbox has the same rule): the phone
        // wants what the watch says now, and a watch that never reaches its phone must not pile them up.
        val kept = if ((event["type"] as? JsonPrimitive)?.content == "watchStatus") o.items.filter { eventType(it) != "watchStatus" } else o.items
        return Outbox((kept + item).takeLast(MAX), seq) to item
    }

    /** Without the events the phone has applied. */
    fun ack(o: Outbox, ids: Collection<String>?): Outbox {
        if (ids.isNullOrEmpty()) return o
        val set = ids.toSet()
        return o.copy(items = o.items.filter { it.id !in set })
    }

    /** These went out now. */
    fun sent(o: Outbox, ids: Collection<String>, now: Long): Outbox {
        val set = ids.toSet()
        return o.copy(items = o.items.map { if (it.id in set) it.copy(sentAt = now, tries = min(it.tries + 1, 30)) else it })
    }

    /** These are stored on the phone (not applied yet). */
    fun delivered(o: Outbox, ids: Collection<String>): Outbox {
        val set = ids.toSet()
        return o.copy(items = o.items.map { if (it.id in set) it.copy(delivered = true) else it })
    }

    /** What to send now, oldest first: never sent, or sent and not heard of for a while. */
    fun due(o: Outbox, now: Long): List<OutItem> = o.items.filter {
        it.sentAt == 0L || now - it.sentAt >= wait(it) || now < it.sentAt
    }.sortedBy { it.seq }

    /**
     * How long an event waits before it goes out again: 20 s after the first time, then twice as
     * long each time, up to the ten minutes of one the phone has stored. The watch looks every
     * 30 s during a workout; with the phone away for an hour that must not be a put per event
     * every time.
     */
    fun wait(item: OutItem): Long {
        if (item.delivered) return REDELIVER_MS
        val doublings = (item.tries - 1).coerceIn(0, 5)
        return min(RESEND_MS shl doublings, REDELIVER_MS)
    }

    /** The phone is back in reach: everything not delivered goes again, whenever it last went out,
     *  and what is due besides. */
    fun onReconnect(o: Outbox, now: Long): List<OutItem> {
        val soon = due(o, now).map { it.id }.toSet()
        return o.items.filter { !it.delivered || it.id in soon }.sortedBy { it.seq }
    }

    /** Events the phone's side has not stored yet: the small "syncs later" count. */
    fun waiting(o: Outbox): Int = o.items.count { !it.delivered }
}
