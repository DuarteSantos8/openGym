package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The 1.4.5 sync protocol on the watch's side (docs/WATCH_SYNC.md): the outbox keeps every event
 * until the phone applied it, and what the phone says it applied (`acked`) settles the watch's
 * own copy of the session. The Apple Watch's twin is OutboxTests.swift.
 */
class SyncProtocolTest {
    private val squat = Entry("sq", "Squat", sets = listOf(SetRow(w = 100.0, r = 5.0), SetRow(w = 100.0, r = 5.0)))
    private fun workout(id: String, vararg e: Entry) = ActiveWorkout(id = id, name = "Legs", unit = "kg", entries = e.toList())
    private fun ev(id: String) = buildJsonObject { put("id", id); put("type", "setDone") }

    /* ---------- the outbox ---------- */

    @Test fun eventsAreNumberedInOrderAndCarryTheirSeq() {
        var o = Outbox()
        val (o1, a) = OutboxCore.add(o, ev("a"))!!
        val (o2, b) = OutboxCore.add(o1, ev("b"))!!
        o = o2
        assertEquals(1L, a.seq)
        assertEquals(2L, b.seq)
        assertEquals(2L, WireJson.parseToJsonElement(b.json).jsonObject["seq"]!!.jsonPrimitive.content.toLong())
        // the same event twice is one entry
        assertEquals(2, OutboxCore.add(o, ev("b"))!!.first.items.size)
        // no id, no event
        assertNull(OutboxCore.add(o, buildJsonObject { put("type", "setDone") }))
    }

    @Test fun anEventStaysUntilThePhoneAppliedIt() {
        var o = Outbox()
        for (id in listOf("a", "b", "c")) o = OutboxCore.add(o, ev(id))!!.first
        // all unsent: all due, oldest first
        assertEquals(listOf("a", "b", "c"), OutboxCore.due(o, 1000).map { it.id })
        o = OutboxCore.sent(o, listOf("a", "b", "c"), 1000)
        assertTrue(OutboxCore.due(o, 1000 + OutboxCore.RESEND_MS - 1).isEmpty())
        // nothing heard of them: they go again
        assertEquals(3, OutboxCore.due(o, 1000 + OutboxCore.RESEND_MS).size)
        // stored on the phone: only rarely again, and never dropped before the phone applied them
        o = OutboxCore.delivered(o, listOf("a", "b"))
        assertEquals(listOf("c"), OutboxCore.due(o, 1000 + OutboxCore.RESEND_MS).map { it.id })
        assertEquals(listOf("a", "b", "c"), OutboxCore.due(o, 1000 + OutboxCore.REDELIVER_MS).map { it.id })
        // the snapshot says the phone applied a and b
        o = OutboxCore.ack(o, listOf("a", "b", "zz"))
        assertEquals(listOf("c"), o.items.map { it.id })
        assertEquals(1, OutboxCore.waiting(o))
    }

    @Test fun aReconnectSendsWhatIsNotDeliveredWhateverItsTime() {
        var o = Outbox()
        for (id in listOf("a", "b")) o = OutboxCore.add(o, ev(id))!!.first
        o = OutboxCore.sent(o, listOf("a", "b"), 1000)
        o = OutboxCore.delivered(o, listOf("a"))
        assertTrue(OutboxCore.due(o, 1001).isEmpty())
        assertEquals(listOf("b"), OutboxCore.onReconnect(o, 1001).map { it.id })
        assertEquals(listOf("a", "b"), OutboxCore.onReconnect(o, 1000 + OutboxCore.REDELIVER_MS).map { it.id })
    }

    @Test fun theOutboxSurvivesARestart() {
        var o = Outbox()
        o = OutboxCore.add(o, ev("a"))!!.first
        o = OutboxCore.sent(o, listOf("a"), 5)
        val back = WireJson.decodeFromString(Outbox.serializer(), WireJson.encodeToString(Outbox.serializer(), o))
        assertEquals(o, back)
        // and numbering carries on after it
        assertEquals(2L, OutboxCore.add(back, ev("b"))!!.second.seq)
    }

    @Test fun aClockThatWentBackDoesNotStrandAnEvent() {
        val o = OutboxCore.sent(OutboxCore.add(Outbox(), ev("a"))!!.first, listOf("a"), 10_000)
        assertEquals(1, OutboxCore.due(o, 5_000).size)
    }

    /* ---------- what `acked` settles ---------- */

    @Test fun aTickThePhoneAppliedIsThePhonesFromThenOn() {
        var s = SessionCore.applySnapshot(SessionState(), Snapshot(active = workout("w1", squat)))
        s = SessionCore.tick(s, 0, 0, null, 105.0, 5.0, null, 1000.0, "t1").first
        // the phone applied it, then unticked the set: the untick sticks here too
        s = SessionCore.applySnapshot(s, Snapshot(active = workout("w1", squat), acked = listOf("t1")))
        assertFalse(s.workout!!.entries[0].sets[0].done)
        assertTrue(s.pending.isEmpty())
    }

    @Test fun aTickThePhoneHasNotAppliedStaysWhateverTheSnapshot() {
        var s = SessionCore.applySnapshot(SessionState(), Snapshot(active = workout("w1", squat)))
        s = SessionCore.tick(s, 0, 1, null, 110.0, 3.0, null, 2000.0, "t2").first
        s = SessionCore.applySnapshot(s, Snapshot(active = workout("w1", squat), acked = listOf("something-else")))
        assertTrue(s.workout!!.entries[0].sets[1].done)
        assertEquals(110.0, s.workout!!.entries[0].sets[1].w!!, 0.0)
    }

    @Test fun aWorkoutStartedHereAndEndedOnThePhoneBeforeAnySnapshotShowedItEndsHereToo() {
        val ready = Ready(ReadySession(listOf("r"), "Legs", listOf(squat)))
        var s = SessionCore.applySnapshot(SessionState(), Snapshot(ready = ready))
        s = SessionCore.start(s, ready.today!!, "watch-1", 10.0, "start-1").first
        // the phone has not applied the start: the watch keeps its workout
        assertEquals("watch-1", SessionCore.applySnapshot(s, Snapshot(active = null)).workout?.id)
        // it applied it (and the workout ended there since): no zombie here
        val after = SessionCore.applySnapshot(s, Snapshot(active = null, acked = listOf("start-1")))
        assertNull(after.workout)
        assertNull(after.startedHere)
    }

    @Test fun oldSavedStateWithoutTheNewFieldsStillLoads() {
        val old = """{"workout":null,"pending":{"sq#0":{"w":1.0,"r":2.0,"at":3.0}},"startedHere":"watch-1"}"""
        val s = WireJson.decodeFromString(SessionState.serializer(), old)
        assertNull(s.startId)
        assertNull(s.pending["sq#0"]!!.id)
    }

    @Test fun theEventsCarryTheIdsThePendingTicksRemember() {
        val s0 = SessionCore.applySnapshot(SessionState(), Snapshot(active = workout("w1", squat)))
        val (s, e) = SessionCore.tick(s0, 0, 0, null, 100.0, 5.0, null, 1.0, "x")
        assertEquals("x", s.pending["sq#0"]!!.id)
        assertEquals(JsonPrimitive("x"), e!!["id"])
    }
}
