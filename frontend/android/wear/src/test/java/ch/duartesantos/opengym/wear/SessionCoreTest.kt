package ch.duartesantos.opengym.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Apple Watch's WatchCore cases (SessionCoreTests.swift), on this port. */
class SessionCoreTest {
    private fun set(w: Double, r: Double, done: Boolean = false, at: Double? = null, warmup: Boolean = false) =
        SetRow(w = w, r = r, done = done, at = at, warmup = warmup)

    private fun workout(id: String = "w1", vararg entries: Entry) =
        ActiveWorkout(id = id, name = "Legs", unit = "kg", entries = entries.toList())

    private val squat = Entry("sq", "Squat", sets = listOf(set(100.0, 5.0), set(100.0, 5.0)), best = BestSet(100.0, 5.0))
    private val lunge = Entry("lu", "Lunge", sets = listOf(SetRow(w = 20.0, r = 8.0, sides = Sides())), perSide = true)

    private fun started(vararg e: Entry) = SessionCore.applySnapshot(SessionState(), Snapshot(active = workout("w1", *e)))

    @Test fun aTickStaysUntilThePhoneShowsIt() {
        var s = started(squat)
        s = SessionCore.tick(s, 0, 0, null, 105.0, 5.0, null, 1000.0, "e1").first
        // a stale snapshot without the tick: the watch's tick wins
        s = SessionCore.applySnapshot(s, Snapshot(active = workout("w1", squat)))
        assertTrue(s.workout!!.entries[0].sets[0].done)
        assertEquals(105.0, s.workout!!.entries[0].sets[0].w!!, 0.0)
        // the phone has it now (same tick time): pending cleared
        val phone = squat.copy(sets = listOf(set(105.0, 5.0, done = true, at = 1000.0), set(100.0, 5.0)))
        s = SessionCore.applySnapshot(s, Snapshot(active = workout("w1", phone)))
        assertTrue(s.pending.isEmpty())
    }

    @Test fun finishedHereStaysFinished() {
        var s = started(squat)
        s = SessionCore.finish(s, 2000.0, "f").first
        assertNull(s.workout)
        s = SessionCore.applySnapshot(s, Snapshot(active = workout("w1", squat)))
        assertNull(s.workout)
    }

    @Test fun startedHereStaysUntilThePhoneHasIt() {
        var s = SessionCore.applySnapshot(SessionState(), Snapshot(ready = Ready(ReadySession(listOf("r"), "Legs", listOf(squat)))))
        val (s1, ev) = SessionCore.start(s, s.ready!!.today!!, "watch-1", 10.0, "st")
        assertEquals("start", (ev["type"] as kotlinx.serialization.json.JsonPrimitive).content)
        // the phone has not heard yet: no workout there, the watch keeps its own
        s = SessionCore.applySnapshot(s1, Snapshot(active = null))
        assertEquals("watch-1", s.workout!!.id)
        // the phone reports it back
        s = SessionCore.applySnapshot(s, Snapshot(active = workout("watch-1", squat)))
        assertNull(s.startedHere)
        // discarded on the phone: let go of
        val s2 = SessionCore.applySnapshot(s1, Snapshot(active = null, discarded = listOf("watch-1")))
        assertNull(s2.workout)
    }

    @Test fun endedOnThePhone() {
        val s = SessionCore.applySnapshot(started(squat), Snapshot(active = null))
        assertNull(s.workout)
    }

    @Test fun perSideSetsTickOneSideAtATime() {
        var s = started(lunge)
        val (s1, ev) = SessionCore.tick(s, 0, 0, "L", 20.0, 8.0, null, 5.0, "l")
        assertEquals("L", (ev!!["side"] as kotlinx.serialization.json.JsonPrimitive).content)
        assertFalse(s1.workout!!.entries[0].sets[0].done)
        assertEquals("R", s1.workout!!.entries[0].sets[0].sideUp)
        // the other side next, no rest in between
        assertEquals(0 to false, SessionCore.next(s1, 0, 0))
        s = SessionCore.tick(s1, 0, 0, "R", 20.0, 7.0, null, 6.0, "r").first
        val row = s.workout!!.entries[0].sets[0]
        assertTrue(row.done)
        assertEquals(15.0, row.r!!, 0.0)
    }

    @Test fun nextGoesThroughSetsThenExercisesThenFinish() {
        var s = started(squat, lunge.copy(perSide = null, sets = listOf(set(20.0, 8.0))))
        assertEquals(0 to true, SessionCore.next(s, 0, 0))
        s = SessionCore.tick(s, 0, 0, null, 100.0, 5.0, null, 1.0, "a").first
        s = SessionCore.tick(s, 0, 1, null, 100.0, 5.0, null, 2.0, "b").first
        assertEquals(1 to true, SessionCore.next(s, 0, 1))
        s = SessionCore.tick(s, 1, 0, null, 20.0, 8.0, null, 3.0, "c").first
        assertEquals(2 to true, SessionCore.next(s, 1, 0))   // the Finish page
    }

    @Test fun supersetsTakeTurns() {
        val a = squat.copy(group = "g"); val b = Entry("pu", "Pull-up", sets = listOf(set(0.0, 8.0), set(0.0, 8.0)), group = "g")
        var s = started(a, b)
        s = SessionCore.tick(s, 0, 0, null, 100.0, 5.0, null, 1.0, "a").first
        assertEquals(1 to false, SessionCore.next(s, 0, 0))   // the partner, no rest
        s = SessionCore.tick(s, 1, 0, null, 0.0, 8.0, null, 2.0, "b").first
        assertEquals(0 to true, SessionCore.next(s, 1, 0))    // round over: rest, then the first again
    }

    @Test fun skippedSetsAreJumped() {
        var s = started(squat)
        s = SessionCore.skip(s, 0, 0)
        assertEquals(1, SessionCore.setIndex(s, 0))
    }

    @Test fun summaryCountsWorkSetsVolumeAndRecords() {
        var s = started(squat.copy(sets = listOf(set(60.0, 10.0, warmup = true), set(100.0, 5.0), set(100.0, 5.0))))
        s = SessionCore.tick(s, 0, 1, null, 102.5, 5.0, null, 1.0, "a").first
        val sum = SessionCore.summary(s.workout!!.copy(start = 0.0), 60_000.0)
        assertEquals(1, sum.sets)
        assertEquals(512.5, sum.volume, 0.001)
        assertEquals(listOf("Squat"), sum.prs)
        assertEquals(60.0, sum.duration!!, 0.0)
        assertEquals(1 to 2, SessionCore.progress(s))
    }

    @Test fun weightStepsStayOnTheGrid() {
        assertEquals(62.5, SessionCore.stepWeight(60.0, 2.5, 1), 0.0)
        assertEquals(62.5, SessionCore.stepWeight(61.0, 2.5, 1), 0.0)
        assertEquals(60.0, SessionCore.stepWeight(61.0, 2.5, -1), 0.0)
        assertEquals(0.0, SessionCore.stepWeight(1.0, 2.5, -3), 0.0)
        assertEquals(0.0, SessionCore.stepReps(0.0, -1), 0.0)
    }

    @Test fun mixedUnitsCountInTheWorkoutsUnit() {
        val lb = Entry("x", "Curl", sets = listOf(set(100.0, 1.0, done = true)), unit = "lb")
        val sum = SessionCore.summary(workout("w", lb), 0.0)
        assertEquals(45.359237, sum.volume, 1e-6)
    }

    @Test fun savedStateRoundTrips() {
        val s = SessionCore.tick(started(squat), 0, 0, null, 100.0, 5.0, null, 1.0, "a").first
        val json = WireJson.encodeToString(SessionState.serializer(), s)
        assertEquals(s, WireJson.decodeFromString(SessionState.serializer(), json))
    }
}
