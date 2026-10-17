package ch.duartesantos.opengym.wear

import java.util.UUID

/**
 * The workout as a state machine over a [Snapshot]. Every function is pure: it takes the session and
 * returns the next one, so what the watch does between sets can be tested without a watch.
 *
 * The rules mirror the phone's (docs/dev/SET_TYPES.md):
 *  - a drop set is its main set and then each drop, logged back to back with no rest;
 *  - a rest-pause set is an activation set and then mini-sets, each after its own short rest,
 *    and the row's reps are the sum of what was done in all of them;
 *  - a set that is not logged is sent as not done, never as a made-up one;
 *  - the exercises can be done in any order: the session's cursor ([Session.ex], [Session.set]) is the
 *    exercise being worked, [goTo] moves it, and each exercise keeps its own place (its first set
 *    with no result). Finishing a set carries on in the same exercise, then in the next one that is
 *    not finished (wrapping round), and the workout is over when every set has a result.
 */
object Engine {

    fun begin(snapshot: Snapshot, now: Long, id: String = UUID.randomUUID().toString()): Session {
        val first = unfinishedFrom(snapshot, emptyList(), 0)
        return Session(
            id = id, routineId = snapshot.routineId, name = snapshot.name, unit = snapshot.unit, start = now,
            ex = first?.first ?: 0, set = first?.second ?: 0, step = 0, partial = emptyList(), results = emptyList(),
            restEndsAt = 0, restTotalSec = 0, finished = first == null,
        )
    }

    private fun hasResult(results: List<SetResult>, ex: Int, set: Int): Boolean = results.any { it.ex == ex && it.set == set }

    /** The first set of [ex] with no result (done or skipped), else null. */
    fun nextSetIn(snapshot: Snapshot, results: List<SetResult>, ex: Int): Int? =
        snapshot.exercises.getOrNull(ex)?.sets?.indices?.firstOrNull { !hasResult(results, ex, it) }

    /** The first unfinished (exercise, set) looking from [ex] on and wrapping round; null when nothing is left. */
    private fun unfinishedFrom(snapshot: Snapshot, results: List<SetResult>, ex: Int): Pair<Int, Int>? {
        val n = snapshot.exercises.size
        for (k in 0 until n) {
            val e = (ex + k) % n
            nextSetIn(snapshot, results, e)?.let { return e to it }
        }
        return null
    }

    /** The exercise has sets and every one of them has a result. */
    fun exerciseFinished(snapshot: Snapshot, s: Session, ex: Int): Boolean =
        snapshot.exercises.getOrNull(ex)?.sets?.isNotEmpty() == true && nextSetIn(snapshot, s.results, ex) == null

    /**
     * Moves to another exercise, at its first unfinished set. Not while a drop set or rest-pause is
     * half logged (its steps would be lost: finish it or end it from the menu), and not onto an
     * exercise with nothing left to log; the rest, if one is running, keeps running.
     */
    fun goTo(snapshot: Snapshot, s: Session, ex: Int): Session {
        if (s.finished || s.partial.isNotEmpty() || ex == s.ex) return s
        val set = nextSetIn(snapshot, s.results, ex) ?: return s
        return s.copy(ex = ex, set = set, step = 0)
    }

    fun exerciseOf(snapshot: Snapshot, s: Session): Exercise = snapshot.exercises[s.ex]
    fun setOf(snapshot: Snapshot, s: Session): PlannedSet = snapshot.exercises[s.ex].sets[s.set]

    /** What the crown starts from for the step being logged: the plan, with the weight carried through a rest-pause. */
    fun planned(snapshot: Snapshot, s: Session): StepValue {
        val p = setOf(snapshot, s)
        return when (p.type) {
            "dropset" -> if (s.step == 0) StepValue(p.w, p.r, p.sec) else p.drops.getOrNull(s.step - 1)?.let { StepValue(it.w, it.r, 0) } ?: StepValue(p.w, p.r, p.sec)
            "restpause" -> {
                val c = p.clusters.getOrNull(s.step)
                StepValue(if (s.step == 0) p.w else s.partial.firstOrNull()?.w ?: p.w, c?.r ?: p.r, 0)
            }
            else -> StepValue(p.w, p.r, p.sec)
        }
    }

    /** The step being logged is done with [value]. */
    fun confirm(snapshot: Snapshot, s: Session, value: StepValue, now: Long): Session {
        if (s.finished) return s
        val p = setOf(snapshot, s)
        val partial = s.partial + value
        if (s.step + 1 < p.steps) {
            // A rest-pause rests before each mini-set after the activation; a drop set does not rest at all.
            val rest = if (p.type == "restpause") p.clusters.getOrNull(s.step + 1)?.restSec ?: 0 else 0
            return withRest(s.copy(step = s.step + 1, partial = partial), rest, now)
        }
        return complete(snapshot, s, partial, now, done = true)
    }

    /** "That's all": a rest-pause (or a drop set) ends with what has been logged so far. */
    fun stopHere(snapshot: Snapshot, s: Session, now: Long): Session =
        if (s.finished || s.partial.isEmpty()) s else complete(snapshot, s, s.partial, now, done = true)

    /** The set is left unlogged. If part of it was logged, that part stands. */
    fun skip(snapshot: Snapshot, s: Session, now: Long): Session {
        if (s.finished) return s
        return if (s.partial.isNotEmpty()) complete(snapshot, s, s.partial, now, done = true)
        else complete(snapshot, s, emptyList(), now, done = false)
    }

    private fun complete(snapshot: Snapshot, s: Session, partial: List<StepValue>, now: Long, done: Boolean): Session {
        val p = setOf(snapshot, s)
        val main = partial.firstOrNull() ?: StepValue(p.w, p.r, p.sec)
        val result = when {
            !done -> SetResult(s.ex, s.set, p.w, p.r, p.sec, false, 0, emptyList(), emptyList())
            p.type == "dropset" && partial.size > 1 ->
                SetResult(s.ex, s.set, main.w, main.r, main.sec, true, now, partial.drop(1).map { Drop(it.w, it.r) }, emptyList())
            p.type == "restpause" ->
                SetResult(
                    s.ex, s.set, main.w, partial.sumOf { it.r }, 0, true, now, emptyList(),
                    partial.mapIndexed { i, v -> Cluster(v.r, p.clusters.getOrNull(i)?.restSec ?: p.clusters.firstOrNull()?.restSec ?: 0) },
                )
            else -> SetResult(s.ex, s.set, main.w, main.r, main.sec, true, now, emptyList(), emptyList())
        }
        val results = s.results + result
        // Carries on in this exercise; once it is done, in the next one that is not.
        val following = unfinishedFrom(snapshot, results, s.ex)
        val moved = s.copy(
            results = results, partial = emptyList(), step = 0, restEndsAt = 0, restTotalSec = 0,
            ex = following?.first ?: s.ex, set = following?.second ?: s.set, finished = following == null,
        )
        // The rest this set earned comes after it, unless it was the last set of the workout or was skipped.
        return if (following != null && done) withRest(moved, p.rest, now) else moved
    }

    private fun withRest(s: Session, seconds: Int, now: Long): Session =
        if (seconds > 0) s.copy(restEndsAt = now + seconds * 1000L, restTotalSec = seconds)
        else s.copy(restEndsAt = 0, restTotalSec = 0)

    fun adjustRest(s: Session, deltaSec: Int, now: Long): Session {
        if (s.restEndsAt <= 0) return s
        val left = maxOf(0L, s.restEndsAt - now) + deltaSec * 1000L
        return if (left <= 0) endRest(s) else s.copy(restEndsAt = now + left, restTotalSec = maxOf(s.restTotalSec, ((left + 999) / 1000).toInt()))
    }

    fun endRest(s: Session): Session = s.copy(restEndsAt = 0, restTotalSec = 0)

    /** Take back the last thing logged: a step of the set in progress, else the last finished set. */
    fun undo(snapshot: Snapshot, s: Session): Session {
        if (s.partial.isNotEmpty()) {
            return s.copy(step = s.step - 1, partial = s.partial.dropLast(1), restEndsAt = 0, restTotalSec = 0)
        }
        val last = s.results.lastOrNull() ?: return s
        val p = snapshot.exercises[last.ex].sets[last.set]
        val steps = if (!last.done) emptyList() else when {
            p.type == "dropset" && last.drops.isNotEmpty() ->
                (listOf(StepValue(last.w, last.r, last.sec)) + last.drops.map { StepValue(it.w, it.r, 0) }).dropLast(1)
            p.type == "restpause" -> last.clusters.dropLast(1).map { StepValue(last.w, it.r, 0) }
            else -> emptyList()
        }
        return s.copy(
            ex = last.ex, set = last.set, step = steps.size, partial = steps, results = s.results.dropLast(1),
            restEndsAt = 0, restTotalSec = 0, finished = false,
        )
    }

    // ---- what the screens say

    fun setsDone(s: Session): Int = s.results.count { it.done }
    fun setsTotal(snapshot: Snapshot): Int = snapshot.exercises.sumOf { it.sets.size }

    /** How far through the routine: sets done over sets in all, 0..1. A set left out does not count, as on the phone. */
    fun progress(snapshot: Snapshot, s: Session): Float {
        val total = setsTotal(snapshot)
        return if (total == 0) 0f else (setsDone(s).toFloat() / total).coerceIn(0f, 1f)
    }

    /** Sets of [ex] with a result, and its sets in all. */
    fun exerciseCount(snapshot: Snapshot, s: Session, ex: Int): Pair<Int, Int> {
        val sets = snapshot.exercises.getOrNull(ex)?.sets?.size ?: 0
        return s.results.count { it.ex == ex }.coerceAtMost(sets) to sets
    }

    /** The 1-based number of the set among the exercise's work sets (or its warm-ups), for "Set 2 / 4". */
    fun numberAmong(snapshot: Snapshot, ex: Int, set: Int): Pair<Int, Int> {
        val sets = snapshot.exercises[ex].sets
        val warm = sets[set].warmup
        val same = sets.withIndex().filter { it.value.warmup == warm }.map { it.index }
        return (same.indexOf(set) + 1) to same.size
    }

    /** Where [ex] stands for a screen: the set to log, or null when every one has a result. */
    fun pageFor(snapshot: Snapshot, s: Session, ex: Int): Pair<Int, Int>? =
        if (ex == s.ex && !s.finished) s.ex to s.set
        else nextSetIn(snapshot, s.results, ex)?.let { ex to it }
}
