package ch.duartesantos.opengym.wear

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same JSON files frontend/src/lib/wear-bridge.test.js pins, read from the other side. The
 * snapshot is what the phone produced (JS checks it is still what it produces); the session is
 * what this side produces from it (JS checks it reads it back into a workout). If either side
 * changes the format without the other, one of the two suites fails.
 */
class ContractTest {
    private fun resource(name: String): String =
        ContractTest::class.java.classLoader!!.getResource(name)!!.readText()

    private val snapshotJson = resource("snapshot-v1.json")
    private val snapshot = Wire.parseSnapshot(snapshotJson)!!

    @Test fun readsTheSnapshotThePhoneProduces() {
        assertEquals("push", snapshot.routineId)
        assertEquals("kg", snapshot.unit)
        assertEquals(listOf("Exercise 3666"), snapshot.skipped)
        assertEquals(4, snapshot.exercises.size)

        val bench = snapshot.exercises[0]
        assertEquals(1.25, bench.step, 0.0)
        assertEquals(listOf(true, false, false), bench.sets.map { it.warmup })
        assertEquals(30.0, bench.sets[0].w, 0.0)
        assertEquals(120, bench.sets[1].rest)

        val drop = snapshot.exercises[1].sets.single()
        assertEquals("dropset", drop.type)
        assertEquals(listOf(Drop(32.5, 8), Drop(25.0, 8)), drop.drops)

        // Rest-pause is planned as a warm-up and then the one rest-pause set (docs/dev/SET_TYPES.md).
        val rpSets = snapshot.exercises[2].sets
        assertEquals(listOf(true, false), rpSets.map { it.warmup })
        val rp = rpSets.last()
        assertEquals("restpause", rp.type)
        assertEquals(12, rp.r)
        assertEquals(listOf(6, 3, 2, 1), rp.clusters.map { it.r })

        val plank = snapshot.exercises[3]
        assertTrue(plank.timed)
        assertEquals(40, plank.sets.single().sec)
        assertEquals(5.0, plank.step, 0.0)
    }

    /** The workout the fixture's session stands for, played through the engine like a person would. */
    private fun play(): Session {
        var s = Engine.begin(snapshot, 1_750_000_000_000, "aaaaaaaa-0000-4000-8000-000000000001")
        var clock = 1_750_000_060_000
        fun tap(w: Double, r: Int, sec: Int = 0) { s = Engine.confirm(snapshot, s, StepValue(w, r, sec), clock); clock += 60_000 }
        tap(30.0, 5)                    // bench warm-up
        tap(60.0, 5)
        tap(60.0, 4)                    // missed a rep
        tap(40.0, 8); tap(32.5, 8); tap(25.0, 6)   // drop set
        tap(30.0, 10)                   // its warm-up
        tap(30.0, 6); tap(30.0, 3); tap(30.0, 2)   // rest-pause: 6 + 3 + 2, then no more
        s = Engine.stopHere(snapshot, s, clock); clock += 60_000
        tap(0.0, 0, 35)                 // plank, 5 s short
        return s
    }

    @Test fun theWorkoutEndsAfterTheLastSet() {
        assertTrue(play().finished)
    }

    @Test fun theSessionItSendsIsTheOneJsReadsBack() {
        val payload = Wire.sessionPayload(snapshot, play(), 1_750_000_900_000)
        val expected = JSONObject(resource("session-v1.json"))
        if (!payload.similar(expected)) {
            // Shown whole so a mismatch can be read, and regenerated on purpose by copying it over the fixture.
            File(System.getProperty("java.io.tmpdir"), "session-v1.actual.json").writeText(payload.toString(2))
        }
        assertEquals(expected.toString(2), payload.toString(2))
    }

    @Test fun echoesTheExercisesContextUntouched() {
        val payload = Wire.sessionPayload(snapshot, play(), 1_750_000_900_000)
        val sent = payload.getJSONArray("exercises")
        val original = JSONObject(snapshotJson).getJSONArray("exercises")
        for (i in 0 until sent.length()) {
            assertTrue(original.getJSONObject(i).getJSONObject("ctx").similar(sent.getJSONObject(i).getJSONObject("ctx")))
        }
    }

    @Test fun aSetNeverLoggedGoesBackAsPlannedAndNotDone() {
        var s = Engine.begin(snapshot, 1_750_000_000_000, "x")
        s = Engine.confirm(snapshot, s, StepValue(30.0, 5, 0), 1_750_000_050_000)
        val sets = Wire.sessionPayload(snapshot, s, 1_750_000_100_000).getJSONArray("exercises").getJSONObject(0).getJSONArray("sets")
        assertTrue(sets.getJSONObject(0).getBoolean("done"))
        assertEquals(1_750_000_050_000, sets.getJSONObject(0).getLong("at"))
        val untouched = sets.getJSONObject(1)
        assertEquals(false, untouched.getBoolean("done"))
        assertEquals(60.0, untouched.getDouble("w"), 0.0)
        assertTrue(!untouched.has("at"))
    }

    @Test fun aSavedWorkoutComesBackAsItWas() {
        val s = Engine.confirm(snapshot, Engine.begin(snapshot, 5, "id"), StepValue(30.0, 5, 0), 9)
        val workout = ActiveWorkout(snapshotJson, snapshot, s)
        val back = Wire.activeFromJson(Wire.activeToJson(workout))!!
        assertEquals(s, back.session)
        assertEquals(snapshot, back.snapshot)
    }

    @Test fun aSavedRestPauseInProgressComesBackAsItWas() {
        var s = Engine.begin(snapshot, 5, "id")
        // Straight to the rest-pause exercise.
        repeat(3) { s = Engine.skip(snapshot, s, 6) }
        s = Engine.confirm(snapshot, s, StepValue(40.0, 8, 0), 7)
        s = Engine.confirm(snapshot, s, StepValue(32.5, 8, 0), 8)
        // In the middle of a drop set, with a step logged.
        assertEquals(1, s.ex)
        assertEquals(listOf(40.0, 32.5), s.partial.map { it.w })
        assertEquals(s, Wire.sessionFromJson(Wire.sessionToJson(s)))
        s = Engine.confirm(snapshot, s, StepValue(25.0, 8, 0), 9)
        s = Engine.skip(snapshot, s, 10)   // the rest-pause exercise's warm-up
        s = Engine.confirm(snapshot, s, StepValue(30.0, 6, 0), 11)
        assertTrue(s.partial.isNotEmpty())
        assertEquals(s, Wire.sessionFromJson(Wire.sessionToJson(s)))
    }

    @Test fun refusesWhatItDoesNotKnow() {
        assertNull(Wire.parseSnapshot("""{"v":2,"kind":"snapshot","routineId":"x"}"""))
        assertNull(Wire.parseSnapshot("not json"))
        assertNull(Wire.parseSnapshot("""{"v":1,"kind":"index"}"""))
        assertNull(Wire.parseIndex("""{"v":1,"kind":"snapshot"}"""))
        assertNull(Wire.activeFromJson("{"))
    }

    @Test fun readsTheIndexAndTheMissingAnswer() {
        val index = Wire.parseIndex("""{"v":1,"kind":"index","unit":"lb","ts":3,"routines":[{"id":"a","name":"A","exercises":4},{"name":"no id"}]}""")
        assertNotNull(index)
        assertEquals("lb", index!!.unit)
        assertEquals(listOf(RoutineRef("a", "A", 4)), index.routines)
        assertEquals("gone", Wire.missingRoutine("""{"v":1,"kind":"missing","routineId":"gone","ts":1}"""))
        assertNull(Wire.missingRoutine(snapshotJson))
    }
}
