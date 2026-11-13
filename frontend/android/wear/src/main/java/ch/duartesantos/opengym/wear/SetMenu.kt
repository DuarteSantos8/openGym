package ch.duartesantos.opengym.wear

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A set-menu edit made here that the phone's snapshot has not shown yet (SetMenu.swift PendingEdit). */
@Serializable
data class PendingEdit(
    val id: String,
    val exId: String,
    /** "mark" | "add" | "remove" */
    val op: String,
    val setIdx: Int? = null,
    /** "warmup" | "failure" | "drop" */
    val kind: String? = null,
    val on: Boolean? = null,
    val w: Double? = null,
    val r: Double? = null,
    val done: Boolean? = null,
    val entryIdx: Int? = null,
    /** Where its set is now in the watch's rows (null: gone, or an add), so a tick here there keeps it the same set. */
    val row: Int? = null,
) {
    /** Its entry in [w]: the one it was made on while that is still this exercise, else the first with its id. */
    fun entry(w: ActiveWorkout): Int? {
        entryIdx?.let { if (it in w.entries.indices && w.entries[it].id == exId) return it }
        return w.entries.indexOfFirst { it.id == exId }.takeIf { it >= 0 }
    }
}

/** A menu disc: on, off, locked (shown but not changeable) or not shown. */
enum class Disc { ON, OFF, LOCKED, HIDDEN }

/** The set pill's width rule: "n/of" goes first when the tags would not fit beside it (widths in dp). */
object PillFit {
    fun showPlace(tags: Int, need: Float, available: Float) = tags == 0 || need <= available
}

enum class MarkKind(val wire: String) { WARMUP("warmup"), FAILURE("failure"), DROP("drop") }

/** What the set menu offers for one set (SetMenu.swift, mirroring the phone's menu). */
data class MenuOffer(
    val warmup: Disc,
    val failure: Disc,
    val drop: Disc,
    val canAdd: Boolean,
    val canRemove: Boolean,
)

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
        return MenuOffer(warmup, failure, drop, canAdd = !e.isCardio && !paired, canRemove = e.sets.size > 1 && !paired)
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
    fun mark(s: SessionState, ei: Int, si: Int, kind: MarkKind, on: Boolean, at: Double, id: String): Pair<SessionState, Event?> =
        edit(s, ei, si, "mark", kind, on, at, id)

    /** A copy of the last set at the end of the exercise, as the phone's addSet. */
    fun addSet(s: SessionState, ei: Int, at: Double, id: String): Pair<SessionState, Event?> =
        edit(s, ei, null, "add", null, null, at, id)

    /** The set taken out (the view sends it once its Undo has passed). */
    fun removeSet(s: SessionState, ei: Int, si: Int, at: Double, id: String): Pair<SessionState, Event?> =
        edit(s, ei, si, "remove", null, null, at, id)

    /** Where a set went when the rows moved; null when it was removed, unchanged when [moved] does not reach it. */
    fun remapSet(si: Int, moved: List<Int?>): Int? = if (si in moved.indices) moved[si] else si

    /** A pointer at a set after an edit on entry [ei] moved its rows: the same set at its new row, null when it was removed. */
    fun follow(ref: SetRef?, ei: Int, moved: List<Int?>): SetRef? =
        if (ref == null || ref.entry != ei) ref else remapSet(ref.set, moved)?.let { SetRef(ei, it) }

    /**
     * What goes to the phone for [next]: a removal still held for Undo first (its indexes come
     * before [next]'s), then [next]; the removal alone when [next] is that removal.
     */
    fun order(held: HeldRemoval?, next: Event): List<Event> {
        val h = held?.toEvent() ?: return listOf(next)
        return if (h["id"] == next["id"]) listOf(next) else listOf(h, next)
    }

    /** [edits] with [pe] made on entry [ei] of [w]: the earlier ones' rows on that entry follow [moved], and [pe] gets its own. */
    fun track(edits: List<PendingEdit>, pe: PendingEdit, w: ActiveWorkout, ei: Int, moved: List<Int?>): List<PendingEdit> =
        edits.map { if (it.row != null && it.entry(w) == ei) it.copy(row = remapSet(it.row, moved)) else it } +
            pe.copy(row = pe.setIdx?.let { remapSet(it, moved) })

    /** "exerciseId#setIndex" keys of one exercise moved to the rows' new places; a removed row's key is dropped. */
    fun remapKeys(s: SessionState, exId: String, moved: List<Int?>): SessionState {
        val prefix = "$exId#"
        fun move(k: String): String? {
            if (!k.startsWith(prefix)) return k
            val parts = k.removePrefix(prefix).split("#").toMutableList()
            val si = parts[0].toIntOrNull() ?: return k
            parts[0] = (remapSet(si, moved) ?: return null).toString()
            return prefix + parts.joinToString("#")
        }
        val pending = LinkedHashMap<String, PendingTick>()
        for ((k, v) in s.pending) move(k)?.let { pending.putIfAbsent(it, v) }
        return s.copy(pending = pending, skipped = s.skipped.mapNotNull(::move).sorted())
    }

    private fun edit(s0: SessionState, ei: Int, si: Int?, op: String, kind: MarkKind?, on: Boolean?, at: Double, id: String): Pair<SessionState, Event?> {
        val w = s0.workout ?: return s0 to null
        if (ei !in w.entries.indices) return s0 to null
        val e = w.entries[ei]
        val row = si?.let { e.sets.getOrNull(it) }
        if (si != null && row == null) return s0 to null
        val pe = PendingEdit(id, e.id, op, si, kind?.wire, on, row?.w, row?.r, row?.done, ei)
        val (next, moved) = apply(pe, w, entry = ei) ?: return s0 to null
        val s = remapKeys(s0, e.id, moved).copy(workout = next, edits = track(s0.edits, pe, w, ei, moved))
        val event = buildJsonObject {
            put("id", id); put("type", if (op == "mark") "setMark" else if (op == "add") "addSet" else "removeSet")
            put("wid", w.id ?: ""); put("exId", e.id); put("entryIdx", ei); put("at", at.toLong())
            if (si != null && row != null) {
                put("setIdx", si); put("done", row.done)
                row.w?.let { put("w", it) }
                row.r?.let { put("r", it) }
            }
            if (kind != null && on != null) put(kind.wire, on)
        }
        return s to event
    }

    /**
     * One edit on a workout: the workout after it and where each old row went (null: removed), or
     * null when its set is no longer the one it was made on, or the menu would not offer it.
     * `sameSet = false` skips the check that the set is still the one the edit was made on: where the
     * rows move to is all that is asked then (SessionCore's trial run).
     */
    fun apply(pe: PendingEdit, w0: ActiveWorkout, sameSet: Boolean = true, entry: Int? = null): Pair<ActiveWorkout, List<Int?>>? {
        val ei = entry ?: pe.entry(w0) ?: return null
        val e = w0.entries[ei]
        val sets = e.sets.toMutableList()
        val same: List<Int?> = sets.indices.toList()
        fun withSets(list: List<SetRow>) = w0.copy(entries = w0.entries.mapIndexed { i, x -> if (i == ei) x.copy(sets = list) else x })
        if (pe.op == "add") {
            val last = sets.lastOrNull() ?: return null
            if (!offer(e, sets.size - 1).canAdd) return null
            val sides = last.sides?.let { Sides(it.L.copy(done = false), it.R.copy(done = false)) }
            sets.add(SetRow(w = last.w, r = last.r, sec = last.sec, done = false, warmup = false, at = null, sides = sides))
            return withSets(sets) to same
        }
        val si = pe.setIdx?.takeIf { it in sets.indices } ?: return null
        val row = sets[si]
        if (sameSet && !(row.w == pe.w && row.r == pe.r && row.done == pe.done)) return null
        val o = offer(e, si)
        if (pe.op == "remove") {
            if (!o.canRemove) return null
            sets.removeAt(si)
            return withSets(sets) to same.map { if (it!! < si) it else if (it == si) null else it - 1 }
        }
        val kind = MarkKind.entries.firstOrNull { it.wire == pe.kind } ?: return null
        val on = pe.on ?: return null
        val disc = when (kind) { MarkKind.WARMUP -> o.warmup; MarkKind.FAILURE -> o.failure; MarkKind.DROP -> o.drop }
        if (disc != (if (on) Disc.OFF else Disc.ON)) return null
        var n = row
        when (kind) {
            MarkKind.FAILURE -> {
                n = n.copy(failure = if (on) true else null)
                // the phone marks the whole pair (toggleFailureSpan)
                partner(sets, si)?.let { sets[it] = sets[it].copy(failure = if (on) true else null) }
            }
            MarkKind.DROP -> n = n.copy(drop = null, drops = if (on) 1 else null)
            MarkKind.WARMUP -> {
                // the phone's makeWarmupAt / makeWorkAt: a warm-up keeps only weight, reps, tick and sides
                n = if (on) SetRow(w = row.w, r = row.r, sec = null, done = row.done, warmup = true, at = row.at, sides = row.sides)
                else row.copy(warmup = false)
                // placeRow: out of its place, in where the work sets begin
                val order = sets.indices.filter { it != si }.toMutableList()
                val at = order.indexOfFirst { !sets[it].warmup }
                order.add(if (at < 0) order.size else at, si)
                return withSets(order.map { if (it == si) n else sets[it] }) to sets.indices.map { old -> order.indexOf(old) }
            }
        }
        sets[si] = n
        return withSets(sets) to same
    }
}
