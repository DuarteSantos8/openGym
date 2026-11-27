package ch.duartesantos.opengym.wear

import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Overview's "Add session note": the running workout's own note, said to the phone as `workoutNote` (the Apple Watch's WorkoutNoteTests). */
class WorkoutNoteTest {
    private fun state(note: String? = null, flag: Boolean? = true) = SessionState(
        workout = ActiveWorkout(id = "w1", name = "Push", note = note),
        settings = WatchSettings(workoutNote = flag),
    )

    private fun str(e: kotlinx.serialization.json.JsonObject, k: String) = e[k]?.jsonPrimitive?.content

    @Test fun saysTheNoteWithWhatThePhoneHadAndShowsItAtOnce() {
        val (s, ev) = SessionCore.workoutNote(state("old"), "  Left shoulder\u0007tight ", 5.0, "n1")!!
        assertEquals("workoutNote", str(ev, "type")); assertEquals("w1", str(ev, "wid"))
        assertEquals("Left shoulder tight", str(ev, "note")); assertEquals("old", str(ev, "was")); assertEquals("5", str(ev, "at"))
        assertEquals("Left shoulder tight", SessionCore.shownNote(s))
    }

    @Test fun anEmptiedNoteClearsItAndNothingChangedSendsNothing() {
        val (s, ev) = SessionCore.workoutNote(state("old"), "   ", 1.0, "n1")!!
        assertEquals("", str(ev, "note")); assertEquals("", SessionCore.shownNote(s))
        assertNull(SessionCore.workoutNote(state("same"), " same ", 1.0, "n2"))
        assertNull(SessionCore.workoutNote(state(), "", 1.0, "n3"))
    }

    @Test fun cutsAtTheWatchLimit() {
        val (_, ev) = SessionCore.workoutNote(state(), "x".repeat(400), 1.0, "n1")!!
        assertEquals(SessionCore.NOTE_MAX, str(ev, "note")!!.length)
    }

    @Test fun noButtonWithoutTheFlagOrAWorkout() {
        assertTrue(SessionCore.canNote(state()))
        assertFalse(SessionCore.canNote(state(flag = null)))
        assertFalse(SessionCore.canNote(state(flag = false)))
        assertFalse(SessionCore.canNote(SessionState()))
        assertNull(SessionCore.workoutNote(state(flag = null), "x", 1.0, "n"))
    }

    @Test fun aSecondEditBeforeTheAckSaysTheFirstAsWhatItSaw() {
        val (s1, _) = SessionCore.workoutNote(state("a"), "b", 1.0, "n1")!!
        val (_, ev2) = SessionCore.workoutNote(s1, "c", 2.0, "n2")!!
        assertEquals("b", str(ev2, "was"))
    }

    private fun snap(w: ActiveWorkout?, acked: List<String>? = null) = Snapshot(active = w, acked = acked)
    private fun active(id: String, note: String?) = ActiveWorkout(id = id, name = "Push", note = note)

    @Test fun theEditStaysUntilThePhoneAcksThenThePhonesNoteShows() {
        var (s, _) = SessionCore.workoutNote(state("old"), "mine", 1.0, "n1")!!
        s = SessionCore.applySnapshot(s, snap(active("w1", "old")))
        assertEquals("mine", SessionCore.shownNote(s))
        s = SessionCore.applySnapshot(s, snap(active("w1", "typed on the phone"), listOf("n1")))
        assertEquals("typed on the phone", SessionCore.shownNote(s))
        assertNull(s.noteDraft)
    }

    @Test fun anotherWorkoutOrNoWorkoutDropsTheEdit() {
        val (s, _) = SessionCore.workoutNote(state(), "mine", 1.0, "n1")!!
        assertEquals("", SessionCore.shownNote(SessionCore.applySnapshot(s, snap(active("w2", null)))))
        assertNull(SessionCore.applySnapshot(s, snap(null)).noteDraft)
    }

    @Test fun theSnapshotCarriesTheNoteAndTheFlag() {
        val sn = Snapshot.parse("""{"v":1,"active":{"id":"w1","name":"Push","unit":"kg","cur":0,"restSec":90,"entries":[],"note":"tight"},"settings":{"workoutNote":true}}""")!!
        assertEquals("tight", sn.active?.note); assertEquals(true, sn.settings?.workoutNote)
    }
}
