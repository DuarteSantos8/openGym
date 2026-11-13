package ch.duartesantos.opengym.wear

import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
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
        val back = WireJson.decodeFromString<SessionState>(
            WireJson.encodeToString(s.copy(edits = listOf(PendingEdit("i", "e", "mark", setIdx = 0, kind = "drop", on = true)))),
        )
        assertNotNull(back.edits.single().kind)
    }
}
