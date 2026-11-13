package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.WeightRecord;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

// v1.4.5 (after TestFlight 59): every record Health Connect would throw for is left out on its own,
// and the rest of the write still goes through.
public class HealthWriteTest {
    private static final long NOW = 1_793_000_000_000L;
    private static final long HOUR = 3_600_000L;

    private static JSONObject session(Object id, Object start, Object end) throws Exception {
        JSONObject s = new JSONObject();
        if (id != null) s.put("id", id);
        if (start != null) s.put("start", start);
        if (end != null) s.put("end", end);
        s.put("type", "strength_training");
        s.put("title", "Push");
        return s;
    }

    private static JSONObject weighIn(Object id, Object time, Object kg) throws Exception {
        JSONObject w = new JSONObject();
        if (id != null) w.put("id", id);
        if (time != null) w.put("time", time);
        if (kg != null) w.put("kg", kg);
        return w;
    }

    private static HealthWrite.Batch build(boolean kcal, JSONObject... sessions) {
        return HealthWrite.build(new JSONArray(Arrays.asList(sessions)), new JSONArray(), kcal, 1, NOW);
    }

    @Test
    public void anOrdinaryWorkoutWithItsCalories() throws Exception {
        JSONObject s = session("opengym-w-1", NOW - 2 * HOUR, NOW - HOUR).put("kcal", 320);
        HealthWrite.Batch b = build(true, s);
        assertEquals(2, b.records.size());
        assertTrue(b.records.get(0) instanceof ExerciseSessionRecord);
        assertEquals(320, ((ActiveCaloriesBurnedRecord) b.records.get(1)).getEnergy().getKilocalories(), 1e-9);
        assertEquals(Arrays.asList("opengym-w-1", "opengym-w-1"), b.owners);
        assertTrue(b.skipped.isEmpty());
    }

    @Test
    public void caloriesOnlyWithThePermission() throws Exception {
        assertEquals(1, build(false, session("a", NOW - 2 * HOUR, NOW - HOUR).put("kcal", 320)).records.size());
    }

    @Test
    public void aForgottenWorkoutGoesInWithoutCaloriesOrSegments() throws Exception {
        // The owner's case on the iPhone: a workout left open for more than a day.
        JSONObject seg = new JSONObject().put("start", NOW - 30 * HOUR + 60_000).put("end", NOW - 30 * HOUR + 90_000).put("type", "bench_press").put("reps", 8);
        JSONObject s = session("a", NOW - 30 * HOUR, NOW).put("kcal", 900).put("segments", new JSONArray().put(seg));
        HealthWrite.Batch b = build(true, s);
        assertEquals(1, b.records.size());
        ExerciseSessionRecord r = (ExerciseSessionRecord) b.records.get(0);
        assertEquals(NOW - 30 * HOUR, r.getStartTime().toEpochMilli());
        assertEquals(NOW, r.getEndTime().toEpochMilli());
        assertTrue(r.getSegments().isEmpty());
    }

    @Test
    public void exactlyADayStillHasItsCalories() throws Exception {
        assertEquals(2, build(true, session("a", NOW - 24 * HOUR, NOW).put("kcal", 900)).records.size());
    }

    @Test
    public void overAWeekIsNotWritten() throws Exception {
        HealthWrite.Batch b = build(true, session("a", NOW - 7 * 24 * HOUR - 1, NOW));
        assertTrue(b.records.isEmpty());
        assertEquals(Arrays.asList("a"), b.skipped);
    }

    @Test
    public void endNotAfterStartAndMissingTimes() throws Exception {
        HealthWrite.Batch b = build(true, session("same", NOW, NOW), session("back", NOW, NOW - 1),
                session("nostart", null, NOW), session("noend", NOW - HOUR, null));
        assertTrue(b.records.isEmpty());
        assertEquals(Arrays.asList("same", "back", "nostart", "noend"), b.skipped);
    }

    @Test
    public void timesOutOfRange() throws Exception {
        long y2000 = HealthWrite.EPOCH_MS - 24 * HOUR;
        HealthWrite.Batch b = build(true, session("zero", 0, HOUR), session("neg", -5 * HOUR, -HOUR),
                session("y2000", y2000, y2000 + HOUR), session("future", NOW + 48 * HOUR, NOW + 49 * HOUR),
                session("huge", NOW - HOUR, 1e300), session("max", NOW - HOUR, Long.MAX_VALUE),
                session("text", "yesterday", NOW), session("bool", NOW - HOUR, true));
        assertTrue(b.records.isEmpty());
        assertEquals(8, b.skipped.size());
    }

    @Test
    public void aClockAFewMinutesAheadIsFine() throws Exception {
        assertEquals(1, build(false, session("a", NOW, NOW + 10 * 60_000)).records.size());
        assertEquals(1, build(false, session("b", HealthWrite.EPOCH_MS, HealthWrite.EPOCH_MS + HOUR)).records.size());
    }

    @Test
    public void noIdNoRecord() throws Exception {
        HealthWrite.Batch b = build(true, session(null, NOW - HOUR, NOW), session("", NOW - HOUR, NOW), session(42, NOW - HOUR, NOW));
        assertTrue(b.records.isEmpty());
        assertEquals(3, b.skipped.size());
    }

    @Test
    public void caloriesThatAreNotCaloriesAreLeftOut() throws Exception {
        for (Object k : new Object[] { 0, -5, 20_001, 1e12, "lots", true }) {
            HealthWrite.Batch b = build(true, session("a", NOW - 2 * HOUR, NOW - HOUR).put("kcal", k));
            assertEquals("kcal " + k, 1, b.records.size());
            assertTrue(b.skipped.isEmpty());
        }
        assertEquals(2, build(true, session("a", NOW - 2 * HOUR, NOW - HOUR).put("kcal", 20_000)).records.size());
    }

    @Test
    public void oneBadWorkoutDoesNotStopTheOthers() throws Exception {
        HealthWrite.Batch b = build(false, session("good1", NOW - 5 * HOUR, NOW - 4 * HOUR), session("bad", NOW, NOW - HOUR),
                session("good2", NOW - 3 * HOUR, NOW - 2 * HOUR));
        assertEquals(Arrays.asList("good1", "good2"), b.owners);
        assertEquals(Arrays.asList("bad"), b.skipped);
    }

    @Test
    public void segmentsOutsideOverlappingOrBackwardsAreDropped() throws Exception {
        long s0 = NOW - 2 * HOUR, s1 = NOW - HOUR;
        JSONArray segs = new JSONArray()
                .put(new JSONObject().put("start", s0 - 60_000).put("end", s0 + 30_000).put("type", "squat").put("reps", 5))     // before the start
                .put(new JSONObject().put("start", s0 + 60_000).put("end", s0 + 90_000).put("type", "squat").put("reps", 5))     // kept
                .put(new JSONObject().put("start", s0 + 80_000).put("end", s0 + 120_000).put("type", "squat").put("reps", 5))    // overlaps
                .put(new JSONObject().put("start", s0 + 200_000).put("end", s0 + 150_000).put("type", "squat").put("reps", 5))   // backwards
                .put(new JSONObject().put("start", s1 - 30_000).put("end", s1 + 30_000).put("type", "squat").put("reps", 5))     // after the end
                .put(new JSONObject().put("start", "x").put("end", s0 + 400_000).put("type", "squat"))                          // not a time
                .put(new JSONObject().put("start", s0 + 500_000).put("end", s0 + 530_000).put("type", "bench_press").put("reps", 1e12)); // reps capped
        HealthWrite.Batch b = build(false, session("a", s0, s1).put("segments", segs));
        ExerciseSessionRecord r = (ExerciseSessionRecord) b.records.get(0);
        assertEquals(2, r.getSegments().size());
        assertEquals(s0 + 60_000, r.getSegments().get(0).getStartTime().toEpochMilli());
        assertEquals(HealthWrite.MAX_REPS, r.getSegments().get(1).getRepetitions());
    }

    @Test
    public void segmentsTheSessionTypeDoesNotTakeLeaveTheWorkout() throws Exception {
        long s0 = NOW - 2 * HOUR;
        JSONArray segs = new JSONArray().put(new JSONObject().put("start", s0 + 60_000).put("end", s0 + 90_000).put("type", "bench_press").put("reps", 8));
        JSONObject s = session("a", s0, NOW - HOUR).put("type", "running").put("segments", segs);
        HealthWrite.Batch b = build(false, s);
        assertEquals(1, b.records.size());
        assertTrue(b.skipped.isEmpty());
    }

    @Test
    public void longTitlesAndNotesAreCut() throws Exception {
        StringBuilder t = new StringBuilder();
        for (int i = 0; i < 1500; i++) t.append('a');
        JSONObject s = session("a", NOW - 2 * HOUR, NOW - HOUR).put("title", t.toString()).put("notes", t.toString());
        ExerciseSessionRecord r = (ExerciseSessionRecord) build(false, s).records.get(0);
        assertEquals(HealthWrite.TEXT_MAX, r.getTitle().length());
        assertEquals(HealthWrite.TEXT_MAX, r.getNotes().length());
        assertNull(((ExerciseSessionRecord) build(false, session("b", NOW - 2 * HOUR, NOW - HOUR).put("title", "")).records.get(0)).getTitle());
    }

    @Test
    public void weighIns() throws Exception {
        JSONArray ws = new JSONArray()
                .put(weighIn("ok", NOW, 81.4))
                .put(weighIn("zero", NOW, 0)).put(weighIn("neg", NOW, -1)).put(weighIn("ton", NOW, 1000)).put(weighIn("more", NOW, 1500))
                .put(weighIn("text", NOW, "heavy")).put(weighIn(null, NOW, 80)).put(weighIn("", NOW, 80))
                .put(weighIn("old", 0, 80)).put(weighIn("y2000", HealthWrite.EPOCH_MS - HOUR, 80)).put(weighIn("ahead", NOW + 48 * HOUR, 80))
                .put(weighIn("notime", null, 80)).put(weighIn("nokg", NOW, null))
                .put(weighIn("almost", NOW, 999.9));
        HealthWrite.Batch b = HealthWrite.build(new JSONArray(), ws, false, 1, NOW);
        assertEquals(Arrays.asList("ok", "almost"), b.owners);
        assertEquals(81.4, ((WeightRecord) b.records.get(0)).getWeight().getKilograms(), 1e-9);
        assertEquals(12, b.skipped.size());
    }

    @Test
    public void notAnObjectIsSkippedNotACrash() {
        JSONArray odd = new JSONArray().put("text").put(5).put(JSONObject.NULL);
        HealthWrite.Batch b = HealthWrite.build(odd, odd, true, 1, NOW);
        assertTrue(b.records.isEmpty());
        assertEquals(6, b.skipped.size());
        assertNotNull(HealthWrite.build(null, null, true, 1, NOW));
    }
}
