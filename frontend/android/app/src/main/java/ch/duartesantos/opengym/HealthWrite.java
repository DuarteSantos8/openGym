package ch.duartesantos.opengym;

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord;
import androidx.health.connect.client.records.ExerciseSegment;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.units.Energy;
import androidx.health.connect.client.units.Mass;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What HealthConnectPlugin writes, as Health Connect records, checked first (v1.4.5, after an
 * uncatchable HealthKit exception killed the iPhone app at every launch on a forgotten workout,
 * TestFlight 59). No Android framework classes, so it is tested on the JVM (HealthWriteTest).
 *
 * Health Connect validates every record when it is made and again when it is inserted (an end not
 * after the start, a weight over 1000 kg, energy over a million kcal, a segment outside its session)
 * and throws IllegalArgumentException; one such record in an insert fails the whole insert. So each
 * record is built on its own here, and one that is not valid is left out, named in `skipped`. The
 * rules are the iPhone's (HealthWriteCore.swift) and lib/health-connect.js's:
 *
 *   a workout     needs an id, a start from 2001 on, an end after it and no later than a day from
 *                 now; one longer than 7 days is not written
 *   its calories  and its sets as segments, only for a workout of at most 24 h, calories finite,
 *                 above 0 and at most 20000; a longer workout (forgotten, left running) is written
 *                 with its real start and end, without them
 *   a weigh-in    needs an id, a time from 2001 on (at most a day ahead) and 0 < kg < 1000
 */
final class HealthWrite {
    private HealthWrite() {}

    static final long DAY_MS = 86_400_000L;
    /** 2001-01-01T00:00:00Z, HealthKit's epoch: the same floor on both phones. */
    static final long EPOCH_MS = 978_307_200_000L;
    static final long MAX_SESSION_MS = 7 * DAY_MS;
    static final long ENERGY_SPAN_MS = DAY_MS;
    static final double MAX_KCAL = 20_000;
    static final double MAX_KG = 1000;
    static final long FUTURE_SLACK_MS = DAY_MS;
    /** Health Connect's limit for a title or notes (lib/health-connect.js TEXT_MAX). */
    static final int TEXT_MAX = 1000;
    static final int MAX_REPS = 10_000;

    /** The records of one write, each with the id of what it belongs to, and the ids left out. */
    static final class Batch {
        final List<Record> records = new ArrayList<>();
        final List<String> owners = new ArrayList<>();
        final List<String> skipped = new ArrayList<>();

        void add(Record r, String owner) { records.add(r); owners.add(owner); }
    }

    /** A time (ms) from JS as a long, or null when it is missing, NaN, infinite or out of range. */
    static Long time(JSONObject o, String key, long now) {
        if (o == null) return null;
        Object v = o.opt(key);
        if (!(v instanceof Number)) return null;
        double d = ((Number) v).doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d) || d < EPOCH_MS || d > now + FUTURE_SLACK_MS) return null;
        return (long) d;
    }

    private static String id(JSONObject o) {
        Object v = o == null ? null : o.opt("id");
        return v instanceof String && !((String) v).isEmpty() ? (String) v : null;
    }

    private static String text(JSONObject o, String key) {
        String t = o.optString(key, "");
        if (t.length() <= TEXT_MAX) return t.isEmpty() ? null : t;
        // Not cut through a surrogate pair.
        int n = Character.isHighSurrogate(t.charAt(TEXT_MAX - 2)) ? TEXT_MAX - 2 : TEXT_MAX - 1;
        return t.substring(0, n) + "…";
    }

    /** The calories to write, or null (NaN, infinite, zero, negative, absurd, not a number). */
    static Double kcal(JSONObject s) {
        Object v = s.opt("kcal");
        if (!(v instanceof Number)) return null;
        double d = ((Number) v).doubleValue();
        return d > 0 && d <= MAX_KCAL ? d : null;
    }

    /** Every record of these sessions and weigh-ins that Health Connect takes. */
    static Batch build(JSONArray sessions, JSONArray weights, boolean withKcal, long version, long now) {
        Batch b = new Batch();
        for (int i = 0; sessions != null && i < sessions.length(); i++) {
            JSONObject s = sessions.optJSONObject(i);
            String id = id(s);
            try {
                ExerciseSessionRecord rec = session(s, version, now);
                if (rec == null) { b.skipped.add(id == null ? "" : id); continue; }
                b.add(rec, id);
                if (withKcal) {
                    ActiveCaloriesBurnedRecord k = calories(s, version, now);
                    if (k != null) b.add(k, id);
                }
            } catch (RuntimeException e) {
                // Health Connect's own checks (IllegalArgumentException) or a value of the wrong type.
                b.skipped.add(id == null ? "" : id);
            }
        }
        for (int i = 0; weights != null && i < weights.length(); i++) {
            JSONObject w = weights.optJSONObject(i);
            String id = id(w);
            try {
                WeightRecord rec = weight(w, version, now);
                if (rec == null) b.skipped.add(id == null ? "" : id);
                else b.add(rec, id);
            } catch (RuntimeException e) {
                b.skipped.add(id == null ? "" : id);
            }
        }
        return b;
    }

    // The offset in force at that moment where the phone is now: what Health Connect shows the
    // session's local time with.
    static ZoneOffset offsetAt(Instant at) {
        return ZoneId.systemDefault().getRules().getOffset(at);
    }

    /** The workout, or null when it is not one Health Connect takes. */
    static ExerciseSessionRecord session(JSONObject s, long version, long now) {
        String id = id(s);
        Long startMs = time(s, "start", now), endMs = time(s, "end", now);
        if (id == null || startMs == null || endMs == null || endMs <= startMs || endMs - startMs > MAX_SESSION_MS) return null;
        Instant start = Instant.ofEpochMilli(startMs);
        Instant end = Instant.ofEpochMilli(endMs);
        String title = text(s, "title");
        String notes = text(s, "notes");
        int type = exerciseType(s.optString("type", ""));
        List<ExerciseSegment> segments = endMs - startMs <= ENERGY_SPAN_MS ? segments(s.optJSONArray("segments"), start, end) : new ArrayList<>();
        if (!segments.isEmpty()) {
            try {
                return new ExerciseSessionRecord(start, offsetAt(start), end, offsetAt(end),
                        Metadata.manualEntry(id, version), type, title, notes, segments);
            } catch (IllegalArgumentException e) {
                // A segment Health Connect does not take for this session: the workout without them.
            }
        }
        return new ExerciseSessionRecord(start, offsetAt(start), end, offsetAt(end),
                Metadata.manualEntry(id, version), type, title, notes);
    }

    // The sets as segments (lib/health-segments.js, idea from #816): in order, inside the session,
    // never overlapping. One that breaks any of that is dropped, not the workout.
    static List<ExerciseSegment> segments(JSONArray list, Instant start, Instant end) {
        List<ExerciseSegment> out = new ArrayList<>();
        if (list == null) return out;
        Instant floor = start;
        for (int i = 0; i < list.length(); i++) {
            JSONObject g = list.optJSONObject(i);
            if (g == null) continue;
            double a = g.optDouble("start", Double.NaN), z = g.optDouble("end", Double.NaN);
            if (Double.isNaN(a) || Double.isNaN(z) || Double.isInfinite(a) || Double.isInfinite(z)) continue;
            Instant from = Instant.ofEpochMilli((long) a);
            Instant to = Instant.ofEpochMilli((long) z);
            if (from.isBefore(floor) || !to.isAfter(from) || to.isAfter(end)) continue;
            double r = g.optDouble("reps", 0);
            int reps = Double.isNaN(r) ? 0 : (int) Math.max(0, Math.min(MAX_REPS, r));
            try {
                out.add(new ExerciseSegment(from, to, segmentType(g.optString("type", "")), reps));
                floor = to;
            } catch (IllegalArgumentException ignored) { /* left out */ }
        }
        return out;
    }

    static int segmentType(String name) {
        switch (name) {
            case "arm_curl": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_ARM_CURL;
            case "back_extension": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_BACK_EXTENSION;
            case "barbell_shoulder_press": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_BARBELL_SHOULDER_PRESS;
            case "bench_press": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_BENCH_PRESS;
            case "bench_sit_up": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_BENCH_SIT_UP;
            case "burpee": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_BURPEE;
            case "crunch": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_CRUNCH;
            case "deadlift": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_DEADLIFT;
            case "double_arm_triceps_extension": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_DOUBLE_ARM_TRICEPS_EXTENSION;
            case "dumbbell_front_raise": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_DUMBBELL_FRONT_RAISE;
            case "dumbbell_lateral_raise": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_DUMBBELL_LATERAL_RAISE;
            case "dumbbell_row": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_DUMBBELL_ROW;
            case "dumbbell_triceps_extension_two_arm": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_DUMBBELL_TRICEPS_EXTENSION_TWO_ARM;
            case "front_raise": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_FRONT_RAISE;
            case "hip_thrust": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_HIP_THRUST;
            case "jumping_jack": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_JUMPING_JACK;
            case "kettlebell_swing": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_KETTLEBELL_SWING;
            case "lat_pull_down": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_LAT_PULL_DOWN;
            case "lateral_raise": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_LATERAL_RAISE;
            case "leg_curl": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_LEG_CURL;
            case "leg_extension": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_LEG_EXTENSION;
            case "leg_press": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_LEG_PRESS;
            case "leg_raise": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_LEG_RAISE;
            case "lunge": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_LUNGE;
            case "mountain_climber": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_MOUNTAIN_CLIMBER;
            case "plank": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_PLANK;
            case "pull_up": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_PULL_UP;
            case "shoulder_press": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_SHOULDER_PRESS;
            case "sit_up": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_SIT_UP;
            case "squat": return ExerciseSegment.EXERCISE_SEGMENT_TYPE_SQUAT;
            default: return ExerciseSegment.EXERCISE_SEGMENT_TYPE_WEIGHTLIFTING;
        }
    }

    static int exerciseType(String name) {
        switch (name) {
            case "strength_training": return ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING;
            case "walking": return ExerciseSessionRecord.EXERCISE_TYPE_WALKING;
            case "running": return ExerciseSessionRecord.EXERCISE_TYPE_RUNNING;
            case "biking_stationary": return ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY;
            case "elliptical": return ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL;
            case "stair_climbing_machine": return ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE;
            case "biking": return ExerciseSessionRecord.EXERCISE_TYPE_BIKING;
            case "rowing": return ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE;
            case "hiit": return ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING;
            case "yoga": return ExerciseSessionRecord.EXERCISE_TYPE_YOGA;
            case "flexibility": return ExerciseSessionRecord.EXERCISE_TYPE_STRETCHING;
            // Health Connect has no jump rope and no mixed cardio: those are "other", as before.
            default: return ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT;
        }
    }

    /** The estimate from lib/active-energy.js over the session's own time, or null for none. */
    static ActiveCaloriesBurnedRecord calories(JSONObject s, long version, long now) {
        String id = id(s);
        Long startMs = time(s, "start", now), endMs = time(s, "end", now);
        Double kcal = kcal(s);
        if (id == null || startMs == null || endMs == null || kcal == null || endMs <= startMs || endMs - startMs > ENERGY_SPAN_MS) return null;
        Instant start = Instant.ofEpochMilli(startMs);
        Instant end = Instant.ofEpochMilli(endMs);
        return new ActiveCaloriesBurnedRecord(start, offsetAt(start), end, offsetAt(end),
                Energy.kilocalories(kcal), Metadata.manualEntry(id + "-kcal", version));
    }

    /** The weigh-in, or null when it is not one Health Connect takes. */
    static WeightRecord weight(JSONObject w, long version, long now) {
        String id = id(w);
        Long t = time(w, "time", now);
        double kg = w == null ? Double.NaN : w.optDouble("kg", Double.NaN);
        if (id == null || t == null || !(kg > 0 && kg < MAX_KG)) return null;
        Instant time = Instant.ofEpochMilli(t);
        return new WeightRecord(time, offsetAt(time), Mass.kilograms(kg), Metadata.manualEntry(id, version));
    }
}
