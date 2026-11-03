package ch.duartesantos.opengym;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The gym reminder (#614): a notification when the phone walks into one of the user's gyms.
 *
 * The platform's own proximity alerts (LocationManager.addProximityAlert) watch the gyms, so it
 * works without Google Play Services (the APK and F-Droid builds too) and with the app closed; the
 * system hands GymReminderReceiver a broadcast on entering, which decides with GymReminderRules
 * whether to post. Proximity alerts do not survive a restart or an app update:
 * GymReminderBootReceiver registers them again.
 *
 * Android only looks at proximity alerts for a background app every 30 minutes, unless another
 * app's location request feeds it a fix. So every gym gets a second, wide alert (the approach
 * zone, GymReminderRules.approachOf): entering it starts GymScanService, a short check with live
 * location that notices the walk into the gym within a fix or two and then stops (at most 15
 * minutes, at most 3 times a day, never once today is settled). The gym's own alert stays as the
 * fallback.
 *
 * Before posting, a paired phone asks its server whether today was trained somewhere else (a
 * workout logged on the web or another phone this one has not synced yet), bounded to 3 seconds;
 * no server, no network or no answer in time: the phone's own status decides, as before.
 *
 * What is kept, in the app's private preferences: the config the page saved (gyms with their
 * places, the time window), the status it last reported (last day trained, a running session, the
 * notification's words) and the day it last went off. That file is left out of Android's cloud
 * backup and device transfer (res/xml/backup_rules.xml, data_extraction_rules.xml): the places
 * stay on this phone, and never go to the user's server either.
 */
final class GymReminder {
    static final String PREFS = "opengym_gym_reminder";
    static final String CHANNEL_ID = "gym-reminder";
    static final int NOTIFICATION_ID = 3000;
    static final int MAX_GYMS = 20;
    /** The request codes of the proximity alerts' PendingIntents: one per gym slot. */
    private static final int REQUEST_BASE = 46_300;
    /**
     * An alert reports "entering" as soon as it is added while the phone is already inside, which
     * would ping right after "I'm at the gym right now". Entries this soon after arming are ignored.
     */
    static final long ARM_GRACE_MS = 90_000L;

    static final String TAG = "OpenGymGym";
    /** The approach alerts use the request codes after the gyms' own ones. */
    private static final int NEAR_SLOT = MAX_GYMS;
    /** How long the server may take to say how today stands before the phone decides alone. */
    static final long SERVER_CHECK_MS = 3_000L;

    static String actionEnter(Context ctx) { return ctx.getPackageName() + ".GYM_ENTER"; }
    static String actionCheck(Context ctx) { return ctx.getPackageName() + ".GYM_CHECK"; }
    static String actionOpen(Context ctx) { return ctx.getPackageName() + ".GYM_REMINDER_OPEN"; }

    private GymReminder() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- what is kept

    static void saveConfig(Context ctx, JSONObject config) {
        prefs(ctx).edit().putString("config", config.toString()).apply();
    }

    static JSONObject config(Context ctx) {
        try {
            String s = prefs(ctx).getString("config", null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    static void saveStatus(Context ctx, JSONObject status) {
        prefs(ctx).edit().putString("status", status.toString()).apply();
    }

    static JSONObject status(Context ctx) {
        try {
            String s = prefs(ctx).getString("status", null);
            return s == null ? new JSONObject() : new JSONObject(s);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    /**
     * The paired server and the headers a request to it carries (the pairing token), from the page
     * (GymReminderPlugin.server); null or an empty server forgets them. Encrypted with the app's
     * Keystore key (NudgeCheck.seal), in the same file as the gyms, so also out of backups.
     */
    static void saveServer(Context ctx, JSONObject auth) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        String[] sealed = auth == null || auth.optString("server", "").isEmpty() ? null : NudgeCheck.seal(auth.toString());
        if (sealed == null) e.remove("authIv").remove("auth");
        else e.putString("authIv", sealed[0]).putString("auth", sealed[1]);
        e.apply();
    }

    static JSONObject server(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String plain = NudgeCheck.open(p.getString("authIv", null), p.getString("auth", null));
        try {
            return plain == null ? null : new JSONObject(plain);
        } catch (Exception e) {
            return null;
        }
    }

    /** What happened at the last arrival or check, for the emulator proof and bug reports. */
    static void note(Context ctx, String what) {
        Log.i(TAG, what);
        prefs(ctx).edit().putString("lastNote", what).apply();
    }

    // ---------------------------------------------------------------- permissions

    static boolean hasFine(Context ctx) {
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Before Android 10 there is no separate background permission: the location one covers it. */
    static boolean hasBackground(Context ctx) {
        if (Build.VERSION.SDK_INT < 29) return hasFine(ctx);
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // ---------------------------------------------------------------- watching

    private static PendingIntent alertIntent(Context ctx, int slot, String gymId, int flags) {
        Intent i = new Intent(ctx, GymReminderReceiver.class).setAction(actionEnter(ctx));
        if (gymId != null) i.putExtra("gym", gymId);
        if (slot >= NEAR_SLOT) i.putExtra("near", true);
        // Mutable: the system adds KEY_PROXIMITY_ENTERING to it. Explicit, so nothing else can fill it in.
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        return PendingIntent.getBroadcast(ctx, REQUEST_BASE + slot, i, flags | mutable);
    }

    /** Stops every alert this app may have registered. */
    static void unregister(Context ctx) {
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        for (int slot = 0; slot < 2 * MAX_GYMS; slot++) {
            PendingIntent pi = alertIntent(ctx, slot, null, PendingIntent.FLAG_NO_CREATE);
            if (pi == null) continue;
            try {
                if (lm != null) lm.removeProximityAlert(pi);
            } catch (Exception ignored) {
                // no permission any more: the system dropped it already
            }
            pi.cancel();
        }
        prefs(ctx).edit().putInt("watching", 0).apply();
    }

    /**
     * Watches the saved gyms, or nothing when the reminder is off or location may not be used.
     * Returns how many gyms are watched.
     */
    static int register(Context ctx) {
        unregister(ctx);
        JSONObject c = config(ctx);
        if (c == null || !c.optBoolean("on", false) || !hasFine(ctx)) return 0;
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return 0;
        JSONArray gyms = c.optJSONArray("gyms");
        int n = 0;
        for (int slot = 0; gyms != null && slot < gyms.length() && slot < MAX_GYMS; slot++) {
            JSONObject g = gyms.optJSONObject(slot);
            if (g == null) continue;
            double lat = g.optDouble("lat", Double.NaN), lng = g.optDouble("lng", Double.NaN);
            float radius = (float) Math.max(50, Math.min(500, g.optDouble("radius", 100)));
            if (Double.isNaN(lat) || Double.isNaN(lng)) continue;
            try {
                lm.addProximityAlert(lat, lng, radius, -1, alertIntent(ctx, slot, g.optString("id", ""), PendingIntent.FLAG_UPDATE_CURRENT));
                lm.addProximityAlert(lat, lng, (float) GymReminderRules.approachOf(radius), -1,
                        alertIntent(ctx, NEAR_SLOT + slot, g.optString("id", ""), PendingIntent.FLAG_UPDATE_CURRENT));
                n++;
            } catch (SecurityException e) {
                break;
            }
        }
        prefs(ctx).edit().putInt("watching", n).putLong("armedAt", System.currentTimeMillis()).apply();
        return n;
    }

    static int watching(Context ctx) {
        return prefs(ctx).getInt("watching", 0);
    }

    // ---------------------------------------------------------------- arriving

    /** From GymReminderReceiver: a proximity alert fired. */
    static void onAlert(Context ctx, Intent intent) {
        if (!intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false)) return;
        SharedPreferences p = prefs(ctx);
        if (System.currentTimeMillis() - p.getLong("armedAt", 0) < ARM_GRACE_MS) return;
        if (intent.getBooleanExtra("near", false)) startCheck(ctx, intent.getStringExtra("gym"), Calendar.getInstance());
        else arrive(ctx, intent.getStringExtra("gym"), Calendar.getInstance());
    }

    /** The no-nag rule for now (GymReminderRules.skipReason), or "off" without a config. */
    static String skipNow(Context ctx, Calendar now) {
        JSONObject c = config(ctx);
        if (c == null) return "off";
        JSONObject st = status(ctx);
        JSONObject win = c.optJSONObject("window");
        JSONArray gyms = c.optJSONArray("gyms");
        return GymReminderRules.skipReason(
                c.optBoolean("on", false), gyms == null ? 0 : gyms.length(),
                win == null ? null : win.optString("from", null), win == null ? null : win.optString("to", null),
                st.optString("trainedOn", ""), st.optString("quietOn", ""), st.optLong("activeSince", 0),
                prefs(ctx).getString("lastFired", ""), now);
    }

    /**
     * The phone entered a gym's approach zone: start the short check with live location, unless
     * today is settled already (no point looking), three checks ran today, or Android refuses.
     */
    static void startCheck(Context ctx, String gymId, Calendar now) {
        String why = skipNow(ctx, now);
        if (why != null) {
            note(ctx, "near " + gymId + ": no check (" + why + ")");
            return;
        }
        SharedPreferences p = prefs(ctx);
        String today = GymReminderRules.isoOf(now);
        String day = p.getString("scanDay", "");
        int count = today.equals(day) ? p.getInt("scans", 0) : 0;
        if (!GymReminderRules.mayScan(day, count, today)) {
            note(ctx, "near " + gymId + ": no check (3 today)");
            return;
        }
        String how = launchCheck(ctx);
        if (how == null) {
            // Android 12+ refuses a foreground service from the background unless the app may
            // set exact alarms or runs with unrestricted battery: the gym's own alert still
            // fires, just on the system's slower schedule.
            note(ctx, "near " + gymId + ": check refused (background start not allowed)");
            return;
        }
        p.edit().putString("scanDay", today).putInt("scans", count + 1).apply();
        note(ctx, "near " + gymId + ": check started (" + how + ")");
    }

    /**
     * Starts GymScanService. Android 12+ lets a background app start a foreground service only
     * with an exemption: unrestricted battery (works directly), or the right to set exact alarms
     * (an exact alarm a moment later may start it: GymReminderReceiver, actionCheck). Returns how
     * it went ("direct", "alarm"), or null when neither is possible.
     */
    static String launchCheck(Context ctx) {
        if (startScan(ctx)) return "direct";
        if (Build.VERSION.SDK_INT < 31) return null;
        android.app.AlarmManager am = (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null || !am.canScheduleExactAlarms()) return null;
        Intent i = new Intent(ctx, GymReminderReceiver.class).setAction(actionCheck(ctx));
        PendingIntent pi = PendingIntent.getBroadcast(ctx, REQUEST_BASE + 2 * MAX_GYMS, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try {
            am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 500, pi);
            return "alarm";
        } catch (SecurityException e) {
            return null;
        }
    }

    /**
     * Whether the approach check can start with the app in the background: always before
     * Android 12; from 12 on with unrestricted battery or with the right to set exact alarms.
     */
    static boolean quickCheckAllowed(Context ctx) {
        if (Build.VERSION.SDK_INT < 31) return true;
        android.os.PowerManager pm = (android.os.PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) return true;
        android.app.AlarmManager am = (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /** True when the check's foreground service could be started from here. */
    static boolean startScan(Context ctx) {
        try {
            Intent i = new Intent(ctx, GymScanService.class);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
            return true;
        } catch (Exception e) {
            Log.i(TAG, "check: start refused (" + e.getClass().getSimpleName() + ")");
            return false;
        }
    }

    /**
     * Applies the no-nag rule for arriving at `gymId` now, and posts if it says so. True if posted.
     * One at a time: the gym's own alert and the approach check can both see the same arrival.
     */
    static synchronized boolean arrive(Context ctx, String gymId, Calendar now) {
        JSONObject c = config(ctx);
        if (c == null) return false;
        JSONObject st = status(ctx);
        JSONArray gyms = c.optJSONArray("gyms");
        SharedPreferences p = prefs(ctx);
        String why = skipNow(ctx, now);
        if (why != null) {
            note(ctx, "at " + gymId + ": quiet (" + why + ")");
            return false;
        }
        String today = GymReminderRules.isoOf(now);
        if (trainedElsewhere(ctx, today)) {
            // Remember it, so the next alert today needs no network.
            try {
                saveStatus(ctx, status(ctx).put("trainedOn", today));
            } catch (Exception ignored) {
            }
            note(ctx, "at " + gymId + ": quiet (trained on another device)");
            return false;
        }
        JSONObject gym = null;
        for (int i = 0; gyms != null && i < gyms.length(); i++) {
            JSONObject g = gyms.optJSONObject(i);
            if (g != null && g.optString("id", "").equals(gymId)) gym = g;
        }
        String title = st.optString("title", "");
        String body = gym != null && !gym.optString("text", "").trim().isEmpty() ? gym.optString("text") : st.optString("body", "");
        if (title.isEmpty()) title = "Gym spotted";
        if (body.isEmpty()) body = "Ready for your workout? 💪";
        if (!post(ctx, title, body, st.optString("channel", ""))) return false;
        p.edit().putString("lastFired", GymReminderRules.isoOf(now)).apply();
        note(ctx, "at " + gymId + ": posted");
        return true;
    }

    // ---------------------------------------------------------------- the server's word on today

    private static boolean online(Context ctx) {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            if (Build.VERSION.SDK_INT < 23) {
                android.net.NetworkInfo ni = cm.getActiveNetworkInfo();
                return ni != null && ni.isConnected();
            }
            Network n = cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Whether the paired server says `today` was trained or excused (GET /api/nudge-check, the
     * same few bytes the missed-day check asks for). False without a server, offline, on any
     * error and after SERVER_CHECK_MS: the phone then goes by what it knows. Runs off the main
     * thread (the receiver's and the check's own threads).
     */
    static boolean trainedElsewhere(Context ctx, String today) {
        JSONObject auth = server(ctx);
        String base = auth == null ? "" : auth.optString("server", "").replaceAll("/+$", "");
        if (base.isEmpty()) return false;
        if (!online(ctx)) {
            note(ctx, "server check skipped (offline)");
            return false;
        }
        JSONObject headers = auth.optJSONObject("headers");
        ExecutorService ex = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "opengym-gym-check");
            t.setDaemon(true);
            return t;
        });
        long t0 = System.currentTimeMillis();
        Future<Boolean> f = ex.submit(() -> {
            HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/nudge-check?date=" + URLEncoder.encode(today, "UTF-8")).openConnection();
            try {
                c.setConnectTimeout((int) SERVER_CHECK_MS);
                c.setReadTimeout((int) SERVER_CHECK_MS);
                c.setInstanceFollowRedirects(false);
                c.setRequestProperty("Accept", "application/json");
                if (headers != null) {
                    for (Iterator<String> it = headers.keys(); it.hasNext();) {
                        String k = it.next();
                        c.setRequestProperty(k, headers.optString(k));
                    }
                }
                if (c.getResponseCode() != 200) return false;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[1024];
                    for (int n; (n = in.read(buf)) > 0 && out.size() < 8192;) out.write(buf, 0, n);
                }
                JSONObject a = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
                return today.equals(a.optString("date", null)) && Boolean.TRUE.equals(a.opt("done"));
            } finally {
                c.disconnect();
            }
        });
        try {
            boolean done = f.get(SERVER_CHECK_MS, TimeUnit.MILLISECONDS);
            note(ctx, "server check: " + (done ? "done" : "not done") + " in " + (System.currentTimeMillis() - t0) + " ms");
            return done;
        } catch (Exception e) {
            f.cancel(true);
            note(ctx, "server check: no answer (" + e.getClass().getSimpleName() + ") after " + (System.currentTimeMillis() - t0) + " ms");
            return false;
        } finally {
            ex.shutdownNow();
        }
    }

    static boolean post(Context ctx, String title, String body, String channelName) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || !nm.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, channelName.isEmpty() ? "Gym reminder" : channelName, NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class).setAction(actionOpen(ctx));
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(ctx, NOTIFICATION_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL_ID) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_dumbbell)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis())
                .setCategory(Notification.CATEGORY_REMINDER)
                .setContentIntent(tap);
        try {
            nm.notify(NOTIFICATION_ID, b.build());
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
