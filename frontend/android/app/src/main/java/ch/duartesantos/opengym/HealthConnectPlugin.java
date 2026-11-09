package ch.duartesantos.opengym;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.HealthConnectFeatures;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord;
import androidx.health.connect.client.records.BasalMetabolicRateRecord;
import androidx.health.connect.client.records.BodyFatRecord;
import androidx.health.connect.client.records.BoneMassRecord;
import androidx.health.connect.client.records.BodyWaterMassRecord;
import androidx.health.connect.client.records.LeanBodyMassRecord;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.records.RestingHeartRateRecord;
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.aggregate.AggregationResultGroupedByPeriod;
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Period;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;
import org.json.JSONException;

/**
 * Writes finished workouts and weigh-ins to Health Connect (#200), the phone's own store for
 * health data, so other apps can read them. Write-only and off until the user turns it on in
 * Settings: no permission is asked for before that. What to write is worked out in JS
 * (lib/health-connect.js); this side only turns those plain objects into records.
 *
 * Every record carries openGym's own id as its clientRecordId, so writing it again replaces it,
 * and "remove" finds exactly the records openGym wrote. The version is the time of the write:
 * Health Connect keeps a rewritten record only when its version is higher than the stored one.
 *
 * The client's API is Kotlin suspend functions. They are called from a worker thread through
 * runBlocking, which keeps the Android project Java-only.
 *
 * The client library needs Android 8 (API 26) and Health Connect itself Android 9 (API 28); the
 * app supports Android 6, so every entry point checks the version before a Health Connect class
 * is touched, and answers "unsupported" below 9.
 *
 * Usage from JS (lib/health-sync.js):
 *   const HC = registerPlugin('HealthConnect');
 *   await HC.status();              // { status: 'available' | 'update' | 'missing' | 'unsupported', granted }
 *   await HC.requestPermissions();  // { granted, calories } (calories optional, #724)
 *   await HC.write({ sessions: [...], weights: [...] });
 *   await HC.remove({ sessions: [ids], weights: [ids] });
 *   await HC.openSettings();        // Health Connect's data screen, or its store page
 *
 * Reading back (v1.4.3), each only after the user turned it on and granted that one permission:
 *   await HC.requestPermissions({ read: ['heartRate'], write: [] });  // { granted, read: { heartRate, weight } }
 *   await HC.readHeartRate({ from, to });   // { samples: [[ms, bpm]], origins: [package] }
 *   await HC.readWeights({ since });        // { records: [{ t, kg, id, origin, clientId }] }
 *   await HC.readBody({ since });           // { records: [{ kind, t, v, id, origin, clientId }] } (v1.4.5)
 *   await HC.readVitals({ from: 'YYYY-MM-DD' });  // { sleep, rhr, hrv, steps, hrvKind } (v1.4.5, lib/vitals.js)
 *   await HC.readWorkouts({ since });       // { records: [{ id, sport, start, end, title, origin, clientId }] } (v1.4.5, lib/activities.js)
 * Foreground only: no READ_HEALTH_DATA_IN_BACKGROUND. Without READ_HEALTH_DATA_HISTORY Health
 * Connect gives 30 days back from the first grant, plenty for the workout just done; weigh-ins
 * ask for it too (read: ['weight', 'history']) where Health Connect has the feature, which
 * status() says as `history`, so a scale's older weigh-ins come along (idea from #801).
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {

    private static final String PROVIDER = "com.google.android.apps.healthdata";
    // The literal permission names, as declared in AndroidManifest.xml.
    private static final String WRITE_EXERCISE = "android.permission.health.WRITE_EXERCISE";
    private static final String WRITE_WEIGHT = "android.permission.health.WRITE_WEIGHT";
    // Optional (#724): the estimated active energy of each workout, written beside its session.
    private static final String WRITE_CALORIES = "android.permission.health.WRITE_ACTIVE_CALORIES_BURNED";
    private static final String READ_HEART_RATE = "android.permission.health.READ_HEART_RATE";
    private static final String READ_WEIGHT = "android.permission.health.READ_WEIGHT";
    private static final String READ_HISTORY = "android.permission.health.READ_HEALTH_DATA_HISTORY";
    // Body composition (v1.4.5), each its own permission; whichever were granted are read.
    private static final String READ_BODY_FAT = "android.permission.health.READ_BODY_FAT";
    private static final String READ_LEAN_MASS = "android.permission.health.READ_LEAN_BODY_MASS";
    private static final String READ_BONE_MASS = "android.permission.health.READ_BONE_MASS";
    private static final String READ_BODY_WATER = "android.permission.health.READ_BODY_WATER_MASS";
    private static final String READ_BMR = "android.permission.health.READ_BASAL_METABOLIC_RATE";
    // Vitals (v1.4.5, gm-insights), each its own permission; whichever were granted are read.
    private static final String READ_SLEEP = "android.permission.health.READ_SLEEP";
    private static final String READ_RESTING_HR = "android.permission.health.READ_RESTING_HEART_RATE";
    private static final String READ_HRV = "android.permission.health.READ_HEART_RATE_VARIABILITY";
    private static final String READ_STEPS = "android.permission.health.READ_STEPS";
    // Sport (v1.4.5, gm-hooks): other apps' exercise sessions, read as activities (lib/activities.js).
    private static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";
    // Records per page when reading, and pages at most: a few hours of heart rate fit easily.
    private static final int PAGE = 1000;
    private static final int MAX_PAGES = 50;
    // Health Connect takes at most this many records in one insert.
    private static final int CHUNK = 500;

    // One at a time, in order: a remove queued behind a write must not overtake it.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    private static Set<String> permissions() {
        Set<String> p = new HashSet<>();
        p.add(WRITE_EXERCISE);
        p.add(WRITE_WEIGHT);
        return p;
    }

    private String sdkStatus() {
        if (!supported()) return "unsupported";
        int s = HealthConnectClient.Companion.getSdkStatus(getContext(), PROVIDER);
        if (s == HealthConnectClient.SDK_AVAILABLE) return "available";
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update";
        // Android 13 and lower need the Health Connect app; 14 and up have it built in, so
        // "missing" there means the phone has no Health Connect at all (some Android Go builds).
        return Build.VERSION.SDK_INT >= 34 ? "unsupported" : "missing";
    }

    private HealthConnectClient client() {
        return HealthConnectClient.Companion.getOrCreate(getContext(), PROVIDER);
    }

    // Whether this Health Connect knows the history permission at all (newer provider versions
    // only). Asked before it is requested: an unknown permission is not offered in the dialog.
    private boolean historyAvailable() {
        try {
            return client().getFeatures().getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY)
                    == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE;
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private Set<String> granted() throws InterruptedException {
        PermissionController pc = client().getPermissionController();
        return (Set<String>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> pc.getGrantedPermissions(cont));
    }

    @PluginMethod
    public void status(PluginCall call) {
        String status = sdkStatus();
        if (!"available".equals(status)) {
            JSObject r = new JSObject();
            r.put("status", status);
            r.put("granted", false);
            call.resolve(r);
            return;
        }
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("status", status);
                Set<String> got = granted();
                r.put("granted", got.containsAll(permissions()));
                r.put("calories", got.contains(WRITE_CALORIES));
                r.put("read", readState(got));
                r.put("history", historyAvailable());
                call.resolve(r);
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Set<String> asked;
        try {
            asked = asked(call);
        } catch (JSONException e) {
            call.reject(e.getMessage(), "failed");
            return;
        }
        if (!historyAvailable()) asked.remove(READ_HISTORY);
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), asked);
        startActivityForResult(call, intent, "permissionsResult");
    }

    @ActivityCallback
    private void permissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Set<String> got = contract.parseResult(result.getResultCode(), result.getData());
        // The dialog answers only for this time; ask Health Connect what stands now, since the
        // user may also have granted one of the two and not the other.
        worker.execute(() -> {
            try {
                Set<String> now = new HashSet<>(granted());
                if (got != null) now.addAll(got);
                JSObject r = new JSObject();
                r.put("granted", now.containsAll(permissions()));
                r.put("calories", now.contains(WRITE_CALORIES));
                r.put("read", readState(now));
                call.resolve(r);
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                long version = System.currentTimeMillis();
                boolean kcal = granted().contains(WRITE_CALORIES);
                // Each record built and checked on its own (HealthWrite): one Health Connect would
                // refuse is left out instead of failing the write of everything else.
                HealthWrite.Batch batch = HealthWrite.build(sessions, weights, kcal, version, version);
                Set<String> failed = new HashSet<>();
                for (int from = 0; from < batch.records.size(); from += CHUNK) {
                    int to = Math.min(batch.records.size(), from + CHUNK);
                    List<Record> part = batch.records.subList(from, to);
                    try {
                        insert(part);
                    } catch (SecurityException e) {
                        throw e;
                    } catch (Exception e) {
                        // One of them refused at insert time: each on its own, so the rest go in.
                        for (int i = from; i < to; i++) {
                            try {
                                insert(Collections.singletonList(batch.records.get(i)));
                            } catch (SecurityException se) {
                                throw se;
                            } catch (Exception one) {
                                failed.add(batch.owners.get(i));
                            }
                        }
                    }
                }
                if (!batch.skipped.isEmpty() || !failed.isEmpty())
                    android.util.Log.w("openGym", "Health Connect: " + batch.skipped.size() + " left out, " + failed.size() + " refused");
                // lib/health-sync.js keeps both as written: a bad record is not tried at every sync.
                JSObject out = new JSObject();
                out.put("skipped", new JSArray(batch.skipped));
                out.put("failed", new JSArray(failed));
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    private void insert(List<Record> part) throws InterruptedException {
        BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().insertRecords(part, cont));
    }

    @PluginMethod
    public void remove(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                delete(ExerciseSessionRecord.class, ids(sessions));
                // A session's calories go with it; without the permission there are none of ours.
                if (granted().contains(WRITE_CALORIES)) delete(ActiveCaloriesBurnedRecord.class, kcalIds(sessions));
                delete(WeightRecord.class, ids(weights));
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    @PluginMethod
    public void readHeartRate(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Long from = millis(call, "from"), to = millis(call, "to");
        if (from == null || to == null || to <= from) {
            call.reject("from and to are needed", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                List<HeartRateRecord> recs = read(HeartRateRecord.class,
                        TimeRangeFilter.between(Instant.ofEpochMilli(from), Instant.ofEpochMilli(to)));
                JSArray samples = new JSArray();
                for (long[] s : HealthRead.samples(recs, from, to)) samples.put(new JSArray().put(s[0]).put(s[1]));
                Set<String> origins = new HashSet<>();
                for (HeartRateRecord r : recs) origins.add(r.getMetadata().getDataOrigin().getPackageName());
                JSObject out = new JSObject();
                out.put("samples", samples);
                out.put("origins", new JSArray(origins));
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    @PluginMethod
    public void readWeights(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Long since = millis(call, "since");
        if (since == null) {
            call.reject("since is needed", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                List<WeightRecord> recs = read(WeightRecord.class, TimeRangeFilter.after(Instant.ofEpochMilli(since)));
                JSArray records = new JSArray();
                for (HealthRead.Weight w : HealthRead.weights(recs)) {
                    JSObject o = new JSObject();
                    o.put("t", w.t);
                    o.put("kg", w.kg);
                    o.put("id", w.id);
                    o.put("origin", w.origin);
                    o.put("clientId", w.clientId);
                    records.put(o);
                }
                JSObject out = new JSObject();
                out.put("records", records);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    /**
     * Body composition since `since`: body fat (%), lean, bone and water mass (kg) and BMR (kcal a day),
     * each only where its permission was granted, so a partial grant still reads the rest.
     */
    @PluginMethod
    public void readBody(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Long since = millis(call, "since");
        if (since == null) {
            call.reject("since is needed", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                Set<String> got = granted();
                TimeRangeFilter range = TimeRangeFilter.after(Instant.ofEpochMilli(since));
                List<HealthRead.Body> all = new ArrayList<>();
                if (got.contains(READ_BODY_FAT)) for (BodyFatRecord r : read(BodyFatRecord.class, range))
                    all.add(HealthRead.body("fat", r.getTime().toEpochMilli(), r.getPercentage().getValue(), r.getMetadata()));
                if (got.contains(READ_LEAN_MASS)) for (LeanBodyMassRecord r : read(LeanBodyMassRecord.class, range))
                    all.add(HealthRead.body("lean", r.getTime().toEpochMilli(), r.getMass().getKilograms(), r.getMetadata()));
                if (got.contains(READ_BONE_MASS)) for (BoneMassRecord r : read(BoneMassRecord.class, range))
                    all.add(HealthRead.body("bone", r.getTime().toEpochMilli(), r.getMass().getKilograms(), r.getMetadata()));
                // Body water (#1014): what Renpho and friends save as the water in you, in kg.
                if (got.contains(READ_BODY_WATER)) for (BodyWaterMassRecord r : read(BodyWaterMassRecord.class, range))
                    all.add(HealthRead.body("water", r.getTime().toEpochMilli(), r.getMass().getKilograms(), r.getMetadata()));
                if (got.contains(READ_BMR)) for (BasalMetabolicRateRecord r : read(BasalMetabolicRateRecord.class, range))
                    all.add(HealthRead.body("bmr", r.getTime().toEpochMilli(), r.getBasalMetabolicRate().getKilocaloriesPerDay(), r.getMetadata()));
                JSArray records = new JSArray();
                for (HealthRead.Body b : all) {
                    if (b == null) continue;
                    JSObject o = new JSObject();
                    o.put("kind", b.kind);
                    o.put("t", b.t);
                    o.put("v", b.v);
                    o.put("id", b.id);
                    o.put("origin", b.origin);
                    o.put("clientId", b.clientId);
                    records.put(o);
                }
                JSObject out = new JSObject();
                out.put("records", records);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    /**
     * Vitals from local midnight of `from` on (lib/vitals.js): sleep sessions (from the noon before,
     * so the first night is whole) with their awake stages, resting heart rate and HRV (RMSSD)
     * samples, and the steps per local day as Health Connect totals them (its aggregate leaves out
     * the double counts of two apps tracking the same walk). Only what was granted is read.
     */
    @PluginMethod
    public void readVitals(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        LocalDate day;
        try {
            day = LocalDate.parse(call.getString("from", ""));
        } catch (Exception e) {
            call.reject("from is needed", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                Set<String> got = granted();
                ZoneId zone = ZoneId.systemDefault();
                Instant start = day.atStartOfDay(zone).toInstant();
                TimeRangeFilter range = TimeRangeFilter.after(start);
                JSArray sleep = new JSArray();
                if (got.contains(READ_SLEEP)) {
                    for (SleepSessionRecord r : read(SleepSessionRecord.class, TimeRangeFilter.after(start.minus(Duration.ofHours(12))))) {
                        sleep.put(span(r.getStartTime(), r.getEndTime(), 0));
                        for (SleepSessionRecord.Stage st : r.getStages()) {
                            int k = st.getStage();
                            if (k == SleepSessionRecord.STAGE_TYPE_AWAKE || k == SleepSessionRecord.STAGE_TYPE_OUT_OF_BED
                                    || k == SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED) sleep.put(span(st.getStartTime(), st.getEndTime(), 1));
                        }
                    }
                }
                JSArray rhr = new JSArray();
                if (got.contains(READ_RESTING_HR)) for (RestingHeartRateRecord r : read(RestingHeartRateRecord.class, range))
                    rhr.put(point(r.getTime(), r.getBeatsPerMinute()));
                JSArray hrv = new JSArray();
                if (got.contains(READ_HRV)) for (HeartRateVariabilityRmssdRecord r : read(HeartRateVariabilityRmssdRecord.class, range))
                    hrv.put(point(r.getTime(), r.getHeartRateVariabilityMillis()));
                JSArray steps = new JSArray();
                if (got.contains(READ_STEPS)) {
                    AggregateGroupByPeriodRequest req = new AggregateGroupByPeriodRequest(
                            Collections.singleton(StepsRecord.COUNT_TOTAL), TimeRangeFilter.after(day.atStartOfDay()),
                            Period.ofDays(1), Collections.emptySet());
                    @SuppressWarnings("unchecked")
                    List<AggregationResultGroupedByPeriod> groups = (List<AggregationResultGroupedByPeriod>) BuildersKt.runBlocking(
                            EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().aggregateGroupByPeriod(req, cont));
                    for (AggregationResultGroupedByPeriod g : groups) {
                        Long n = g.getResult().get(StepsRecord.COUNT_TOTAL);
                        if (n == null || n <= 0) continue;
                        JSObject o = new JSObject();
                        o.put("d", g.getStartTime().toLocalDate().toString());
                        o.put("n", n);
                        steps.put(o);
                    }
                }
                JSObject out = new JSObject();
                out.put("sleep", sleep);
                out.put("rhr", rhr);
                out.put("hrv", hrv);
                out.put("steps", steps);
                out.put("hrvKind", "rmssd");
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    /**
     * Exercise sessions since `since` (ms) that any app saved, openGym's own included (JS skips
     * those, lib/activities.js isOwnRecord), with the sport as lib/activities.js names it
     * (HealthRead.sportName). Only with READ_EXERCISE granted; distance needs a permission of its
     * own and is left out.
     */
    @PluginMethod
    public void readWorkouts(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Long since = millis(call, "since");
        if (since == null) {
            call.reject("since is needed", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                JSArray records = new JSArray();
                if (granted().contains(READ_EXERCISE)) {
                    for (ExerciseSessionRecord r : read(ExerciseSessionRecord.class, TimeRangeFilter.after(Instant.ofEpochMilli(since)))) {
                        Metadata m = r.getMetadata();
                        JSObject o = new JSObject();
                        o.put("id", m.getId());
                        o.put("sport", HealthRead.sportName(r.getExerciseType()));
                        o.put("start", r.getStartTime().toEpochMilli());
                        o.put("end", r.getEndTime().toEpochMilli());
                        if (r.getTitle() != null) o.put("title", r.getTitle());
                        o.put("origin", m.getDataOrigin().getPackageName());
                        if (m.getClientRecordId() != null) o.put("clientId", m.getClientRecordId());
                        records.put(o);
                    }
                }
                JSObject out = new JSObject();
                out.put("records", records);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()), "failed");
            }
        });
    }

    private static JSObject span(Instant s, Instant e, int awake) {
        JSObject o = new JSObject();
        o.put("s", s.toEpochMilli());
        o.put("e", e.toEpochMilli());
        o.put("a", awake);
        return o;
    }

    private static JSObject point(Instant t, double v) {
        JSObject o = new JSObject();
        o.put("t", t.toEpochMilli());
        o.put("v", v);
        return o;
    }

    // Every page of one record type in the window, oldest first.
    @SuppressWarnings("unchecked")
    private <T extends Record> List<T> read(Class<T> type, TimeRangeFilter range) throws InterruptedException {
        List<T> out = new ArrayList<>();
        String token = null;
        for (int page = 0; page < MAX_PAGES; page++) {
            ReadRecordsRequest<T> req = new ReadRecordsRequest<>(JvmClassMappingKt.getKotlinClass(type), range,
                    Collections.emptySet(), true, PAGE, token);
            ReadRecordsResponse<T> res = (ReadRecordsResponse<T>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                    (scope, cont) -> client().readRecords(req, cont));
            out.addAll(res.getRecords());
            token = res.getPageToken();
            if (token == null || token.isEmpty()) break;
        }
        return out;
    }

    // What was asked for: { read: ['heartRate', 'weight'], write: ['exercise', 'weight'] }, each
    // optional. Without either, the two write permissions, as before v1.4.3.
    private static Set<String> asked(PluginCall call) throws JSONException {
        JSArray read = call.getArray("read", null), write = call.getArray("write", null);
        if (read == null && write == null) {
            Set<String> all = permissions();
            all.add(WRITE_CALORIES);
            return all;
        }
        Set<String> out = new HashSet<>();
        if (read != null) for (int i = 0; i < read.length(); i++) {
            String p = HealthRead.readPermission(read.getString(i));
            if (p != null) out.add(p);
        }
        if (write != null) for (int i = 0; i < write.length(); i++) {
            String p = HealthRead.writePermission(write.getString(i));
            if (p != null) out.add(p);
        }
        return out;
    }

    // A time from JS: a number that may arrive as an Integer, Long or Double (getLong takes only Long).
    private static Long millis(PluginCall call, String name) {
        Object v = call.getData().opt(name);
        return v instanceof Number ? ((Number) v).longValue() : null;
    }

    private static JSObject readState(Set<String> granted) {
        JSObject r = new JSObject();
        r.put("heartRate", granted.contains(READ_HEART_RATE));
        r.put("weight", granted.contains(READ_WEIGHT));
        r.put("history", granted.contains(READ_HISTORY));
        // Body composition: on when any of its five was granted.
        r.put("body", granted.contains(READ_BODY_FAT) || granted.contains(READ_LEAN_MASS)
                || granted.contains(READ_BONE_MASS) || granted.contains(READ_BMR)
                || granted.contains(READ_BODY_WATER));
        // Vitals (v1.4.5): on when any of its four was granted.
        r.put("vitals", granted.contains(READ_SLEEP) || granted.contains(READ_RESTING_HR)
                || granted.contains(READ_HRV) || granted.contains(READ_STEPS));
        r.put("exercise", granted.contains(READ_EXERCISE));
        return r;
    }

    // Health Connect's own screen for the data apps wrote, where the user can look at and delete
    // what openGym wrote. Without Health Connect (Android 13 and lower), its store page instead.
    @PluginMethod
    public void openSettings(PluginCall call) {
        String status = sdkStatus();
        if ("unsupported".equals(status)) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        try {
            Intent intent = "available".equals(status)
                    ? HealthConnectClient.Companion.getHealthConnectManageDataIntent(getContext(), PROVIDER)
                    : new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + PROVIDER + "&url=healthconnect%3A%2F%2Fonboarding"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "failed");
        }
    }

    private void delete(Class<? extends Record> type, List<String> clientIds) throws InterruptedException {
        for (int from = 0; from < clientIds.size(); from += CHUNK) {
            List<String> part = clientIds.subList(from, Math.min(clientIds.size(), from + CHUNK));
            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) ->
                    client().deleteRecords(JvmClassMappingKt.getKotlinClass(type), Collections.emptyList(), part, cont));
        }
    }

    private static List<String> ids(JSArray array) throws JSONException {
        List<String> out = new ArrayList<>();
        // Only real ids: a null or a number from the page is left out, not the whole removal.
        for (int i = 0; i < array.length(); i++) {
            Object v = array.opt(i);
            if (v instanceof String && !((String) v).isEmpty()) out.add((String) v);
        }
        return out;
    }

    // The client id of a session's calories record: the session's own, plus "-kcal".
    private static List<String> kcalIds(JSArray sessions) throws JSONException {
        List<String> out = new ArrayList<>();
        for (String id : ids(sessions)) out.add(id + "-kcal");
        return out;
    }
}
