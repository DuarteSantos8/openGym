package ch.duartesantos.opengym.wear

import kotlinx.serialization.encodeToString
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

/** The set menu's model (WatchCore SetMenuTests.swift on this port, from #1139). */
class SetMenuTest {
    @Test fun testOldSnapshotDecodes() {
        val snap = Snapshot.parse("""{"v":1,"active":{"id":"w","name":"A","entries":[{"id":"e","sets":[{"w":50,"r":5}]}]}}""")!!
        val row = snap.active!!.entries[0].sets[0]
        assertNull(row.failure); assertNull(row.drop); assertNull(row.drops); assertNull(row.rp); assertNull(row.side)
        assertNull(snap.settings?.setMenu)
    }

    @Test fun testNewFieldsDecode() {
        val snap = Snapshot.parse(
            """{"v":1,"settings":{"setMenu":true},"active":{"id":"w","name":"A","entries":[{"id":"e","sets":[{"w":50,"r":5,"failure":true,"drop":50,"drops":2,"rp":true,"side":"L"}]}]}}""",
        )!!
        val row = snap.active!!.entries[0].sets[0]
        assertEquals(true, row.failure); assertEquals(50.0, row.drop!!, 0.0); assertEquals(2, row.drops)
        assertEquals(true, row.rp); assertEquals("L", row.side)
        assertEquals(true, snap.settings!!.setMenu)
    }

    @Test fun testAStateSavedWithoutEditsStillLoads() {
        val s = WireJson.decodeFromString<SessionState>("""{"unit":"kg","entryIndex":1}""")
        assertTrue(s.edits.isEmpty())
        val edit = PendingEdit("i", "e", "mark", setIdx = 0, kind = "drop", on = true, w = 60.0, r = 8.0, done = true, entryIdx = 1)
        val back = WireJson.decodeFromString<SessionState>(WireJson.encodeToString(s.copy(edits = listOf(edit))))
        assertEquals(listOf(edit), back.edits)
    }

    private fun row(done: Boolean = false, warmup: Boolean = false) = SetRow(w = 60.0, r = 8.0, done = done, warmup = warmup)
    private fun entry(sets: List<SetRow>, mode: String = "reps") = Entry(id = "x", name = "X", mode = mode, sets = sets)
    private fun workout(sets: List<SetRow>, id: String = "w1") = ActiveWorkout(id = id, name = "Push", unit = "kg", cur = 0, restSec = 90.0, entries = listOf(entry(sets)))
    private fun state(sets: List<SetRow>) = SessionState(workout = workout(sets), settings = WatchSettings(setMenu = true))
    private fun rows(s: SessionState) = s.workout!!.entries[0].sets
    private fun tick(w: Double, r: Double, at: Double) = PendingTick(w = w, r = r, at = at)
    private fun snap(w: ActiveWorkout, acked: List<String>? = null) = Snapshot(v = 1, unit = "kg", restSec = 90.0, active = w, acked = acked)

    @Test fun workSetOffersAllThree() {
        assertEquals(MenuOffer(Disc.OFF, Disc.OFF, Disc.OFF, canAdd = true, canRemove = true), SetMenu.offer(entry(listOf(row(), row())), 0))
    }

    @Test fun warmupLocksFailureAndDrop() {
        val o = SetMenu.offer(entry(listOf(row(warmup = true), row())), 0)
        assertEquals(Disc.ON, o.warmup); assertEquals(Disc.LOCKED, o.failure); assertEquals(Disc.LOCKED, o.drop)
    }

    @Test fun lastWorkSetCannotBecomeWarmup() {
        assertEquals(Disc.LOCKED, SetMenu.offer(entry(listOf(row(warmup = true), row())), 1).warmup)
        assertEquals(Disc.LOCKED, SetMenu.offer(entry(listOf(row())), 0).warmup)
    }

    @Test fun dropSetAndRestPauseCannotBecomeWarmup() {
        val od = SetMenu.offer(entry(listOf(row().copy(drop = 50.0), row())), 0)
        assertEquals(Disc.LOCKED, od.warmup); assertEquals(Disc.ON, od.drop)
        val op = SetMenu.offer(entry(listOf(row().copy(rp = true), row())), 0)
        assertEquals(Disc.LOCKED, op.warmup); assertEquals(Disc.HIDDEN, op.drop)
    }

    // Swift wins: the Swift test asserts the switch is off (offered) on a done set.
    @Test fun doneSetHasAWarmupSwitch() {
        assertEquals(Disc.OFF, SetMenu.offer(entry(listOf(row(done = true), row())), 0).warmup)
    }

    @Test fun twoDropsLockTheDropDisc() {
        val o = SetMenu.offer(entry(listOf(row().copy(drop = 50.0, drops = 2), row())), 0)
        assertEquals(Disc.LOCKED, o.drop)
    }

    @Test fun failureMarkShowsOn() {
        assertEquals(Disc.ON, SetMenu.offer(entry(listOf(row().copy(failure = true), row())), 0).failure)
    }

    @Test fun timedHasNoDropCardioOnlyNothing() {
        val t = SetMenu.offer(entry(listOf(row(), row()), mode = "time"), 0)
        assertEquals(Disc.HIDDEN, t.drop); assertEquals(Disc.HIDDEN, t.warmup); assertEquals(Disc.OFF, t.failure); assertTrue(t.canAdd)
        val c = SetMenu.offer(entry(listOf(row(), row()), mode = "cardio"), 0)
        assertEquals(Disc.HIDDEN, c.failure); assertEquals(Disc.HIDDEN, c.drop); assertEquals(Disc.HIDDEN, c.warmup); assertFalse(c.canAdd)
    }

    @Test fun onlySetCannotBeRemoved() {
        assertFalse(SetMenu.offer(entry(listOf(row())), 0).canRemove)
    }

    @Test fun menuNeedsThePhonesFlag() {
        var s = SessionState()
        assertFalse(SetMenu.available(s))
        s = s.copy(settings = s.settings.copy(setMenu = true)); assertTrue(SetMenu.available(s))
        s = s.copy(settings = s.settings.copy(setMenu = false)); assertFalse(SetMenu.available(s))
    }

    @Test fun failureMarkEmitsEventAndShowsAtOnce() {
        val (s, ev) = SetMenu.mark(state(listOf(row(done = true), row())), 0, 0, MarkKind.FAILURE, true, 5.0, "m1")
        assertEquals(true, rows(s)[0].failure)
        val e = ev!!
        fun str(k: String) = e[k]!!.jsonPrimitive.content
        assertEquals("m1", str("id")); assertEquals("setMark", str("type")); assertEquals("w1", str("wid")); assertEquals("x", str("exId"))
        assertEquals("0", str("entryIdx")); assertEquals("0", str("setIdx")); assertEquals(5.0, e["at"]!!.jsonPrimitive.double, 0.0)
        assertEquals(60.0, e["w"]!!.jsonPrimitive.double, 0.0); assertEquals(8.0, e["r"]!!.jsonPrimitive.double, 0.0)
        assertEquals("true", str("done")); assertEquals("true", str("failure"))
        assertEquals(11, e.size)
        assertEquals(listOf(PendingEdit("m1", "x", "mark", setIdx = 0, kind = "failure", on = true, w = 60.0, r = 8.0, done = true, entryIdx = 0, row = 0)), s.edits)
    }

    @Test fun warmupMovesTheRowAndRemapsKeys() {
        val s0 = state(listOf(row(done = true), SetRow(w = 40.0, r = 10.0), row())).copy(
            pending = mapOf("x#0" to tick(60.0, 8.0, 1.0)), skipped = listOf("x#1", "x#2"),
        )
        val (s, ev) = SetMenu.mark(s0, 0, 1, MarkKind.WARMUP, true, 5.0, "m1")
        assertNotNull(ev); assertEquals("true", ev!!["warmup"]!!.jsonPrimitive.content)
        assertEquals(listOf(40.0, 60.0, 60.0), rows(s).map { it.w })
        assertTrue(rows(s)[0].warmup)
        assertEquals(setOf("x#1"), s.pending.keys)
        assertEquals(listOf("x#0", "x#2"), s.skipped)
        // and back: it becomes the first work set, where it is already
        val (b, _) = SetMenu.mark(s, 0, 0, MarkKind.WARMUP, false, 6.0, "m2")
        assertEquals(listOf(40.0, 60.0, 60.0), rows(b).map { it.w }); assertFalse(rows(b)[0].warmup)
    }

    @Test fun warmupOffGoesToTheEdgeOfTheWarmups() {
        val s0 = state(listOf(row(warmup = true), SetRow(w = 30.0, r = 5.0, warmup = true), row()))
        val (s, _) = SetMenu.mark(s0, 0, 0, MarkKind.WARMUP, false, 5.0, "m1")
        assertEquals(listOf(30.0, 60.0, 60.0), rows(s).map { it.w }); assertEquals(listOf(true, false, false), rows(s).map { it.warmup })
    }

    @Test fun warmupClearsFailureAndDrop() {
        val (s, _) = SetMenu.mark(state(listOf(row().copy(failure = true), row())), 0, 0, MarkKind.WARMUP, true, 5.0, "m1")
        assertTrue(rows(s)[0].warmup); assertNull(rows(s)[0].failure); assertNull(rows(s)[0].drop); assertNull(rows(s)[0].drops)
    }

    @Test fun dropOnShowsDropWithoutAWeight() {
        val (s, ev) = SetMenu.mark(state(listOf(row(), row())), 0, 0, MarkKind.DROP, true, 5.0, "m1")
        assertEquals("true", ev!!["drop"]!!.jsonPrimitive.content)
        assertEquals(1, rows(s)[0].drops); assertNull(rows(s)[0].drop)
        val o = SetMenu.offer(s.workout!!.entries[0], 0)
        assertEquals(Disc.ON, o.drop); assertEquals(Disc.LOCKED, o.warmup)
        val (off, _) = SetMenu.mark(s, 0, 0, MarkKind.DROP, false, 6.0, "m2")
        assertNull(rows(off)[0].drops); assertNull(rows(off)[0].drop)
    }

    @Test fun addAppendsACopyOfTheLastSet() {
        val last = SetRow(w = 70.0, r = 6.0, done = true, at = 3.0, failure = true)
        val (s, ev) = SetMenu.addSet(state(listOf(row(done = true), row(done = true), row(), last)), 0, 5.0, "a1")
        assertEquals(5, rows(s).size)
        assertEquals(SetRow(w = 70.0, r = 6.0), rows(s)[4])
        assertEquals("addSet", ev!!["type"]!!.jsonPrimitive.content); assertNull(ev["setIdx"]); assertEquals(6, ev.size)
        assertEquals("add", s.edits.first().op)
    }

    @Test fun removeDeletesTheRowAndItsPendingTick() {
        val s0 = state(listOf(row(done = true), row(done = true), row())).copy(
            pending = mapOf("x#0" to tick(60.0, 8.0, 1.0), "x#1" to tick(60.0, 8.0, 2.0)), skipped = listOf("x#2"),
        )
        val (s, ev) = SetMenu.removeSet(s0, 0, 1, 5.0, "r1")
        assertEquals(2, rows(s).size)
        assertEquals(setOf("x#0"), s.pending.keys); assertEquals(listOf("x#1"), s.skipped)
        assertEquals("removeSet", ev!!["type"]!!.jsonPrimitive.content); assertEquals("1", ev["setIdx"]!!.jsonPrimitive.content)
        assertEquals("true", ev["done"]!!.jsonPrimitive.content); assertEquals(60.0, ev["w"]!!.jsonPrimitive.double, 0.0)
    }

    @Test fun refusedMarkEmitsNothing() {
        val s0 = state(listOf(row(warmup = true), row()))
        val (s, ev) = SetMenu.mark(s0, 0, 1, MarkKind.WARMUP, true, 5.0, "m1")
        assertNull(ev); assertEquals(s0, s)
        assertNull(SetMenu.removeSet(state(listOf(row())), 0, 0, 5.0, "r1").second)
        assertNull(SetMenu.mark(state(listOf(row(), row())), 0, 0, MarkKind.FAILURE, false, 5.0, "m2").second)
    }

    @Test fun aTimedPerSidePairIsOneSet() {
        fun half(side: String) = SetRow(sec = 30.0, side = side)
        val s0 = state(listOf(half("L"), half("R"))).let { it.copy(workout = it.workout!!.copy(entries = listOf(it.workout!!.entries[0].copy(mode = "time")))) }
        val o = SetMenu.offer(s0.workout!!.entries[0], 1)
        assertFalse(o.canAdd); assertFalse(o.canRemove)
        val (s, ev) = SetMenu.mark(s0, 0, 1, MarkKind.FAILURE, true, 5.0, "m1")
        assertNotNull(ev)
        assertEquals(listOf<Boolean?>(true, true), rows(s).map { it.failure })
    }

    @Test fun anEditOnTheSecondCopyOfAnExerciseStaysThere() {
        val s0 = state(listOf(row(), row())).let { it.copy(workout = it.workout!!.copy(entries = it.workout!!.entries + entry(listOf(row(), row())))) }
        val (s1, ev) = SetMenu.mark(s0, 1, 0, MarkKind.FAILURE, true, 5.0, "m1")
        assertNotNull(ev)
        assertNull(s1.workout!!.entries[0].sets[0].failure)
        assertEquals(true, s1.workout!!.entries[1].sets[0].failure)
        // replayed over the phone's snapshot (without the edit), it lands on the same copy
        val replayed = SetMenu.apply(s1.edits.single(), s0.workout!!)!!.first
        assertNull(replayed.entries[0].sets[0].failure); assertEquals(true, replayed.entries[1].sets[0].failure)
    }

    // Edits stay until the phone has them (SessionCore.applySnapshot)

    @Test fun olderSnapshotDoesNotRevertAnEdit() {
        val (s1, _) = SetMenu.mark(state(listOf(row(), row())), 0, 0, MarkKind.FAILURE, true, 5.0, "m1")
        val s2 = SessionCore.applySnapshot(s1, snap(workout(listOf(row(), row()))))
        assertEquals(true, rows(s2)[0].failure); assertEquals(1, s2.edits.size)
        val s3 = SessionCore.applySnapshot(s2, snap(workout(listOf(row(), row())), acked = listOf("m1")))
        assertNull(rows(s3)[0].failure); assertTrue(s3.edits.isEmpty())
    }

    // Swift checks SetMenu.replay here; this port has no replay (applySnapshot replays itself), so apply is checked.
    @Test fun replaySkipsAnEditWhoseSetChanged() {
        val (s1, _) = SetMenu.mark(state(listOf(row(), row())), 0, 0, MarkKind.FAILURE, true, 5.0, "m1")
        val changed = workout(listOf(SetRow(w = 65.0, r = 8.0), row()))
        assertNull(SetMenu.apply(s1.edits.single(), changed))
        val s2 = SessionCore.applySnapshot(s1, snap(changed))
        assertNull(rows(s2)[0].failure); assertTrue(s2.edits.isEmpty())
    }

    @Test fun replayKeepsAnAddAndARemoveUntilAcked() {
        val (a, _) = SetMenu.addSet(state(listOf(row(), row())), 0, 5.0, "a1")
        assertEquals(3, rows(SessionCore.applySnapshot(a, snap(workout(listOf(row(), row()))))).size)
        val b0 = state(listOf(row(), SetRow(w = 50.0, r = 8.0)))
        val (b, _) = SetMenu.removeSet(b0, 0, 1, 5.0, "r1")
        val older = SessionCore.applySnapshot(b, snap(b0.workout!!))
        assertEquals(listOf(60.0), rows(older).map { it.w })
    }

    // Ticks made after an unapplied add or remove are keyed in the watch's rows.

    @Test fun aTickAfterARemoveStaysOnItsSet() {
        val s0 = state(listOf(row(), SetRow(w = 50.0, r = 8.0), SetRow(w = 70.0, r = 6.0)))
        val (s1, _) = SetMenu.removeSet(s0, 0, 1, 5.0, "r1")
        val (s2, _) = SessionCore.tick(s1, 0, 1, w = 70.0, r = 6.0, at = 6.0, id = "t1")
        val s3 = SessionCore.applySnapshot(s2, snap(s0.workout!!)) // the phone has neither yet
        assertEquals(listOf(60.0, 70.0), rows(s3).map { it.w })
        assertEquals(listOf(false, true), rows(s3).map { it.done })
        assertEquals(1, s3.edits.size)
    }

    @Test fun aTickOnAnAddedSetStays() {
        val s0 = state(listOf(row(), row()))
        val (s1, _) = SetMenu.addSet(s0, 0, 5.0, "a1")
        val (s2, _) = SessionCore.tick(s1, 0, 2, w = 60.0, r = 8.0, at = 6.0, id = "t1")
        val s3 = SessionCore.applySnapshot(s2, snap(s0.workout!!))
        assertEquals(listOf(false, false, true), rows(s3).map { it.done })
        assertNotNull(s3.pending["x#2"])
    }

    @Test fun aMarkAfterATickOnTheSameSetStays() {
        val s0 = state(listOf(row(), row()))
        val (s1, _) = SessionCore.tick(s0, 0, 0, w = 60.0, r = 8.0, at = 5.0, id = "t1")
        val (s2, _) = SetMenu.mark(s1, 0, 0, MarkKind.FAILURE, true, 6.0, "m1")
        val s3 = SessionCore.applySnapshot(s2, snap(s0.workout!!))
        assertTrue(rows(s3)[0].done); assertEquals(true, rows(s3)[0].failure)
    }

    @Test fun aTickAfterAWarmupMoveStaysOnItsSet() {
        val s0 = state(listOf(row(), SetRow(w = 40.0, r = 10.0), row()))
        val (s1, _) = SetMenu.mark(s0, 0, 1, MarkKind.WARMUP, true, 5.0, "m1") // 40 moves to the top
        val (s2, _) = SessionCore.tick(s1, 0, 1, w = 60.0, r = 8.0, at = 6.0, id = "t1") // the first work set
        val s3 = SessionCore.applySnapshot(s2, snap(s0.workout!!))
        assertEquals(listOf(40.0, 60.0, 60.0), rows(s3).map { it.w })
        assertEquals(listOf(false, true, false), rows(s3).map { it.done })
    }

    @Test fun aNewWorkoutDropsTheEdits() {
        val (s1, _) = SetMenu.mark(state(listOf(row(), row())), 0, 0, MarkKind.FAILURE, true, 5.0, "m1")
        assertTrue(SessionCore.applySnapshot(s1, snap(workout(listOf(row(), row()), id = "w2"))).edits.isEmpty())
        assertTrue(SessionCore.finish(s1, at = 9.0, id = "f1").first.edits.isEmpty())
        assertTrue(SessionCore.applySnapshot(s1, Snapshot()).edits.isEmpty())
        val ready = ReadySession(name = "Legs", entries = listOf(entry(listOf(row()))))
        assertTrue(SessionCore.start(s1, ready, "w3", 9.0, "s1").first.edits.isEmpty())
    }

    // Found missing in the Task 2 review

    @Test fun remapSetOutOfRangeLeavesTheSet() {
        assertEquals(5, SetMenu.remapSet(5, listOf(0, null)))
        assertNull(SetMenu.remapSet(1, listOf(0, null)))
    }

    @Test fun aTrialRunAppliesDespiteAChangedSet() {
        val pe = PendingEdit("m1", "x", "mark", setIdx = 0, kind = "failure", on = true, w = 60.0, r = 8.0, done = false, entryIdx = 0)
        val changed = workout(listOf(SetRow(w = 65.0, r = 5.0), row()))
        assertNull(SetMenu.apply(pe, changed))
        assertEquals(true, SetMenu.apply(pe, changed, sameSet = false)!!.first.entries[0].sets[0].failure)
    }

    @Test fun aStaleEntryIdxFallsBackToTheFirstCopy() {
        val w = workout(listOf(row())).let { it.copy(entries = listOf(Entry(id = "y", name = "Y", sets = listOf(row()))) + it.entries + it.entries) }
        assertEquals(1, PendingEdit("i", "x", "add", entryIdx = 0).entry(w))
        assertEquals(1, PendingEdit("i", "x", "add", entryIdx = 7).entry(w))
        assertEquals(2, PendingEdit("i", "x", "add", entryIdx = 2).entry(w))
        assertNull(PendingEdit("i", "z", "add", entryIdx = 0).entry(w))
    }

    @Test fun addOnASetWithSidesResetsBothSides() {
        val sides = Sides(SideRow(w = 20.0, r = 8.0, done = true), SideRow(w = 20.0, r = 8.0, done = true))
        val (s, _) = SetMenu.addSet(state(listOf(row(done = true).copy(sides = sides))), 0, 5.0, "a1")
        assertEquals(Sides(SideRow(w = 20.0, r = 8.0), SideRow(w = 20.0, r = 8.0)), rows(s)[1].sides)
    }

    @Test fun anUnknownKindOrMissingOnIsRefused() {
        val w = workout(listOf(row(), row()))
        assertNull(SetMenu.apply(PendingEdit("i", "x", "mark", setIdx = 0, kind = "band", on = true, w = 60.0, r = 8.0, done = false), w))
        assertNull(SetMenu.apply(PendingEdit("i", "x", "mark", setIdx = 0, kind = "failure", w = 60.0, r = 8.0, done = false), w))
    }

    // Task 3 review: a repeated exercise, and the watch's own tick after an edit

    @Test fun aTickFollowsItsSetWhenThePhoneRefusesTheRemove() {
        val s0 = state(listOf(row(), SetRow(w = 50.0, r = 8.0), SetRow(w = 70.0, r = 6.0)))
        val (s1, _) = SetMenu.removeSet(s0, 0, 1, 5.0, "r1")
        val (s2, _) = SessionCore.tick(s1, 0, 1, w = 70.0, r = 6.0, at = 6.0, id = "t1")
        // the phone changed the 50 to 55 first: the remove no longer fits and goes
        val changed = workout(listOf(row(), SetRow(w = 55.0, r = 8.0), SetRow(w = 70.0, r = 6.0)))
        val s3 = SessionCore.applySnapshot(s2, snap(changed))
        assertEquals(listOf(false, false, true), rows(s3).map { it.done })
        assertTrue(s3.edits.isEmpty())
        assertNotNull(s3.pending["x#2"])
        val s4 = SessionCore.applySnapshot(s3, snap(changed))
        assertEquals(listOf(55.0, 70.0), rows(s4).drop(1).map { it.w })
        assertEquals(listOf(false, false, true), rows(s4).map { it.done })
    }

    @Test fun aMarkOnATickedAddedSetSurvivesAnOlderSnapshot() {
        val s0 = state(listOf(row(), row()))
        val (s1, _) = SetMenu.addSet(s0, 0, 5.0, "a1")
        val (s2, _) = SetMenu.mark(s1, 0, 2, MarkKind.FAILURE, true, 6.0, "m1")
        val (s3, _) = SessionCore.tick(s2, 0, 2, w = 60.0, r = 8.0, at = 7.0, id = "t1")
        val s4 = SessionCore.applySnapshot(s3, snap(s0.workout!!))
        assertEquals(listOf(false, false, true), rows(s4).map { it.done })
        assertEquals(true, rows(s4)[2].failure)
        assertEquals(2, s4.edits.size)
    }

    private fun twice(sets: List<SetRow>) = state(sets).let { it.copy(workout = it.workout!!.copy(entries = listOf(entry(sets), entry(sets)))) }

    @Test fun anEditOnTheSecondCopyLeavesTheFirstCopysKeys() {
        val s0 = twice(listOf(row(), SetRow(w = 50.0, r = 8.0), SetRow(w = 70.0, r = 6.0)))
        val (s1, _) = SessionCore.tick(s0, 0, 1, w = 50.0, r = 8.0, at = 5.0, id = "t1")
        val s2 = SessionCore.skip(s1, 0, 2)
        val (s3, _) = SetMenu.removeSet(s2, 1, 1, 6.0, "r1")
        assertNotNull(s3.pending["x#1"]); assertEquals(listOf("x#2"), s3.skipped)
        val (s4, _) = SetMenu.mark(s3, 1, 1, MarkKind.WARMUP, true, 7.0, "m1")
        assertNotNull(s4.pending["x#1"]); assertEquals(listOf("x#2"), s4.skipped)
    }

    @Test fun aRemoveOnTheSecondCopyLeavesTheFirstCopysTick() {
        val s0 = twice(listOf(row(), SetRow(w = 50.0, r = 8.0), SetRow(w = 70.0, r = 6.0)))
        val (s1, _) = SetMenu.removeSet(s0, 1, 1, 5.0, "r1")
        val (s2, _) = SessionCore.tick(s1, 0, 1, w = 50.0, r = 8.0, at = 6.0, id = "t1")
        val s3 = SessionCore.applySnapshot(s2, snap(s0.workout!!))
        assertEquals(listOf(false, true, false), s3.workout!!.entries[0].sets.map { it.done })
        assertEquals(listOf(60.0, 70.0), s3.workout!!.entries[1].sets.map { it.w })
        assertEquals(1, s3.edits.size)
    }

    @Test fun aTickOnTheFirstCopyKeepsAMarkOnTheSecond() {
        val s0 = twice(listOf(row(), row()))
        val (s1, _) = SetMenu.mark(s0, 1, 0, MarkKind.FAILURE, true, 5.0, "m1")
        val (s2, _) = SessionCore.tick(s1, 0, 0, w = 60.0, r = 8.0, at = 6.0, id = "t1")
        val s3 = SessionCore.applySnapshot(s2, snap(s0.workout!!))
        assertTrue(s3.workout!!.entries[0].sets[0].done); assertNull(s3.workout!!.entries[0].sets[0].failure)
        assertFalse(s3.workout!!.entries[1].sets[0].done); assertEquals(true, s3.workout!!.entries[1].sets[0].failure)
        assertEquals(1, s3.edits.size)
    }

    @Test fun aTickAfterAMarkOnTheSameSetKeepsTheMark() {
        val s0 = state(listOf(row(), row()))
        val (s1, _) = SetMenu.mark(s0, 0, 0, MarkKind.FAILURE, true, 5.0, "m1")
        val (s2, _) = SessionCore.tick(s1, 0, 0, w = 62.5, r = 7.0, at = 6.0, id = "t1")
        assertEquals(PendingEdit("m1", "x", "mark", 0, "failure", true, 62.5, 7.0, true, 0, row = 0), s2.edits.single())
        val s3 = SessionCore.applySnapshot(s2, snap(s0.workout!!))
        assertTrue(rows(s3)[0].done); assertEquals(true, rows(s3)[0].failure); assertEquals(1, s3.edits.size)
    }

    @Test fun aTickOnAMovedWarmupKeepsTheMove() {
        val s0 = state(listOf(row(), SetRow(w = 40.0, r = 10.0), row()))
        val (s1, _) = SetMenu.mark(s0, 0, 1, MarkKind.WARMUP, true, 5.0, "m1") // 40 moves to the top
        val (s2, _) = SessionCore.tick(s1, 0, 0, w = 40.0, r = 10.0, at = 6.0, id = "t1") // the warm-up itself
        val s3 = SessionCore.applySnapshot(s2, snap(s0.workout!!))
        assertEquals(listOf(40.0, 60.0, 60.0), rows(s3).map { it.w })
        assertEquals(listOf(true, false, false), rows(s3).map { it.warmup })
        assertEquals(listOf(true, false, false), rows(s3).map { it.done })
        assertEquals(setOf("x#0"), s3.pending.keys); assertEquals(1, s3.edits.size)
    }

    @Test fun anEditsRowFollowsLaterMoves() {
        val s0 = state(listOf(row(), SetRow(w = 50.0, r = 8.0), SetRow(w = 40.0, r = 10.0)))
        val (s1, _) = SetMenu.mark(s0, 0, 1, MarkKind.FAILURE, true, 5.0, "m1")
        val (s2, _) = SetMenu.mark(s1, 0, 2, MarkKind.WARMUP, true, 6.0, "m2") // 40 to the top: 50 goes to row 2
        assertEquals(listOf<Int?>(2, 0), s2.edits.map { it.row })
        val (s3, _) = SetMenu.removeSet(s2, 0, 2, 7.0, "r1")
        assertEquals(listOf<Int?>(null, 0, null), s3.edits.map { it.row })
    }

    /* ---------- Undo, the order events leave in, the refs that follow an edit ---------- */

    private fun held(id: String = "r1"): HeldRemoval {
        val s0 = state(listOf(row(), row(), row()))
        val (_, ev) = SetMenu.removeSet(s0, 0, 1, 5.0, id)
        return HeldRemoval(ev.toString(), WireJson.encodeToString(s0), setNumber = 2, w = 60.0, r = 8.0, unit = "kg")
    }
    private fun ev(id: String): Event = buildJsonObject { put("id", id) }
    private fun Event.id() = this["id"]!!.jsonPrimitive.content

    @Test fun pillDropsThePlaceOnlyWhenTheTagsDoNotFit() {
        assertTrue(PillFit.showPlace(0, 500f, 100f))
        assertTrue(PillFit.showPlace(2, 160f, 172f))
        assertFalse(PillFit.showPlace(2, 180f, 172f))
        assertTrue(PillFit.showPlace(2, 172f, 172f))
    }

    @Test fun undoCancels() {
        val u = UndoWindow(); u.begin(held()); u.undo()
        assertNull(u.flush())
    }

    @Test fun flushReturnsItOnce() {
        val h = held()
        val u = UndoWindow(); u.begin(h)
        assertEquals(h, u.flush()); assertNull(u.flush())
    }

    @Test fun aHeldRemovalIsSentBeforeTheNextEvent() {
        val u = UndoWindow(); u.begin(held("r1"))
        // Done on another set during the Undo time: the removal goes first, once
        assertEquals(listOf("r1", "t1"), SetMenu.order(u.flush(), ev("t1")).map { it.id() })
        assertEquals(listOf("t2"), SetMenu.order(u.flush(), ev("t2")).map { it.id() })
        // the removal itself is not sent twice
        assertEquals(listOf("r1"), SetMenu.order(held("r1"), ev("r1")).map { it.id() })
    }

    @Test fun aHeldRemovalSurvivesARestart() {
        val h = held("r1")
        val back = WireJson.decodeFromString<HeldRemoval>(WireJson.encodeToString(h))
        assertEquals(h, back)
        assertEquals("removeSet", back.toEvent()["type"]!!.jsonPrimitive.content)
        assertEquals(1, back.toEvent()["setIdx"]!!.jsonPrimitive.content.toInt())
        // Undo puts back the rows as they were
        assertEquals(3, WireJson.decodeFromString<SessionState>(back.before).workout!!.entries[0].sets.size)
        assertEquals(listOf("r1", "t1"), SetMenu.order(back, ev("t1")).map { it.id() })
    }

    @Test fun refsFollowARemove() {
        val s0 = state(listOf(row(), row(), row()))
        val (s1, _) = SetMenu.removeSet(s0, 0, 0, 5.0, "r1")
        val moved = SetMenu.apply(s1.edits.last(), s0.workout!!, entry = 0)!!.second
        assertEquals(SetRef(0, 1), SetMenu.follow(SetRef(0, 2), 0, moved))
        assertNull(SetMenu.follow(SetRef(0, 0), 0, moved))
        assertEquals(SetRef(1, 2), SetMenu.follow(SetRef(1, 2), 0, moved))   // another exercise: untouched
        assertNull(SetMenu.follow(null, 0, moved))
        // the shown set removed: nothing picked, the next open set comes up
        assertEquals(0, SessionCore.setIndex(s1, 0, SetMenu.follow(SetRef(0, 0), 0, moved)?.set))
    }

    @Test fun thePageStaysOnItsSetWhenAWarmupMovesRows() {
        // rows: warm-up, A, B. B becomes a warm-up and moves to row 1; A goes to row 2.
        val s0 = state(listOf(row(warmup = true), SetRow(w = 60.0, r = 8.0), SetRow(w = 70.0, r = 8.0)))
        val (s1, _) = SetMenu.mark(s0, 0, 2, MarkKind.WARMUP, true, 5.0, "m1")
        assertEquals(70.0, rows(s1)[1].w!!, 0.0)
        val moved = SetMenu.apply(s1.edits.last(), s0.workout!!, entry = 0)!!.second
        assertEquals(SetRef(0, 2), SetMenu.follow(SetRef(0, 1), 0, moved))   // A: still A
        assertEquals(SetRef(0, 1), SetMenu.follow(SetRef(0, 2), 0, moved))   // B: still B
        assertEquals(SetRef(0, 0), SetMenu.follow(SetRef(0, 0), 0, moved))
    }
}
