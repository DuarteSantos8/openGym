package ch.duartesantos.opengym.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineTest {
    private val t0 = 1_000_000L

    private fun straight(w: Double = 60.0, r: Int = 5, rest: Int = 90, warmup: Boolean = false) =
        PlannedSet(w, r, 0, false, warmup, null, "straight", false, false, rest, emptyList(), emptyList())

    private fun dropset(w: Double = 40.0, r: Int = 8, drops: List<Drop>, rest: Int = 60) =
        PlannedSet(w, r, 0, false, false, null, "dropset", false, false, rest, drops, emptyList())

    private fun restPause(w: Double = 30.0, clusters: List<Cluster>, rest: Int = 90) =
        PlannedSet(w, clusters.sumOf { it.r }, 0, false, false, null, "restpause", false, false, rest, emptyList(), clusters)

    private fun timed(sec: Int = 40, rest: Int = 45) =
        PlannedSet(0.0, 0, sec, true, false, null, "straight", false, false, rest, emptyList(), emptyList())

    private fun exercise(name: String, vararg sets: PlannedSet, timed: Boolean = false) =
        Exercise(name, name, timed, false, 2.5, "{}", sets.toList())

    private fun snapshot(vararg ex: Exercise) = Snapshot("r", "Routine", "kg", 0, emptyList(), ex.toList())

    private fun value(s: Session, snap: Snapshot) = Engine.planned(snap, s)

    @Test fun beginsOnTheFirstSetOfTheFirstExerciseThatHasSets() {
        val snap = snapshot(exercise("empty"), exercise("bench", straight()))
        val s = Engine.begin(snap, t0, "id")
        assertEquals(1, s.ex)
        assertEquals(0, s.set)
        assertFalse(s.finished)
    }

    @Test fun anEmptyRoutineIsFinishedAtOnce() {
        assertTrue(Engine.begin(snapshot(), t0, "id").finished)
        assertTrue(Engine.begin(snapshot(exercise("none")), t0, "id").finished)
    }

    @Test fun aStraightSetLogsWhatWasTypedAndStartsItsRest() {
        val snap = snapshot(exercise("bench", straight(rest = 120), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(62.5, 4, 0), t0 + 1000)
        assertEquals(1, s.set)
        assertEquals(t0 + 1000 + 120_000, s.restEndsAt)
        assertEquals(120, s.restTotalSec)
        val r = s.results.single()
        assertEquals(62.5, r.w, 0.0)
        assertEquals(4, r.r)
        assertTrue(r.done)
        assertEquals(t0 + 1000, r.at)
    }

    @Test fun noRestAfterTheLastSetOfTheWorkout() {
        val snap = snapshot(exercise("bench", straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        assertTrue(s.finished)
        assertEquals(0L, s.restEndsAt)
    }

    @Test fun noRestWhenTheSetEarnsNone() {
        val snap = snapshot(exercise("bench", straight(rest = 0), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        assertEquals(0L, s.restEndsAt)
    }

    @Test fun theRestAfterTheLastSetOfAnExerciseRunsIntoTheNextExercise() {
        val snap = snapshot(exercise("a", straight(rest = 100)), exercise("b", straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        assertEquals(1, s.ex)
        assertEquals(100, s.restTotalSec)
    }

    @Test fun aDropSetLogsTheMainSetAndEachDropBackToBackWithNoRest() {
        val drops = listOf(Drop(32.5, 8), Drop(25.0, 8))
        val snap = snapshot(exercise("curl", dropset(drops = drops), straight()))
        var s = Engine.begin(snap, t0, "id")
        assertEquals(StepValue(40.0, 8, 0), value(s, snap))

        s = Engine.confirm(snap, s, StepValue(40.0, 8, 0), t0)
        assertEquals(0L, s.restEndsAt)
        assertEquals(1, s.step)
        assertEquals(StepValue(32.5, 8, 0), value(s, snap))

        s = Engine.confirm(snap, s, StepValue(32.5, 8, 0), t0)
        assertEquals(0L, s.restEndsAt)
        s = Engine.confirm(snap, s, StepValue(25.0, 6, 0), t0 + 5000)

        // Now the set is done, and its rest begins.
        assertEquals(1, s.set)
        assertEquals(60, s.restTotalSec)
        val r = s.results.single()
        assertEquals(40.0, r.w, 0.0)
        assertEquals(8, r.r)
        assertEquals(listOf(Drop(32.5, 8), Drop(25.0, 6)), r.drops)
        assertTrue(r.clusters.isEmpty())
    }

    @Test fun restPauseRestsShortBetweenMiniSetsAndItsRepsAreTheirSum() {
        val clusters = listOf(Cluster(6, 15), Cluster(3, 15), Cluster(2, 10), Cluster(1, 10))
        val snap = snapshot(exercise("press", restPause(clusters = clusters), straight()))
        var s = Engine.begin(snap, t0, "id")
        assertEquals(StepValue(30.0, 6, 0), value(s, snap))

        s = Engine.confirm(snap, s, StepValue(30.0, 7, 0), t0)
        // The rest before mini-set 2 is that mini-set's own.
        assertEquals(15, s.restTotalSec)
        assertEquals(t0 + 15_000, s.restEndsAt)
        assertEquals(StepValue(30.0, 3, 0), value(s, snap))

        s = Engine.confirm(snap, s, StepValue(30.0, 3, 0), t0 + 20_000)
        assertEquals(10, s.restTotalSec)
        s = Engine.confirm(snap, s, StepValue(30.0, 2, 0), t0 + 40_000)
        assertEquals(10, s.restTotalSec)
        s = Engine.confirm(snap, s, StepValue(30.0, 1, 0), t0 + 60_000)

        val r = s.results.single()
        assertEquals(13, r.r)
        assertEquals(listOf(7, 3, 2, 1), r.clusters.map { it.r })
        assertEquals(r.r, r.clusters.sumOf { it.r })
        assertEquals(30.0, r.w, 0.0)
        // ...and after the whole set, the full rest.
        assertEquals(90, s.restTotalSec)
        assertEquals(1, s.set)
    }

    @Test fun theLoadIsCarriedThroughRestPauseMiniSets() {
        val snap = snapshot(exercise("press", restPause(clusters = listOf(Cluster(6, 15), Cluster(3, 15))), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(32.5, 6, 0), t0)
        assertEquals(32.5, value(s, snap).w, 0.0)
    }

    @Test fun stoppingARestPauseEarlyKeepsWhatWasDone() {
        val clusters = listOf(Cluster(6, 15), Cluster(3, 15), Cluster(2, 10))
        val snap = snapshot(exercise("press", restPause(clusters = clusters), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(30.0, 6, 0), t0)
        s = Engine.confirm(snap, s, StepValue(30.0, 2, 0), t0)
        s = Engine.stopHere(snap, s, t0 + 1000)
        val r = s.results.single()
        assertEquals(8, r.r)
        assertEquals(2, r.clusters.size)
        assertEquals(1, s.set)
    }

    @Test fun stoppingBeforeAnythingIsLoggedDoesNothing() {
        val snap = snapshot(exercise("press", straight(), straight()))
        val s = Engine.begin(snap, t0, "id")
        assertEquals(s, Engine.stopHere(snap, s, t0))
    }

    @Test fun aSkippedSetIsRecordedAsNotDoneAndStartsNoRest() {
        val snap = snapshot(exercise("bench", straight(), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.skip(snap, s, t0)
        assertFalse(s.results.single().done)
        assertEquals(0L, s.restEndsAt)
        assertEquals(1, s.set)
    }

    @Test fun skippingInTheMiddleOfADropSetKeepsTheLoggedPart() {
        val snap = snapshot(exercise("curl", dropset(drops = listOf(Drop(32.5, 8))), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(40.0, 8, 0), t0)
        s = Engine.skip(snap, s, t0)
        val r = s.results.single()
        assertTrue(r.done)
        assertTrue(r.drops.isEmpty())
    }

    @Test fun aTimedSetLogsSeconds() {
        val snap = snapshot(exercise("plank", timed(40), timed(), timed = true))
        var s = Engine.begin(snap, t0, "id")
        assertEquals(40, value(s, snap).sec)
        s = Engine.confirm(snap, s, StepValue(0.0, 0, 35), t0)
        assertEquals(35, s.results.single().sec)
    }

    @Test fun undoTakesBackTheLastStepOfASetInProgress() {
        val snap = snapshot(exercise("curl", dropset(drops = listOf(Drop(32.5, 8), Drop(25.0, 8))), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(40.0, 8, 0), t0)
        s = Engine.confirm(snap, s, StepValue(32.5, 8, 0), t0)
        s = Engine.undo(snap, s)
        assertEquals(1, s.step)
        assertEquals(1, s.partial.size)
        s = Engine.undo(snap, s)
        assertEquals(0, s.step)
        assertTrue(s.partial.isEmpty())
    }

    @Test fun undoReopensTheLastFinishedSetAndCancelsItsRest() {
        val snap = snapshot(exercise("bench", straight(rest = 90), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        assertTrue(s.restEndsAt > 0)
        s = Engine.undo(snap, s)
        assertEquals(0, s.set)
        assertTrue(s.results.isEmpty())
        assertEquals(0L, s.restEndsAt)
    }

    @Test fun undoOfTheVeryLastSetBringsTheWorkoutBack() {
        val snap = snapshot(exercise("bench", straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        assertTrue(s.finished)
        s = Engine.undo(snap, s)
        assertFalse(s.finished)
        assertEquals(0, s.set)
    }

    @Test fun undoOfAFinishedRestPauseReopensItsLastMiniSet() {
        val clusters = listOf(Cluster(6, 15), Cluster(3, 15))
        val snap = snapshot(exercise("press", restPause(clusters = clusters), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(30.0, 6, 0), t0)
        s = Engine.confirm(snap, s, StepValue(30.0, 3, 0), t0)
        s = Engine.undo(snap, s)
        assertEquals(1, s.step)
        assertEquals(listOf(6), s.partial.map { it.r })
    }

    @Test fun undoWithNothingLoggedDoesNothing() {
        val snap = snapshot(exercise("bench", straight()))
        val s = Engine.begin(snap, t0, "id")
        assertEquals(s, Engine.undo(snap, s))
    }

    @Test fun adjustingTheRestMovesItsEnd() {
        val snap = snapshot(exercise("bench", straight(rest = 60), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        s = Engine.adjustRest(s, 15, t0 + 10_000)
        assertEquals(t0 + 10_000 + 65_000, s.restEndsAt)
        s = Engine.adjustRest(s, -15, t0 + 10_000)
        assertEquals(t0 + 10_000 + 50_000, s.restEndsAt)
    }

    @Test fun shorteningARestPastItsEndEndsIt() {
        val snap = snapshot(exercise("bench", straight(rest = 60), straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        s = Engine.adjustRest(s, -15, t0 + 55_000)
        assertEquals(0L, s.restEndsAt)
    }

    @Test fun adjustingWithNoRestRunningDoesNothing() {
        val snap = snapshot(exercise("bench", straight()))
        val s = Engine.begin(snap, t0, "id")
        assertEquals(s, Engine.adjustRest(s, 15, t0))
    }

    @Test fun setNumbersCountWarmUpsApartFromWorkSets() {
        val snap = snapshot(exercise("bench", straight(warmup = true), straight(warmup = true), straight(), straight(), straight()))
        assertEquals(1 to 2, Engine.numberAmong(snap, 0, 0))
        assertEquals(2 to 2, Engine.numberAmong(snap, 0, 1))
        assertEquals(1 to 3, Engine.numberAmong(snap, 0, 2))
        assertEquals(3 to 3, Engine.numberAmong(snap, 0, 4))
    }

    @Test fun pageForTellsWhereAnExerciseStands() {
        val snap = snapshot(exercise("bench", straight()), exercise("row", straight(), straight()))
        var s = Engine.begin(snap, t0, "id")
        assertEquals(0 to 0, Engine.pageFor(snap, s, 0))
        assertEquals(1 to 0, Engine.pageFor(snap, s, 1))
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        assertNull(Engine.pageFor(snap, s, 0))
        assertEquals(1 to 0, Engine.pageFor(snap, s, 1))
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        assertNull(Engine.pageFor(snap, s, 1))
    }

    @Test fun confirmingAFinishedWorkoutChangesNothing() {
        val snap = snapshot(exercise("bench", straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        assertEquals(s, Engine.confirm(snap, s, StepValue(99.0, 9, 0), t0))
    }

    // ---- any order

    private val three get() = snapshot(
        exercise("bench", straight(rest = 0), straight(rest = 0)),
        exercise("row", straight(rest = 0), straight(rest = 0)),
        exercise("curl", straight(rest = 0), straight(rest = 0)),
    )
    private fun log(snap: Snapshot, s: Session, at: Long = t0) = Engine.confirm(snap, s, StepValue(50.0, 6, 0), at)

    @Test fun goToMovesToAnotherExerciseAtItsFirstUnfinishedSet() {
        val snap = three
        var s = Engine.begin(snap, t0, "id")
        s = Engine.goTo(snap, s, 2)
        assertEquals(2, s.ex)
        assertEquals(0, s.set)
        assertEquals(0, s.step)
        assertTrue(s.results.isEmpty())
    }

    @Test fun goToKeepsARunningRest() {
        val snap = snapshot(exercise("bench", straight(rest = 90), straight()), exercise("row", straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(60.0, 5, 0), t0)
        val ends = s.restEndsAt
        s = Engine.goTo(snap, s, 1)
        assertEquals(1, s.ex)
        assertEquals(ends, s.restEndsAt)
        assertEquals(90, s.restTotalSec)
    }

    @Test fun goToDoesNothingWhileASetIsHalfLogged() {
        val snap = snapshot(
            exercise("curl", dropset(drops = listOf(Drop(30.0, 8), Drop(20.0, 8)))),
            exercise("row", straight()),
        )
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(40.0, 8, 0), t0)
        assertEquals(s, Engine.goTo(snap, s, 1))
    }

    @Test fun goToIgnoresTheSameExerciseOneThatIsDoneAndOneThatDoesNotExist() {
        val snap = snapshot(exercise("bench", straight(rest = 0)), exercise("row", straight()))
        var s = Engine.begin(snap, t0, "id")
        assertEquals(s, Engine.goTo(snap, s, 0))
        s = log(snap, s)                      // bench is done, row is current
        assertEquals(1, s.ex)
        assertEquals(s, Engine.goTo(snap, s, 0))
        assertEquals(s, Engine.goTo(snap, s, 7))
        assertEquals(s, Engine.goTo(snap, s, -1))
    }

    @Test fun anExerciseDoneOutOfOrderCarriesOnInItsOwnSetsFirst() {
        val snap = three
        var s = Engine.begin(snap, t0, "id")
        s = Engine.goTo(snap, s, 1)
        s = log(snap, s)
        assertEquals(1 to 1, s.ex to s.set)   // the second set of row, not a jump to curl
        s = log(snap, s)
        // row is done: on to the next exercise that is not, which is curl, then round to bench
        assertEquals(2 to 0, s.ex to s.set)
        s = log(snap, s); s = log(snap, s)
        assertEquals(0 to 0, s.ex to s.set)
        s = log(snap, s); s = log(snap, s)
        assertTrue(s.finished)
        assertEquals(6, s.results.size)
    }

    @Test fun leftOutOfOrderAnExerciseKeepsItsPlaceWhenYouComeBack() {
        val snap = three
        var s = Engine.begin(snap, t0, "id")
        s = log(snap, s)                      // bench set 1
        s = Engine.goTo(snap, s, 2)
        s = log(snap, s)                      // curl set 1
        s = Engine.goTo(snap, s, 0)
        assertEquals(0 to 1, s.ex to s.set)   // bench continues at its second set
    }

    @Test fun skippingAndFinishingOutOfOrderEndsTheWorkoutOnlyWhenEverySetHasAResult() {
        val snap = three
        var s = Engine.begin(snap, t0, "id")
        s = Engine.goTo(snap, s, 2)
        s = Engine.skip(snap, s, t0)
        s = Engine.skip(snap, s, t0)
        assertFalse(s.finished)
        assertEquals(0, s.ex)
        s = log(snap, s); s = log(snap, s)
        s = log(snap, s)
        assertFalse(s.finished)
        s = log(snap, s)
        assertTrue(s.finished)
        assertEquals(4, Engine.setsDone(s))
    }

    @Test fun undoReturnsToTheExerciseTheLastSetWasIn() {
        val snap = three
        var s = Engine.begin(snap, t0, "id")
        s = log(snap, s)                      // bench 1
        s = Engine.goTo(snap, s, 2)
        s = log(snap, s)                      // curl 1
        s = Engine.goTo(snap, s, 1)
        s = Engine.undo(snap, s)              // takes back curl 1, wherever you are
        assertEquals(2 to 0, s.ex to s.set)
        assertEquals(1, s.results.size)
        assertEquals(0, s.results[0].ex)
    }

    @Test fun progressIsSetsDoneOverSetsInAll() {
        val snap = three
        var s = Engine.begin(snap, t0, "id")
        assertEquals(0f, Engine.progress(snap, s), 0.0001f)
        s = log(snap, s)
        assertEquals(1f / 6, Engine.progress(snap, s), 0.0001f)
        s = Engine.goTo(snap, s, 2)
        s = log(snap, s); s = log(snap, s)
        assertEquals(3f / 6, Engine.progress(snap, s), 0.0001f)
        s = Engine.skip(snap, s, t0)          // a set left out does not count
        assertEquals(3f / 6, Engine.progress(snap, s), 0.0001f)
        s = Engine.undo(snap, s)
        assertEquals(3f / 6, Engine.progress(snap, s), 0.0001f)
    }

    @Test fun aDropSetCountsWhenAllItsStepsAreIn() {
        val snap = snapshot(exercise("curl", dropset(drops = listOf(Drop(30.0, 8)))), exercise("row", straight()))
        var s = Engine.begin(snap, t0, "id")
        s = Engine.confirm(snap, s, StepValue(40.0, 8, 0), t0)
        assertEquals(0f, Engine.progress(snap, s), 0.0001f)
        s = Engine.confirm(snap, s, StepValue(30.0, 8, 0), t0)
        assertEquals(0.5f, Engine.progress(snap, s), 0.0001f)
    }

    @Test fun progressOfAnEmptyRoutineIsZero() {
        assertEquals(0f, Engine.progress(snapshot(), Engine.begin(snapshot(), t0, "id")), 0f)
    }

    @Test fun exerciseCountIsItsSetsWithAResult() {
        val snap = three
        var s = Engine.begin(snap, t0, "id")
        s = log(snap, s)
        assertEquals(1 to 2, Engine.exerciseCount(snap, s, 0))
        assertEquals(0 to 2, Engine.exerciseCount(snap, s, 1))
        assertFalse(Engine.exerciseFinished(snap, s, 0))
        s = log(snap, s)
        assertTrue(Engine.exerciseFinished(snap, s, 0))
    }

    @Test fun theSessionLeavesTheWatchWithEverySetInRoutineOrderWhateverTheOrderDone() {
        val snap = three
        var s = Engine.begin(snap, t0, "id")
        s = Engine.goTo(snap, s, 2)
        s = log(snap, s, t0 + 1); s = log(snap, s, t0 + 2)
        s = log(snap, s, t0 + 3); s = log(snap, s, t0 + 4)
        s = log(snap, s, t0 + 5); s = log(snap, s, t0 + 6)
        val out = Wire.sessionPayload(snap, s, t0 + 10)
        val ex = out.getJSONArray("exercises")
        assertEquals(listOf("bench", "row", "curl"), (0 until ex.length()).map { ex.getJSONObject(it).getString("id") })
        // ...and each set carries when it was really done, which is what orders them on the phone.
        val curl = ex.getJSONObject(2).getJSONArray("sets")
        val bench = ex.getJSONObject(0).getJSONArray("sets")
        val row = ex.getJSONObject(1).getJSONArray("sets")
        assertEquals(t0 + 1, curl.getJSONObject(0).getLong("at"))   // curl first, then round to bench, then row
        assertEquals(t0 + 3, bench.getJSONObject(0).getLong("at"))
        assertEquals(t0 + 5, row.getJSONObject(0).getLong("at"))
    }
}
