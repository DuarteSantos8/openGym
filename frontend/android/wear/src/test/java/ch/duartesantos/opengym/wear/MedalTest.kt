package ch.duartesantos.opengym.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** The summary's medal (#1309), case for case from the Apple Watch's MedalTests.swift: the records it lists with their old and new bests, the notches and diamonds on its face, its entrance haptics, its size and the crown's stops. */
class MedalTest {
    private fun row(w: Double?, r: Double?, sec: Double? = null) = SetRow(w = w, r = r, sec = sec)

    private fun entry(id: String, name: String, mode: String = "reps", best: BestSet, sets: List<SetRow>) =
        Entry(id = id, name = name, mode = mode, sets = sets, best = best)

    @Test fun eachRecordCarriesTheBestItBeat() {
        val heavier = entry("b", "Bench", best = BestSet(100.0, 5.0), sets = listOf(row(102.5, 3.0), row(105.0, 2.0), row(100.0, 6.0)))
        val moreReps = entry("r", "Row", best = BestSet(70.0, 8.0), sets = listOf(row(70.0, 9.0), row(70.0, 10.0), row(60.0, 15.0)))
        val assisted = entry("d", "Assisted dip", best = BestSet(25.0, 8.0), sets = listOf(row(20.0, 8.0), row(15.0, 6.0))).copy(assisted = true)
        val hold = entry("p", "Plank", mode = "time", best = BestSet(sec = 60.0), sets = listOf(row(null, null, 75.0), row(null, null, 70.0)))
        val pounds = entry("c", "Curl", best = BestSet(30.0, 10.0), sets = listOf(row(35.0, 8.0))).copy(unit = "lb")
        val none = entry("n", "Squat", best = BestSet(140.0, 5.0), sets = listOf(row(140.0, 5.0)))
        var s = SessionCore.applySnapshot(SessionState(), Snapshot(v = 1, unit = "kg", restSec = 90.0, active = ActiveWorkout(
            id = "w", name = "Push", unit = "kg", cur = 0, restSec = 90.0, entries = listOf(heavier, moreReps, assisted, hold, pounds, none), start = 0.0)))
        for ((ei, e) in s.workout!!.entries.withIndex()) {
            for ((si, r) in e.sets.withIndex()) s = SessionCore.tick(s, ei, si, null, r.w, r.r, r.sec, 1.0, "$ei$si").first
        }
        val sum = SessionCore.summary(s.workout!!, 52 * 60_000.0)
        assertEquals("the heaviest past the best, else the most reps at it; the lightest when assisted; the exercise's own unit", listOf(
            RecordLine("Bench", RecordLine.Kind.weight, 100.0, 105.0, "kg"),
            RecordLine("Row", RecordLine.Kind.reps, 8.0, 10.0, "kg"),
            RecordLine("Assisted dip", RecordLine.Kind.weight, 25.0, 15.0, "kg"),
            RecordLine("Plank", RecordLine.Kind.hold, 60.0, 75.0, "kg"),
            RecordLine("Curl", RecordLine.Kind.weight, 30.0, 35.0, "lb"),
        ), sum.records)
        assertEquals("one record line per name, in the same order", sum.records.map { it.name }, sum.prs)
        assertEquals(52 * 60_000.0, sum.endedAt!!, 0.0)
    }

    @Test fun recordTexts() {
        val de = Locale.GERMANY
        assertEquals("60" to "62,5", RecordLine("B", RecordLine.Kind.weight, 60.0, 62.5, "kg").texts(de))
        assertEquals("0:45" to "1:15", RecordLine("P", RecordLine.Kind.hold, 45.0, 75.0, "kg").texts(de))
        assertEquals("1.23", Medal.number(1.234, Locale.US))
    }

    @Test fun aSummaryFromAnOlderBuildStillReads() {
        val old = """{"name":"Push","unit":"kg","duration":3120,"sets":16,"volume":5180,"prs":["Bench"],"hrAvg":128,"endedOnPhone":false}"""
        val s = WireJson.decodeFromString(WorkoutSummary.serializer(), old)
        assertEquals(emptyList<RecordLine>(), s.records)
        assertNull(s.endedAt)
        assertNull(s.kcal)
        assertEquals(listOf("Bench"), s.prs)
        val now = s.copy(records = listOf(RecordLine("Bench", RecordLine.Kind.weight, 100.0, 105.0, "kg")), endedAt = 1.0)
        assertEquals(now, WireJson.decodeFromString(WorkoutSummary.serializer(), WireJson.encodeToString(WorkoutSummary.serializer(), now)))
    }

    @Test fun oneNotchPerSetUpTo48() {
        val a = Medal.notchAngles(16)
        assertEquals(16, a.size)
        assertEquals("the first at 12 o'clock", -90.0, a.first(), 0.0)
        assertEquals(22.5, a[1] - a[0], 0.0)
        assertEquals(emptyList<Double>(), Medal.notchAngles(0))
        assertEquals(emptyList<Double>(), Medal.notchAngles(-3))
        assertEquals(48, Medal.notchAngles(120).size)
    }

    @Test fun diamondsSitUnderTheTime() {
        val two = Medal.gems(2)
        assertEquals(listOf(76.5, 103.5), two.first)
        assertEquals(8.6, two.second, 0.0)
        assertEquals("one diamond straight under the time", listOf(90.0), Medal.gems(1).first)
        val six = Medal.gems(6)
        assertEquals(7.0, six.second, 0.0)
        assertEquals(21.0, six.first[1] - six.first[0], 0.0)
        assertEquals(7, Medal.gems(12).first.size)
        assertEquals(emptyList<Double>(), Medal.gems(0).first)
    }

    @Test fun theTimeOnTheFace() {
        assertEquals("52" to false, Medal.time(52 * 60.0 + 13))
        assertEquals("1:05" to true, Medal.time(65 * 60.0))
        assertEquals("59:40 rounds to the hour", "1:00" to true, Medal.time(59 * 60.0 + 40))
        assertEquals("0" to false, Medal.time(Double.NaN))
        assertEquals("1:15", Medal.clock(75.0))
    }

    @Test fun onlyLettersThatStandAloneGoRoundTheRim() {
        for (s in listOf("Push day", "Upper body: push, pull & core 💪", "Oberkörper Ü", "Тяга", "Ngày đẩy", "胸の日", "가슴 날")) assertTrue(s, Medal.arcable(s))
        for (s in listOf("يوم الصدر", "פוש", "पुश डे", "วันอก")) assertFalse(s, Medal.arcable(s))
        // A letter with its accent as a separate mark would split on the rim: the whole name goes straight.
        assertFalse(Medal.arcable("Cafe\u0301")); assertTrue(Medal.arcable("Café"))
    }

    @Test fun theEntranceHaptics() {
        val plain = Medal.beats(0)
        assertEquals(listOf(Medal.Beat.STRIKE, Medal.Beat.SETTLED), plain.map { it.second })
        assertEquals(listOf(0.3, 1.15), plain.map { it.first })
        for (n in 1..9) {
            val b = Medal.beats(n)
            assertEquals(Medal.Beat.STRIKE, b.first().second)
            assertEquals("4 taps at most", 1 + minOf(n, 3), b.size)
            for ((x, y) in b.zipWithNext()) assertTrue(y.first - x.first >= 0.35 - 1e-9)
        }
        assertEquals(7, Medal.gemTimes(9).size)
        assertTrue(Medal.entranceEnds(2) > Medal.gemTimes(7).last() + 0.5)
    }

    @Test fun theMedalSizePerWatch() {
        assertEquals("40 mm class, 192 dp", 149.76, Medal.diameter(192.0, 192.0), 0.01)
        assertEquals("227 dp", 177.06, Medal.diameter(227.0, 227.0), 0.01)
        assertEquals("never wider than the screen less its margins", 76.0, Medal.diameter(100.0, 251.0), 0.0)
    }

    @Test fun theCrownStops() {
        assertEquals(0, Medal.endStops(0.0))
        assertEquals(2, Medal.endStops(87.0))
        assertEquals(0.0, Medal.scroll(1.5, 87.0), 0.0)
        assertEquals(43.5, Medal.scroll(3.0, 87.0), 0.0)
        assertEquals(87.0, Medal.scroll(4.0, 87.0), 0.0)
        assertEquals(87.0, Medal.scroll(9.0, 87.0), 0.0)
        assertEquals(0.0, Medal.scroll(3.0, 0.0), 0.0)
        assertEquals(listOf(0, 0, 1, 1, 2, 2), listOf(0.0, 0.4, 0.6, 1.4, 1.6, 3.0).map { Medal.mark(it) })
        assertEquals(listOf(1.0, 1.0, 2.0, 2.0, 0.0, 0.0), listOf(0.0, 0.3, 1.0, 1.5, 2.0, 3.5).map { Medal.nextStop(it) })
    }
}
