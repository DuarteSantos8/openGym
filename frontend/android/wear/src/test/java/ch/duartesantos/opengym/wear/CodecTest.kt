package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The contract with the phone (frontend/src/lib/watch-sync.wear.test.js reads the same files):
 * the snapshot the phone builds parses here, and the events built here are the ones the page
 * applies.
 */
class CodecTest {
    private fun resource(name: String) = javaClass.classLoader!!.getResource(name)!!.readText()

    @Test fun readsThePhonesSnapshot() {
        val snap = Snapshot.parse(resource("snapshot.json"))
        assertNotNull(snap)
        snap!!
        assertEquals("kg", snap.unit)
        val a = snap.active!!
        assertEquals("w-1", a.id)
        assertEquals("Push day", a.name)
        assertEquals(1761743000000.0, a.rest!!.endsAt, 0.0)
        assertEquals(1761742800000.0, a.start!!, 0.0)
        assertEquals(1761742950000.0, a.activeAt!!, 0.0)
        assertEquals(2, a.entries.size)
        val bench = a.entries[0]
        assertEquals("0025", bench.id)
        assertEquals("Barbell Bench Press", bench.name)
        assertEquals(120.0, bench.restSec!!, 0.0)
        assertTrue(bench.last!!.contains("55"))
        assertEquals(listOf(true, false), bench.sets.map { it.done })
        assertEquals(60.0, bench.sets[1].w!!, 0.0)
        // `sec: null` and `ready: null` in the JSON: the defaults
        assertNull(bench.sets[0].sec)
        assertNull(snap.ready)
        assertTrue(a.entries[1].sets[0].warmup)
        assertEquals("de", snap.settings!!.lang)
        assertEquals(1, snap.streak!!.weeks)
    }

    @Test fun ignoresWhatItDoesNotKnow() {
        val snap = Snapshot.parse("""{"v":2,"unit":"lb","future":{"x":1},"active":null,"ready":{"today":null,"others":[],"more":true}}""")
        assertEquals("lb", snap!!.unit)
        assertNull(snap.active)
        assertNull(Snapshot.parse("not json"))
    }

    @Test fun sendsTheEventsThePageApplies() {
        val snap = Snapshot.parse(resource("snapshot.json"))!!
        var s = SessionCore.applySnapshot(SessionState(), snap)
        val out = mutableListOf<Event>()
        SessionCore.tick(s, 0, 1, null, 62.5, 7.0, null, 1761743100000.0, "ev-1", 128 to 141).let { (n, e) -> s = n; out += e!! }
        SessionCore.tick(s, 1, 1, null, 30.0, 10.0, null, 1761743200000.0, "ev-2").let { (n, e) -> s = n; out += e!! }
        SessionCore.finish(s, 1761743300000.0, "ev-3").let { (n, e) -> s = n; out += e!! }
        val push = ReadySession(listOf("r-push"), "Push day", snap.active!!.entries)
        SessionCore.start(s, push, "watch-test", 1761743400000.0, "ev-4").let { (n, e) -> s = n; out += e }
        val expected = WireJson.parseToJsonElement(resource("events.json"))
        assertEquals(norm(expected), norm(JsonArray(out)))
    }

    /** Numbers compared as numbers (7 and 7.0 are the same to the page). */
    private fun norm(e: JsonElement): Any? = when (e) {
        is JsonObject -> e.mapValues { norm(it.value) }
        is JsonArray -> e.map { norm(it) }
        is JsonPrimitive -> if (e.isString) e.content else e.booleanOrNull ?: e.doubleOrNull
    }
}
