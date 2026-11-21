package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import kotlin.math.abs
import kotlin.random.Random

/**
 * The watch's own protocol code under random abuse (watch-wear verification, 1.4.5). The page's
 * watch-sync.property.test.js does this for the page and a port of the watch; this one runs the
 * Wear OS app's real pieces (SessionCore, OutboxCore, SnapshotIn, ClockOffset, RestFollow,
 * RestEvents) the way WearStore strings them together, against a small phone that keeps the rules
 * of docs/WATCH_SYNC.md (later wins by the phone's clock, one rest by its stamp, each event once).
 *
 * Each seed: a workout on the phone with set ids; sets ticked and corrected at the wrist and on the
 * phone, +15/-15/Skip on the watch, +15/Skip/pause/resume on the phone; the link going and coming;
 * events lost, sent twice and delivered out of order; snapshot messages late, lost and reordered;
 * the data item arriving before or after its message; the watch app killed (everything through its
 * saved JSON) and the phone page killed between applying and acknowledging; a watch clock up to two
 * minutes off; the workout finished on either side. Then the link is let settle, and:
 *
 *  - every set ticked at the wrist is done in the phone's workout (running or saved), none lost;
 *  - the outbox is empty and no tick is still pending on the watch;
 *  - while the workout runs, the watch shows the phone's sets with the phone's numbers;
 *  - the two rests agree to within a second (on one clock), or neither runs;
 *  - a workout ended on one side has ended on the other.
 *
 * RUN_SEED=<n> replays one seed, WEAR_SIM_RUNS=<n> runs more.
 */
class WearPropertyTest {
    private val t0 = 1_800_000_000_000L
    private val restMs = 60_000L

    private class PRow(val sid: String, var w: Double, var r: Double, var done: Boolean = false, var at: Double? = null)
    private class PEntry(val id: String, val rows: MutableList<PRow>)

    /** A message, data item or event on its way, and when it lands. */
    private class Flight<T>(val what: T, val at: Long)

    private inner class World(val seed: Int) {
        val rnd = Random(seed)
        val log = mutableListOf<String>()
        var t = t0                                   // the phone's clock
        val skew = if (rnd.nextBoolean()) 0L else rnd.nextLong(-120_000, 120_000)
        fun wnow() = t + skew                        // the watch's clock
        var near = true

        /* ----- the phone ----- */
        val entries = listOf(
            PEntry("bp", MutableList(5) { PRow("a$it", 60.0, 8.0) }),
            PEntry("row", MutableList(5) { PRow("b$it", 50.0, 10.0) }),
            PEntry("bp", MutableList(3) { PRow("c$it", 40.0, 12.0) }),    // the same exercise twice
        )
        var running = true                           // false: finished (on either side), saved
        val applied = LinkedHashSet<String>()        // the page's applied ids, on disk
        val queue = LinkedHashMap<String, JsonObject>()   // the native queue file
        var pRestAt = 0.0
        var pRestEnd: Long? = null
        var pPausedLeft: Long? = null
        var stamp = 0L
        val ticked = mutableSetOf<String>()          // sids ticked at the wrist

        fun row(sid: String) = entries.flatMap { it.rows }.firstOrNull { it.sid == sid }

        fun snapshotJson(): String {
            val active = if (!running) null else ActiveWorkout(
                id = "w1", name = "Push", unit = "kg", restSec = 60.0,
                entries = entries.map { e -> Entry(e.id, e.id, restSec = 60.0, sets = e.rows.map { SetRow(w = it.w, r = it.r, done = it.done, at = it.at, sid = it.sid) }) },
                rest = pRestEnd?.let { RestInfo(it.toDouble(), 60.0) },
                restPaused = if (pPausedLeft != null) true else null,
                restLeft = pPausedLeft?.let { it / 1000.0 },
                restAt = pRestAt.takeIf { it > 0 },
                start = t0.toDouble())
            val snap = Snapshot(v = 2, unit = "kg", restSec = 60.0, active = active, acked = applied.toList().takeLast(80), now = t.toDouble())
            return WireJson.encodeToString(Snapshot.serializer(), snap)
        }

        fun restChange(at: Double, end: Long?, paused: Long? = null) {
            if (at <= pRestAt) return
            pRestAt = at
            pRestEnd = end?.takeIf { it > t + 500 }
            pPausedLeft = paused
        }

        /** The page drains the queue: each id once, in the watch's order; killed before the ack sometimes. */
        fun drain() {
            val evs = queue.values.sortedBy { it["seq"]?.jsonPrimitive?.longOrNull ?: 0 }
            for (ev in evs) {
                val id = ev["id"]!!.jsonPrimitive.content
                if (id in applied) continue
                applyEvent(ev)
                applied += id
            }
            if (rnd.nextInt(6) == 0) { log += "page killed before the ack"; return }
            queue.clear()
        }

        fun applyEvent(ev: JsonObject) {
            val off = ev["off"]?.jsonPrimitive?.longOrNull ?: 0
            val at = ev["at"]?.jsonPrimitive?.double?.minus(off) ?: t.toDouble()
            when (ev["type"]?.jsonPrimitive?.content) {
                "setDone" -> {
                    val r = row(ev["sid"]!!.jsonPrimitive.content) ?: return
                    if (!r.done || (r.at ?: 0.0) <= at) {
                        r.done = true; r.at = at
                        ev["w"]?.jsonPrimitive?.doubleOrNull?.let { r.w = it }
                        ev["r"]?.jsonPrimitive?.doubleOrNull?.let { r.r = it }
                    }
                    if (running) ev["restEnd"]?.jsonPrimitive?.long?.let { end -> restChange(at, if (end > 0) end - off else null) }
                }
                "rest" -> if (running) {
                    val e = ev["endsAt"]
                    restChange(at, if (e == null || e is JsonNull) null else e.jsonPrimitive.long - off)
                }
                "finish" -> if (running) { running = false; pRestEnd = null; pPausedLeft = null; log += "phone: saved (finished on the watch)" }
            }
        }

        /* ----- the watch, as WearStore strings the pure pieces together ----- */
        var state = SessionState(unit = "kg", restSec = 60.0)
        var box = Outbox()
        var wRestAt = 0.0
        var wRestAtWid: String? = null
        var wRestEnd: Long? = null
        var wPausedLeft: Long? = null
        var clock = ClockSamples()
        var snapAt = emptyMap<String, Long>()
        var ids = 0
        /** When (real time) the lifter last changed the rest at the wrist, and what broke the rules on the way. */
        var lastOwnReal = 0L
        val broken = mutableListOf<String>()
        var restCompared = 0

        fun off() = ClockOffset.off(clock, wnow())
        fun restAtFor(wid: String?) = if (wid != null && wid == wRestAtWid) wRestAt else 0.0
        fun noteRestAt(at: Double, wid: String?) { wRestAt = at; wRestAtWid = wid }

        fun send(e: Event) {
            val withOff = RestEvents.withOff(e, off())
            val (o, item) = OutboxCore.add(box, withOff) ?: return
            box = o
            put(item)
        }

        fun receive(json: String, source: String, at: Long, viaMessage: Boolean) {
            val snap = Snapshot.parse(json)!!
            val step = SnapshotIn.take(snapAt, clock, source, at, viaMessage, wnow(), snap.now)
            clock = step.clock
            if (!step.apply) return
            snapAt = step.stamps
            val off = off()
            val before = state
            val after = SessionCore.applySnapshot(before, snap, off)
            if (before.workout != null && after.workout == null) { wRestEnd = null; wPausedLeft = null; log += "watch: ended by the phone" }
            if (before.workout?.id != after.workout?.id && after.workout != null) {
                if (before.workout != null) { wRestEnd = null; wPausedLeft = null }
                noteRestAt(0.0, after.workout.id)
            }
            val active = snap.active
            val wid = after.workout?.id
            val restBefore = wRestEnd to wPausedLeft
            if (active != null && wid != null && wid == active.id) {
                when (val f = RestFollow.of(active, restAtFor(wid), off, wRestEnd.takeIf { wPausedLeft == null }, wPausedLeft)) {
                    is RestFollow.Run -> {
                        noteRestAt(f.restAt, wid)
                        if (f.endsAt <= wnow() + 500) { wRestEnd = null; wPausedLeft = null }
                        else if (f.restart) { wRestEnd = f.endsAt; wPausedLeft = null }
                    }
                    is RestFollow.Pause -> { noteRestAt(f.restAt, wid); wRestEnd = null; wPausedLeft = f.leftMs }
                    is RestFollow.End -> { noteRestAt(f.restAt, wid); wRestEnd = null; wPausedLeft = null }
                    else -> {}
                }
                // A picture of the phone from before the lifter's own newest change never moves the rest
                // (the phone's restAt is its clock, the real time in this world).
                val pAt = active.restAt ?: 0.0
                if ((wRestEnd to wPausedLeft) != restBefore && pAt > 0 && pAt <= lastOwnReal)
                    broken += "a picture with restAt ${pAt.toLong() - t0} changed the rest after the wrist's change at ${lastOwnReal - t0}"
            }
            state = after
            box = OutboxCore.ack(box, snap.acked)
        }

        fun watchTick() {
            val w = state.workout ?: return
            var ei = state.entryIndex
            if (SessionCore.setIndex(state, ei) == null) ei = w.entries.indices.firstOrNull { SessionCore.setIndex(state, it) != null } ?: return
            val si = SessionCore.setIndex(state, ei) ?: return
            val row = w.entries[ei].sets[si]
            val at = wnow()
            val wt = (row.w ?: 0.0) + 2.5 * rnd.nextInt(0, 3)
            val (s1, ev0) = SessionCore.tick(state, ei, si, null, wt, row.r, null, at.toDouble(), "e${seed}-${++ids}")
            ev0 ?: return
            val (nextEi, rest) = SessionCore.next(s1, ei, si)
            val end = if (rest && nextEi < w.entries.size) at + restMs else 0L
            val off = off()
            send(JsonObject(ev0 + ("restEnd" to JsonPrimitive(end))))
            noteRestAt(RestEvents.stamp(at, off), w.id)
            lastOwnReal = t
            state = s1.copy(entryIndex = nextEi)
            if (end > 0) { wRestEnd = end; wPausedLeft = null } else { wRestEnd = null; wPausedLeft = null }
            ticked += row.sid!!
            log += "watch: tick ${row.sid} $wt"
        }

        fun watchFix() {
            val w = state.workout ?: return
            val done = w.entries.flatMapIndexed { ei, e -> e.sets.mapIndexedNotNull { si, r -> if (r.done) ei to si else null } }
            if (done.isEmpty()) return
            val (ei, si) = done[rnd.nextInt(done.size)]
            val r = w.entries[ei].sets[si]
            val (s1, ev) = SetFix.correct(state, ei, si, null, SetFix.Numbers((r.w ?: 0.0) + 5.0, r.r, null), null, wnow().toDouble(), "e${seed}-${++ids}", off())
            ev ?: return
            send(ev); state = s1
            log += "watch: fix ${r.sid}"
        }

        fun watchRest(kind: Int) {
            val wid = state.workout?.id ?: return
            val end = wRestEnd ?: return
            if (wPausedLeft != null) return
            val now = wnow()
            val to: Long? = when (kind) {
                0 -> (end + 15_000).coerceAtLeast(now + 1000)
                1 -> RestMath.minus(end, now)
                else -> null
            }
            wRestEnd = to
            noteRestAt(RestEvents.stamp(now, off()), wid)
            lastOwnReal = t
            send(RestEvents.rest(wid, to, now, "e${seed}-${++ids}"))
            log += "watch: rest ${listOf("+15", "-15", "skip")[kind]}"
        }

        fun watchFinish() {
            val (s1, ev) = SessionCore.finish(state, wnow().toDouble(), "e${seed}-${++ids}")
            ev ?: return
            send(ev); state = s1; wRestEnd = null; wPausedLeft = null
            log += "watch: finish"
        }

        fun restartWatch() {
            state = WireJson.decodeFromString(SessionState.serializer(), WireJson.encodeToString(SessionState.serializer(), state))
            box = WireJson.decodeFromString(Outbox.serializer(), WireJson.encodeToString(Outbox.serializer(), box))
            clock = WireJson.decodeFromString(ClockSamples.serializer(), WireJson.encodeToString(ClockSamples.serializer(), clock))
            log += "watch app killed and relaunched"
        }

        /* ----- the link ----- */
        val toPhone = mutableListOf<Flight<String>>()
        val messages = mutableListOf<Flight<Pair<Long, String>>>()
        var item: Flight<Pair<Long, String>>? = null
        var settling = false

        fun put(it: OutItem) {
            if (!near) return
            val f = if (settling) 0 else rnd.nextInt(10)
            if (f == 0 && !settling) return                       // lost on the way
            toPhone += Flight(it.json, t + rnd.nextLong(0, if (settling) 50 else 8_000))
            if (f == 1) toPhone += Flight(it.json, t + rnd.nextLong(0, 20_000))   // and once more
            box = OutboxCore.sent(box, listOf(it.id), wnow())
        }

        fun phoneChanged() {
            val json = snapshotJson()
            val s = ++stamp
            val lost = !settling && rnd.nextInt(8) == 0
            if (near && !lost) messages += Flight(s to json, t + (if (settling) 30 else rnd.nextLong(20, 400)))
            item = Flight(s to json, t + (if (settling) 60 else rnd.nextLong(10, 5_000)))
        }

        fun advance(ms: Long) {
            val end = t + ms
            while (true) {
                val next = listOfNotNull(toPhone.minOfOrNull { it.at }, messages.minOfOrNull { it.at }, item?.at?.takeIf { near })
                    .filter { it <= end }.minOrNull() ?: break
                t = maxOf(t, next)
                toPhone.filter { it.at <= t }.let { due -> toPhone.removeAll(due); if (near) for (d in due) { val ev = WireJson.parseToJsonElement(d.what).jsonObject; queue.putIfAbsent(ev["id"]!!.jsonPrimitive.content, ev) } }
                messages.filter { it.at <= t }.sortedBy { if (settling) it.at else rnd.nextLong() }.let { due -> messages.removeAll(due); if (near) for (m in due) receive(m.what.second, "phone", m.what.first, true) }
                item?.takeIf { it.at <= t && near }?.let { item = null; receive(it.what.second, "phone", it.what.first, false) }
            }
            t = end
            // rests that run out by themselves (no change of anyone's stamp)
            if (pRestEnd != null && pRestEnd!! <= t) pRestEnd = null
            if (wRestEnd != null && wRestEnd!! <= wnow()) wRestEnd = null
        }

        fun resend() { for (it in box.items) put(it) }

        fun play(steps: Int) {
            // the workout starts on the phone; its first snapshot comes as a message, so the watch knows the clock
            phoneChanged(); advance(1_000)
            if (state.workout == null) { messages.clear(); messages += Flight(stamp to snapshotJson(), t); advance(10) }
            val midway = rnd.nextInt(8, 30)
            repeat(steps) { step ->
                // once in the middle: a set and a rest change, the link settles, and the two must agree mid-workout
                if (step == midway && running) {
                    watchTick(); advance(1_200); if (rnd.nextBoolean()) watchRest(rnd.nextInt(2))
                    settle(); check(); settling = false
                }
                when (rnd.nextInt(20)) {
                    0, 1, 2, 3, 4 -> watchTick()
                    5 -> watchFix()
                    6, 7 -> watchRest(rnd.nextInt(3))
                    8 -> if (running) {                          // a set ticked on the phone
                        entries.flatMap { it.rows }.firstOrNull { !it.done }?.let { r ->
                            r.done = true; r.at = t.toDouble(); restChange(t.toDouble(), t + restMs); log += "phone: tick ${r.sid}"; phoneChanged()
                        }
                    }
                    9 -> if (running) {                           // a weight changed on the phone (its stamp moves)
                        entries.flatMap { it.rows }.filter { it.done }.randomOrNull(rnd)?.let { r -> r.w += 1.0; r.at = t.toDouble(); log += "phone: edit ${r.sid}"; phoneChanged() }
                    }
                    10 -> if (running && pRestEnd != null) { val e = pRestEnd!! + 15_000; restChange(t.toDouble(), e); log += "phone: +15"; phoneChanged() }
                    11 -> if (running && (pRestEnd != null || pPausedLeft != null)) { restChange(t.toDouble(), null); log += "phone: skip"; phoneChanged() }
                    12 -> if (running && pRestEnd != null) { restChange(t.toDouble(), null, pRestEnd!! - t); log += "phone: pause"; phoneChanged() }
                    13 -> if (running && pPausedLeft != null) { restChange(t.toDouble(), t + pPausedLeft!!); log += "phone: resume"; phoneChanged() }
                    14 -> { near = !near; log += if (near) "back in reach" else "out of reach"; if (near) { resend(); item?.let { item = Flight(it.what, t + 200) } } }
                    15 -> restartWatch()
                    16 -> { drain(); phoneChanged() }
                    17 -> if (rnd.nextInt(8) == 0) watchFinish() else resend()
                    18 -> if (running && rnd.nextInt(8) == 0) { running = false; pRestEnd = null; pPausedLeft = null; log += "phone: finish"; phoneChanged() }
                    else -> {}
                }
                advance(rnd.nextLong(500, 12_000))
                if (rnd.nextInt(3) == 0) { drain(); phoneChanged() }
            }
            // often the last thing is a set at the wrist, then a rest change somewhere: a rest runs while it settles
            if (rnd.nextBoolean()) { watchTick(); advance(1_200); if (rnd.nextBoolean()) watchRest(rnd.nextInt(2)) }   // the rest's buttons wait a second after Done (touchLock)
            settle()
        }

        fun settle() {
            settling = true; near = true
            log += "-- settle"
            repeat(12) {
                resend(); advance(100); drain(); phoneChanged(); advance(200)
            }
        }

        fun check() {
            val why = broken.toMutableList()
            if (box.items.isNotEmpty()) why += "outbox not empty: ${box.items.map { OutboxCore.eventType(it) }}"
            if (state.pending.isNotEmpty()) why += "pending left: ${state.pending.keys}"
            for (sid in ticked) if (row(sid)?.done != true) why += "set $sid ticked at the wrist is not on the phone"
            val w = state.workout
            if (running) {
                if (w == null) why += "the phone runs the workout, the watch does not"
                else {
                    val mine = w.entries.flatMap { it.sets }
                    val theirs = entries.flatMap { it.rows }
                    for ((a, b) in mine.zip(theirs)) if (a.done != b.done || a.w != b.w || a.r != b.r)
                        why += "set ${b.sid}: watch ${a.done}/${a.w}x${a.r}, phone ${b.done}/${b.w}x${b.r}"
                    // one rest, on one clock (the watch's offset is known to the message delay: well under a second)
                    val pe = pRestEnd; val we = wRestEnd
                    when {
                        pPausedLeft != null -> if (wPausedLeft == null || abs(wPausedLeft!! - pPausedLeft!!) > 1000) why += "phone paused at ${pPausedLeft}, watch ${wPausedLeft}/${we}"
                        pe != null && pe > t + 1500 -> if (restCompared++ < 0 || we == null || abs((we - skew) - pe) > 1000) why += "phone rest ends ${pe - t}, watch ${we?.let { it - wnow() }}"
                        pe == null -> if (we != null && we > wnow() + 1500) why += "phone has no rest, the watch's ends in ${we - wnow()}"
                    }
                }
            } else if (w != null) why += "finished on one side, still running on the watch"
            if (why.isNotEmpty()) fail("seed $seed (skew $skew): ${why.joinToString("; ")}\n  " + log.joinToString("\n  "))
        }
    }

    @Test fun everySetLandsOnceAndBothSidesAgree() {
        val one = System.getenv("RUN_SEED")?.toIntOrNull()
        val runs = System.getenv("WEAR_SIM_RUNS")?.toIntOrNull() ?: 400
        val seeds = if (one != null) listOf(one) else (1..runs).toList()
        var finished = 0; var ticks = 0; var rests = 0; var skewedRests = 0
        for (seed in seeds) {
            val w = World(seed)
            w.play(60)
            w.check()
            rests += w.restCompared; if (w.skew != 0L) skewedRests += w.restCompared
            if (!w.running) finished++
            ticks += w.ticked.size
        }
        // the seeds really did something: sets at the wrist and workouts ended
        if (one == null) {
            assertTrue("sets at the wrist", ticks > seeds.size * 3)
            assertTrue("workouts ended", finished > 10)
            assertTrue("rests running at the end, compared: $rests ($skewedRests with the clocks off)", rests > seeds.size / 8 && skewedRests > seeds.size / 16)
        }
    }

    @Test fun aLateMessageNeverRestartsTheRest() {
        val w = World(7)
        w.phoneChanged(); w.advance(1_000)
        assertTrue(w.state.workout != null)
        // a set ticked on the phone starts its rest; the watch follows it
        val r = w.entries[0].rows[0]
        r.done = true; r.at = w.t.toDouble(); w.restChange(w.t.toDouble(), w.t + 60_000)
        val old = w.snapshotJson(); val oldStamp = ++w.stamp
        w.receive(old, "phone", oldStamp, viaMessage = true)
        val followed = w.wRestEnd!!
        assertTrue("on the watch's clock, to the message's delay", abs(w.pRestEnd!! + w.skew - followed) <= 400)
        // Skip at the wrist, then the phone's picture from before it comes again (a late message, the item put again)
        w.advance(2_000)
        w.watchRest(2)
        assertNull(w.wRestEnd)
        w.receive(old, "phone", oldStamp, viaMessage = true)
        assertNull("the same stamp: skipped", w.wRestEnd)
        w.receive(old, "phone", w.stamp + 10, viaMessage = false)
        assertNull("a rest change older than the Skip: ignored, the rest stays skipped", w.wRestEnd)
        // +15 at the wrist on a new rest, and the old picture again: the +15 stands
        w.watchTick(); w.advance(1_500)
        val mine = w.wRestEnd!!
        w.watchRest(0)
        assertEquals(mine + 15_000, w.wRestEnd)
        w.receive(old, "phone", w.stamp + 12, viaMessage = false)
        assertEquals("the phone's older rest never replaces the +15", mine + 15_000, w.wRestEnd)
        assertTrue(w.broken.isEmpty())
    }
}
