package ch.duartesantos.opengym;

import static org.junit.Assert.*;

import androidx.health.connect.client.records.ExerciseSegment;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import java.time.Instant;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the actual JSON -> AndroidX boundary, without needing Health permissions or writes. */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 28)
public class HealthConnectPluginTest {
    private static final long START = 1789660800000L;

    private static JSONObject segment(long from, long to, String type, int reps) throws Exception {
        return new JSONObject().put("start", START + from).put("end", START + to)
                .put("type", type).put("repetitions", reps);
    }

    private static JSONObject session(JSONArray segments) throws Exception {
        return new JSONObject().put("id", "opengym-w-test").put("start", START).put("end", START + 3600000)
                .put("type", "strength_training").put("title", "Push").put("notes", "The original notes")
                .put("segments", segments);
    }

    @Test
    public void preservesSessionAndEverySet() throws Exception {
        JSONObject payload = session(new JSONArray()
                .put(segment(0, 60000, "bench_press", 8))
                .put(segment(60000, 120000, "bench_press", 7))
                .put(segment(180000, 240000, "pull_up", 12)));
        ExerciseSessionRecord record = HealthConnectPlugin.session(payload, 42);
        assertEquals(Instant.ofEpochMilli(START), record.getStartTime());
        assertEquals(Instant.ofEpochMilli(START + 3600000), record.getEndTime());
        assertEquals(ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, record.getExerciseType());
        assertEquals("Push", record.getTitle());
        assertEquals("The original notes", record.getNotes());
        assertEquals("opengym-w-test", record.getMetadata().getClientRecordId());
        assertEquals(42, record.getMetadata().getClientRecordVersion());
        assertEquals(3, record.getSegments().size());
        assertEquals(ExerciseSegment.EXERCISE_SEGMENT_TYPE_BENCH_PRESS, record.getSegments().get(0).getSegmentType());
        assertEquals(8, record.getSegments().get(0).getRepetitions());
        assertEquals(7, record.getSegments().get(1).getRepetitions());
        assertEquals(ExerciseSegment.EXERCISE_SEGMENT_TYPE_PULL_UP, record.getSegments().get(2).getSegmentType());
        assertEquals(12, record.getSegments().get(2).getRepetitions());
    }

    @Test
    public void everyExportedTypeIsRecognizedAndCompatibleWithStrengthTraining() throws Exception {
        String[] types = { "bench_press", "deadlift", "squat", "barbell_shoulder_press", "shoulder_press",
                "arm_curl", "dumbbell_row", "dumbbell_front_raise", "dumbbell_lateral_raise", "lat_pull_down",
                "leg_extension", "leg_curl", "leg_press", "lunge", "crunch", "sit_up", "pull_up", "plank",
                "kettlebell_swing", "burpee" };
        for (String type : types) {
            ExerciseSessionRecord record = HealthConnectPlugin.session(session(new JSONArray()
                    .put(segment(0, 60000, type, 5))), 1);
            assertNotEquals(type, ExerciseSegment.EXERCISE_SEGMENT_TYPE_UNKNOWN,
                    record.getSegments().get(0).getSegmentType());
        }
    }

    @Test
    public void unknownTypesRetainRepsAndTimedSegmentsHaveZeroReps() throws Exception {
        ExerciseSessionRecord record = HealthConnectPlugin.session(session(new JSONArray()
                .put(segment(0, 60000, "unsupported", 10))
                .put(segment(90000, 120000, "plank", 0))), 1);
        assertEquals(ExerciseSegment.EXERCISE_SEGMENT_TYPE_UNKNOWN, record.getSegments().get(0).getSegmentType());
        assertEquals(10, record.getSegments().get(0).getRepetitions());
        assertEquals(0, record.getSegments().get(1).getRepetitions());
    }

    @Test
    public void ignoresMalformedAndOverlappingDetailWithoutLosingSession() throws Exception {
        JSONArray rows = new JSONArray()
                .put(segment(120000, 180000, "squat", 5))
                .put(segment(0, 60000, "bench_press", 8))
                .put(segment(30000, 90000, "bench_press", 7))
                .put(segment(-1, 1000, "bench_press", 8))
                .put(segment(200000, 200000, "bench_press", 8))
                .put(segment(250000, 3600001, "bench_press", 8))
                .put(new JSONObject().put("type", "squat"))
                .put("bad row");
        ExerciseSessionRecord record = HealthConnectPlugin.session(session(rows), 1);
        assertEquals(2, record.getSegments().size());
        assertEquals(Instant.ofEpochMilli(START), record.getSegments().get(0).getStartTime());
        assertEquals(Instant.ofEpochMilli(START + 120000), record.getSegments().get(1).getStartTime());
        assertEquals("Push", record.getTitle());
    }

    @Test
    public void invalidRepetitionsNeverWrapOrRound() throws Exception {
        for (Object reps : new Object[] { -1, 1.5, 2147483648L, "Infinity" }) {
            JSONObject row = segment(0, 60000, "bench_press", 8).put("repetitions", reps);
            ExerciseSessionRecord record = HealthConnectPlugin.session(session(new JSONArray().put(row)), 1);
            assertEquals(0, record.getSegments().get(0).getRepetitions());
        }
    }

    @Test
    public void sessionOnlyAndCardioExportsStillConstruct() throws Exception {
        JSONObject payload = session(null);
        assertTrue(HealthConnectPlugin.session(payload, 1).getSegments().isEmpty());
        for (String type : new String[] { "walking", "running", "biking_stationary", "elliptical",
                "stair_climbing_machine", "other_workout" }) {
            payload.put("type", type).put("segments", new JSONArray().put(segment(0, 60000, "bench_press", 8)));
            assertTrue(HealthConnectPlugin.session(payload, 1).getSegments().isEmpty());
        }
    }

    @Test
    public void weightExportKeepsItsKilogramsTimeAndClientIdentity() throws Exception {
        WeightRecord record = HealthConnectPlugin.weight(new JSONObject()
                .put("id", "opengym-bw-2026-09-17").put("time", START).put("kg", 80.5), 42);
        assertEquals(80.5, record.getWeight().getKilograms(), 0);
        assertEquals(Instant.ofEpochMilli(START), record.getTime());
        assertEquals("opengym-bw-2026-09-17", record.getMetadata().getClientRecordId());
        assertEquals(42, record.getMetadata().getClientRecordVersion());
    }
}
