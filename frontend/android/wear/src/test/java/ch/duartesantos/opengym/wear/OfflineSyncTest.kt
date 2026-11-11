package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The watch and the phone apart (the fable round, 1.4.5): a whole workout at the wrist with no
 * phone, the watch dying mid-queue, acks that never come, the phone ending or changing the workout
 * meanwhile, the same set changed on both sides, clocks that disagree, a second watch.
 *
 * `offline-workout.json` is what this watch sends for a workout the phone never saw; the page's
 * own test (frontend/src/lib/watch-sync.offline.test.js) merges that very file, shuffled and twice
 * over, into the phone's history. Written on purpose with UPDATE_WEAR_FIXTURES=1.
 */
class OfflineSyncTest {
    private val t0 = 1_800_000_000_000.0
    private val wid = "watch-off-1"
    private val bench = Entry("0025", "Barbell Bench Press", restSec = 45.0, sets = listOf(SetRow(w = 60.0, r = 8.0), SetRow(w = 60.0, r = 8.0)))
    private val plank = Entry("0007", "Plank", mode = "time", sets = listOf(SetRow(sec = 20.0)))
    private val curl = Entry("0001", "Curl", group = "g1", sets = listOf(SetRow(w = 20.0, r = 10.0), SetRow(w = 20.0, r = 10.0)))
    private val raise = Entry("0009", "Raise", group = "g1", sets = listOf(SetRow(w = 15.0, r = 12.0), SetRow(w = 15.0, r = 12.0)))
    private val push = ReadySession(listOf("r-push"), "Push day", listOf(bench, plank, curl, raise))

    /** The app killed and started again: everything it knows is what it saved. */
    private fun restart(s: SessionState) = WireJson.decodeFromString(SessionState.serializer(), WireJson.encodeToString(SessionState.serializer(), s))
    private fun restart(o: Outbox) = WireJson.decodeFromString(Outbox.serializer(), WireJson.encodeToString(Outbox.serializer(), o))
    private fun type(i: OutItem) = OutboxCore.eventType(i)
    private fun setEvent(id: String) = kotlinx.serialization.json.buildJsonObject { put("id", JsonPrimitive(id)); put("type", JsonPrimitive("setDone")) }
    private fun snap(active: ActiveWorkout?, acked: List<String>? = null, discarded: List<String>? = null) =
        Snapshot(unit = "kg", restSec = 60.0, active = active, acked = acked, discarded = discarded)
    private fun phoneWorkout(vararg e: Entry, id: String = "w-1", cur: Int = 0) = ActiveWorkout(id = id, name = "Push day", unit = "kg", cur = cur, entries = e.toList(), start = t0)

    /** A whole workout with the phone switched off, the app killed after every single event. */
    private fun offlineWorkout(): Pair<SessionState, Outbox> {
        var s = SessionState(unit = "kg", restSec = 60.0, ready = Ready(today = push), synced = true)
        var o = Outbox()
        fun send(e: Event?) { if (e != null) o = restart(OutboxCore.add(o, e)!!.first); s = restart(s) }
        fun tick(ei: Int, si: Int, w: Double?, r: Double?, sec: Double?, at: Double, id: String, hr: Pair<Int, Int>? = null) =
            SessionCore.tick(s, ei, si, null, w, r, sec, at, id, hr).let { (n, e) -> s = n; send(e) }

        send(WeighIn.event(80.5, t0, "off-1"))
        SessionCore.start(s, push, wid, t0 + 1_000, "off-2", bw = 80.5).let { (n, e) -> s = n; send(e) }
        tick(0, 0, 60.0, 8.0, null, t0 + 60_000, "off-3", 121 to 134)
        tick(0, 1, 62.5, 7.0, null, t0 + 180_000, "off-4", 130 to 148)
        // the second set was six reps after all, and hard: fixed on the rest screen
        SetFix.correct(s, 0, 1, null, SetFix.Numbers(62.5, 6.0, null), EffortRating("rir", 2.0), now = t0 + 200_000, id = "off-5").let { (n, e) -> s = n; send(e) }
        send(SessionCore.setHrEvent(wid, "0025", 0, 1, "off-6", restHr = 118 to 126))
        // the plank, stopped two seconds early
        tick(1, 0, null, null, 18.0, t0 + 300_000, "off-7")
        // the superset in turns; the last raise is passed over
        tick(2, 0, 20.0, 10.0, null, t0 + 360_000, "off-8")
        tick(3, 0, 15.0, 12.0, null, t0 + 400_000, "off-9")
        tick(2, 1, 20.0, 9.0, null, t0 + 480_000, "off-10")
        s = SessionCore.skip(s, 3, 1)
        SessionCore.finish(s, t0 + 600_000, "off-11").let { (n, e) -> s = n; send(e) }
        return s to o
    }

    @Test fun aWholeWorkoutWithoutThePhoneWaitsCompleteAndInOrder() {
        val (s, o) = offlineWorkout()
        assertNull(s.workout)
        assertTrue(wid in s.finishedHere)
        assertEquals((1L..11L).toList(), o.items.map { it.seq })
        assertEquals(listOf("weighIn", "start", "setDone", "setDone", "setDone", "setHr", "setDone", "setDone", "setDone", "setDone", "finish"), o.items.map { type(it) })
        // seven sets the lifter would miss: the pill's number
        assertEquals(7, OutboxCore.waitingSets(o))
        assertEquals(11, OutboxCore.due(o, t0.toLong() + 700_000).size)

        val sent = JsonArray(o.items.map { WireJson.parseToJsonElement(it.json) })
        val file = File("src/test/resources/offline-workout.json")
        if (System.getenv("UPDATE_WEAR_FIXTURES") != null) file.writeText(kotlinx.serialization.json.Json { prettyPrint = true }.encodeToString(JsonArray.serializer(), sent) + "\n")
        val expected = WireJson.parseToJsonElement(file.readText())
        assertEquals(norm(expected), norm(sent))
    }

    @Test fun thePhoneComingBackWithItsOldPictureBringsNothingBack() {
        var (s, o) = offlineWorkout()
        // the phone's first snapshot after hours apart: no workout, nothing applied yet
        s = SessionCore.applySnapshot(s, snap(null))
        assertNull(s.workout)
        // it applied the start and the sets but not the finish yet, so it shows the workout running
        val running = ActiveWorkout(id = wid, name = "Push day", entries = push.entries, start = t0 + 1_000)
        s = SessionCore.applySnapshot(s, snap(running, acked = listOf("off-1", "off-2", "off-3")))
        assertNull("finished here stays finished", s.workout)
        o = OutboxCore.ack(o, listOf("off-1", "off-2", "off-3"))
        assertEquals(8, o.items.size)
        // everything applied: the outbox is empty, nothing waits
        o = OutboxCore.ack(o, (1..11).map { "off-$it" })
        assertTrue(o.items.isEmpty())
        assertEquals(0, OutboxCore.waitingSets(o))
    }

    @Test fun theWatchDyingMidQueueGoesOnWhereItWas() {
        var o = Outbox()
        for (i in 1..5) o = OutboxCore.add(o, setEvent("e$i"))!!.first
        o = OutboxCore.sent(o, listOf("e1", "e2"), 10_000)
        o = OutboxCore.delivered(o, listOf("e1"))
        // killed here: e3..e5 were never put, e2's put may or may not have got through
        o = restart(o)
        assertEquals(listOf("e3", "e4", "e5"), OutboxCore.due(o, 10_001).map { it.id })
        assertEquals(listOf("e2", "e3", "e4", "e5"), OutboxCore.due(o, 10_000 + OutboxCore.RESEND_MS).map { it.id })
        // back in reach: everything the phone has not stored, in the order it happened
        assertEquals(listOf("e2", "e3", "e4", "e5"), OutboxCore.onReconnect(o, 10_001).map { it.id })
        // new events after the restart carry on the numbering: no seq is used twice
        val (o2, next) = OutboxCore.add(o, setEvent("e6"))!!
        assertEquals(6L, next.seq)
        assertEquals(6, o2.items.size)
    }

    @Test fun aWatchRebootedWithItsClockResetStillSends() {
        var o = OutboxCore.add(Outbox(), CheckIn.event("1.4.5", 1000, "e1"))!!.first
        o = OutboxCore.sent(o, listOf("e1"), 1_800_000_000_000)
        // after the reboot the clock says 2020 until it hears from the phone
        assertEquals(listOf("e1"), OutboxCore.due(restart(o), 1_600_000_000_000).map { it.id })
    }

    @Test fun anAckThatNeverComesMeansSendingAgainButEverMoreRarely() {
        var o = OutboxCore.add(Outbox(), CheckIn.event("1.4.5", 1000, "e1"))!!.first
        var now = 1_000_000L
        val waits = mutableListOf<Long>()
        repeat(8) {
            o = OutboxCore.sent(o, listOf("e1"), now)
            val w = OutboxCore.wait(o.items[0])
            assertTrue(OutboxCore.due(o, now + w - 1).isEmpty())
            assertEquals(1, OutboxCore.due(o, now + w).size)
            waits += w; now += w
        }
        assertEquals(listOf(20_000L, 40_000L, 80_000L, 160_000L, 320_000L, 600_000L, 600_000L, 600_000L), waits)
        // stored on the phone but never applied (its page never ran): every ten minutes, never dropped
        o = OutboxCore.delivered(o, listOf("e1"))
        assertEquals(OutboxCore.REDELIVER_MS, OutboxCore.wait(o.items[0]))
        assertEquals(1, o.items.size)
        // the ack, twice over and with ids nobody knows: gone once, nothing breaks
        o = OutboxCore.ack(OutboxCore.ack(o, listOf("e1", "zz")), listOf("e1"))
        assertTrue(o.items.isEmpty())
    }

    @Test fun endedOnThePhoneWhileTheWatchLoggedOnOutOfReach() {
        var s = SessionCore.applySnapshot(SessionState(), snap(phoneWorkout(bench, curl)))
        var o = Outbox()
        SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, t0 + 1000, "a").let { (n, e) -> s = n; o = OutboxCore.add(o, e!!)!!.first }
        SessionCore.tick(s, 0, 1, null, 60.0, 7.0, null, t0 + 2000, "b").let { (n, e) -> s = n; o = OutboxCore.add(o, e!!)!!.first }
        // back in reach: the phone finished it an hour ago and knows nothing of these two
        s = SessionCore.applySnapshot(s, snap(null))
        assertNull(s.workout)
        assertTrue(s.pending.isEmpty())
        // the sets are not gone with the workout: they wait for the phone, which puts them into the saved one
        assertEquals(2, OutboxCore.waitingSets(o))
        assertEquals(listOf("a", "b"), OutboxCore.onReconnect(o, 5).map { it.id })
        assertEquals("w-1", WireJson.parseToJsonElement(o.items[0].json).jsonObject["wid"]!!.jsonPrimitive.content)
    }

    @Test fun startedHereWhileThePhoneRanAnotherOneKeepsItsOwn() {
        var s = SessionState(unit = "kg", restSec = 60.0, ready = Ready(today = push), synced = true)
        s = SessionCore.start(s, push, wid, t0, "st").first
        s = SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, t0 + 1000, "a").first
        // the phone turns up running a workout of its own
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(curl, id = "phone-9")))
        assertEquals(wid, s.workout!!.id)
        assertTrue(s.workout!!.entries[0].sets[0].done)
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(curl, id = "phone-9"), acked = listOf("st")))
        // The phone only applies a start when nothing else runs there. So once it names ours as applied
        // and still shows another workout, ours is over on the phone, and the watch shows what runs.
        assertEquals("phone-9", s.workout!!.id)
    }

    @Test fun aSnapshotMidSetKeepsWhatTheCrownMadeOfIt() {
        val key = Drafts.key("w-1", "0025", 0, 1, null)
        val loaded = Drafts.next(Draft(), key, 60.0, 8.0, 30.0)
        assertFalse(loaded.touched)
        // nothing changed on the phone: the same draft
        assertEquals(loaded, Drafts.next(loaded, key, 60.0, 8.0, 30.0))
        // the phone raised this set's weight and nobody touched the crown: the watch shows it
        assertEquals(65.0, Drafts.next(loaded, key, 65.0, 8.0, 30.0).w, 0.0)
        // the crown made it 62.5: a snapshot (even one with another plan) leaves it alone
        val turned = loaded.copy(w = 62.5)
        assertTrue(turned.touched)
        assertEquals(62.5, Drafts.next(turned, key, 65.0, 8.0, 30.0).w, 0.0)
        // another set, or the same row of another exercise: its own numbers
        assertEquals(20.0, Drafts.next(turned, Drafts.key("w-1", "0001", 0, 1, null), 20.0, 10.0, 30.0).w, 0.0)
        assertEquals(60.0, Drafts.next(turned, key, 60.0, 8.0, 30.0, force = true).w, 0.0)
    }

    @Test fun thePhonePutsAnExerciseInFrontAndTheWatchStaysOnItsOwn() {
        var s = SessionCore.applySnapshot(SessionState(), snap(phoneWorkout(bench, curl)))
        s = s.copy(entryIndex = 1)                                  // the lifter is on the curl
        s = SessionCore.tick(s, 1, 0, null, 20.0, 10.0, null, t0 + 1000, "a").first
        // the phone adds the plank at the top; its own marker stays where it was
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(plank, bench, curl)))
        assertEquals("0001", s.workout!!.entries[s.entryIndex].id)
        assertEquals(2, s.entryIndex)
        assertTrue("the tick made here is still on its set", s.workout!!.entries[2].sets[0].done)
        // moved to the end, an exercise taken out before it: still the curl
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(bench, plank, raise, curl)))
        assertEquals(3, s.entryIndex)
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(curl, bench)))
        assertEquals(0, s.entryIndex)
    }

    @Test fun thePhoneTakesTheExerciseOrTheSetAwayUnderATick() {
        var s = SessionCore.applySnapshot(SessionState(), snap(phoneWorkout(bench, curl)))
        s = s.copy(entryIndex = 1)
        s = SessionCore.tick(s, 1, 1, null, 20.0, 10.0, null, t0 + 1000, "a").first
        // the curl is gone on the phone: the watch lands on what is left, nothing crashes
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(bench)))
        assertTrue(s.entryIndex in 0..1)
        assertEquals(1, s.workout!!.entries.size)
        // the tick is still the watch's until the phone says it has it (the event waits in the outbox)
        assertNotNull(s.pending[SessionCore.key("0001", 1)])
        // the curl back with one set fewer: the tick has no row, and still waits
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(bench, curl.copy(sets = curl.sets.take(1)))))
        assertEquals(1, s.workout!!.entries[1].sets.size)
        assertNotNull(s.pending[SessionCore.key("0001", 1)])
        // applied on the phone: the watch lets go of its copy
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(bench, curl), acked = listOf("a")))
        assertTrue(s.pending.isEmpty())
    }

    @Test fun theSameExerciseTwiceStaysOnTheNearerOne() {
        var s = SessionCore.applySnapshot(SessionState(), snap(phoneWorkout(bench, curl, bench)))
        s = s.copy(entryIndex = 2)
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(plank, bench, curl, bench)))
        assertEquals(3, s.entryIndex)
    }

    @Test fun bothSidesChangeTheSameSetAndTheLaterOneWins() {
        var s = SessionCore.applySnapshot(SessionState(), snap(phoneWorkout(bench)))
        s = SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, t0 + 1000, "a").first
        // the phone ticked it too, earlier, with other numbers: the watch's later tick stays
        val phoneOlder = bench.copy(sets = listOf(SetRow(w = 55.0, r = 8.0, done = true, at = t0 + 500), bench.sets[1]))
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(phoneOlder)))
        assertEquals(60.0, s.workout!!.entries[0].sets[0].w!!, 0.0)
        assertEquals(1, s.pending.size)
        // the phone edits it after the watch's tick: the phone's numbers, the watch's copy gone
        val phoneNewer = bench.copy(sets = listOf(SetRow(w = 65.0, r = 5.0, done = true, at = t0 + 5000), bench.sets[1]))
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(phoneNewer)))
        assertEquals(65.0, s.workout!!.entries[0].sets[0].w!!, 0.0)
        assertTrue(s.pending.isEmpty())
        // the phone unticks a set it has applied (acked): it stays unticked here
        s = SessionCore.tick(s, 0, 1, null, 60.0, 8.0, null, t0 + 6000, "b").first
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(bench.copy(sets = listOf(phoneNewer.sets[0], SetRow(w = 60.0, r = 8.0)))), acked = listOf("b")))
        assertFalse(s.workout!!.entries[0].sets[1].done)
    }

    @Test fun aFixFromAWatchWhoseClockRunsBehindStillWins() {
        // the phone ticked the set at its own 12:00:00; the watch's clock says 11:55
        val ticked = bench.copy(sets = listOf(SetRow(w = 60.0, r = 8.0, done = true, at = t0), bench.sets[1]))
        val s = SessionCore.applySnapshot(SessionState(), snap(phoneWorkout(ticked)))
        val (_, e) = SetFix.correct(s, 0, 0, null, SetFix.Numbers(60.0, 6.0, null), now = t0 - 300_000, id = "fix")
        val at = e!!["at"]!!.jsonPrimitive.content.toDouble()
        assertTrue("later than the tick it corrects, so the phone takes it", at > t0)
    }

    @Test fun aWatchWhoseClockRunsAheadGetsItsTickConfirmedAllTheSame() {
        var s = SessionCore.applySnapshot(SessionState(), snap(phoneWorkout(bench)))
        val ahead = t0 + 300_000                                    // five minutes fast
        s = SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, ahead, "a").first
        // the phone keeps the watch's own time on the set, so the two agree whatever their clocks say
        val applied = bench.copy(sets = listOf(SetRow(w = 60.0, r = 8.0, done = true, at = ahead), bench.sets[1]))
        s = SessionCore.applySnapshot(s, snap(phoneWorkout(applied)))
        assertTrue(s.pending.isEmpty())
        assertTrue(s.workout!!.entries[0].sets[0].done)
    }

    @Test fun aSetLoggedOnAnotherWatchComesInAsThePhones() {
        var s = SessionCore.applySnapshot(SessionState(), snap(phoneWorkout(bench, curl)))
        val before = s.workout
        s = SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, t0 + 1000, "mine").first
        // the Garmin on the other wrist logged the first curl; the phone applied it and names its event
        val both = phoneWorkout(bench, curl.copy(sets = listOf(SetRow(w = 20.0, r = 10.0, done = true, at = t0 + 2000), curl.sets[1])))
        val after = SessionCore.applySnapshot(s, snap(both, acked = listOf("garmin-17")))
        assertEquals(listOf(PhoneTick("0001", 1, 0, t0 + 2000)), SessionCore.phoneTicks(s.workout, after.workout))
        // this watch's own tick is untouched by the other one's ack
        assertNotNull(after.pending[SessionCore.key("0025", 0)])
        assertTrue(after.workout!!.entries[0].sets[0].done)
        assertTrue(after.workout!!.entries[1].sets[0].done)
        assertNotNull(before)
    }

    @Test fun theSmallRulesOfTheLink() {
        // awake for the rest, a little past its end, never for longer than a rest can be
        assertEquals(93_000L, AwakePlan.holdMs(190_000, 100_000))
        assertEquals(0L, AwakePlan.holdMs(100_000, 100_000))
        assertEquals(AwakePlan.MAX_MS, AwakePlan.holdMs(100_000 + 3_600_000, 100_000))
        // the watch checks in after an update, or every few hours, or when its clock went back
        assertTrue(CheckIn.due(0, null, "1.4.5", 1000))
        assertFalse(CheckIn.due(1000, "1.4.5", "1.4.5", 1000 + CheckIn.EVERY_MS - 1))
        assertTrue(CheckIn.due(1000, "1.4.5", "1.4.5", 1000 + CheckIn.EVERY_MS))
        assertTrue(CheckIn.due(1000, "1.4.4", "1.4.5", 2000))
        assertTrue(CheckIn.due(5000, "1.4.5", "1.4.5", 1000))
        val e = CheckIn.event("1.4.5", 1234, "c1")
        assertEquals("watchStatus", e["type"]!!.jsonPrimitive.content)
        assertEquals("1.4.5", e["version"]!!.jsonPrimitive.content)
        // a check-in is not a set: the pill does not count it
        assertEquals(0, OutboxCore.waitingSets(OutboxCore.add(Outbox(), e)!!.first))
        // another app records the workout already: measure only, never end its exercise
        assertTrue(HrPlan.measureOnly(1, otherAppInProgress = 1))
        assertFalse(HrPlan.measureOnly(0, 1)); assertFalse(HrPlan.measureOnly(2, 1)); assertFalse(HrPlan.measureOnly(null, 1))
        // the word before the clock: "Today" on any watch, "Quick check-in" only where the arc is long enough
        assertTrue(TopLine.leadFits("Today", 198)); assertFalse(TopLine.leadFits("Quick check-in", 198))
        assertTrue(TopLine.leadFits("Quick check-in", 227)); assertFalse(TopLine.leadFits("Aujourd’hui", 192))
        // in reach over Bluetooth or Wi-Fi alike; looked after while it matters
        assertTrue(Reach.phone(1)); assertFalse(Reach.phone(0))
        assertTrue(Reach.upkeep(workout = true, waiting = 0)); assertTrue(Reach.upkeep(false, 2)); assertFalse(Reach.upkeep(false, 0))
    }

    @Test fun onlyTheNewestCheckInWaits() {
        var o = OutboxCore.add(Outbox(), setEvent("s1"))!!.first
        o = OutboxCore.add(o, CheckIn.event("1.4.4", 1000, "c1"))!!.first
        o = OutboxCore.add(o, setEvent("s2"))!!.first
        o = OutboxCore.add(o, CheckIn.event("1.4.5", 2000, "c2"))!!.first
        // weeks without the phone: one check-in in the outbox, the sets untouched and in order
        assertEquals(listOf("s1", "s2", "c2"), o.items.map { it.id })
        assertEquals(4L, o.items.last().seq)
    }

    /** The watch hears that the phone stored an event only if its listener is told of the deletion. */
    @Test fun theListenerIsToldOfEveryPathItHandles() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val listener = manifest.substringAfter("android:name=\".WearListener\"").substringBefore("</service>")
        assertTrue(listener.contains("android:path=\"${Paths.SNAPSHOT}\""))
        assertTrue(listener.contains("android:pathPrefix=\"${Paths.STILL_PREFIX}\""))
        assertTrue("the phone's deletions of our events (PhoneLink.delivered)", listener.contains("android:pathPrefix=\"${Paths.EVENT_PREFIX}\""))
        assertTrue(listener.contains("android:path=\"${Paths.OPEN}\""))
    }

    private fun norm(e: JsonElement): Any? = when (e) {
        is JsonObject -> e.mapValues { norm(it.value) }
        is JsonArray -> e.map { norm(it) }
        is JsonPrimitive -> if (e.isString) e.content else e.booleanOrNull ?: e.doubleOrNull
    }
}
