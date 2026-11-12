package ch.duartesantos.opengym.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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

    /* ---------- SessionCoreTests.swift (without phoneTicks / discarded()) ---------- */

    private fun row(w: Double, r: Double, done: Boolean = false, at: Double? = null) = set(w, r, done = done, at = at)

    private fun pw(id: String, sets: List<SetRow>, cur: Int = 0) =
        ActiveWorkout(id = id, name = "Push", unit = "kg", cur = cur, restSec = 90.0, entries = listOf(
            Entry("0025", "Bench Press", sets = sets), Entry("0426", "Overhead Press", sets = listOf(row(40.0, 8.0)))))

    private fun snap(w: ActiveWorkout?) = Snapshot(v = 1, unit = "kg", restSec = 90.0, active = w)
    private fun str(ev: Event?, k: String) = (ev?.get(k) as? kotlinx.serialization.json.JsonPrimitive)?.content

    // Discord: sets logged on the phone only, the watch stayed on the first exercise (Apple Watch #1066).
    @Test fun testFollowsThePhoneToTheNextExerciseOfTheSameWorkout() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0), row(60.0, 8.0)))))
        assertEquals(0, s.entryIndex)
        s = SessionCore.applySnapshot(s, snap(pw("p1", listOf(row(60.0, 8.0, done = true, at = 1.0), row(60.0, 8.0, done = true, at = 2.0)), cur = 1)))
        assertEquals(1, s.entryIndex)
    }

    @Test fun testAPageOpenedOnTheWatchStaysWhileThePhoneStaysPut() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0), row(60.0, 8.0)))))
        s = s.copy(entryIndex = 1) // swiped on the wrist; the phone still says 0
        s = SessionCore.applySnapshot(s, snap(pw("p1", listOf(row(60.0, 8.0, done = true, at = 1.0), row(60.0, 8.0)))))
        assertEquals(1, s.entryIndex)
    }

    @Test fun testPicksUpAWorkoutRunningOnThePhoneWhenFirstOpened() {
        val s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0, done = true, at = 1.0), row(60.0, 8.0)), cur = 1)))
        assertEquals("p1", s.workout?.id)
        assertEquals(1, s.entryIndex)
        assertEquals(1, SessionCore.setIndex(s, 0))
    }

    @Test fun testATickStaysUntilTheSnapshotShowsItAndTheLaterTickWins() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0), row(60.0, 8.0)))))
        val (t, event) = SessionCore.tick(s, 0, 0, null, 62.5, 7.0, null, 1000.0, "e1")
        s = t
        assertEquals("setDone", str(event, "type"))
        assertEquals("p1", str(event, "wid"))
        // an older snapshot, sent before the phone applied the tick: the tick stays
        s = SessionCore.applySnapshot(s, snap(pw("p1", listOf(row(60.0, 8.0), row(60.0, 8.0)))))
        assertEquals(row(62.5, 7.0, done = true, at = 1000.0), s.workout?.entries?.get(0)?.sets?.get(0))
        assertNotNull(s.pending["0025#0"])
        // the phone changed that set itself earlier: the watch's later tick still wins
        s = SessionCore.applySnapshot(s, snap(pw("p1", listOf(row(55.0, 5.0, done = true, at = 500.0), row(60.0, 8.0)))))
        assertEquals(62.5, s.workout!!.entries[0].sets[0].w!!, 0.0)
        // the phone has applied it: confirmed, no longer pending
        s = SessionCore.applySnapshot(s, snap(pw("p1", listOf(row(62.5, 7.0, done = true, at = 1000.0), row(60.0, 8.0)))))
        assertNull(s.pending["0025#0"])
        // a later change on the phone wins over the watch's tick
        s = SessionCore.tick(s, 0, 1, null, 60.0, 8.0, null, 2000.0, "e2").first
        s = SessionCore.applySnapshot(s, snap(pw("p1", listOf(row(62.5, 7.0, done = true, at = 1000.0), row(65.0, 6.0, done = true, at = 3000.0)))))
        assertEquals(65.0, s.workout!!.entries[0].sets[1].w!!, 0.0)
        assertNull(s.pending["0025#1"])
    }

    @Test fun testRelaunchRestoresTheSessionWithItsUnconfirmedTicks() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0), row(60.0, 8.0)))))
        s = SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, 1000.0, "e1").first
        var back = WireJson.decodeFromString(SessionState.serializer(), WireJson.encodeToString(SessionState.serializer(), s))
        assertEquals(s, back)
        // the latest context is the old snapshot: the tick survives
        back = SessionCore.applySnapshot(back, snap(pw("p1", listOf(row(60.0, 8.0), row(60.0, 8.0)))))
        assertTrue(back.workout!!.entries[0].sets[0].done)
    }

    @Test fun testFinishedOnTheWatchStaysFinishedThoughThePhoneHasNotHeard() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0)))))
        val (f, event) = SessionCore.finish(s, 5000.0, "f1")
        s = f
        assertEquals("finish", str(event, "type"))
        assertNull(s.workout)
        s = SessionCore.applySnapshot(s, snap(pw("p1", listOf(row(60.0, 8.0)))))
        assertNull("a snapshot from before the phone applied the finish does not bring it back", s.workout)
        s = SessionCore.applySnapshot(s, snap(pw("p2", listOf(row(60.0, 8.0)))))
        assertEquals("the next workout does show", "p2", s.workout?.id)
    }

    @Test fun testDiscardedOnTheWatchTellsThePhoneAndStaysGone() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0)))))
        val (d, event) = SessionCore.finish(s, 5000.0, "d1", discard = true)
        s = d
        assertEquals("discard", str(event, "type"))
        assertEquals("p1", str(event, "wid"))
        s = SessionCore.applySnapshot(s, snap(pw("p1", listOf(row(60.0, 8.0)))))
        assertNull("a snapshot from before the phone dropped it does not bring it back", s.workout)
    }

    @Test fun testFinishedOnThePhoneEndsItHere() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0)))))
        s = SessionCore.applySnapshot(s, snap(null))
        assertNull(s.workout)
        assertTrue(s.pending.isEmpty())
    }

    @Test fun testStartedOnTheWatchStaysUntilThePhoneHasIt() {
        val ready = ReadySession(listOf("r1"), "Push", pw("x", listOf(row(60.0, 8.0))).entries)
        var (s, event) = SessionCore.start(SessionState(), ready, "watch-1", 100.0, "s1")
        assertEquals("start", str(event, "type"))
        assertEquals("watch-1", str(event, "wid"))
        s = SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, 200.0, "e1").first
        s = SessionCore.applySnapshot(s, snap(null))
        assertEquals("the phone has not heard of it yet", "watch-1", s.workout?.id)
        s = SessionCore.applySnapshot(s, snap(pw("phone-other", listOf(row(1.0, 1.0)))))
        assertEquals("another workout on the phone does not replace it", "watch-1", s.workout?.id)
        s = SessionCore.applySnapshot(s, snap(pw("watch-1", listOf(row(60.0, 8.0), row(40.0, 8.0)))))
        assertNull("the phone runs it now", s.startedHere)
        assertTrue("with the tick made before it heard", s.workout!!.entries[0].sets[0].done)
    }

    @Test fun testTheWorkoutTypeComesWithTheSessionAndAnOlderPhoneSendsNone() {
        val ready = ReadySession(listOf("r1"), "Run", emptyList(), healthType = "running")
        assertEquals("running", SessionCore.start(SessionState(), ready, "watch-1", 100.0, "s1").first.workout?.healthType)
        val old = Snapshot.parse("""{"v":1,"active":{"id":"p1","name":"Push","unit":"kg","cur":0,"restSec":90,"entries":[]}}""")!!
        assertNull(old.active?.healthType)
        val run = Snapshot.parse("""{"v":1,"active":{"id":"p1","name":"Run","unit":"kg","cur":0,"restSec":90,"entries":[],"healthType":"running"}}""")!!
        assertEquals("running", SessionCore.applySnapshot(SessionState(), run).workout?.healthType)
    }

    @Test fun testAnotherWorkoutOnThePhoneStartsClean() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0)))))
        s = SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, 1.0, "e1").first
        s = SessionCore.applySnapshot(s, snap(pw("p2", listOf(row(70.0, 5.0)), cur = 1)))
        assertEquals("p2", s.workout?.id)
        assertFalse("an old tick never lands on another workout", s.workout!!.entries[0].sets[0].done)
        assertEquals(1, s.entryIndex)
    }

    @Test fun testProgressCountsWorkSetsOnly() {
        val w0 = pw("p1", listOf(row(60.0, 8.0, done = true, at = 1.0), row(60.0, 8.0)))
        val e0 = w0.entries[0]
        val w = w0.copy(entries = listOf(e0.copy(sets = listOf(set(20.0, 10.0, done = true, at = 1.0, warmup = true)) + e0.sets)) + w0.entries.drop(1))
        val s = SessionCore.applySnapshot(SessionState(), snap(w))
        assertEquals(1, SessionCore.progress(s).first)
        assertEquals(3, SessionCore.progress(s).second)
    }

    @Test fun testReadsASnapshotWithFieldsItDoesNotKnowAndWithoutOptionalOnes() {
        val json = """{"v":1,"future":true,"active":{"id":"p1","name":"Push","unit":"kg","cur":0,"restSec":90,"entries":[{"id":"0025","name":"Bench","mode":"reps","sets":[{"w":60,"r":8,"done":false,"warmup":false,"hr":{"avg":1}}]}]}}"""
        assertEquals(1, SessionCore.applySnapshot(SessionState(), Snapshot.parse(json)!!).workout?.entries?.first()?.sets?.size)
    }

    // TestFlight 1.4.4: started here, discarded on the phone before any snapshot said the phone had it.
    // (The Swift test's SessionCore.discarded(_:in:) asserts are left out: no such function here.)
    @Test fun testStartedHereAndDiscardedOnThePhoneBeforeItConfirmedEndsItHere() {
        val ready = ReadySession(listOf("r1"), "Push", pw("x", listOf(row(60.0, 8.0))).entries)
        var s = SessionCore.start(SessionState(), ready, "watch-1", 100.0, "s1").first
        val gone = snap(null).copy(discarded = listOf("watch-1"))
        s = SessionCore.applySnapshot(s, gone)
        assertNull(s.workout)
        assertNull(s.startedHere)
        // Another workout running there, ours discarded: ours goes, theirs is picked up.
        s = SessionCore.start(SessionState(), ready, "watch-2", 100.0, "s2").first
        s = SessionCore.applySnapshot(s, snap(pw("phone-1", listOf(row(1.0, 1.0)))).copy(discarded = listOf("watch-2")))
        assertEquals("phone-1", s.workout?.id)
        // Not named: still kept, as before.
        s = SessionCore.start(SessionState(), ready, "watch-3", 100.0, "s3").first
        assertEquals("watch-3", SessionCore.applySnapshot(s, gone).workout?.id)
    }

    /* ---------- SetTypesTests.swift ---------- */

    private fun srow(w: Double?, r: Double?, sec: Double? = null, done: Boolean = false, warmup: Boolean = false, at: Double? = null) =
        SetRow(w = w, r = r, sec = sec, done = done, warmup = warmup, at = at)

    private fun sideRow(w: Double, r: Double) =
        srow(w, r * 2).copy(sides = Sides(SideRow(w, r, false), SideRow(w, r, false)))

    private fun ent(id: String, name: String, sets: List<SetRow>, mode: String = "reps", group: String? = null) =
        Entry(id, name, mode = mode, sets = sets, group = group)

    private fun mixed(entries: List<Entry>, start: Double? = 0.0) = SessionCore.applySnapshot(SessionState(), snap(
        ActiveWorkout(id = "w1", name = "Mixed", unit = "kg", restSec = 90.0, entries = entries, start = start)))

    private fun num(ev: Event?, k: String) = (ev?.get(k) as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull()

    @Test fun testAHoldIsTickedWithItsSeconds() {
        val s0 = mixed(listOf(ent("plank", "Plank", listOf(srow(null, null, sec = 45.0), srow(null, null, sec = 45.0)), mode = "time")))
        assertTrue(s0.workout!!.entries[0].isTimed)
        val (s, ev) = SessionCore.tick(s0, 0, 0, null, null, null, 38.0, 10.0, "h1")
        assertEquals(38.0, s.workout!!.entries[0].sets[0].sec!!, 0.0)
        assertEquals(38.0, num(ev, "sec")!!, 0.0)
        assertNull(ev!!["w"])
        assertNull(ev["r"])
        // an old snapshot keeps the watch's seconds until the phone has them
        val back = SessionCore.applySnapshot(s, snap(s0.workout))
        assertEquals(38.0, back.workout!!.entries[0].sets[0].sec!!, 0.0)
        assertEquals(1, SessionCore.setIndex(back, 0))
    }

    @Test fun testBodyweightCountsOnlyTheAddedWeight() {
        var s = mixed(listOf(ent("pullup", "Pull-up", listOf(srow(0.0, 10.0), srow(5.0, 8.0))).copy(bodyweight = true)))
        assertTrue(s.workout!!.entries[0].isBodyweight)
        s = SessionCore.tick(s, 0, 0, null, 0.0, 10.0, null, 1.0, "a").first
        s = SessionCore.tick(s, 0, 1, null, 5.0, 8.0, null, 2.0, "b").first
        val sum = SessionCore.summary(s.workout!!, 60_000.0)
        assertEquals(2, sum.sets)
        assertEquals(40.0, sum.volume, 0.0)
    }

    @Test fun testAPerSideSetIsDoneOneSideAtATime() {
        val e = ent("split", "Split squat", listOf(sideRow(20.0, 8.0), sideRow(20.0, 8.0))).copy(perSide = true)
        var s = mixed(listOf(e, ent("calf", "Calf raise", listOf(srow(40.0, 12.0)))))
        assertEquals("L", s.workout!!.entries[0].sets[0].sideUp)
        val (s1, ev) = SessionCore.tick(s, 0, 0, "L", 20.0, 8.0, null, 5.0, "l")
        assertEquals("L", str(ev, "side"))
        assertFalse("one side is not the set", s1.workout!!.entries[0].sets[0].done)
        assertEquals("R", s1.workout!!.entries[0].sets[0].sideUp)
        // the other side next, on the same exercise, without a rest between
        val n = SessionCore.next(s1, 0, 0)
        assertEquals(0, n.first)
        assertFalse(n.second)
        s = SessionCore.tick(s1, 0, 0, "R", 20.0, 7.0, null, 6.0, "r").first
        val row0 = s.workout!!.entries[0].sets[0]
        assertTrue(row0.done)
        assertEquals(15.0, row0.r!!, 0.0)
        assertEquals(1, SessionCore.setIndex(s, 0))
        // an old snapshot keeps both sides the watch did
        val back = SessionCore.applySnapshot(s, snap(mixed(listOf(e)).workout))
        assertEquals(7.0, back.workout!!.entries[0].sets[0].sides!!.R.r!!, 0.0)
        assertTrue(back.workout!!.entries[0].sets[0].done)
        // and the phone having them confirms them
        val p = mixed(listOf(e)).workout!!
        val phone = p.copy(entries = listOf(p.entries[0].copy(sets = listOf(row0) + p.entries[0].sets.drop(1))))
        val confirmed = SessionCore.applySnapshot(back, snap(phone))
        assertNull(confirmed.pending["split#0#L"])
        assertNull(confirmed.pending["split#0#R"])
        assertEquals(300.0, SessionCore.summary(s.workout!!, 1.0).volume, 0.0)   // 20x8 + 20x7
    }

    @Test fun testWarmUpsAreNotWorkSets() {
        var s = mixed(listOf(ent("bench", "Bench", listOf(srow(40.0, 10.0, warmup = true), srow(60.0, 8.0)))))
        assertEquals(1, SessionCore.progress(s).second)
        s = SessionCore.tick(s, 0, 0, null, 40.0, 10.0, null, 1.0, "w").first
        assertEquals(0, SessionCore.progress(s).first)
        assertEquals(0.0, SessionCore.summary(s.workout!!, 1.0).volume, 0.0)
        assertEquals(1, SessionCore.setIndex(s, 0))
    }

    @Test fun testASupersetGoesInTurnsAndRestsAfterTheRound() {
        val s0 = mixed(listOf(
            ent("curl", "Curl", listOf(srow(12.0, 10.0), srow(12.0, 10.0)), group = "a"),
            ent("push", "Pushdown", listOf(srow(20.0, 12.0), srow(20.0, 12.0)), group = "a"),
            ent("raise", "Lateral raise", listOf(srow(8.0, 15.0))),
        ))
        var s = SessionCore.tick(s0, 0, 0, null, 12.0, 10.0, null, 1.0, "1").first
        var n = SessionCore.next(s, 0, 0)
        assertEquals("on to the partner", 1, n.first)
        assertFalse("no rest inside a round", n.second)
        s = SessionCore.tick(s, 1, 0, null, 20.0, 12.0, null, 2.0, "2").first
        n = SessionCore.next(s, 1, 0)
        assertEquals("back to the first for the next round", 0, n.first)
        assertTrue("the rest after the round", n.second)
        s = SessionCore.tick(s, 0, 1, null, 12.0, 10.0, null, 3.0, "3").first
        s = SessionCore.tick(s, 1, 1, null, 20.0, 12.0, null, 4.0, "4").first
        n = SessionCore.next(s, 1, 1)
        assertEquals("the superset done: the next exercise", 2, n.first)
        s = SessionCore.tick(s, 2, 0, null, 8.0, 15.0, null, 5.0, "5").first
        assertEquals("all done: the Finish page", 3, SessionCore.next(s, 2, 0).first)
    }

    @Test fun testASkippedSetIsPassedOverNotDone() {
        var s = mixed(listOf(ent("bench", "Bench", listOf(srow(60.0, 8.0), srow(60.0, 8.0), srow(60.0, 8.0)))))
        s = SessionCore.skip(s, 0, 0)
        assertEquals(1, SessionCore.setIndex(s, 0))
        assertFalse(s.workout!!.entries[0].sets[0].done)
        // picked by hand, it is back
        assertEquals(0, SessionCore.setIndex(s, 0, picked = 0))
        // a new workout forgets it
        val other = ActiveWorkout(id = "w2", name = "Other", unit = "kg", restSec = 90.0, entries = s.workout!!.entries)
        val s2 = SessionCore.applySnapshot(s, snap(other))
        assertTrue(s2.skipped.isEmpty())
        assertEquals(0, SessionCore.summary(s.workout!!, 1.0).sets)
    }

    @Test fun testCardioIsTickedWithoutNumbers() {
        val s0 = mixed(listOf(ent("run", "Treadmill", listOf(srow(null, null)), mode = "cardio")))
        val (s, ev) = SessionCore.tick(s0, 0, 0, null, null, null, null, 1.0, "c")
        assertTrue(s.workout!!.entries[0].sets[0].done)
        assertNull(ev!!["w"])
        assertNull(ev["r"])
    }

    @Test fun testTheSummaryCountsTimeVolumeAndRecords() {
        val bench = ent("bench", "Bench", listOf(srow(40.0, 10.0, warmup = true), srow(80.0, 5.0), srow(80.0, 6.0))).copy(best = BestSet(80.0, 5.0, null))
        val row1 = ent("row", "Row", listOf(srow(60.0, 8.0))).copy(best = BestSet(70.0, 8.0, null))
        val assist = ent("dip", "Assisted dip", listOf(srow(20.0, 8.0))).copy(best = BestSet(25.0, 8.0, null), assisted = true)
        val plank = ent("plank", "Plank", listOf(srow(null, null, sec = 60.0)), mode = "time").copy(best = BestSet(null, null, 50.0))
        val fresh = ent("new", "New thing", listOf(srow(100.0, 1.0)))
        var s = mixed(listOf(bench, row1, assist, plank, fresh), start = 1_000.0)
        for ((ei, si) in listOf(0 to 0, 0 to 1, 0 to 2, 1 to 0, 2 to 0, 3 to 0, 4 to 0)) {
            val r = s.workout!!.entries[ei].sets[si]
            s = SessionCore.tick(s, ei, si, null, r.w, r.r, r.sec, 2.0, "$ei$si").first
        }
        val sum = SessionCore.summary(s.workout!!, 1_000.0 + 45 * 60_000)
        assertEquals(45.0 * 60, sum.duration!!, 0.0)
        assertEquals("warm-ups are not counted", 6, sum.sets)
        assertEquals(400.0 + 480 + 480 + 160 + 100, sum.volume, 0.0)   // 80x5, 80x6, 60x8, 20x8, 100x1
        assertEquals("more reps at the best weight, lighter assistance, a longer hold; no history is no PR",
            listOf("Bench", "Assisted dip", "Plank"), sum.prs)
        assertFalse(sum.endedOnPhone)
    }

    @Test fun testAnOlderPhoneWithoutTheNewFieldsStillReads() {
        val json = """{"v":1,"active":{"id":"w","name":"A","unit":"kg","cur":0,"restSec":90,"entries":[{"id":"x","name":"X","mode":"reps","sets":[{"w":1,"r":2,"done":false,"warmup":false}]}]}}"""
        val snap = Snapshot.parse(json)!!
        assertNull(snap.active?.start)
        assertNull(snap.active?.entries?.get(0)?.group)
        assertNull(snap.active?.entries?.get(0)?.sets?.get(0)?.sides)
        val newer = """{"v":1,"active":{"id":"w","name":"A","unit":"kg","cur":0,"restSec":90,"start":5,"entries":[{"id":"x","name":"X","mode":"reps","perSide":true,"group":"g","best":{"w":10,"r":5},"sets":[{"w":1,"r":2,"done":false,"warmup":false,"sides":{"L":{"w":1,"r":1,"done":true},"R":{"w":1,"r":1,"done":false}}}]}]}}"""
        val snap2 = Snapshot.parse(newer)!!
        assertEquals("R", snap2.active?.entries?.get(0)?.sets?.get(0)?.sideUp)
        assertEquals(5.0, snap2.active?.start!!, 0.0)
    }

    @Test fun testAStateSavedByTheLastBuildStillLoads() {
        val saved = """{"settings":{},"unit":"kg","restSec":90,"finishedHere":[],"pending":{"x#0":{"w":1,"r":2,"at":3}},"entryIndex":0}"""
        val s = WireJson.decodeFromString(SessionState.serializer(), saved)
        assertTrue(s.skipped.isEmpty())
        assertNull(s.pending["x#0"]?.sec)
    }

    @Test fun testTheWeighInGoesOutAndRidesOnTheStart() {
        val ev = WeighIn.event(81.44, 5.0, "b")
        assertEquals("weighIn", str(ev, "type"))
        assertEquals(81.4, num(ev, "w")!!, 0.0)
        assertNull(WeighIn.event(0.0, 5.0, "x"))
        val ready = ReadySession(listOf("r"), "Push", emptyList())
        val (_, start) = SessionCore.start(SessionState(), ready, "watch-1", 5.0, "s", bw = 81.44)
        assertEquals(81.4, num(start, "bw")!!, 0.0)
        val (_, noBw) = SessionCore.start(SessionState(), ready, "watch-2", 5.0, "s2")
        assertNull(noBw["bw"])
    }

    // The derived show flags (showClip, showElapsed, showKcal, restRing) are not on WatchShow here: left out.
    @Test fun testTheSettingsReadWithAndWithoutTheNewFields() {
        val json = """{"v":1,"settings":{"health":true,"lang":"pt-BR","weighIn":false,"lastBw":80.5,"show":{"clip":false,"elapsed":true,"rest":"plain"}},"active":{"id":"w","name":"A","unit":"kg","cur":0,"restSec":90,"entries":[{"id":"x","name":"X","mode":"reps","step":1.25,"sets":[]}]}}"""
        val s = SessionCore.applySnapshot(SessionState(), Snapshot.parse(json)!!)
        assertEquals("pt-BR", s.settings.lang)
        assertEquals(false, s.settings.weighIn)
        assertEquals(80.5, s.settings.lastBw!!, 0.0)
        val show = s.settings.show ?: WatchShow()
        assertTrue(show.showHr)
        assertEquals(1.25, s.workout!!.entries[0].step!!, 0.0)
        val old = Snapshot.parse("""{"v":1,"settings":{"health":false}}""")!!
        val d = old.settings?.show ?: WatchShow()
        assertTrue(d.showLast && d.showNext && d.showHr)
        assertNull(old.settings?.lang)
    }

    /* ---------- phoneTicks: a set ticked on the phone gets the watch's heart rate (setHr) ---------- */

    @Test fun testFindsTheSetsThePhoneTickedButNotTheWatchsOwn() {
        var s = SessionCore.applySnapshot(SessionState(), snap(pw("p1", listOf(row(60.0, 8.0), row(60.0, 8.0), row(60.0, 8.0)))))
        s = SessionCore.tick(s, 0, 0, null, 60.0, 8.0, null, 1000.0, "e1").first
        val before = s.workout
        val phone = pw("p1", listOf(row(60.0, 8.0, done = true, at = 1000.0), row(60.0, 8.0, done = true, at = 3000.0), row(60.0, 8.0, done = true)))
        s = SessionCore.applySnapshot(s, snap(phone))
        val ticks = SessionCore.phoneTicks(before, s.workout)
        assertEquals("the watch's own tick and a set without a time are left out",
            listOf(PhoneTick("0025", 0, 1, 3000.0)), ticks)
        assertEquals(emptyList<PhoneTick>(), SessionCore.phoneTicks(s.workout, s.workout))
        assertEquals("another workout", emptyList<PhoneTick>(), SessionCore.phoneTicks(before, pw("p2", listOf(row(60.0, 8.0, done = true, at = 5.0)))))
    }

    @Test fun testOneSideTickedOnThePhoneCounts() {
        val w = pw("p1", listOf(row(20.0, 0.0).copy(sides = Sides(L = SideRow(20.0, 10.0, false), R = SideRow(20.0, 10.0, false)))))
        val before = SessionCore.applySnapshot(SessionState(), snap(w)).workout
        val first = w.entries[0]
        val after = w.copy(entries = listOf(first.copy(sets = listOf(SessionCore.markSide(first.sets[0], "L", 20.0, 10.0, 2000.0)))) + w.entries.drop(1))
        assertEquals(listOf(2000.0), SessionCore.phoneTicks(before, after).map { it.at })
    }

    @Test fun theSetHrEventIsTheAppleWatchs() {
        val ev = SessionCore.setHrEvent("p1", "0025", 0, 1, "h1", hr = 128 to 151)
        assertEquals("setHr", str(ev, "type"))
        assertEquals("h1", str(ev, "id"))
        assertEquals("p1", str(ev, "wid"))
        assertEquals("0025", str(ev, "exId"))
        assertEquals("0", str(ev, "entryIdx"))
        assertEquals("1", str(ev, "setIdx"))
        val hr = ev["hr"] as kotlinx.serialization.json.JsonObject
        assertEquals("128", (hr["avg"] as kotlinx.serialization.json.JsonPrimitive).content)
        assertEquals("151", (hr["max"] as kotlinx.serialization.json.JsonPrimitive).content)
        assertNull("no rest reading on a set's", ev["restHr"])
    }

    @Test fun theRestsHeartRateGoesToTheSetBeforeIt() {
        val ev = SessionCore.setHrEvent("p1", "0025", 0, 1, "r1", restHr = 112 to 140)
        assertEquals("setHr", str(ev, "type"))
        assertNull("the set's own reading went with its setDone", ev["hr"])
        val rest = ev["restHr"] as kotlinx.serialization.json.JsonObject
        assertEquals("112", (rest["avg"] as kotlinx.serialization.json.JsonPrimitive).content)
        assertEquals("140", (rest["max"] as kotlinx.serialization.json.JsonPrimitive).content)
    }

    // #1149: a set ticked on the phone takes the watch to the set after it, on whichever exercise.
    @Test fun aPhoneTickOnAnyExerciseMovesTheWatchThere() {
        val bench = Entry("be", "Bench", sets = listOf(set(60.0, 8.0), set(60.0, 8.0)))
        fun after(sq: Entry, be: Entry) = SessionCore.applySnapshot(SessionState(), Snapshot(active = workout("w1", sq, be)))
        val done = { e: Entry, n: Int -> e.copy(sets = e.sets.mapIndexed { i, r -> if (i < n) r.copy(done = true) else r }) }
        // the watch shows the squat (entry 0); the phone ticked bench set 1: the watch goes to the bench
        assertEquals(1, SessionCore.followTick(after(squat, done(bench, 1)), 1, 0))
        // the phone ticked squat set 1 and set 2 is open: the watch stays on the squat
        assertNull(SessionCore.followTick(after(done(squat, 1), bench), 0, 0))
        // the squat's last set: on to the bench
        assertEquals(1, SessionCore.followTick(after(done(squat, 2), bench), 0, 1))
    }
}
