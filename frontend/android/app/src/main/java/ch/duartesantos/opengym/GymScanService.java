package ch.duartesantos.opengym;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.LocationRequest;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import java.util.Calendar;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The gym reminder's approach check (GymReminder.startCheck): the phone entered the wide zone
 * around a gym, so for a few minutes it asks for live location (one fix every 15 s) to notice the
 * walk through the door, instead of waiting for Android's next proximity-alert look, which for an
 * app in the background can be half an hour away. Ends as soon as one of these is true: the phone
 * is inside a gym (the reminder posts, or the no-nag rule keeps it quiet), it left every approach
 * zone, today got settled meanwhile, or 15 minutes passed. A foreground service because Android
 * only gives background apps a few fixes an hour otherwise; its notification is a silent one on
 * its own channel and goes away with the check.
 *
 * Battery (#1477): while every gym is more than 400 m away the fixes are the cheap kind (balanced
 * power every 30 s; below Android 12 the network provider), GPS-grade every 15 s only closer in.
 * A check also ends once the phone has not come any closer for 5 minutes, unless it waits by a
 * gym. At most 15 minutes, at most 3 checks a day, none once the reminder went off, a workout is
 * logged or the time window is closed. A typical day is one check of a minute or two on the way in.
 */
public class GymScanService extends Service implements LocationListener {
    static final int NOTIFICATION_ID = 3001;
    static final String CHANNEL_ID = "gym-reminder-check";

    private HandlerThread thread;
    private Handler handler;
    private LocationManager lm;
    private boolean running;
    private long startedAt;
    private int fixes;
    /** Whether the cheap kind of fix is asked for (every gym more than 400 m away). */
    private boolean far = true;
    private final GymReminderRules.Progress progress = new GymReminderRules.Progress();

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Context ctx = getApplicationContext();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification(ctx), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIFICATION_ID, notification(ctx));
        } catch (Exception e) {
            GymReminder.note(ctx, "check: could not start (" + e.getClass().getSimpleName() + ")");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;
        running = true;
        startedAt = System.currentTimeMillis();
        thread = new HandlerThread("opengym-gym-scan");
        thread.start();
        handler = new Handler(thread.getLooper());
        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (!GymReminder.hasFine(ctx) || !request(far)) {
            finish("no location");
            return START_NOT_STICKY;
        }
        handler.postDelayed(() -> finish("time up"), GymReminderRules.SCAN_MAX_MS);
        return START_NOT_STICKY;
    }

    /** (Re)starts the updates for the cheap or the sharp kind of fix; false when none can be had. */
    private boolean request(boolean cheap) {
        String provider = provider(lm, cheap);
        if (provider == null) return false;
        long interval = GymReminderRules.intervalFor(cheap);
        try {
            lm.removeUpdates(this);
            if (Build.VERSION.SDK_INT >= 31) {
                LocationRequest req = new LocationRequest.Builder(interval)
                        .setQuality(cheap ? LocationRequest.QUALITY_BALANCED_POWER_ACCURACY : LocationRequest.QUALITY_HIGH_ACCURACY)
                        .setMinUpdateIntervalMillis(5_000L)
                        .setDurationMillis(Math.max(1_000L, GymReminderRules.SCAN_MAX_MS - (System.currentTimeMillis() - startedAt)))
                        .build();
                lm.requestLocationUpdates(provider, req, command -> handler.post(command), this);
            } else {
                lm.requestLocationUpdates(provider, interval, 0f, this, thread.getLooper());
            }
        } catch (Exception e) {
            GymReminder.note(getApplicationContext(), "check: no location (" + e.getClass().getSimpleName() + ")");
            return false;
        }
        GymReminder.note(getApplicationContext(), "check: watching with " + provider + (cheap ? " (far)" : " (near)"));
        return true;
    }

    /** The first provider the rules allow that this phone has and has switched on. */
    private static String provider(LocationManager lm, boolean cheap) {
        if (lm == null) return null;
        for (String p : GymReminderRules.providersFor(cheap, Build.VERSION.SDK_INT)) {
            try {
                if (lm.getAllProviders().contains(p) && lm.isProviderEnabled(p)) return p;
            } catch (Exception ignored) {
            }
        }
        return null;
    }

    @Override
    public void onLocationChanged(Location loc) {
        if (!running || loc == null) return;
        fixes++;
        Context ctx = getApplicationContext();
        Calendar now = Calendar.getInstance();
        String why = GymReminder.skipNow(ctx, now);
        if (why != null) {
            finish("settled (" + why + ")");
            return;
        }
        JSONObject c = GymReminder.config(ctx);
        JSONArray gyms = c == null ? null : c.optJSONArray("gyms");
        int n = gyms == null ? 0 : Math.min(gyms.length(), GymReminder.MAX_GYMS);
        double[] dist = new double[n], radius = new double[n];
        String[] ids = new String[n];
        float[] out = new float[1];
        for (int i = 0; i < n; i++) {
            JSONObject g = gyms.optJSONObject(i);
            if (g == null) {
                dist[i] = Double.MAX_VALUE;
                continue;
            }
            Location.distanceBetween(loc.getLatitude(), loc.getLongitude(), g.optDouble("lat"), g.optDouble("lng"), out);
            dist[i] = out[0];
            radius[i] = Math.max(50, Math.min(500, g.optDouble("radius", 100)));
            ids[i] = g.optString("id", "");
        }
        int in = GymReminderRules.insideOf(dist, radius, loc.hasAccuracy() ? loc.getAccuracy() : 1000);
        if (in >= 0) {
            GymReminder.arrive(ctx, ids[in], now);
            finish("inside after " + (System.currentTimeMillis() - startedAt) / 1000 + " s");
        } else if (n == 0 || GymReminderRules.awayFromAll(dist, radius)) {
            finish("left the area");
        } else if (progress.stalled(GymReminderRules.nearestEdge(dist, radius), System.currentTimeMillis())) {
            finish("not getting closer");
        } else {
            boolean cheap = GymReminderRules.far(dist, far);
            if (cheap != far) {
                far = cheap;
                if (!request(far)) finish("no location");
            }
        }
    }

    // Older Android calls these; nothing to do.
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    private synchronized void finish(String why) {
        if (!running) return;
        running = false;
        try {
            if (lm != null) lm.removeUpdates(this);
        } catch (Exception ignored) {
        }
        GymReminder.note(getApplicationContext(), "check: ended, " + why + ", " + fixes + " fixes in " + (System.currentTimeMillis() - startedAt) / 1000 + " s");
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        finish("stopped");
        super.onDestroy();
    }

    private static Notification notification(Context ctx) {
        JSONObject st = GymReminder.status(ctx);
        String text = st.optString("scan", "");
        if (text.isEmpty()) text = "Checking if you made it to the gym";
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = nm.getNotificationChannel(CHANNEL_ID);
            if (ch == null || !text.contentEquals(ch.getName())) {
                // Silent and out of the way: no sound, no badge, folded away in the shade.
                ch = new NotificationChannel(CHANNEL_ID, text, NotificationManager.IMPORTANCE_MIN);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL_ID) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_dumbbell)
                .setContentTitle(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_MIN);
        return b.build();
    }
}
