package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

/** #1535: the daily check-in before a workout started on the watch, case for case with WatchCore's DailyFormTests. */
class DailyFormTest {
    @Test fun asksOnlyWhenOnAndNotAnsweredOrAskedToday() {
        assertTrue(DailyForm.due(true, null, null, "2026-11-24"))
        assertTrue(DailyForm.due(true, "2026-11-23", "2026-11-23", "2026-11-24"))
        assertFalse("an older phone never says so", DailyForm.due(null, null, null, "2026-11-24"))
        assertFalse(DailyForm.due(false, null, null, "2026-11-24"))
        assertFalse("done on the phone counts", DailyForm.due(true, "2026-11-24", null, "2026-11-24"))
        assertFalse("never twice a day", DailyForm.due(true, null, "2026-11-24", "2026-11-24"))
    }

    @Test fun dayIsTheWatchesOwnDate() {
        // 2026-11-24 23:30 UTC is already the 25th in Zurich.
        val at = 1_795_563_000_000L
        assertEquals("2026-11-24", DailyForm.day(at, ZoneId.of("UTC")))
        assertEquals("2026-11-25", DailyForm.day(at, ZoneId.of("Europe/Zurich")))
        assertEquals("1970-01-01", DailyForm.day(0L, ZoneId.of("UTC")))
    }

    @Test fun eventCarriesOnlyTheAnswersGiven() {
        val ev = DailyForm.event(mapOf("sleep" to 2, "energy" to 9, "sore" to 4, "stress" to 3), 1000.0, "c1")
        assertNotNull(ev)
        assertEquals("dailyForm", ev!!["type"]!!.jsonPrimitive.content)
        assertEquals("c1", ev["id"]!!.jsonPrimitive.content)
        assertEquals(1000L, ev["at"]!!.jsonPrimitive.long)
        assertEquals(2, ev["sleep"]!!.jsonPrimitive.int)
        assertEquals(4, ev["sore"]!!.jsonPrimitive.int)
        assertNull("out of range is left out", ev["energy"])
        assertNull("the watch does not ask it", ev["stress"])
        assertNull(DailyForm.event(emptyMap(), 1.0, "x"))
        assertNull(DailyForm.event(mapOf("energy" to 0), 1.0, "x"))
    }
}
