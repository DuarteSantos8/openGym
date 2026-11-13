package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/*
 * The 1.4.5 watch redesign's rules, as plain functions: the Kotlin twins of the Apple Watch's
 * WatchCore Plan.swift, Overview.swift, SetNav.swift, RestMath.swift, Outbox.swift (waitingSets,
 * SyncState) and the Effort / WeighIn / Countdown / Idle / TouchLock parts of SessionCore.swift.
 * The screens (ui/) only call these, so both watches behave alike. Tested in WatchLogicTest.kt.
 */

/** What the start screen says about a routine: "5 exercises, 17 sets" (warm-ups don't count). */
object Plan {
    fun size(entries: List<Entry>): Pair<Int, Int> {
        val real = entries.filter { it.sets.isNotEmpty() }
        return real.size to real.sumOf { e -> e.sets.count { !it.warmup } }
    }
}

/** "#30d158" as an ARGB int, or null for anything that is not a #rrggbb colour. */
object Hex {
    fun argb(hex: String?): Long? {
        if (hex == null || hex.length != 7 || !hex.startsWith("#")) return null
        val n = hex.substring(1).toLongOrNull(16) ?: return null
        return 0xFF000000L or n
    }
}

/* ---------- the Overview ---------- */

data class OverviewRow(
    val index: Int,
    val id: String,
    val name: String,
    /** Work sets done and in all (warm-ups not counted, unless the exercise has nothing else). */
    val done: Int,
    val total: Int,
    val current: Boolean,
    val finished: Boolean,
    /** The first exercise of a superset: the heading goes above it. */
    val supersetStart: Boolean,
    val inSuperset: Boolean,
)

object Overview {
    fun rows(w: ActiveWorkout, current: Int): List<OverviewRow> {
        val entries = w.entries
        return entries.mapIndexed { i, e ->
            val work = e.sets.filter { !it.warmup }
            val counted = if (work.isEmpty()) e.sets else work
            val grouped = inSuperset(entries, i)
            val first = grouped && (i == 0 || entries[i - 1].group != e.group)
            OverviewRow(i, e.id, e.name, counted.count { it.done }, counted.size, i == current,
                e.sets.isNotEmpty() && e.sets.all { it.done }, first, grouped)
        }
    }

    /** A group shared with a neighbour (a group of one is not a superset). */
    fun inSuperset(entries: List<Entry>, i: Int): Boolean {
        val g = entries.getOrNull(i)?.group ?: return false
        return (i > 0 && entries[i - 1].group == g) || (i + 1 < entries.size && entries[i + 1].group == g)
    }

    /** The other exercises of `i`'s superset, in order: the set page names them. */
    fun partners(entries: List<Entry>, i: Int): List<String> {
        if (!inSuperset(entries, i)) return emptyList()
        val g = entries[i].group
        var lo = i; var hi = i
        while (lo > 0 && entries[lo - 1].group == g) lo--
        while (hi + 1 < entries.size && entries[hi + 1].group == g) hi++
        return (lo..hi).filter { it != i }.map { entries[it].name }
    }

    /** Past the last exercise: every set done or passed over, the Overview's Finish is next. */
    fun atEnd(s: SessionState): Boolean {
        val w = s.workout ?: return false
        return s.entryIndex >= w.entries.size
    }
}

/* ---------- ‹ › and fixing a logged set ---------- */

data class SetRef(val entry: Int, val set: Int)

object SetNav {
    /** "Set 2 of 4": a work set among the work sets, a warm-up among the warm-ups. */
    fun place(e: Entry, si: Int): Pair<Int, Int> {
        if (si !in e.sets.indices) return 0 to 0
        val warm = e.sets[si].warmup
        val same = e.sets.indices.filter { e.sets[it].warmup == warm }
        return (same.indexOf(si) + 1) to same.size
    }

    /** The set `by` rows away from `si` in the exercise, or null past either end. */
    fun step(e: Entry, from: Int, by: Int): Int? = (from + by).takeIf { it in e.sets.indices }
}

/** RPE or RIR on a set, in the scale the phone's profile logs (lib/history.js EFFORT). */
data class EffortRating(val kind: String, val value: Double)

object SetFix {
    data class Numbers(val w: Double? = null, val r: Double? = null, val sec: Double? = null)

    /** What was logged on a done set (one side's numbers on a per-side set), or null. */
    fun logged(row: SetRow, side: String?): Numbers? {
        val sides = row.sides
        if (side != null && sides != null) {
            val one = sides[side]
            return if (one.done) Numbers(one.w, one.r, null) else null
        }
        return if (row.done) Numbers(row.w, row.r, row.sec) else null
    }

    /**
     * A done set with new numbers: the setDone the phone already knows, a moment later than the
     * set's own tick so it wins there (Workout.jsx setDone: the later tick wins), and without `hr`,
     * so the phone keeps the set's own heart rate. Null for a set not done, cardio, or a row gone.
     */
    fun correct(s: SessionState, ei: Int, si: Int, side: String?, to: Numbers, effort: EffortRating? = null,
                now: Double, id: String): Pair<SessionState, Event?> {
        val w = s.workout ?: return s to null
        val e = w.entries.getOrNull(ei) ?: return s to null
        val row = e.sets.getOrNull(si) ?: return s to null
        val oneSide = side?.takeIf { row.sides != null }
        if (e.isCardio || logged(row, oneSide) == null) return s to null
        val at = max(now, (row.at ?: 0.0) + 1)
        var weight = to.w; var reps = to.r; var sec = to.sec
        if (e.isTimed) {
            reps = null
            if ((row.w ?: 0.0) <= 0) weight = null       // a hold without weight stays without
        } else sec = null
        return SessionCore.tick(s, ei, si, oneSide, weight, reps, sec, at, id, effort = effort)
    }
}

/**
 * The numbers on the set page for the set up next (what Done logs). `key` names the set they belong
 * to, `from` what the phone's plan said when they were loaded: while the lifter has not changed
 * them here, a change of the plan on the phone (another weight for this set) comes through; once
 * the crown or the keypad has touched them, they are the lifter's and stay.
 */
data class Draft(val key: String = "", val w: Double = 0.0, val r: Double = 0.0, val sec: Double = 30.0,
                 val from: SetFix.Numbers? = null) {
    val touched: Boolean get() = from != null && (w != (from.w ?: 0.0) || r != (from.r ?: 0.0) || sec != (from.sec ?: 0.0))
}

object Drafts {
    /** Which set a draft belongs to: the workout, the exercise (not only its row: the phone may move it), the set, the side. */
    fun key(wid: String?, exId: String?, ei: Int, si: Int?, side: String?) = "$wid#$exId#$ei#$si#$side"

    /**
     * The draft after the state changed: another set (or `force`) loads the plan's numbers; the
     * same set keeps what is on the screen, unless the plan's numbers changed on the phone and
     * nobody touched them here.
     */
    fun next(cur: Draft, key: String, w: Double, r: Double, sec: Double, force: Boolean = false): Draft {
        val plan = SetFix.Numbers(w, r, sec)
        val fresh = Draft(key, w, r, sec, plan)
        if (force || cur.key != key) return fresh
        if (cur.from == null || cur.touched || cur.from == plan) return cur
        return fresh
    }
}

/** A number typed on the watch's keypad: whole digits, a point, `decimals` after it. */
data class Keypad(val decimals: Int, val text: String = "") {
    fun press(key: String): Keypad {
        if (key == ".") {
            if (decimals <= 0 || text.contains('.')) return this
            return copy(text = (if (text.isEmpty()) "0" else text) + ".")
        }
        if (key.length != 1 || key[0] !in '0'..'9') return this
        val dot = text.indexOf('.')
        return when {
            dot >= 0 -> if (text.length - dot - 1 < decimals) copy(text = text + key) else this
            text == "0" -> copy(text = key)                       // no leading zeros
            text.length < MAX_WHOLE -> copy(text = text + key)
            else -> this
        }
    }

    fun back(): Keypad = if (text.isEmpty()) this else copy(text = text.dropLast(1))

    /** The number typed, null while nothing is ("62." is 62). */
    val value: Double? get() = if (text.isEmpty()) null else text.removeSuffix(".").toDoubleOrNull()

    fun fits(range: ClosedFloatingPointRange<Double>) = value?.let { it in range } ?: false

    companion object { const val MAX_WHOLE = 4 }
}

/* ---------- the rest ---------- */

object RestMath {
    const val STEP_MS = 15_000L

    /** The rest's end after −15 s, or null when that is the end of it (a Skip, as on the phone). */
    fun minus(end: Long, now: Long, by: Long = STEP_MS): Long? = (end - by).takeIf { it - now >= 1000 }

    /**
     * A rest end from the phone's snapshot is followed only when it is a new one: the same end sent
     * again (with an unrelated change) no longer undoes a ±15 or brings a skipped rest back.
     */
    fun follows(phoneEnd: Double, last: Double?): Boolean = phoneEnd != last

    /**
     * The phone ended its rest early (Skip there, #1149): the end it had sent is gone before it came,
     * and not for a pause. The watch ends its own rest too, or it counts on after the phone moved on.
     */
    fun phoneSkipped(lastPhoneEnd: Double?, phoneEnd: Double?, paused: Boolean, now: Long): Boolean =
        lastPhoneEnd != null && phoneEnd == null && !paused && lastPhoneEnd - now > 1000

    /** How much of the rest is left: 1 at its start, 0 at its end. */
    fun left(start: Long, end: Long, now: Long): Float {
        val total = end - start
        if (total <= 0) return 0f
        return ((end - now).toFloat() / total).coerceIn(0f, 1f)
    }
}

object Effort {
    /** The scale's values from easy to hard, null for a scale the watch does not know. */
    fun notches(kind: String?): List<Double>? = when (kind) {
        "rpe" -> (0..8).map { 6.0 + it * 0.5 }
        "rir" -> listOf(5.0, 4.0, 3.0, 2.0, 1.0, 0.0)
        else -> null
    }

    fun name(kind: String) = if (kind == "rpe") "RPE" else "RIR"

    /** The quick ratings during the rest, hardest first. */
    fun chips(kind: String): List<Double> = if (kind == "rpe") listOf(10.0, 9.0, 8.0, 7.0) else listOf(0.0, 1.0, 2.0, 3.0)

    /** "3+" and "≤7" for the open ends, the number itself otherwise. */
    fun chipLabel(kind: String, v: Double): String {
        if (kind == "rpe" && v <= 7) return "≤7"
        if (kind == "rir" && v >= 3) return "3+"
        return if (v == floor(v)) v.toLong().toString() else v.toString()
    }

    /** The phone's colour band (lib/effort.js EFFORT_BANDS), by RIR: 0 nothing left … 5 easy. */
    fun band(kind: String, value: Double): Int {
        val rir = if (kind == "rpe") 10 - value else value
        val tops = listOf(0.25, 0.75, 1.5, 2.5, 3.5)
        return tops.indexOfFirst { rir <= it }.let { if (it < 0) tops.size else it }
    }
}

/* ---------- the sync status ---------- */

/** What the watch says about its sets and the phone (the Apple Watch's SyncState). */
sealed class SyncState {
    object Synced : SyncState()
    data class Waiting(val n: Int) : SyncState()
    data class Away(val n: Int) : SyncState()

    val count: Int get() = when (this) { Synced -> 0; is Waiting -> n; is Away -> n }

    companion object {
        fun of(waiting: Int, reachable: Boolean): SyncState =
            if (waiting <= 0) Synced else if (reachable) Waiting(waiting) else Away(waiting)
    }
}

/**
 * Sets logged here that have not reached the phone yet: setDone events not delivered. A watch
 * status or a set's heart rate is not a set the lifter would miss (Outbox.swift waitingSets).
 */
fun OutboxCore.waitingSets(o: Outbox): Int = o.items.count { !it.delivered && eventType(it) == "setDone" }

fun OutboxCore.eventType(item: OutItem): String? = try {
    WireJson.parseToJsonElement(item.json).jsonObject["type"]?.jsonPrimitive?.content
} catch (_: Exception) { null }

/* ---------- the 3-2-1, the touch lock, the weigh-in, a workout left running ---------- */

object Countdown {
    const val SECONDS = 3

    /** The number up `elapsedMs` after the countdown began: 3, 2, 1, then 0 (go). */
    fun number(elapsedMs: Long): Int = max(SECONDS - (max(elapsedMs, 0L) / 1000).toInt(), 0)
}

/** After the watch turns the page by itself, taps wait a second (the thumb that hit Done is still there). */
class TouchLock {
    private var until = 0L
    fun lock(at: Long) { until = at + 1000 }
    fun unlock() { until = 0 }
    fun allows(at: Long) = at >= until
}

object WeighIn {
    /** 79.4 → (79, 4); rounded to the tenth first, so 79.95 is (80, 0), never (79, 10). */
    fun parts(v: Double): Pair<Int, Int> {
        val tenths = Math.round(max(0.0, v) * 10)
        return (tenths / 10).toInt() to (tenths % 10).toInt()
    }

    /** (79, 4) → 79.4, on the tenth's grid. */
    fun join(whole: Int, tenth: Int): Double = (whole * 10 + tenth.coerceIn(0, 9)) / 10.0

    /** The weigh-in event for the phone's body weight list (SessionCore.swift weighIn). */
    fun event(w: Double, at: Double, id: String): Event? {
        if (w <= 0 || w >= 700) return null
        return buildJsonObject {
            put("id", id); put("type", "weighIn"); put("w", Math.round(w * 10) / 10.0); put("at", at.toLong())
        }
    }
}

/**
 * A workout left running (forgotten workouts, the phone's lib/forgotten-workout.js and WatchCore's
 * Idle): "Still training?" after the phone's quiet spell (45 minutes unless changed), "Looks like
 * you left the gym" at once when the phone walked out of the gym, and the workout ends by itself
 * once the question has waited its grace (5 minutes), at its last set plus that set's rest. The
 * phone checks such a finish against its own log before saving it (staleWatchFinish, #904) and
 * keeps the workout running when it was used there.
 *
 * An older phone sends no choices: the watch then only asks after 20 minutes and never ends one,
 * as before 1.4.5 (there is no phone round trip on Wear OS to confirm it).
 */
object Idle {
    const val ASK_AFTER_MS = 20 * 60 * 1000L
    private const val MIN = 60_000.0

    enum class State { ACTIVE, ASK, LEFT, END }

    /** `askAfter` 0: never asks. `ends` false: asks only (an older phone). Times in ms. */
    data class Rules(val askAfter: Double, val grace: Double, val leaveGym: Boolean, val ends: Boolean) {
        companion object {
            val OLDER = Rules(ASK_AFTER_MS.toDouble(), 0.0, leaveGym = false, ends = false)
            fun from(f: ForgottenSettings?): Rules {
                if (f == null) return OLDER
                val ask = f.askMin ?: 45.0
                return Rules(if (ask > 0) ask * MIN else 0.0, max(1.0, f.graceMin ?: 5.0) * MIN, f.leaveGym == true, ends = true)
            }
        }
    }

    /** The last set logged (either side), or the phone's last use of the workout, else its start. */
    fun lastSet(w: ActiveWorkout): Double? {
        val ticks = w.entries.flatMap { it.sets }.mapNotNull { it.at }.filter { it > 0 }.maxOrNull()
        val phone = w.activeAt?.takeIf { it > 0 }
        return listOfNotNull(ticks, phone).maxOrNull() ?: w.start?.takeIf { it > 0 }
    }

    /**
     * What idle time counts from: the newest of the last set, when this watch picked the workout up,
     * the last change to it from either side (`activity`) and a "keep going" answered.
     */
    fun since(lastSet: Double, seen: Double?, activity: Double?, snooze: Double?) =
        maxOf(lastSet, seen ?: 0.0, activity ?: 0.0, snooze ?: 0.0)

    fun asks(since: Double, now: Double) = now - since >= ASK_AFTER_MS

    /** `since`: the last thing that counts. `leftAt`: the phone left the gym then. */
    fun state(since: Double, now: Double, rules: Rules = Rules.OLDER, leftAt: Double? = null): State {
        if (rules.leaveGym && leftAt != null && leftAt > since) {
            return if (rules.ends && now >= leftAt + rules.grace) State.END else State.LEFT
        }
        if (rules.askAfter <= 0) return State.ACTIVE
        val idle = now - since
        if (idle < rules.askAfter) return State.ACTIVE
        return if (rules.ends && idle >= rules.askAfter + rules.grace) State.END else State.ASK
    }

    /** When it ends by itself if nobody answers (for the card's words), or null if it never does. */
    fun endsAt(since: Double, rules: Rules, leftAt: Double? = null): Double? {
        if (!rules.ends) return null
        if (rules.leaveGym && leftAt != null && leftAt > since) return leftAt + rules.grace
        return if (rules.askAfter > 0) since + rules.askAfter + rules.grace else null
    }

    /** Its last set plus the rest after it, never later than now; nothing logged: its start. */
    fun endAt(w: ActiveWorkout, now: Double): Double {
        var bestAt = 0.0
        var rest = 0.0
        for (e in w.entries) for (s in e.sets) {
            val at = s.at ?: continue
            val done = s.done || s.sides?.let { it.L.done || it.R.done } == true
            if (at > 0 && done && at > bestAt) { bestAt = at; rest = e.restSec ?: w.restSec }
        }
        if (bestAt <= 0) return min(now, w.start?.takeIf { it > 0 } ?: now)
        return min(now, bestAt + max(0.0, rest) * 1000)
    }

    fun minutes(since: Double, now: Double) = max(0, ((now - since) / 60_000).toInt())
}

/**
 * When the heart-rate sensor (WorkoutService's Health Services exercise) may rest: a workout never
 * finished (left open on the phone, the watch on its charger) kept it running for good. Idle = no
 * set ticked, no rest or hold running, no change from the phone and no start for three hours; the
 * next set or phone change wakes it (the Apple Watch's SensorPlan, its tests case for case).
 */
object SensorPlan {
    const val IDLE_LIMIT_MS = 3 * 3600 * 1000.0

    /** The latest moment anything happened in the workout: its start, `seen` (picked up or changed here), each tick, the rest's end. */
    fun lastActivity(w: ActiveWorkout, seen: Double?): Double? =
        (listOf(w.start, seen, w.rest?.endsAt) + w.entries.flatMap { e -> e.sets.map { it.at } }).filterNotNull().maxOrNull()

    /** Whether the sensor should rest now. `busy`: a rest or hold runs on the watch. No known time: not idle. */
    fun idle(w: ActiveWorkout?, seen: Double?, now: Double, busy: Boolean): Boolean {
        if (w == null || busy) return false
        val last = lastActivity(w, seen) ?: return false
        return now - last >= IDLE_LIMIT_MS
    }
}

/**
 * The exercises' stills on the Overview (Paths.STILL_PREFIX): the phone sends the running
 * workout's, the watch keeps them under stills/<workout id>/<exercise id>.webp. The Apple Watch's
 * Overview mark: the still when there is one and the phone shows animations, never in Always On.
 */
object Stills {
    private val PLAIN = Regex("[A-Za-z0-9_-]{1,64}")
    /** A still is ~5 KB; anything past this is not one. */
    const val MAX_BYTES = 64 * 1024

    /** A name from the phone that may become a file or folder name here. */
    fun safe(id: String?) = id != null && PLAIN.matches(id)

    /** The workouts' folders to delete: all but the running one's. */
    fun stale(folders: List<String>, running: String?) = folders.filter { it != running }

    fun shows(have: Boolean, showClip: Boolean?, ambient: Boolean) = have && showClip != false && !ambient
}

/**
 * Always On on a screen that can burn in (AmbientDetails.burnInProtectionRequired): the whole
 * screen moves a few dp each minute (onUpdateAmbient), round a 3 × 3 grid, so no pixel stays lit.
 */
object BurnIn {
    const val DP = 3

    /** The offset in dp for the n-th minute in Always On: (0, 0) first, then the grid's other eight. */
    fun offset(n: Int): Pair<Int, Int> {
        val i = Math.floorMod(n + 4, 9)
        return ((i % 3) - 1) * DP to ((i / 3) - 1) * DP
    }
}

/**
 * The rest's buzz with the screen off: the watch's processor sleeps between heart-rate batches, and
 * a timer that only counts while it is awake comes late. So the app holds it awake for the rest (or
 * a hold), a little past its end, and never for longer than a rest can sensibly be.
 */
object AwakePlan {
    const val MAX_MS = 15 * 60_000L
    const val PAST_MS = 3_000L

    /** How long to stay awake for a countdown ending at `endsAt`; 0 for one that is over. */
    fun holdMs(endsAt: Long, now: Long): Long = if (endsAt <= now) 0 else min(endsAt - now + PAST_MS, MAX_MS)
}

/**
 * The watch telling the phone it is there (the Apple Watch's watchStatus): its version and the
 * time, so Settings on the phone can say "Last heard from the watch". Not more often than every
 * few hours, and again after an update.
 */
object CheckIn {
    const val EVERY_MS = 6 * 3600_000L

    fun due(lastAt: Long, lastVersion: String?, version: String, now: Long) =
        lastVersion != version || now - lastAt >= EVERY_MS || now < lastAt

    fun event(version: String, at: Long, id: String): Event = buildJsonObject {
        put("id", id); put("type", "watchStatus"); put("version", version); put("platform", "wear"); put("at", at)
    }
}

/**
 * Where the heart rate comes from: our own exercise (the sensor at workout rate, kept alive in the
 * background), unless another app is recording one already. Health Services ends that app's
 * exercise when a second one starts, so then the watch only measures.
 */
object HrPlan {
    /** `tracked`: Health Services' ExerciseTrackedStatus now (null: it would not say). */
    fun measureOnly(tracked: Int?, otherAppInProgress: Int) = tracked != null && tracked == otherAppInProgress
}

/**
 * Whether the phone is in reach for the sync line: any node the Data Layer is connected to, near
 * (Bluetooth) or not (over Wi-Fi), carries the sets across. `nearby` alone called a phone on Wi-Fi
 * out of reach while it synced.
 */
object Reach {
    fun phone(connected: Int) = connected > 0
    /** Whether the link is looked after now (every 30 s): a workout runs, or something still waits. */
    fun upkeep(workout: Boolean, waiting: Int) = workout || waiting > 0
}

/**
 * The curved line at the top of a round screen: the clock, and a word before it when there is arc
 * for one. "Quick check-in · 8:23" ran down the side of a 40 mm watch with the clock on its ear.
 */
object TopLine {
    /** The left inset of left-aligned rows on a round screen, as a share of its width. */
    const val ROUND_INSET = 0.18f

    /** Whether `lead` fits before the clock: a short word on a small watch (under 210 dp), a few on a larger one. */
    fun leadFits(lead: String, widthDp: Int) = lead.length <= (if (widthDp < 210) 6 else 16)
}

/** 62.25 → "62.25", 62.5 → "62.5", 60.0 → "60". */
fun formatNumber(v: Double): String {
    val r = Math.round(v * 100) / 100.0
    if (r == floor(r)) return r.toLong().toString()
    return r.toString().let { if (it.contains('.')) it.trimEnd('0').trimEnd('.') else it }
}

/** A weight or rep count moved by the crown, on the field's grid and inside its range. */
fun nudge(v: Double, steps: Int, step: Double, lo: Double, hi: Double): Double {
    if (step <= 0) return v
    val k = v / step
    val idx = if (steps > 0) floor(k + 1e-9) + steps else kotlin.math.ceil(k - 1e-9) + steps
    return min(hi, max(lo, Math.round(idx * step * 100) / 100.0))
}
