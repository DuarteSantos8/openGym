package ch.duartesantos.opengym.wear

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The set menu's model, case for case with WatchCore's SetMenuTests.swift (#1139), by the set's id (protocol 2). */
class SetMenuTest {
    private fun row(done: Boolean = false, warmup: Boolean = false, sid: String? = null, w: Double = 60.0) =
        SetRow(w = w, r = 8.0, done = done, warmup = warmup, sid = sid)
    private fun entry(sets: List<SetRow>, mode: String = "reps") = Entry(id = "x", name = "X", mode = mode, sets = sets)
    private fun workout(sets: List<SetRow>, id: String = "w1") =
        ActiveWorkout(id = id, name = "Push", unit = "kg", cur = 0, restSec = 90.0, entries = listOf(entry(sets)))
    private fun state(sets: List<SetRow>) = SessionState(workout = workout(sets), settings = WatchSettings(setMenu = true))
    private fun snap(w: ActiveWorkout, acked: List<String>? = null) = Snapshot(v = 1, unit = "kg", restSec = 90.0, active = w, acked = acked)
    private fun rows(s: SessionState) = s.workout!!.entries[0].sets
    private fun JsonObject.str(k: String) = this[k]?.jsonPrimitive?.content
    /** Three sets the phone has named. */
    private val abc get() = listOf(row(sid = "a"), row(sid = "b", w = 50.0), row(sid = "c", w = 70.0))

    @Test fun oldSnapshotDecodes() {
        val snap = Snapshot.parse("""{"v":1,"active":{"id":"w","name":"A","entries":[{"id":"e","sets":[{"w":50,"r":5}]}]}}""")!!
        val r = snap.active!!.entries[0].sets[0]
        assertNull(r.failure); assertNull(r.drop); assertNull(r.drops); assertNull(r.rp); assertNull(r.side)
        assertNull(snap.settings?.setMenu)
    }

    @Test fun newFieldsDecode() {
        val snap = Snapshot.parse(
            """{"v":1,"settings":{"setMenu":true},"active":{"id":"w","name":"A","entries":[{"id":"e","sets":[{"w":50,"r":5,"failure":true,"drop":50,"drops":2,"rp":true,"side":"L"}]}]}}""",
        )!!
        val r = snap.active!!.entries[0].sets[0]
        assertEquals(true, r.failure); assertEquals(50.0, r.drop!!, 0.0); assertEquals(2, r.drops)
        assertEquals(true, r.rp); assertEquals("L", r.side)
        assertEquals(true, snap.settings!!.setMenu)
    }

    @Test fun workSetOffersAllThree() {
        assertEquals(MenuOffer(Disc.OFF, Disc.OFF, Disc.OFF, canAdd = true, canRemove = true),
            SetMenu.offer(entry(listOf(row(sid = "a"), row(sid = "b"))), 0))
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

    @Test fun doneSetHasAWarmupSwitch() {
        assertEquals(Disc.OFF, SetMenu.offer(entry(listOf(row(done = true), row())), 0).warmup)
    }

    @Test fun twoDropsLockTheDropDisc() {
        assertEquals(Disc.LOCKED, SetMenu.offer(entry(listOf(row().copy(drop = 50.0, drops = 2), row())), 0).drop)
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
        assertFalse(SetMenu.offer(entry(listOf(row(sid = "a"))), 0).canRemove)
    }

    // What the phone's removeWatchSet takes: never a done set, nor one with a side done, nor one it has not named.
    @Test fun removeIsNotOfferedOnADoneSet() {
        assertFalse(SetMenu.offer(entry(listOf(row(done = true, sid = "a"), row(sid = "b"))), 0).canRemove)
        val half = row(sid = "a").copy(sides = Sides(SideRow(20.0, 8.0, done = true), SideRow(20.0, 8.0, done = false)))
        assertFalse(SetMenu.offer(entry(listOf(half, row(sid = "b"))), 0).canRemove)
        assertFalse(SetMenu.offer(entry(listOf(row(), row())), 0).canRemove)
        assertTrue(SetMenu.offer(entry(listOf(row(sid = "a"), row(sid = "b"))), 0).canRemove)
    }

    @Test fun menuNeedsThePhonesFlag() {
        assertFalse(SetMenu.available(SessionState()))
        assertTrue(SetMenu.available(SessionState(settings = WatchSettings(setMenu = true))))
        assertFalse(SetMenu.available(SessionState(settings = WatchSettings(setMenu = false))))
    }

    /* ---------- edits on the watch's own state, by the set's id ---------- */

    @Test fun aMarkGoesOutByItsSetsId() {
        val (s, ev) = SetMenu.mark(state(abc), 0, 1, MarkKind.FAILURE, true, 5.0, "m1")
        assertEquals(true, rows(s)[1].failure)
        val e = ev!!
        assertEquals("m1", e.str("id")); assertEquals("setMark", e.str("type"))
        assertEquals("w1", e.str("wid")); assertEquals("x", e.str("exId"))
        assertEquals(0, e["entryIdx"]!!.jsonPrimitive.int); assertEquals(1, e["setIdx"]!!.jsonPrimitive.int); assertEquals("b", e.str("sid"))
        assertEquals(5L, e["at"]!!.jsonPrimitive.long); assertEquals(true, e["failure"]!!.jsonPrimitive.boolean)
        assertEquals(9, e.size)   // no w, r or done: the id is the set's identity (PhoneLink adds `off`)
    }

    @Test fun anEditSurvivesASnapshotWithoutItAndGoesOnceAcked() {
        val (s1, _) = SetMenu.mark(state(abc), 0, 0, MarkKind.FAILURE, true, 5.0, "m1")
        val s2 = SessionCore.applySnapshot(s1, snap(workout(abc)))
        assertEquals(true, rows(s2)[0].failure); assertEquals(1, s2.edits.size)
        val s3 = SessionCore.applySnapshot(s2, snap(workout(abc), acked = listOf("m1")))
        assertNull(rows(s3)[0].failure); assertTrue(s3.edits.isEmpty())
    }

    @Test fun aMarkFollowsItsSetWhereverThePhoneMovedIt() {
        val (s1, _) = SetMenu.mark(state(abc), 0, 0, MarkKind.FAILURE, true, 5.0, "m1")
        val moved = workout(listOf(abc[1], abc[2], abc[0]))   // the phone moved "a" to the end
        assertEquals(listOf(false, false, true), rows(SessionCore.applySnapshot(s1, snap(moved))).map { it.failure == true })
    }

    @Test fun aMarkWithoutAnIdFallsBackToItsPlace() {
        val (s1, ev) = SetMenu.mark(state(listOf(row(), row(w = 50.0))), 0, 1, MarkKind.FAILURE, true, 5.0, "m1")
        assertNull(ev!!["sid"])
        val s2 = SessionCore.applySnapshot(s1, snap(workout(listOf(row(), row(w = 50.0)))))
        assertEquals(listOf(false, true), rows(s2).map { it.failure == true })
    }

    @Test fun aWarmupMoveKeepsTheSetsIdAndItsPendingTickFollows() {
        val s0 = state(abc).copy(skipped = listOf("s:c"))
        val (t, _) = SessionCore.tick(s0, 0, 1, w = 50.0, r = 8.0, at = 4.0, id = "t1")   // "b" done here
        val (s1, ev) = SetMenu.mark(t, 0, 1, MarkKind.WARMUP, true, 5.0, "m1")
        assertEquals(true, ev!!["warmup"]!!.jsonPrimitive.boolean)
        assertEquals(listOf("b", "a", "c"), rows(s1).map { it.sid }); assertTrue(rows(s1)[0].warmup)
        assertEquals(listOf("s:c"), s1.skipped)
        assertNotNull(s1.pending["s:b"])
        // the phone has neither yet: the move is replayed, and the tick lands on "b" where it is now
        val s2 = SessionCore.applySnapshot(s1, snap(workout(abc)))
        assertEquals(listOf("b", "a", "c"), rows(s2).map { it.sid })
        assertEquals(listOf(true, false, false), rows(s2).map { it.done })
        // and back: it becomes the first work set, where it is already
        val (b, _) = SetMenu.mark(s2, 0, 0, MarkKind.WARMUP, false, 6.0, "m2")
        assertEquals(listOf("b", "a", "c"), rows(b).map { it.sid }); assertFalse(rows(b)[0].warmup)
    }

    @Test fun aWarmupMoveRemapsSkippedAndEfforts() {
        // sets without an id are skipped by their place; efforts are always by place
        val s0 = state(listOf(row(), row(w = 50.0), row(w = 70.0))).copy(skipped = listOf("n0:x#0"), efforts = mapOf("x@0#0" to 8.0))
        val (s, _) = SetMenu.mark(s0, 0, 2, MarkKind.WARMUP, true, 5.0, "m1")   // the 70 to the top
        assertEquals(listOf(70.0, 60.0, 50.0), rows(s).map { it.w })
        assertEquals(listOf("n0:x#1"), s.skipped); assertEquals(mapOf("x@0#1" to 8.0), s.efforts)
    }

    @Test fun aWarmupMoveRemapsAPendingTickByPlace() {
        // no ids: the tick on the 60 is kept by its place, which the warm-up moves
        val (t, _) = SessionCore.tick(state(listOf(row(), row(w = 50.0), row(w = 70.0))), 0, 0, w = 65.0, r = 8.0, at = 4.0, id = "t1")
        val (s1, _) = SetMenu.mark(t, 0, 1, MarkKind.WARMUP, true, 5.0, "m1")
        assertEquals(setOf("n0:x#1"), s1.pending.keys)
        // an older snapshot: the move is replayed and the tick stays on the 60, not the 50 now in its old place
        val s2 = SessionCore.applySnapshot(s1, snap(workout(listOf(row(), row(w = 50.0), row(w = 70.0)))))
        assertEquals(listOf(50.0, 65.0, 70.0), rows(s2).map { it.w }); assertEquals(listOf(false, true, false), rows(s2).map { it.done })
    }

    @Test fun aRatingStaysOnItsSetWhenTheReplayRefusesAMove() {
        val done = listOf(row(done = true, sid = "a").copy(at = 1.0), row(done = true, sid = "b", w = 50.0).copy(at = 2.0), row(sid = "c", w = 70.0))
        val s0 = state(done).copy(efforts = mapOf("x@0#0" to 8.0))
        val (s1, _) = SetMenu.mark(s0, 0, 1, MarkKind.WARMUP, true, 5.0, "m1")   // "b" to the top, "a"'s rating to place 1
        assertEquals(mapOf("x@0#1" to 8.0), s1.efforts)
        // the phone made "b" a drop set meanwhile: the warm-up is refused there and here, "a" is back at place 0
        val there = done.toMutableList().also { it[1] = it[1].copy(drops = 1) }
        val s2 = SessionCore.applySnapshot(s1, snap(workout(there)))
        assertEquals(listOf("a", "b", "c"), rows(s2).map { it.sid })
        assertEquals(mapOf("x@0#0" to 8.0), s2.efforts)
    }

    @Test fun warmupOffGoesToTheEdgeOfTheWarmups() {
        val s0 = state(listOf(row(warmup = true), SetRow(w = 30.0, r = 5.0, warmup = true), row()))
        val (s, _) = SetMenu.mark(s0, 0, 0, MarkKind.WARMUP, false, 5.0, "m1")
        assertEquals(listOf(30.0, 60.0, 60.0), rows(s).map { it.w }); assertEquals(listOf(true, false, false), rows(s).map { it.warmup })
    }

    @Test fun warmupClearsFailureAndDrop() {
        val (s, _) = SetMenu.mark(state(listOf(row(sid = "a").copy(failure = true), row())), 0, 0, MarkKind.WARMUP, true, 5.0, "m1")
        assertTrue(rows(s)[0].warmup); assertNull(rows(s)[0].failure); assertNull(rows(s)[0].drop); assertNull(rows(s)[0].drops)
        assertEquals("a", rows(s)[0].sid)
    }

    @Test fun dropOnShowsDropWithoutAWeight() {
        val (s, ev) = SetMenu.mark(state(listOf(row(), row())), 0, 0, MarkKind.DROP, true, 5.0, "m1")
        assertEquals(true, ev!!["drop"]!!.jsonPrimitive.boolean)
        assertEquals(1, rows(s)[0].drops); assertNull(rows(s)[0].drop)
        val o = SetMenu.offer(s.workout!!.entries[0], 0)
        assertEquals(Disc.ON, o.drop); assertEquals(Disc.LOCKED, o.warmup)
        val (off, _) = SetMenu.mark(s, 0, 0, MarkKind.DROP, false, 6.0, "m2")
        assertNull(rows(off)[0].drops); assertNull(rows(off)[0].drop)
    }

    @Test fun addAppendsACopyOfTheLastSetWithAnIdOfItsOwn() {
        val last = SetRow(w = 70.0, r = 6.0, done = true, at = 3.0, sid = "c", failure = true)
        val (s, ev) = SetMenu.addSet(state(listOf(row(done = true, sid = "a"), last)), 0, 5.0, "a1")
        assertEquals(3, rows(s).size)
        val n = rows(s)[2]
        val sid = n.sid!!
        assertTrue(sid.startsWith("w-")); assertTrue(sid.length <= 40)   // the phone's sidOk
        assertEquals(SetRow(w = 70.0, r = 6.0, done = false, warmup = false, at = null, sid = sid), n)
        val e = ev!!
        assertEquals("addSet", e.str("type")); assertEquals(sid, e.str("sid"))
        assertEquals(70.0, e["w"]!!.jsonPrimitive.double, 0.0); assertEquals(6.0, e["r"]!!.jsonPrimitive.double, 0.0)
        assertNull(e["setIdx"]); assertNull(e["after"])   // at the end of the exercise
    }

    @Test fun addOnASetWithSidesResetsBothSides() {
        val sided = row(done = true, sid = "a").copy(sides = Sides(SideRow(20.0, 8.0, done = true), SideRow(20.0, 8.0, done = true)))
        val (s, _) = SetMenu.addSet(state(listOf(sided)), 0, 5.0, "a1")
        assertEquals(Sides(SideRow(20.0, 8.0, done = false), SideRow(20.0, 8.0, done = false)), rows(s)[1].sides)
    }

    @Test fun aTickOnAWatchAddedSetIsKeyedByItsIdAndLands() {
        val (s1, ev) = SetMenu.addSet(state(abc), 0, 5.0, "a1", sid = "w-new")
        assertEquals("w-new", ev!!.str("sid"))
        val (s2, _) = SessionCore.tick(s1, 0, 3, w = 70.0, r = 8.0, at = 6.0, id = "t1")
        assertNotNull(s2.pending["s:w-new"])
        val s3 = SessionCore.applySnapshot(s2, snap(workout(abc)))   // the phone has neither yet
        assertEquals(listOf("a", "b", "c", "w-new"), rows(s3).map { it.sid })
        assertEquals(listOf(false, false, false, true), rows(s3).map { it.done })
        // the phone added it (once) and has the tick
        val there = abc + row(done = true, sid = "w-new", w = 70.0).copy(at = 7.0)
        val s4 = SessionCore.applySnapshot(s3, snap(workout(there), acked = listOf("a1", "t1")))
        assertEquals(4, rows(s4).size); assertTrue(s4.edits.isEmpty()); assertTrue(s4.pending.isEmpty())
    }

    @Test fun aHeldRemovalIsReplayedAndUndoPutsTheSetBack() {
        // the third set has no id yet: skipped by its place, and that place moves with the removal
        val sets = listOf(row(sid = "a"), row(sid = "b", w = 50.0), row(w = 70.0))
        val s0 = state(sets).copy(skipped = listOf("n0:x#2"))
        val s1 = SetMenu.removeSet(s0, 0, 1, 5.0, "r1")!!
        assertEquals(listOf("a", null), rows(s1).map { it.sid }); assertEquals(listOf("n0:x#1"), s1.skipped)
        assertEquals(listOf("r1"), SetMenu.held(s1))
        // a snapshot meanwhile does not bring it back, nor end the Undo
        val s2 = SessionCore.applySnapshot(s1, snap(workout(sets)))
        assertEquals(listOf("a", null), rows(s2).map { it.sid }); assertEquals(listOf("r1"), SetMenu.held(s2))
        // Undo: the set in its place, nothing to send
        val u = SetMenu.undo(s2, "r1")
        assertEquals(listOf("a", "b", null), rows(u).map { it.sid }); assertTrue(u.edits.isEmpty()); assertEquals(listOf("n0:x#2"), u.skipped)
        // or its time is over: it goes out, by the set's id, and stays until acked
        val (s3, ev) = SetMenu.release(s2, "r1")
        assertEquals("removeSet", ev!!.str("type")); assertEquals("b", ev.str("sid")); assertEquals(1, ev["setIdx"]!!.jsonPrimitive.int)
        assertEquals(emptyList<String>(), SetMenu.held(s3)); assertNull(s3.edits.first().row)
        assertEquals(listOf("a", null), rows(SessionCore.applySnapshot(s3, snap(workout(sets)))).map { it.sid })
        assertNull(SetMenu.release(s3, "r1").second)   // once
    }

    @Test fun aRemovalThePhoneRefusedComesBack() {
        val s1 = SetMenu.removeSet(state(abc), 0, 1, 5.0, "r1")!!
        val (s2, _) = SetMenu.release(s1, "r1")
        // the phone ticked "b" meanwhile: it is not taken out there, nor here
        val there = abc.toMutableList().also { it[1] = it[1].copy(done = true, at = 6.0) }
        assertEquals(listOf("a", "b", "c"), rows(SessionCore.applySnapshot(s2, snap(workout(there)))).map { it.sid })
    }

    @Test fun refusedEditsDoNothing() {
        val s0 = state(listOf(row(warmup = true), row()))
        val (s, ev) = SetMenu.mark(s0, 0, 1, MarkKind.WARMUP, true, 5.0, "m1")
        assertNull(ev); assertEquals(s0, s)
        assertNull(SetMenu.removeSet(state(listOf(row(sid = "a"))), 0, 0, 5.0, "r1"))
        assertNull(SetMenu.removeSet(state(listOf(row(done = true, sid = "a"), row(sid = "b"))), 0, 0, 5.0, "r1"))
        assertNull(SetMenu.mark(state(listOf(row(), row())), 0, 0, MarkKind.FAILURE, false, 5.0, "m2").second)
    }

    @Test fun anUnknownKindOrMissingOnIsRefused() {
        val w = workout(abc)
        assertNull(SetMenu.apply(PendingEdit("m1", "setMark", "w1", "x", 0, setIdx = 0, sid = "a", kind = "rp", on = true, at = 5.0), w))
        assertNull(SetMenu.apply(PendingEdit("m1", "setMark", "w1", "x", 0, setIdx = 0, sid = "a", kind = "failure", at = 5.0), w))
    }

    @Test fun aTimedPerSidePairIsOneSet() {
        fun half(side: String) = SetRow(sec = 30.0, sid = side, side = side)
        val w0 = ActiveWorkout(id = "w1", name = "Push", unit = "kg", cur = 0, restSec = 90.0, entries = listOf(entry(listOf(half("L"), half("R")), mode = "time")))
        val s0 = SessionState(workout = w0, settings = WatchSettings(setMenu = true))
        val o = SetMenu.offer(w0.entries[0], 1)
        assertFalse(o.canAdd); assertFalse(o.canRemove)
        val (s, ev) = SetMenu.mark(s0, 0, 1, MarkKind.FAILURE, true, 5.0, "m1")
        assertNotNull(ev)
        assertEquals(listOf(true, true), rows(s).map { it.failure })
    }

    @Test fun anEditOnTheSecondCopyOfAnExerciseStaysThere() {
        val w0 = ActiveWorkout(id = "w1", name = "Push", unit = "kg", cur = 0, restSec = 90.0,
            entries = listOf(entry(listOf(row(sid = "a"), row(sid = "b"))), entry(listOf(row(sid = "c"), row(sid = "d")))))
        val (s1, _) = SetMenu.mark(SessionState(workout = w0, settings = WatchSettings(setMenu = true)), 1, 0, MarkKind.FAILURE, true, 5.0, "m1")
        val s2 = SessionCore.applySnapshot(s1, snap(w0))
        assertNull(s2.workout!!.entries[0].sets[0].failure)
        assertEquals(true, s2.workout!!.entries[1].sets[0].failure)
    }

    @Test fun aNewWorkoutDropsTheEdits() {
        val (s1, _) = SetMenu.mark(state(listOf(row(), row())), 0, 0, MarkKind.FAILURE, true, 5.0, "m1")
        assertTrue(SessionCore.applySnapshot(s1, snap(workout(listOf(row(), row()), id = "w2"))).edits.isEmpty())
        assertTrue(SessionCore.finish(s1, 9.0, "f1").first.edits.isEmpty())
    }

    @Test fun editsSurviveARelaunch() {
        val s1 = SetMenu.removeSet(state(abc), 0, 1, 5.0, "r1")!!
        val back = WireJson.decodeFromString<SessionState>(WireJson.encodeToString(s1))
        assertEquals(s1, back); assertEquals(listOf("r1"), SetMenu.held(back))
    }

    @Test fun aStateSavedWithoutEditsStillLoads() {
        assertTrue(WireJson.decodeFromString<SessionState>("""{"unit":"kg","entryIndex":1}""").edits.isEmpty())
    }

    /* ---------- the store's pointers, the pill, the Undo window ---------- */

    @Test fun remapSetOutOfRangeLeavesTheSet() {
        assertEquals(5, SetMenu.remapSet(5, listOf(0, null)))
        assertNull(SetMenu.remapSet(1, listOf(0, null)))
    }

    @Test fun refsFollowARemove() {
        val moved = SetMenu.apply(SetMenu.removeSet(state(abc), 0, 0, 5.0, "r1")!!.edits.last(), workout(abc))!!.second
        assertEquals(SetRef(0, 1), SetMenu.follow(SetRef(0, 2), 0, moved))
        assertNull(SetMenu.follow(SetRef(0, 0), 0, moved))
        assertEquals(SetRef(1, 2), SetMenu.follow(SetRef(1, 2), 0, moved))   // another exercise: untouched
        assertNull(SetMenu.follow(null, 0, moved))
    }

    @Test fun thePageStaysOnItsSetWhenAWarmupMovesRows() {
        // rows: warm-up, A, B. B becomes a warm-up and moves to row 1; A goes to row 2.
        val w0 = workout(listOf(row(warmup = true), SetRow(w = 60.0, r = 8.0), SetRow(w = 70.0, r = 8.0)))
        val (s1, _) = SetMenu.mark(SessionState(workout = w0, settings = WatchSettings(setMenu = true)), 0, 2, MarkKind.WARMUP, true, 5.0, "m1")
        val moved = SetMenu.apply(s1.edits.last(), w0)!!.second
        assertEquals(SetRef(0, 2), SetMenu.follow(SetRef(0, 1), 0, moved))   // A: still A
        assertEquals(SetRef(0, 1), SetMenu.follow(SetRef(0, 2), 0, moved))   // B: still B
        assertEquals(SetRef(0, 0), SetMenu.follow(SetRef(0, 0), 0, moved))
    }

    @Test fun pillDropsThePlaceOnlyWhenTheTagsDoNotFit() {
        assertTrue(PillFit.showPlace(0, 500f, 100f))
        assertTrue(PillFit.showPlace(2, 160f, 172f))
        assertFalse(PillFit.showPlace(2, 180f, 172f))
        assertTrue(PillFit.showPlace(2, 172f, 172f))
    }

    private fun held(id: String = "r1") = HeldRemoval(id, setNumber = 2, w = 60.0, r = 8.0, unit = "kg")

    @Test fun undoCancels() {
        val u = UndoWindow(); u.begin(held()); u.undo()
        assertNull(u.flush())
    }

    @Test fun flushReturnsItOnce() {
        val u = UndoWindow(); u.begin(held())
        assertEquals("r1", u.flush()?.id); assertNull(u.flush())
    }
}
