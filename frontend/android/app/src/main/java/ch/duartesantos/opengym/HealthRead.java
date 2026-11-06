package ch.duartesantos.opengym;

import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import java.util.ArrayList;
import java.util.List;

/**
 * What HealthConnectPlugin hands to JS when it reads (v1.4.3): plain values, no Android classes,
 * so it is tested on the JVM (HealthReadTest). Heart rate as [ms, bpm] pairs inside the window
 * asked for; weigh-ins as { t, kg, id, origin, clientId }. Which of them openGym takes, and how,
 * is decided in JS (lib/health-read.js), which also skips openGym's own records.
 */
final class HealthRead {
    private HealthRead() {}

    // Beyond this no reading is plausible; lib/heart-rate.js applies the same bounds again.
    static final long BPM_MIN = 25;
    static final long BPM_MAX = 250;
    // A workout of a few hours at one sample a second is well under this.
    static final int MAX_SAMPLES = 50000;

    /** The samples of these records that lie in [from, to], oldest first. */
    static List<long[]> samples(List<HeartRateRecord> records, long from, long to) {
        List<long[]> out = new ArrayList<>();
        for (HeartRateRecord r : records) {
            for (HeartRateRecord.Sample s : r.getSamples()) {
                long t = s.getTime().toEpochMilli();
                long bpm = s.getBeatsPerMinute();
                if (t < from || t > to || bpm < BPM_MIN || bpm > BPM_MAX) continue;
                out.add(new long[] { t, bpm });
                if (out.size() >= MAX_SAMPLES) break;
            }
            if (out.size() >= MAX_SAMPLES) break;
        }
        out.sort((a, b) -> Long.compare(a[0], b[0]));
        return out;
    }

    /** One weigh-in as JS gets it. */
    static final class Weight {
        final long t;
        final double kg;
        final String id, origin, clientId;

        Weight(long t, double kg, String id, String origin, String clientId) {
            this.t = t; this.kg = kg; this.id = id; this.origin = origin; this.clientId = clientId;
        }
    }

    static List<Weight> weights(List<WeightRecord> records) {
        List<Weight> out = new ArrayList<>();
        for (WeightRecord r : records) {
            Metadata m = r.getMetadata();
            double kg = r.getWeight().getKilograms();
            if (!(kg > 0)) continue;
            out.add(new Weight(r.getTime().toEpochMilli(), kg, m.getId(),
                    m.getDataOrigin().getPackageName(), m.getClientRecordId()));
        }
        return out;
    }

    /** One body-composition reading as JS gets it: kind fat (%), lean or bone (kg), bmr (kcal a day). */
    static final class Body {
        final String kind, id, origin, clientId;
        final long t;
        final double v;

        Body(String kind, long t, double v, String id, String origin, String clientId) {
            this.kind = kind; this.t = t; this.v = v; this.id = id; this.origin = origin; this.clientId = clientId;
        }
    }

    /** A reading worth handing over: a time and a positive, finite value. */
    static Body body(String kind, long t, double v, Metadata m) {
        if (t <= 0 || !(v > 0) || Double.isInfinite(v)) return null;
        return new Body(kind, t, v, m.getId(), m.getDataOrigin().getPackageName(), m.getClientRecordId());
    }

    /** The JS names of the read permissions, as the manifest declares them. */
    static String readPermission(String name) {
        switch (name) {
            case "heartRate": return "android.permission.health.READ_HEART_RATE";
            case "weight": return "android.permission.health.READ_WEIGHT";
            // Body composition (v1.4.5): what a smart scale saves besides the weight.
            case "bodyFat": return "android.permission.health.READ_BODY_FAT";
            case "leanMass": return "android.permission.health.READ_LEAN_BODY_MASS";
            case "boneMass": return "android.permission.health.READ_BONE_MASS";
            case "bmr": return "android.permission.health.READ_BASAL_METABOLIC_RATE";
            // Vitals (v1.4.5): the Daily form card and the check-in's sleep.
            case "sleep": return "android.permission.health.READ_SLEEP";
            case "restingHeartRate": return "android.permission.health.READ_RESTING_HEART_RATE";
            case "hrv": return "android.permission.health.READ_HEART_RATE_VARIABILITY";
            case "steps": return "android.permission.health.READ_STEPS";
            // Not a data type: data older than 30 days before the first grant (#801).
            case "history": return "android.permission.health.READ_HEALTH_DATA_HISTORY";
            default: return null;
        }
    }

    static String writePermission(String name) {
        switch (name) {
            case "exercise": return "android.permission.health.WRITE_EXERCISE";
            case "weight": return "android.permission.health.WRITE_WEIGHT";
            case "calories": return "android.permission.health.WRITE_ACTIVE_CALORIES_BURNED";
            default: return null;
        }
    }
}
