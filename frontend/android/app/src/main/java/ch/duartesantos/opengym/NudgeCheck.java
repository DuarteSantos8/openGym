package ch.duartesantos.opengym;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The background check before a missed-day nudge or a workout-day reminder the app scheduled on
 * the phone (frontend lib/nudge-check.js; NudgeCheckPlugin hands it over, NudgeCheckJob runs it).
 * What it keeps: the paired server, the headers a request to it carries (the pairing token among
 * them) and the days something is scheduled for. That goes into the app's private preferences
 * encrypted with a key of the Android Keystore, so the token is no easier to read than in the
 * pairing file it comes from.
 */
final class NudgeCheck {
    static final int JOB_ID = 46_201;
    private static final String PREFS = "opengym_nudge_check";
    private static final String KEY_ALIAS = "opengym-nudge-check";
    private static final long MINUTE = 60_000L;

    private NudgeCheck() {}

    // ---------------------------------------------------------------- what is kept

    static boolean save(Context ctx, JSONObject config) {
        String[] sealed = seal(config.toString());
        if (sealed == null) return false;
        prefs(ctx).edit().putString("iv", sealed[0]).putString("config", sealed[1]).apply();
        return true;
    }

    static JSONObject load(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String plain = open(p.getString("iv", null), p.getString("config", null));
        try {
            return plain == null ? null : new JSONObject(plain);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * `plain` encrypted with this app's Keystore key, as { iv, sealed } in Base64, or null. Also
     * keeps the gym reminder's copy of the server and its headers (GymReminder.saveServer).
     */
    static String[] seal(String plain) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] sealed = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return new String[] { Base64.encodeToString(c.getIV(), Base64.NO_WRAP), Base64.encodeToString(sealed, Base64.NO_WRAP) };
        } catch (Exception e) {
            return null;
        }
    }

    /** The other way round; null when either part is missing or does not open. */
    static String open(String iv, String sealed) {
        if (iv == null || sealed == null) return null;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(sealed, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    static void clear(Context ctx) {
        prefs(ctx).edit().clear().apply();
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(JOB_ID);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return gen.generateKey();
    }

    // ---------------------------------------------------------------- the days

    /** The days still ahead, soonest first. */
    static List<JSONObject> upcoming(JSONObject config, long now) {
        List<JSONObject> out = new ArrayList<>();
        JSONArray entries = config.optJSONArray("entries");
        if (entries == null) return out;
        for (int i = 0; i < entries.length(); i++) {
            JSONObject e = entries.optJSONObject(i);
            if (e != null && e.optLong("at") > now) out.add(e);
        }
        Collections.sort(out, (a, b) -> Long.compare(a.optLong("at"), b.optLong("at")));
        return out;
    }

    /**
     * Runs the check in the half hour before the next day's first notification, with a network
     * if there is one; at the end of that window it runs anyway (and, offline, changes nothing).
     */
    static void schedule(Context ctx, JSONObject config) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        js.cancel(JOB_ID);
        List<JSONObject> next = upcoming(config, System.currentTimeMillis());
        if (next.isEmpty()) return;
        long now = System.currentTimeMillis();
        long at = next.get(0).optLong("at");
        long from = Math.max(0, at - 30 * MINUTE - now);
        long until = Math.max(from + MINUTE, at - 2 * MINUTE - now);
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, NudgeCheckJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(from)
                .setOverrideDeadline(until)
                .setPersisted(true)
                .build();
        js.schedule(job);
    }

    /**
     * The rule lib/nudge-check.js idsToCancel spells out: a day trained or excused takes its
     * reminder and its nudge, a day the server would not nudge takes the nudge, anything else
     * (another day's answer included) takes nothing.
     */
    static List<Integer> idsToCancel(JSONObject entry, JSONObject answer) {
        List<Integer> out = new ArrayList<>();
        if (entry == null || answer == null) return out;
        String date = entry.optString("date", "");
        if (date.isEmpty() || !date.equals(answer.optString("date", null))) return out;
        boolean done = answer.optBoolean("done", false) && answer.opt("done") instanceof Boolean;
        boolean noNudge = answer.opt("nudge") instanceof Boolean && !answer.optBoolean("nudge", true);
        if (done) addAll(out, entry.optJSONArray("reminder"));
        if (done || noNudge) addAll(out, entry.optJSONArray("nudge"));
        return out;
    }

    private static void addAll(List<Integer> out, JSONArray ids) {
        if (ids == null) return;
        for (int i = 0; i < ids.length(); i++) if (ids.opt(i) instanceof Number) out.add(ids.optInt(i));
    }

    /**
     * Takes back notifications @capacitor/local-notifications scheduled: its alarm (the same
     * PendingIntent it set, LocalNotificationManager.cancelTimerForNotification) and its stored
     * record, which a reboot would otherwise schedule again.
     */
    static void cancelScheduled(Context ctx, List<Integer> ids) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        NotificationStorage storage = new NotificationStorage(ctx);
        for (int id : ids) {
            int flags = PendingIntent.FLAG_NO_CREATE;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(ctx, id, new Intent(ctx, TimedNotificationPublisher.class), flags);
            if (pi != null) {
                if (am != null) am.cancel(pi);
                pi.cancel();
            }
            storage.deleteNotification(String.valueOf(id));
        }
    }
}
