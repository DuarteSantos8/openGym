package ch.duartesantos.opengym.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #911: the rest screen says what to load for the next set. */
class NextSetNumbersTest {
    @Test fun weightAndReps() {
        val e = Entry("sq", "Squat", sets = listOf(SetRow(w = 62.5, r = 8.0)))
        assertEquals("62.5 kg × 8", nextSetNumbers(e, 0, "kg"))
        assertEquals("62.5 lb × 8", nextSetNumbers(e.copy(unit = "lb"), 0, "kg"))
    }

    @Test fun bodyweightTimedCardioAndSides() {
        val dip = Entry("dip", "Dip", bodyweight = true, sets = listOf(SetRow(w = 10.0, r = 6.0), SetRow(r = 12.0)))
        assertEquals("+10 kg × 6", nextSetNumbers(dip, 0, "kg"))
        assertEquals("× 12", nextSetNumbers(dip, 1, "kg"))
        assertEquals("45 s", nextSetNumbers(Entry("pl", "Plank", mode = "time", sets = listOf(SetRow(sec = 45.0))), 0, "kg"))
        assertNull(nextSetNumbers(Entry("run", "Run", mode = "cardio", sets = listOf(SetRow(w = 10.0))), 0, "kg"))
        val lunge = Entry("lu", "Lunge", sets = listOf(SetRow(w = 20.0, r = 8.0,
            sides = Sides(L = SideRow(w = 20.0, r = 8.0, done = true), R = SideRow(w = 22.0, r = 7.0)))))
        assertEquals("22 kg × 7", nextSetNumbers(lunge, 0, "kg"))
        assertNull(nextSetNumbers(lunge, 3, "kg"))
    }
}
