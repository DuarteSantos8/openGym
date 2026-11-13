package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Protocol 2 on Wear OS (docs/WATCH_SYNC.md, the sync engineer's "For the native sides: Wear OS"):
 * the clock offset, snapshot order, one rest by its stamp, set ids, and the fields the events carry.
 */
class Protocol2Test {
    private fun wk(id: String = "w1", vararg e: Entry, rest: RestInfo? = null, restAt: Double? = null, paused: Boolean? = null, left: Double? = null) =
        ActiveWorkout(id = id, name = "Push", entries = e.toList(), rest = rest, restAt = restAt, restPaused = paused, restLeft = left)

    private fun ex(id: String, vararg sets: SetRow) = Entry(id, id, sets = sets.toList())

    /* ---------- rule 1: the clock offset ---------- */

    @Test fun theOffsetIsTheSmallestRecentGapAndOnlyFromMessages() {
        var c = ClockSamples()
        assertEquals("nothing heard yet", 0L, ClockOffset.off(c, 1_000_000))
        // a watch 3 s ahead: messages arrive 40, 900 and 15 ms after they were made
        c = ClockOffset.add(c, 1_003_040, 1_000_000.0)
        c = ClockOffset.add(c, 1_013_900, 1_010_000.0)
        c = ClockOffset.add(c, 1_023_015, 1_020_000.0)
        assertEquals(3_015L, ClockOffset.off(c, 1_024_000))
        // the good sample gets old: past five minutes only newer ones count
        c = ClockOffset.add(c, 1_400_200, 1_397_000.0)
        assertEquals("the newest alone", 3_200L, ClockOffset.off(c, 1_400_200 + ClockOffset.RECENT_MS - 1))
        assertEquals("all old: still the newest", 3_200L, ClockOffset.off(c, 1_400_200 + 10 * ClockOffset.RECENT_MS))
        // behind as well as ahead
        val behind = ClockOffset.add(ClockSamples(), 1_000_000 - 90_000 + 30, 1_000_000.0)
        assertEquals(-89_970L, ClockOffset.off(behind, 910_100))
    }

    @Test fun theOffsetKeepsEightAndIgnoresAClockThatIsWrong() {
        var c = ClockSamples()
        for (i in 0 until 12) c = ClockOffset.add(c, 10_000L + i * 1000 + i, 10_000.0 + i * 1000)
        assertEquals(ClockOffset.KEEP, c.gap.size)
        assertEquals("the four oldest went", 4L, c.gap.first())
        val wrong = ClockOffset.add(c, 100_000_000_000L, 10_000.0)
        assertEquals("13 h off: not an offset", c, wrong)
        assertEquals("no `now` (an older phone)", c, ClockOffset.add(c, 5, null))
    }

    /* ---------- the snapshot's order: message and item ---------- */

    @Test fun anOlderSnapshotFromTheSamePhoneIsSkipped() {
        var last = emptyMap<String, Long>()
        assertTrue(SnapshotOrder.newer(last, "phone", 10))
        last = SnapshotOrder.note(last, "phone", 10)
        assertFalse("the same stamp again (the item after the message)", SnapshotOrder.newer(last, "phone", 10))
        assertFalse("a late item", SnapshotOrder.newer(last, "phone", 9))
        assertTrue(SnapshotOrder.newer(last, "phone", 11))
        assertTrue("another phone has its own stamps", SnapshotOrder.newer(last, "other", 1))
        assertTrue("no stamp (the rig, an old phone): applied", SnapshotOrder.newer(last, null, null))
        for (i in 0 until 6) last = SnapshotOrder.note(last, "p$i", 100L + i)
        assertEquals("a few phones remembered", 4, last.size)
    }

    @Test fun theMessageFormIsTheStampThenTheJson() {
        assertEquals(42L to "{\"v\":2}", SnapshotMessage.decode("42\n{\"v\":2}".toByteArray()))
        assertNull(SnapshotMessage.decode("{\"v\":2}".toByteArray()))
        assertNull(SnapshotMessage.decode("x\n{}".toByteArray()))
        assertNull(SnapshotMessage.decode("5\nnot json".toByteArray()))
    }

    /* ---------- rule 3: following the phone's rest ---------- */

    @Test fun theRestIsFollowedOnlyWhenThePhoneChangedItLater() {
        val a = wk(rest = RestInfo(100_000.0, 90.0), restAt = 10_000.0)
        assertTrue("no restAt: the old rules", RestFollow.of(a.copy(restAt = null), 0.0, 0, null) is RestFollow.Legacy)
        assertTrue("the same stamp: ignored", RestFollow.of(a, 10_000.0, 0, null) is RestFollow.Ignore)
        assertTrue("an older one: ignored (opening the phone never restarts the watch's rest)", RestFollow.of(a, 12_000.0, 0, 95_000) is RestFollow.Ignore)
        val run = RestFollow.of(a, 9_000.0, 2_000, null) as RestFollow.Run
        assertEquals("on the watch's clock", 102_000L, run.endsAt)
        assertEquals(90, run.total)
        assertTrue(run.restart)
        assertEquals(10_000.0, run.restAt, 0.0)
        val same = RestFollow.of(a, 9_000.0, 2_000, 102_200) as RestFollow.Run
        assertFalse("within 250 ms: the countdown is not restarted", same.restart)
        assertTrue((RestFollow.of(a, 9_000.0, 2_000, 102_300) as RestFollow.Run).restart)
        assertTrue("a pause here, a run there: it runs again", (RestFollow.of(a, 9_000.0, 2_000, 102_000, ownPausedLeft = 30_000) as RestFollow.Run).restart)
    }

    @Test fun aPauseHoldsAndASkipEnds() {
        val paused = RestFollow.of(wk(paused = true, left = 42.0, restAt = 20.0), 10.0, 0, 5_000) as RestFollow.Pause
        assertEquals(42_000L, paused.leftMs)
        assertEquals(20.0, paused.restAt, 0.0)
        // #1149: skipped on the phone (newer stamp, no rest, no pause): the watch's rest ends
        val end = RestFollow.of(wk(restAt = 20.0), 10.0, 0, 5_000)
        assertTrue(end is RestFollow.End)
        assertTrue("a skip older than the watch's own +15: ignored", RestFollow.of(wk(restAt = 20.0), 25.0, 0, 5_000) is RestFollow.Ignore)
    }

    /* ---------- rule 4: the watch's own changes ---------- */

    @Test fun aTickCarriesItsSetsIdAndTheRestItStarts() {
        val s0 = SessionCore.applySnapshot(SessionState(), Snapshot(active = wk("w1", ex("sq", SetRow(w = 100.0, r = 5.0, sid = "a1"), SetRow(w = 100.0, r = 5.0, sid = "a2")))))
        val (s1, ev) = SessionCore.tick(s0, 0, 0, null, 100.0, 5.0, null, 1_000.0, "t1", restEnd = 91_000)
        assertEquals("a1", (ev!!["sid"] as JsonPrimitive).content)
        assertEquals(91_000L, (ev["restEnd"] as JsonPrimitive).long)
        assertNotNull("pending by the set's id", s1.pending["s:a1"])
        val (_, fix) = SessionCore.tick(s1, 0, 0, null, 102.5, 5.0, null, 2_000.0, "t2")
        assertFalse("a correction starts no rest", fix!!.containsKey("restEnd"))
        // a phone without set ids: by the set's place
        val old = SessionCore.applySnapshot(SessionState(), Snapshot(active = wk("w1", ex("sq", SetRow(w = 100.0, r = 5.0)))))
        val (s2, ev2) = SessionCore.tick(old, 0, 0, null, 100.0, 5.0, null, 1.0, "t3")
        assertFalse(ev2!!.containsKey("sid"))
        assertNotNull(s2.pending["n0:sq#0"])
    }

    @Test fun aCorrectionIsLaterThanTheSetOnTheWatchsClock() {
        // the phone stamped the set 50_000 on its clock; this watch runs 4 s ahead and its own clock says 52_000
        val s = SessionCore.applySnapshot(SessionState(), Snapshot(active = wk("w1", ex("sq", SetRow(w = 100.0, r = 5.0, done = true, at = 50_000.0, sid = "a1")))))
        val (_, ev) = SetFix.correct(s, 0, 0, null, SetFix.Numbers(w = 105.0, r = 5.0), now = 52_000.0, id = "c", off = 4_000)
        assertEquals("phone's at + off + 1", 54_001L, (ev!!["at"] as JsonPrimitive).long)
        assertFalse(ev.containsKey("restEnd"))
    }

    @Test fun theRestEventSaysSkipWithAnExplicitNull() {
        val skip = RestEvents.rest("w1", null, 5_000, "r1")
        assertEquals("rest", (skip["type"] as JsonPrimitive).content)
        assertEquals(JsonNull, skip["endsAt"])
        assertEquals(5_000L, (skip["at"] as JsonPrimitive).long)
        assertEquals(65_000L, (RestEvents.rest("w1", 65_000, 5_000, "r2")["endsAt"] as JsonPrimitive).long)
        val withOff = RestEvents.withOff(skip, -1_500)
        assertEquals(-1_500L, (withOff["off"] as JsonPrimitive).long)
        assertEquals("an event keeps the offset it was made with", withOff, RestEvents.withOff(withOff, 99))
        assertEquals("the watch's newest on the phone's clock", 3_500.0, RestEvents.stamp(5_000, 1_500), 0.0)
    }

    @Test fun setHrNamesTheSet() {
        val e = SessionCore.setHrEvent("w1", "sq", 0, 1, "h", restHr = 120 to 140, sid = "a2")
        assertEquals("a2", (e["sid"] as JsonPrimitive).content)
        assertFalse(SessionCore.setHrEvent("w1", "sq", 0, 1, "h", hr = 1 to 2).containsKey("sid"))
    }

    /* ---------- rule 5: set identity ---------- */

    @Test fun thePhonesShowingOfATickCountsOnTheWatchsClock() {
        // the watch is 3 s behind the phone (off −3000): its tick at 10_000 is 13_000 on the phone
        val s0 = SessionCore.applySnapshot(SessionState(), Snapshot(active = wk("w1", ex("sq", SetRow(w = 100.0, r = 5.0, sid = "a1")))))
        val s1 = SessionCore.tick(s0, 0, 0, null, 100.0, 5.0, null, 10_000.0, "t1").first
        val shown = Snapshot(active = wk("w1", ex("sq", SetRow(w = 100.0, r = 5.0, done = true, at = 13_000.0, sid = "a1"))))
        assertTrue("shown at its time: the phone's from now on", SessionCore.applySnapshot(s1, shown, off = -3_000).pending.isEmpty())
        // the same snapshot read by a watch 5 s ahead: the phone's 13_000 is the watch's 18_000, later than the tick
        assertTrue(SessionCore.applySnapshot(s1, shown, off = 5_000).pending.isEmpty())
        // a phone stamp before the tick (an older change there): the watch's tick still stands
        val older = Snapshot(active = wk("w1", ex("sq", SetRow(w = 90.0, r = 5.0, done = true, at = 12_000.0, sid = "a1"))))
        val kept = SessionCore.applySnapshot(s1, older, off = -3_000)
        assertNotNull(kept.pending["s:a1"])
        assertEquals(100.0, kept.workout!!.entries[0].sets[0].w!!, 0.0)
    }

    @Test fun theSameExerciseTwiceNoLongerSharesATick() {
        // #1162 case 3: bench, rows, bench again. A tick on the second bench shows there only.
        val snap = Snapshot(active = wk("w1", ex("bp", SetRow(w = 60.0, r = 8.0)), ex("row", SetRow(w = 50.0, r = 8.0)), ex("bp", SetRow(w = 50.0, r = 10.0))))
        var s = SessionCore.applySnapshot(SessionState(), snap)
        s = SessionCore.tick(s, 2, 0, null, 50.0, 10.0, null, 1_000.0, "t").first
        s = SessionCore.applySnapshot(s, snap)
        assertFalse("the first bench is not done", s.workout!!.entries[0].sets[0].done)
        assertTrue(s.workout!!.entries[2].sets[0].done)
        // with set ids too, and wherever the phone moves the row
        val ids = Snapshot(active = wk("w1", ex("bp", SetRow(w = 60.0, r = 8.0, sid = "x")), ex("bp", SetRow(w = 50.0, r = 10.0, sid = "y"))))
        var t = SessionCore.applySnapshot(SessionState(), ids)
        t = SessionCore.tick(t, 1, 0, null, 50.0, 10.0, null, 1_000.0, "t").first
        val moved = Snapshot(active = wk("w1", ex("bp", SetRow(w = 50.0, r = 10.0, sid = "y")), ex("bp", SetRow(w = 60.0, r = 8.0, sid = "x"))))
        t = SessionCore.applySnapshot(t, moved)
        assertTrue("the set with id y, now first", t.workout!!.entries[0].sets[0].done)
        assertFalse(t.workout!!.entries[1].sets[0].done)
    }

    @Test fun aSkipOnTheSecondCopyLeavesTheFirstAlone() {
        val snap = Snapshot(active = wk("w1", ex("bp", SetRow(w = 60.0, r = 8.0)), ex("bp", SetRow(w = 50.0, r = 10.0))))
        val s = SessionCore.skip(SessionCore.applySnapshot(SessionState(), snap), 1, 0)
        assertTrue(SessionCore.isSkipped(s, 1, 0))
        assertFalse(SessionCore.isSkipped(s, 0, 0))
        assertEquals(0, SessionCore.setIndex(s, 0))
        assertNull(SessionCore.setIndex(s, 1))
    }

    @Test fun aTickSavedByTheOldVersionStillCounts() {
        // a watch updated mid-workout: its pending tick is under the 1.4.4 key "exId#set"
        val snap = Snapshot(active = wk("w1", ex("sq", SetRow(w = 100.0, r = 5.0, sid = "a1"))))
        val s0 = SessionCore.applySnapshot(SessionState(), snap)
        val s = s0.copy(pending = mapOf("sq#0" to PendingTick(105.0, 5.0, 1_000.0, id = "old")))
        val after = SessionCore.applySnapshot(s, snap)
        assertTrue(after.workout!!.entries[0].sets[0].done)
        assertEquals(105.0, after.workout!!.entries[0].sets[0].w!!, 0.0)
    }

    @Test fun phoneTicksCarryTheSetsId() {
        val before = wk("w1", ex("sq", SetRow(w = 100.0, r = 5.0, sid = "a1")))
        val after = wk("w1", ex("sq", SetRow(w = 100.0, r = 5.0, done = true, at = 5.0, sid = "a1")))
        assertEquals("a1", SessionCore.phoneTicks(before, after).single().sid)
    }

    /* ---------- protocol 1 left as it was, with the wider margin ---------- */

    @Test fun aPhoneRestThatRanOutIsNotTakenForASkip() {
        // #1165 review: a watch clock 2 s behind the phone's sees the phone's rest go 2 s "early"
        assertFalse(RestMath.phoneSkipped(lastPhoneEnd = 12_000.0, phoneEnd = null, paused = false, now = 10_000))
        assertTrue(RestMath.phoneSkipped(lastPhoneEnd = 40_000.0, phoneEnd = null, paused = false, now = 10_000))
        assertFalse(RestMath.phoneSkipped(lastPhoneEnd = 40_000.0, phoneEnd = null, paused = true, now = 10_000))
    }

    @Test fun theNewFieldsAreRead() {
        val s = Snapshot.parse("""{"v":2,"now":123,"active":{"id":"w","restAt":55,"restPaused":true,"restLeft":30,"rest":{"endsAt":9,"total":60},
            "entries":[{"id":"sq","sets":[{"w":1,"sid":"k"}]}]}}""")!!
        assertEquals(123.0, s.now!!, 0.0)
        assertEquals(55.0, s.active!!.restAt!!, 0.0)
        assertEquals(30.0, s.active!!.restLeft!!, 0.0)
        assertEquals(60.0, s.active!!.rest!!.total!!, 0.0)
        assertEquals("k", s.active!!.entries[0].sets[0].sid)
        // a protocol 1 snapshot still reads
        assertNull(Snapshot.parse("""{"active":{"id":"w","rest":{"endsAt":9},"entries":[]}}""")!!.active!!.restAt)
    }
}
