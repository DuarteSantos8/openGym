package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The 1.4.5 watch redesign's rules on Wear OS (WatchLogic.kt): the Apple Watch's PlanTests,
 * OverviewTests, SetNavTests, RestMathTests and the waitingSets / SyncState cases of OutboxTests,
 * case for case, so both watches behave alike.
 */
class WatchLogicTest {
    private fun row(w: Double = 50.0, r: Double = 8.0, done: Boolean = false, warmup: Boolean = false, at: Double? = null, sides: Sides? = null) =
        SetRow(w = w, r = r, done = done, warmup = warmup, at = at, sides = sides)

    private fun entry(id: String, sets: List<SetRow>, group: String? = null, mode: String = "reps") =
        Entry(id, id.replaceFirstChar { it.uppercase() }, mode = mode, sets = sets, group = group)

    private fun workout(vararg e: Entry) = ActiveWorkout(id = "w1", name = "Push", unit = "kg", restSec = 90.0, entries = e.toList())
    private fun state(vararg e: Entry) = SessionState(workout = workout(*e))
    private fun num(ev: Event?, k: String) = ev?.get(k)?.jsonPrimitive?.double

    /* ---------- Plan ---------- */

    @Test fun countsWorkSetsNotWarmupsAndAPerSideSetOnce() {
        val sides = Sides(SideRow(20.0, 8.0), SideRow(20.0, 8.0))
        val (exercises, sets) = Plan.size(listOf(
            entry("bench", listOf(row(warmup = true), row(), row(), row())),
            entry("split", listOf(row(sides = sides), row(sides = sides))),
            entry("empty", emptyList()),
        ))
        assertEquals("an exercise without sets is not one to do", 2, exercises)
        assertEquals(5, sets)
        assertEquals(0 to 0, Plan.size(emptyList()))
    }

    @Test fun readsTheAccentAndRefusesAnythingElse() {
        assertEquals(0xFF30D158L, Hex.argb("#30d158"))
        assertNull(Hex.argb(null))
        assertNull(Hex.argb("green"))
        assertNull(Hex.argb("#30d15"))
        assertNull(Hex.argb("#zzzzzz"))
    }

    @Test fun theSnapshotCarriesTheAccentAndThePause() {
        val snap = Snapshot.parse("""{"v":1,"active":{"id":"w","pausedAt":1234,"entries":[]},"settings":{"accent":"#0a84ff","onAccent":"#ffffff"}}""")!!
        assertEquals("#0a84ff", snap.settings!!.accent)
        assertEquals("#ffffff", snap.settings!!.onAccent)
        assertEquals(1234.0, snap.active!!.pausedAt!!, 0.0)
    }

    /* ---------- Overview ---------- */

    @Test fun overviewCountsWorkSetsAndMarksTheCurrentAndFinished() {
        val w = workout(
            entry("bench", listOf(row(done = true, warmup = true), row(done = true), row(done = true))),
            entry("press", listOf(row(done = true), row(), row())),
            entry("warm", listOf(row(warmup = true))),
        )
        val rows = Overview.rows(w, 1)
        assertEquals(listOf(2, 1, 0), rows.map { it.done })
        assertEquals("an exercise of warm-ups only counts them", listOf(2, 3, 1), rows.map { it.total })
        assertEquals(listOf(false, true, false), rows.map { it.current })
        assertEquals(listOf(true, false, false), rows.map { it.finished })
    }

    @Test fun aSupersetIsTwoOrMoreNeighboursAndNamesItsPartners() {
        val entries = listOf(
            entry("curl", listOf(row()), "a"), entry("pushdown", listOf(row()), "a"), entry("raise", listOf(row()), "a"),
            entry("alone", listOf(row()), "b"),
            entry("squat", listOf(row())),
        )
        val rows = Overview.rows(workout(*entries.toTypedArray()), 0)
        assertEquals(listOf(true, false, false, false, false), rows.map { it.supersetStart })
        assertEquals("a group of one is no superset", listOf(true, true, true, false, false), rows.map { it.inSuperset })
        assertEquals(listOf("Curl", "Raise"), Overview.partners(entries, 1))
        assertEquals(emptyList<String>(), Overview.partners(entries, 3))
        assertEquals(emptyList<String>(), Overview.partners(entries, 4))
    }

    @Test fun atTheEndPastTheLastExercise() {
        assertFalse("no workout, no end", Overview.atEnd(SessionState()))
        val s = state(entry("bench", listOf(row(done = true))))
        assertFalse(Overview.atEnd(s.copy(entryIndex = 0)))
        assertTrue(Overview.atEnd(s.copy(entryIndex = 1)))
    }

    /* ---------- SetNav, SetFix, Keypad ---------- */

    @Test fun placeCountsWorkSetsAndWarmupsApart() {
        val e = entry("b", listOf(row(40.0, 10.0, warmup = true), row(60.0, 8.0), row(62.5, 8.0), row(62.5, 8.0)))
        assertEquals(1 to 1, SetNav.place(e, 0))
        assertEquals(2 to 3, SetNav.place(e, 2))
        assertEquals(0 to 0, SetNav.place(e, 9))
        assertNull(SetNav.step(e, 0, -1))
        assertEquals(1, SetNav.step(e, 0, 1))
        assertNull(SetNav.step(e, 3, 1))
    }

    @Test fun aFixIsTheSameSetDoneAgainLaterWithoutHeartRate() {
        val e = entry("b", listOf(row(60.0, 8.0, done = true, at = 5000.0), row(60.0, 8.0)))
        val (s, ev) = SetFix.correct(state(e), 0, 0, null, SetFix.Numbers(62.5, 7.0), now = 1000.0, id = "fix1")
        assertNotNull(ev)
        assertEquals("setDone", ev!!["type"]!!.jsonPrimitive.content)
        assertEquals(62.5, num(ev, "w")!!, 0.0)
        assertEquals(7.0, num(ev, "r")!!, 0.0)
        assertEquals("later than the set's own tick, also with a clock behind", 5001.0, num(ev, "at")!!, 0.0)
        assertNull("the phone keeps the set's heart rate", ev["hr"])
        assertNull(ev["sec"])
        // only the keys a setDone already has: the phone needs nothing new for a fix
        val known = setOf("id", "type", "wid", "exId", "entryIdx", "setIdx", "at", "w", "r", "sec", "side", "hr", "rpe", "rir")
        assertTrue(known.containsAll(ev.keys))
        assertEquals(62.5, s.workout!!.entries[0].sets[0].w!!, 0.0)
        assertTrue(s.workout!!.entries[0].sets[0].done)
        assertEquals("kept until the phone has it", "fix1", s.pending[SessionCore.key("b", 0)]?.id)
    }

    @Test fun onlyALoggedSetCanBeFixedAndNeverCardio() {
        assertNull(SetFix.correct(state(entry("b", listOf(row(60.0, 8.0)))), 0, 0, null, SetFix.Numbers(1.0, 1.0), now = 1.0, id = "x").second)
        val bike = entry("bike", listOf(row(0.0, 0.0, done = true, at = 1.0)), mode = "cardio")
        assertNull(SetFix.correct(state(bike), 0, 0, null, SetFix.Numbers(1.0, 1.0), now = 9.0, id = "x").second)
        assertNull("a row that is gone", SetFix.correct(state(bike), 0, 5, null, SetFix.Numbers(1.0, 1.0), now = 9.0, id = "x").second)
    }

    @Test fun aHoldKeepsItsSecondsAndGetsNoWeightItNeverHad() {
        val plank = Entry("p", "Plank", mode = "time", sets = listOf(SetRow(sec = 45.0, done = true, at = 10.0)))
        val ev = SetFix.correct(state(plank), 0, 0, null, SetFix.Numbers(0.0, 0.0, 60.0), now = 100.0, id = "h").second!!
        assertEquals(60.0, num(ev, "sec")!!, 0.0)
        assertNull(ev["w"])
        assertNull(ev["r"])
    }

    @Test fun oneSideOfAPerSideSet() {
        val r0 = row(20.0, 16.0, at = 10.0, sides = Sides(SideRow(20.0, 8.0, true), SideRow(20.0, 8.0, false)))
        val e = entry("s", listOf(r0))
        val (s, ev) = SetFix.correct(state(e), 0, 0, "L", SetFix.Numbers(22.5, 7.0), now = 50.0, id = "l")
        assertEquals("L", ev!!["side"]!!.jsonPrimitive.content)
        assertEquals(22.5, s.workout!!.entries[0].sets[0].sides!!.L.w!!, 0.0)
        assertEquals("the row's reps follow its sides", 15.0, s.workout!!.entries[0].sets[0].r!!, 0.0)
        assertNull("the right side is not logged yet", SetFix.correct(state(e), 0, 0, "R", SetFix.Numbers(1.0, 1.0), now = 50.0, id = "r").second)
    }

    @Test fun anEffortGoesOutAsTheProfilesScale() {
        val e = entry("b", listOf(row(60.0, 8.0, done = true, at = 10.0)))
        val rir = SetFix.correct(state(e), 0, 0, null, SetFix.Numbers(60.0, 8.0), EffortRating("rir", 2.0), now = 20.0, id = "e").second!!
        assertEquals(2.0, num(rir, "rir")!!, 0.0)
        assertNull("never both", rir["rpe"])
        val rpe = SetFix.correct(state(e), 0, 0, null, SetFix.Numbers(60.0, 8.0), EffortRating("rpe", 8.5), now = 20.0, id = "e").second!!
        assertEquals(8.5, num(rpe, "rpe")!!, 0.0)
        val odd = SetFix.correct(state(e), 0, 0, null, SetFix.Numbers(60.0, 8.0), EffortRating("feel", 3.0), now = 20.0, id = "e").second!!
        assertNull("a scale the phone does not know sends nothing", odd["feel"])
    }

    @Test fun keypadTypesNumbersAndKeepsThemSane() {
        var k = Keypad(2)
        for (key in listOf("0", "6", "2", ".", "2", "5", "9")) k = k.press(key)
        assertEquals("no leading zero, two decimals at most", "62.25", k.text)
        assertEquals(62.25, k.value!!, 0.0)
        assertEquals("one point", "62.25", k.press(".").text)
        k = k.back().back().back()
        assertEquals("62", k.text)
        k = k.press(".")
        assertEquals("a trailing point is the whole number", 62.0, k.value!!, 0.0)
        assertTrue(k.fits(0.0..700.0))
        assertFalse(k.fits(0.0..50.0))
        var reps = Keypad(0).press(".")
        assertEquals("no point for reps", "", reps.text)
        for (key in listOf("1", "2", "3", "4", "5")) reps = reps.press(key)
        assertEquals("four digits at most", "1234", reps.text)
        assertEquals("1234", reps.press("x").text)
        assertNull(Keypad(1).value)
        assertFalse("nothing typed is nothing to save", Keypad(1).fits(0.0..10.0))
        assertEquals("0.5", Keypad(1).press(".").press("5").text)
    }

    /* ---------- the rest ---------- */

    private val now = 1_000_000L

    @Test fun minusFifteenOrASkipNearTheEnd() {
        assertEquals(now + 45_000, RestMath.minus(now + 60_000, now))
        assertNull("15 s left: that is a skip", RestMath.minus(now + 15_000, now))
        assertNull(RestMath.minus(now + 10_000, now))
        assertNotNull(RestMath.minus(now + 16_000, now))
    }

    @Test fun followsOnlyARestEndThePhoneHasNotSentBefore() {
        assertTrue(RestMath.follows(5000.0, null))
        assertFalse("the same end again leaves a ±15 or a Skip alone", RestMath.follows(5000.0, 5000.0))
        assertTrue("a new rest on the phone is followed", RestMath.follows(9000.0, 5000.0))
    }

    @Test fun whatIsLeftOfTheRest() {
        val start = now; val end = now + 100_000
        assertEquals(1f, RestMath.left(start, end, now), 0f)
        assertEquals(0.75f, RestMath.left(start, end, now + 25_000), 0.0001f)
        assertEquals(0f, RestMath.left(start, end, now + 200_000), 0f)
        assertEquals("a backwards rest is over", 0f, RestMath.left(end, start, now), 0f)
    }

    @Test fun chipsAreRatingsThePhoneLogs() {
        assertEquals(listOf(0.0, 1.0, 2.0, 3.0), Effort.chips("rir"))
        assertEquals(listOf(10.0, 9.0, 8.0, 7.0), Effort.chips("rpe"))
        for (kind in listOf("rir", "rpe")) for (v in Effort.chips(kind)) assertTrue("$kind $v", Effort.notches(kind)!!.contains(v))
        assertEquals("3+", Effort.chipLabel("rir", 3.0))
        assertEquals("1", Effort.chipLabel("rir", 1.0))
        assertEquals("≤7", Effort.chipLabel("rpe", 7.0))
        assertEquals("9", Effort.chipLabel("rpe", 9.0))
        assertEquals("8.5", Effort.chipLabel("rpe", 8.5))
        // the phone's colour bands: failure, then easier
        assertEquals(0, Effort.band("rir", 0.0))
        assertEquals(0, Effort.band("rpe", 10.0))
        assertEquals(5, Effort.band("rir", 5.0))
    }

    /* ---------- the sync status ---------- */

    @Test fun countsOnlySetsThePhoneHasNotStored() {
        fun ev(id: String, type: String) = buildJsonObject { put("id", id); put("type", type) }
        var o = Outbox()
        for ((id, type) in listOf("a" to "setDone", "b" to "watchStatus", "c" to "setDone", "d" to "setHr")) o = OutboxCore.add(o, ev(id, type))!!.first
        assertEquals("the watch's status and a heart rate are not sets", 2, OutboxCore.waitingSets(o))
        assertEquals(4, OutboxCore.waiting(o))
        o = OutboxCore.delivered(o, listOf("a"))
        assertEquals("on the phone now", 1, OutboxCore.waitingSets(o))
        o = OutboxCore.ack(o, listOf("c"))
        assertEquals(0, OutboxCore.waitingSets(o))
        assertNull(OutboxCore.eventType(OutItem("x", 1, "not json")))
    }

    @Test fun syncStateSaysWhatTheLifterNeedsToKnow() {
        assertEquals("nothing waits: all there, phone or not", SyncState.Synced, SyncState.of(0, false))
        assertEquals(SyncState.Waiting(3), SyncState.of(3, true))
        assertEquals(SyncState.Away(3), SyncState.of(3, false))
        assertEquals(3, SyncState.Away(3).count)
        assertEquals(0, SyncState.Synced.count)
    }

    /* ---------- the 3-2-1, the touch lock, the weigh-in, "All done?" ---------- */

    @Test fun countdownGoesThreeTwoOneGo() {
        assertEquals(3, Countdown.number(0))
        assertEquals(3, Countdown.number(999))
        assertEquals(2, Countdown.number(1000))
        assertEquals(1, Countdown.number(2500))
        assertEquals(0, Countdown.number(3000))
        assertEquals(3, Countdown.number(-500))
    }

    @Test fun theTouchLockHoldsASecond() {
        val lock = TouchLock()
        assertTrue(lock.allows(now))
        lock.lock(now)
        assertFalse("the thumb that hit Done is still there", lock.allows(now + 999))
        assertTrue(lock.allows(now + 1000))
        lock.lock(now); lock.unlock()
        assertTrue("picked by hand: at once", lock.allows(now))
    }

    @Test fun weighInPartsAndItsEvent() {
        assertEquals(79 to 4, WeighIn.parts(79.4))
        assertEquals("never (79, 10)", 80 to 0, WeighIn.parts(79.95))
        assertEquals(79.4, WeighIn.join(79, 4), 1e-9)
        assertEquals(79.9, WeighIn.join(79, 12), 1e-9)
        val ev = WeighIn.event(78.44, 1000.0, "wi")!!
        assertEquals("weighIn", ev["type"]!!.jsonPrimitive.content)
        assertEquals(78.4, num(ev, "w")!!, 1e-9)
        assertNull(WeighIn.event(0.0, 1.0, "x"))
        assertNull(WeighIn.event(800.0, 1.0, "x"))
    }

    @Test fun aStartCarriesTheBodyWeightJustWeighedIn() {
        val session = ReadySession(listOf("r"), "Legs", listOf(entry("sq", listOf(row()))))
        val (_, ev) = SessionCore.start(SessionState(), session, "watch-1", 10.0, "st", bw = 78.44)
        assertEquals(78.4, num(ev, "bw")!!, 1e-9)
        val (_, plain) = SessionCore.start(SessionState(), session, "watch-1", 10.0, "st")
        assertNull("no weigh-in, no bw: the shape the phone had", plain["bw"])
    }

    @Test fun allDoneAsksAfterTwentyMinutesWithoutASet() {
        val w = workout(entry("b", listOf(row(done = true, at = 1_000.0), row(done = true, at = 5_000.0), row())))
        assertEquals(5_000.0, Idle.lastSet(w)!!, 0.0)
        assertEquals("the phone used it later", 9_000.0, Idle.lastSet(w.copy(activeAt = 9_000.0))!!, 0.0)
        assertEquals("nothing done: its start", 7.0, Idle.lastSet(workout(entry("b", listOf(row()))).copy(start = 7.0))!!, 0.0)
        val since = Idle.since(5_000.0, seen = 2_000.0, snooze = null)
        assertFalse(Idle.asks(since, since + 19 * 60_000))
        assertTrue(Idle.asks(since, since + 20 * 60_000))
        assertEquals(23, Idle.minutes(since, since + 23 * 60_000 + 5_000))
        assertEquals("keep going counts from then", 99_000.0, Idle.since(5_000.0, null, 99_000.0), 0.0)
    }

    @Test fun theCrownMovesOnTheFieldsGrid() {
        assertEquals(62.5, nudge(60.0, 1, 2.5, 0.0, 700.0), 0.0)
        assertEquals("an off-grid weight lands on the grid first", 62.5, nudge(61.0, 1, 2.5, 0.0, 700.0), 0.0)
        assertEquals(60.0, nudge(61.0, -1, 2.5, 0.0, 700.0), 0.0)
        assertEquals("never below the range", 0.0, nudge(1.0, -3, 2.5, 0.0, 700.0), 0.0)
        assertEquals("seconds start at 1", 1.0, nudge(5.0, -1, 5.0, 1.0, 3600.0), 0.0)
        assertEquals("62.25", formatNumber(62.25))
        assertEquals("62.5", formatNumber(62.5))
        assertEquals("60", formatNumber(60.0))
    }
}
