package ch.duartesantos.opengym.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test

/** Every routine reaches the watch as a file; the snapshot names the file it goes with. */
class RoutinesFileTest {
    private fun session(id: String, folder: String? = null) = ReadySession(routineIds = listOf(id), name = id, folder = folder)
    private fun file(h: String, n: Int) = RoutinesFile(h, (0 until n).map { session("f$it", if (it > 1) "Legs" else null) })

    @Test fun theFileReadsAsThePhoneWritesIt() {
        val f = WireJson.decodeFromString(RoutinesFile.serializer(),
            """{"h":"abc.12","others":[{"routineIds":["r1"],"name":"Push","entries":[],"folder":"Legs"},{"routineIds":["r2"],"name":"Pull","entries":[]}]}""")
        assertEquals("abc.12", f.h)
        assertEquals(listOf("Legs", null), f.others.map { it.folder })
    }

    @Test fun theSnapshotNamesTheFile() {
        assertEquals("abc.12", Snapshot.parse("""{"v":1,"routinesHash":"abc.12"}""")?.routinesHash)
        assertNull(Snapshot.parse("""{"v":1}""")?.routinesHash)
    }

    @Test fun aFileThatMatchesTheHashReplacesTheShortList() {
        val ready = Ready(today = session("t"), others = listOf(session("s0")))
        val r = Plan.merged(ready, "h1", file("h1", 30))
        assertEquals(30, r?.others?.size)
        assertEquals(listOf("t"), r?.today?.routineIds)
    }

    @Test fun withoutAMatchingFileTheSnapshotsListStands() {
        val ready = Ready(others = listOf(session("s0"), session("s1")))
        assertEquals(ready, Plan.merged(ready, "h2", file("h1", 30)))  // a newer file is on its way
        assertEquals(ready, Plan.merged(ready, "h1", null))            // first launch
        assertEquals(ready, Plan.merged(ready, null, file("h1", 30)))  // an older phone
        assertNull(Plan.merged(null, "h1", file("h1", 3)))
    }

    @Test fun theHashIsKeptWithTheState() {
        val s = SessionCore.applySnapshot(SessionState(), Snapshot(routinesHash = "h1"))
        assertEquals("h1", s.routinesHash)
        assertNull(SessionCore.applySnapshot(s, Snapshot()).routinesHash)
    }

    @Test fun theReportNamesTheFileInUseAndHowManyRoutinesAreListed() {
        val ready = Ready(today = session("t"), others = listOf(session("s0")))
        assertEquals("h1" to 31, Plan.routinesReport(ready, "h1", file("h1", 30)))  // today's and the file's 30
        assertEquals("" to 2, Plan.routinesReport(ready, "h2", file("h1", 30)))      // the snapshot's own list
        assertEquals("" to 0, Plan.routinesReport(null, null, null))
    }

    @Test fun theStatusCarriesTheReport() {
        val e = CheckIn.event("1.4.6", 5, "id", "h1" to 31)
        assertEquals("h1", e["routinesHash"]?.jsonPrimitive?.content)
        assertEquals(31, e["routinesCount"]?.jsonPrimitive?.int)
        assertNull(CheckIn.event("1.4.6", 5, "id")["routinesHash"])
    }
}
