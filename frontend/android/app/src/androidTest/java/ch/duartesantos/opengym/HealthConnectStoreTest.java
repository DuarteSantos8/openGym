package ch.duartesantos.opengym;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.content.Context;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.HealthConnectFeatures;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.response.InsertRecordsResponse;
import androidx.health.connect.client.response.ReadRecordResponse;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Collections;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Opt-in real datastore test. Run with -e healthConnectStore true after granting the debug app's
 * existing WRITE_EXERCISE permission. Uses its own client id and removes only that fixture.
 */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 28)
public class HealthConnectStoreTest {
    @Test
    @SuppressWarnings("unchecked")
    public void representativeWorkoutRoundTripsEditsReplaceAndDeletionRemoves() throws Exception {
        assumeTrue("Explicit opt-in required for real Health Connect writes",
                "true".equals(InstrumentationRegistry.getArguments().getString("healthConnectStore")));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        HealthConnectClient hc = HealthConnectClient.Companion.getOrCreate(context, "com.google.android.apps.healthdata");
        boolean extended = hc.getFeatures().getFeatureStatus(HealthConnectFeatures.FEATURE_EXERCISE_SESSION_IMPROVEMENTS)
                == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE;
        if ("true".equals(InstrumentationRegistry.getArguments().getString("requireExtended"))) {
            assertTrue("Device must support structured mass/index/RPE for this validation", extended);
        }
        android.util.Log.i("openGymHealthTest", "Extended exercise fields supported: " + extended);
        long end = System.currentTimeMillis() - 60000;
        long start = end - 3600000;
        String clientId = "opengym-w-instrumentation-segments";
        String[] types = { "bench_press", "bench_press", "lat_pull_down", "squat", "arm_curl",
                "double_arm_triceps_extension", "lateral_raise", "leg_curl", "running" };
        int[] reps = { 8, 7, 10, 5, 12, 12, 15, 10, 0 };
        JSONArray rows = new JSONArray();
        for (int i = 0; i < types.length; i++) {
            long at = start + (i + 1) * 300000;
            JSONObject row = new JSONObject().put("start", at - (i == types.length - 1 ? 180000 : 1))
                    .put("end", at).put("type", types[i]).put("repetitions", reps[i]).put("setIndex", i == 1 ? 1 : 0);
            if (i != types.length - 1) row.put("weightKg", 20 + i).put("rpe", 8.5);
            rows.put(row);
        }
        JSONObject payload = new JSONObject().put("id", clientId).put("start", start).put("end", end)
                .put("type", "other_workout").put("title", "openGym segment validation").put("segments", rows);
        try {
            ExerciseSessionRecord record = HealthConnectPlugin.session(payload, 1, extended);
            InsertRecordsResponse inserted = (InsertRecordsResponse) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                    (scope, cont) -> hc.insertRecords(Collections.singletonList(record), cont));
            String id = inserted.getRecordIdsList().get(0);
            ReadRecordResponse<ExerciseSessionRecord> read = (ReadRecordResponse<ExerciseSessionRecord>) BuildersKt.runBlocking(
                    EmptyCoroutineContext.INSTANCE, (scope, cont) -> hc.readRecord(
                            JvmClassMappingKt.getKotlinClass(ExerciseSessionRecord.class), id, cont));
            ExerciseSessionRecord saved = read.getRecord();
            assertEquals(types.length, saved.getSegments().size());
            for (int i = 0; i < types.length; i++) {
                assertEquals(record.getSegments().get(i).getSegmentType(), saved.getSegments().get(i).getSegmentType());
                assertEquals(reps[i], saved.getSegments().get(i).getRepetitions());
                if (extended) assertEquals(Integer.valueOf(i == 1 ? 1 : 0), saved.getSegments().get(i).getSetIndex());
                if (extended && i != types.length - 1) {
                    assertEquals(20 + i, saved.getSegments().get(i).getWeight().getKilograms(), 0);
                    assertEquals(8.5f, saved.getSegments().get(i).getRateOfPerceivedExertion(), 0);
                }
            }
            // Optional one-minute inspection window for HC's own UI; cleanup still runs.
            if ("true".equals(InstrumentationRegistry.getArguments().getString("inspect"))) {
                android.util.Log.i("openGymHealthTest", "Fixture ready for UI inspection");
                Thread.sleep(60000);
            }
            rows.getJSONObject(0).put("repetitions", 9);
            ExerciseSessionRecord edit = HealthConnectPlugin.session(payload, 2, extended);
            InsertRecordsResponse replaced = (InsertRecordsResponse) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                    (scope, cont) -> hc.insertRecords(Collections.singletonList(edit), cont));
            assertEquals("Same client id replaces rather than duplicates", id, replaced.getRecordIdsList().get(0));
            ReadRecordResponse<ExerciseSessionRecord> edited = (ReadRecordResponse<ExerciseSessionRecord>) BuildersKt.runBlocking(
                    EmptyCoroutineContext.INSTANCE, (scope, cont) -> hc.readRecord(
                            JvmClassMappingKt.getKotlinClass(ExerciseSessionRecord.class), id, cont));
            assertEquals(9, edited.getRecord().getSegments().get(0).getRepetitions());
            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> hc.deleteRecords(
                    JvmClassMappingKt.getKotlinClass(ExerciseSessionRecord.class),
                    Collections.singletonList(id), Collections.emptyList(), cont));
            boolean removed = false;
            try {
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> hc.readRecord(
                        JvmClassMappingKt.getKotlinClass(ExerciseSessionRecord.class), id, cont));
            } catch (Exception expected) {
                removed = true;
            }
            assertTrue("Deleted fixture must no longer be readable", removed);
        } finally {
            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> hc.deleteRecords(
                    JvmClassMappingKt.getKotlinClass(ExerciseSessionRecord.class),
                    Collections.emptyList(), Collections.singletonList(clientId), cont));
        }
    }
}
