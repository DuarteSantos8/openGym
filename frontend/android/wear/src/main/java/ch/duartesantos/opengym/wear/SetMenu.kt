package ch.duartesantos.opengym.wear

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

/**
 * A set menu change made here: the event the phone gets (setMark, addSet or removeSet,
 * docs/WATCH_SYNC.md), kept until the phone has applied it (`acked`) and replayed over every
 * snapshot until then, so an older snapshot does not undo it. It names its set by the set's id
 * (`sid`, protocol 2), by its place only while the phone has sent none. SetMenu.swift's PendingEdit.
 */
@Serializable
data class PendingEdit(
    val id: String,
    /** "setMark", "addSet" or "removeSet" */
    val type: String,
    val wid: String,
    val exId: String,
    /** Which of the workout's entries: an exercise can be in it twice (combined routines). */
    val entryIdx: Int,
    val setIdx: Int? = null,
    /** The set's id; for an add, the one the watch made up for the new set ("w-<uuid>"). */
    val sid: String? = null,
    /** "warmup" | "failure" | "drop" */
    val kind: String? = null,
    val on: Boolean? = null,
    /** An add: the numbers of the set it copies. */
    val w: Double? = null,
    val r: Double? = null,
    val sec: Double? = null,
    val at: Double,
    /** A removal still inside its Undo time, not sent yet; `row` is the set taken out, for Undo. */
    val held: Boolean? = null,
    val row: SetRow? = null,
) {
    /** Its entry in [w]: the one it was made on while that is still this exercise, else the first with its id. */
    fun entry(w: ActiveWorkout): Int? {
        if (entryIdx in w.entries.indices && w.entries[entryIdx].id == exId) return entryIdx
        return w.entries.indexOfFirst { it.id == exId }.takeIf { it >= 0 }
    }

    /** The event for the phone. */
    val event: Event get() = buildJsonObject {
        put("id", id); put("type", type); put("wid", wid); put("exId", exId); put("entryIdx", entryIdx); put("at", at.toLong())
        setIdx?.let { put("setIdx", it) }
        sid?.let { put("sid", it) }
        if (kind != null && on != null) put(kind, on)
        w?.let { put("w", it) }
        r?.let { put("r", it) }
        sec?.let { put("sec", it) }
    }
}

/** A menu disc: on, off, locked (shown but not changeable) or not shown. */
enum class Disc { ON, OFF, LOCKED, HIDDEN }

/** The set pill's width rule: "n/of" goes first when the tags would not fit beside it (widths in dp). */
object PillFit {
    fun showPlace(tags: Int, need: Float, available: Float) = tags == 0 || need <= available
}

enum class MarkKind(val wire: String) { WARMUP("warmup"), FAILURE("failure"), DROP("drop") }

/** What the set menu offers for one set (SetMenu.swift, mirroring the phone's menu and removeWatchSet). */
data class MenuOffer(
    val warmup: Disc,
    val failure: Disc,
    val drop: Disc,
    val canAdd: Boolean,
    val canRemove: Boolean,
) {
    /** Whether switching [kind] to [on] is offered: its disc shows the other way and is not locked. */
    fun canMark(kind: MarkKind, on: Boolean): Boolean =
        (when (kind) { MarkKind.WARMUP -> warmup; MarkKind.FAILURE -> failure; MarkKind.DROP -> drop }) == (if (on) Disc.OFF else Disc.ON)
}

/** The set menu's rules and edits, a port of the Apple Watch's SetMenu.swift. */
object SetMenu {
    fun offer(e: Entry, si: Int): MenuOffer {
        if (si !in e.sets.indices) return MenuOffer(Disc.HIDDEN, Disc.HIDDEN, Disc.HIDDEN, canAdd = false, canRemove = false)
        val s = e.sets[si]
        val reps = e.mode == "reps"
        // `drops` alone: turned on here, the weight comes with the phone's snapshot
        val isDrop = s.drop != null || s.drops != null
        val rp = s.rp == true

        var warmup = Disc.HIDDEN
        if (reps) {
            // a done set too, as the phone's own menu
            warmup = if (s.warmup) Disc.ON else {
                // a straight set, and one work set must stay
                val otherWork = e.sets.indices.any { it != si && !e.sets[it].warmup }
                if (isDrop || rp || !otherWork) Disc.LOCKED else Disc.OFF
            }
        }
        var failure = Disc.HIDDEN
        if (!e.isCardio) failure = if (s.warmup) Disc.LOCKED else if (s.failure == true) Disc.ON else Disc.OFF
        var drop = Disc.HIDDEN
        // with 2+ drops the phone has to edit them
        if (reps && !rp) drop = if (s.warmup) Disc.LOCKED else if (!isDrop) Disc.OFF else if ((s.drops ?: 1) > 1) Disc.LOCKED else Disc.ON

        // Half of a timed per-side pair: the phone adds and removes the pair, so the watch leaves those to it.
        val paired = partner(e.sets, si) != null
        // The phone never takes out a set that is done (or has a side done), nor an exercise's only
        // row (removeWatchSet); a set the phone has not named yet cannot be named in a removeSet.
        val removable = !s.done && s.sides?.L?.done != true && s.sides?.R?.done != true && e.sets.size > 1 && !paired && s.sid != null
        return MenuOffer(warmup, failure, drop, canAdd = !e.isCardio && !paired, canRemove = removable)
    }

    /** The other half of a timed per-side pair (the phone's setSpanAt), or null. */
    fun partner(sets: List<SetRow>, si: Int): Int? {
        if (si !in sets.indices) return null
        if (sets[si].side == "L" && si + 1 in sets.indices && sets[si + 1].side == "R") return si + 1
        if (sets[si].side == "R" && si > 0 && sets[si - 1].side == "L") return si - 1
        return null
    }

    /** The phone says it understands the set events. */
    fun available(s: SessionState): Boolean = s.settings.setMenu == true

    /** A warm-up, failure or drop mark switched here, as the phone's set menu does it. */
    fun mark(s: SessionState, ei: Int, si: Int, kind: MarkKind, on: Boolean, at: Double, id: String): Pair<SessionState, Event?> {
        val pe = made(s, ei, si, "setMark", at, id)?.copy(kind = kind.wire, on = on) ?: return s to null
        val next = record(s, pe) ?: return s to null
        return next to pe.event
    }

    /** A copy of the last set at the end of the exercise, with an id of the watch's own (addWatchSet). */
    fun addSet(s: SessionState, ei: Int, at: Double, id: String, sid: String = "w-" + UUID.randomUUID()): Pair<SessionState, Event?> {
        val w = s.workout ?: return s to null
        val e = w.entries.getOrNull(ei) ?: return s to null
        val last = e.sets.lastOrNull() ?: return s to null
        if (!offer(e, e.sets.lastIndex).canAdd) return s to null
        val pe = PendingEdit(id, "addSet", w.id ?: "", e.id, ei, sid = sid, w = last.w, r = last.r, sec = last.sec, at = at)
        val next = record(s, pe) ?: return s to null
        return next to pe.event
    }

    /** The set taken out here at once; its event is held for Undo: [release] sends it, [undo] takes it back. */
    fun removeSet(s: SessionState, ei: Int, si: Int, at: Double, id: String): SessionState? {
        val pe = made(s, ei, si, "removeSet", at, id) ?: return null
        val e = s.workout!!.entries[ei]
        if (!offer(e, si).canRemove) return null
        return record(s, pe.copy(held = true, row = e.sets[si]))
    }

    /** The held removals, oldest first (one at a time while the app runs; any left at a launch go out then). */
    fun held(s: SessionState): List<String> = s.edits.filter { it.held == true }.map { it.id }

    /** A held removal's Undo time is over: its event, now on its way. It stays an edit until acked. */
    fun release(s: SessionState, id: String): Pair<SessionState, Event?> {
        val i = s.edits.indexOfFirst { it.id == id && it.held == true }
        if (i < 0) return s to null
        val pe = s.edits[i].copy(held = null, row = null)
        return s.copy(edits = s.edits.toMutableList().also { it[i] = pe }) to pe.event
    }

    /** Undo of a held removal: nothing is sent, and the set is back in its place. */
    fun undo(s0: SessionState, id: String): SessionState {
        val pe = s0.edits.firstOrNull { it.id == id && it.held == true } ?: return s0
        val row = pe.row ?: return s0
        val w0 = s0.workout ?: return s0
        val ei = pe.entry(w0) ?: return s0
        val s = s0.copy(edits = s0.edits.filter { it.id != id })
        if (pe.sid?.let { find(w0, it) } != null) return s
        val sets = w0.entries[ei].sets
        val si = minOf(pe.setIdx ?: sets.size, sets.size)
        val w = withSets(w0, ei, sets.toMutableList().also { it.add(si, row) })
        return remapKeys(s.copy(workout = w), ei) { if (it >= si) it + 1 else it }
    }

    /** The watch's edits over a snapshot that may not have them yet, in the order they were made. */
    fun replay(edits: List<PendingEdit>, w: ActiveWorkout): ActiveWorkout =
        edits.fold(w) { acc, pe -> apply(pe, acc)?.first ?: acc }

    /** Where a set went when the rows moved; null when it was removed, unchanged when [moved] does not reach it. */
    fun remapSet(si: Int, moved: List<Int?>): Int? = if (si in moved.indices) moved[si] else si

    /** A pointer at a set after an edit on entry [ei] moved its rows: the same set at its new row, null when it was removed. */
    fun follow(ref: SetRef?, ei: Int, moved: List<Int?>): SetRef? =
        if (ref == null || ref.entry != ei) ref else remapSet(ref.set, moved)?.let { SetRef(ei, it) }

    /**
     * The keys of entry [ei] that name a set by its place (skips and pending ticks of a set without an id, efforts)
     * moved to the rows' new places; null drops the key. Keys by the set's id need no move.
     */
    fun remapKeys(s: SessionState, ei: Int, map: (Int) -> Int?): SessionState {
        val entries = s.workout?.entries ?: return s
        val exId = entries.getOrNull(ei)?.id ?: return s
        val nth = SessionCore.nthOf(entries, ei)
        fun move(k: String, prefix: String): String? {
            if (!k.startsWith(prefix)) return k
            val parts = k.removePrefix(prefix).split("#").toMutableList()
            val si = parts[0].toIntOrNull() ?: return k
            parts[0] = (map(si) ?: return null).toString()
            return prefix + parts.joinToString("#")
        }
        // SessionCore.placeKey's and effortKey's prefixes for this entry
        val skip = "n$nth:$exId#"
        val rate = "$exId@$nth#"
        val efforts = s.efforts?.let { m ->
            val out = LinkedHashMap<String, Double>()
            for ((k, v) in m) move(k, rate)?.let { out.putIfAbsent(it, v) }
            out
        }
        val pending = LinkedHashMap<String, PendingTick>()
        for ((k, v) in s.pending) move(k, skip)?.let { pending[it] = v }
        return s.copy(skipped = s.skipped.mapNotNull { move(it, skip) }.sorted(), efforts = efforts, pending = pending)
    }

    /**
     * One edit on a workout: the workout after it and where each of the exercise's old rows went
     * (null: removed), or null when it does not apply (its set is gone, it is there already, or the
     * phone would not take it).
     */
    fun apply(pe: PendingEdit, w: ActiveWorkout): Pair<ActiveWorkout, List<Int?>>? {
        if (pe.type == "addSet") {
            val sid = pe.sid ?: return null
            if (find(w, sid) != null) return null
            val ei = pe.entry(w) ?: return null
            val sets = w.entries[ei].sets
            // The phone's rowLike: the last row's shape, not done, no marks, the watch's numbers.
            val sides = sets.lastOrNull()?.sides?.let { Sides(it.L.copy(done = false), it.R.copy(done = false)) }
            val added = SetRow(w = pe.w, r = pe.r, sec = pe.sec, done = false, warmup = false, at = null, sides = sides, sid = sid)
            return withSets(w, ei, sets + added) to sets.indices.toList()
        }
        val (ei, si) = place(pe, w) ?: return null
        val sets = w.entries[ei].sets.toMutableList()
        val same: List<Int?> = sets.indices.toList()
        val row = sets[si]
        if (pe.type == "removeSet") {
            // removeWatchSet's rule: never a set that is done, nor the exercise's only row
            if (row.done || row.sides?.L?.done == true || row.sides?.R?.done == true || sets.size <= 1) return null
            sets.removeAt(si)
            return withSets(w, ei, sets) to same.map { if (it!! < si) it else if (it == si) null else it - 1 }
        }
        if (pe.type != "setMark") return null
        val kind = MarkKind.entries.firstOrNull { it.wire == pe.kind } ?: return null
        val on = pe.on ?: return null
        if (!offer(w.entries[ei], si).canMark(kind, on)) return null
        var n = row
        when (kind) {
            MarkKind.FAILURE -> {
                n = n.copy(failure = if (on) true else null)
                // the phone marks the whole pair (toggleFailureSpan)
                partner(sets, si)?.let { sets[it] = sets[it].copy(failure = if (on) true else null) }
            }
            MarkKind.DROP -> n = n.copy(drop = null, drops = if (on) 1 else null)
            MarkKind.WARMUP -> {
                // the phone's makeWarmupAt / makeWorkAt: a warm-up keeps weight, reps, tick, sides and its id
                n = if (on) SetRow(w = row.w, r = row.r, sec = null, done = row.done, warmup = true, at = row.at, sides = row.sides, sid = row.sid)
                else row.copy(warmup = false)
                // placeRow: out of its place, in where the work sets begin
                val order = sets.indices.filter { it != si }.toMutableList()
                val at = order.indexOfFirst { !sets[it].warmup }
                order.add(if (at < 0) order.size else at, si)
                return withSets(w, ei, order.map { if (it == si) n else sets[it] }) to sets.indices.map { old -> order.indexOf(old) }
            }
        }
        sets[si] = n
        return withSets(w, ei, sets) to same
    }

    private fun withSets(w: ActiveWorkout, ei: Int, sets: List<SetRow>) =
        w.copy(entries = w.entries.mapIndexed { i, x -> if (i == ei) x.copy(sets = sets) else x })

    /** The row an edit names: by its id, else (no id yet) by its place. */
    private fun place(pe: PendingEdit, w: ActiveWorkout): Pair<Int, Int>? {
        pe.sid?.let { return find(w, it) }
        val ei = pe.entry(w) ?: return null
        val si = pe.setIdx?.takeIf { it in w.entries[ei].sets.indices } ?: return null
        return ei to si
    }

    private fun find(w: ActiveWorkout, sid: String): Pair<Int, Int>? {
        w.entries.forEachIndexed { ei, e ->
            val si = e.sets.indexOfFirst { it.sid == sid }
            if (si >= 0) return ei to si
        }
        return null
    }

    /** The edit for set [si] of entry [ei], before its own fields. */
    private fun made(s: SessionState, ei: Int, si: Int, type: String, at: Double, id: String): PendingEdit? {
        val w = s.workout ?: return null
        val e = w.entries.getOrNull(ei) ?: return null
        val row = e.sets.getOrNull(si) ?: return null
        return PendingEdit(id, type, w.id ?: "", e.id, ei, setIdx = si, sid = row.sid, at = at)
    }

    /** The edit on the watch's own state at once, kept until acked; null when it does not apply. */
    private fun record(s0: SessionState, pe: PendingEdit): SessionState? {
        val w = s0.workout ?: return null
        val (next, moved) = apply(pe, w) ?: return null
        val ei = pe.entry(w) ?: return null
        val s = remapKeys(s0, ei) { remapSet(it, moved) }
        return s.copy(workout = next, edits = s.edits + pe)
    }
}
