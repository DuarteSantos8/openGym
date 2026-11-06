package ch.duartesantos.opengym;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The running workout as one ongoing notification (#760), the Android side of what the iPhone's
 * Live Activity shows. The page sends the card (LiveActivityPlugin, lib/live-activity.js); it is kept
 * here so the buttons work with the page asleep or the process gone (WorkoutCardReceiver).
 *
 * One notification, never two: the card and the rest countdown share COUNTDOWN_ID. While a rest
 * runs, RestTimerService owns that id and draws the rest with the next set under it; when the rest
 * is over or skipped the service goes and the card comes back. The rest-over alert stays its own.
 *
 * Android 16 and later: a Live Update (promoted ongoing, a chip by the clock) with a progress bar for
 * the session or the rest. Older phones get the same card as a plain ongoing notification.
 */
final class WorkoutNotification {
    static final String CHANNEL_ID = "workout-card";
    private static final String PREFS = "opengym_workout_card";
    private static final String K_ATTRS = "attributes";
    private static final String K_STATE = "state";
    private static final String K_EVENTS = "events";
    private static final Object LOCK = new Object();
    private static final int FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    // The extra Notification.Builder#setRequestPromotedOngoing sets (Android 16 QPR2). compileSdk 36
    // does not have the method yet; the system reads the extra on every Android 16.
    private static final String EXTRA_PROMOTE = "android.requestPromotedOngoing";

    private WorkoutNotification() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject attributes(Context ctx) {
        return WorkoutCard.parse(prefs(ctx).getString(K_ATTRS, null));
    }

    static JSONObject state(Context ctx) {
        return WorkoutCard.parse(prefs(ctx).getString(K_STATE, null));
    }

    static boolean active(Context ctx) {
        return state(ctx) != null && attributes(ctx) != null;
    }

    static String wid(JSONObject attributes) {
        return attributes == null ? "" : attributes.optString("wid", "");
    }

    /** The page's card for this workout; a card for another workout is replaced. */
    static void save(Context ctx, String attributes, String state) {
        synchronized (LOCK) {
            prefs(ctx).edit().putString(K_ATTRS, attributes).putString(K_STATE, state).apply();
        }
    }

    static void saveState(Context ctx, JSONObject state) {
        synchronized (LOCK) {
            prefs(ctx).edit().putString(K_STATE, state.toString()).apply();
        }
    }

    /** The workout is over (finished, discarded): the card goes, the queued taps stay for the page. */
    static void clear(Context ctx) {
        synchronized (LOCK) {
            prefs(ctx).edit().remove(K_ATTRS).remove(K_STATE).apply();
        }
        if (!RestTimerService.isRunning()) cancel(ctx);
    }

    /* ---------- the taps waiting for the page ---------- */

    static void queue(Context ctx, JSONObject event) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            JSONArray q = WatchEventQueue.add(WatchEventQueue.parse(p.getString(K_EVENTS, null)), event.toString(), System.currentTimeMillis());
            if (q != null) p.edit().putString(K_EVENTS, q.toString()).apply();
        }
    }

    static JSONArray events(Context ctx) {
        return WatchEventQueue.events(WatchEventQueue.parse(prefs(ctx).getString(K_EVENTS, null)));
    }

    static void ack(Context ctx, Collection<String> ids) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            p.edit().putString(K_EVENTS, WatchEventQueue.ack(WatchEventQueue.parse(p.getString(K_EVENTS, null)), ids).toString()).apply();
        }
    }

    /* ---------- drawing ---------- */

    static boolean allowed(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && (Build.VERSION.SDK_INT < 24 || nm.areNotificationsEnabled());
    }

    /**
     * Brings the notification in line with the stored card: the rest's service draws it while one
     * runs, otherwise it is posted here. Without notification permission nothing is posted.
     */
    static void refresh(Context ctx) {
        if (RestTimerService.isRunning()) {
            Intent i = new Intent(ctx, RestTimerService.class).setAction(RestAlert.ACTION_REFRESH);
            try { ctx.startService(i); } catch (Exception ignored) { /* the service draws it on its next tick */ }
            return;
        }
        post(ctx);
    }

    /** Posts the card itself (no rest service running). */
    static void post(Context ctx) {
        JSONObject attrs = attributes(ctx), state = state(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (attrs == null || state == null) return;
        if (!allowed(ctx)) return;
        try {
            nm.notify(RestAlert.COUNTDOWN_ID, card(ctx, attrs, state));
        } catch (Exception e) {
            Log.w("openGym", "workout card not posted", e);
        }
    }

    static void cancel(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(RestAlert.COUNTDOWN_ID);
    }

    private static void ensureChannel(Context ctx, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26 || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, ctx.getString(R.string.workout_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription(ctx.getString(R.string.workout_channel_desc));
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private static Notification.Builder builder(Context ctx, int accent) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        ensureChannel(ctx, nm);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL_ID) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_dumbbell)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_WORKOUT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setColor(accent)
                .setLocalOnly(true)
                .setContentIntent(openWorkout(ctx));
        if (Build.VERSION.SDK_INT >= 26) b.setOnlyAlertOnce(true);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        if (Build.VERSION.SDK_INT >= 36) {
            Bundle extra = new Bundle();
            extra.putBoolean(EXTRA_PROMOTE, true);
            b.addExtras(extra);
        }
        return b;
    }

    private static int accentOf(JSONObject attrs) {
        String hex = attrs.optString("accent", "");
        try {
            if (hex.startsWith("#") && hex.length() == 7) return 0xFF000000 | Integer.parseInt(hex.substring(1), 16);
        } catch (NumberFormatException ignored) { /* the default */ }
        return 0xFF30D158;
    }

    /** The session bar: sets done of all sets, on Android 16 as its own progress style. */
    private static void progress(Notification.Builder b, int done, int total, int accent) {
        if (total <= 0) return;
        if (Build.VERSION.SDK_INT >= 36) {
            List<Notification.ProgressStyle.Segment> seg = new ArrayList<>();
            seg.add(new Notification.ProgressStyle.Segment(total).setColor(accent));
            b.setStyle(new Notification.ProgressStyle().setProgressSegments(seg).setProgress(Math.min(done, total)).setStyledByProgress(true));
        } else {
            b.setProgress(total, Math.min(done, total), false);
        }
    }

    /** The card between sets (or with a rest the page sent but no countdown service runs). */
    static Notification card(Context ctx, JSONObject attrs, JSONObject state) {
        int accent = accentOf(attrs);
        Notification.Builder b = builder(ctx, accent);
        long now = System.currentTimeMillis();
        JSONObject cur = WorkoutCard.cur(state);
        String name = state.optString("name", "");
        if (cur == null) {
            b.setContentTitle(WorkoutCard.label(attrs, "allDone", "All sets done"));
            if (!name.isEmpty()) b.setContentText(name);
        } else {
            b.setContentTitle(cur.optString("exName", name));
            b.setContentText(WorkoutCard.setText(cur));
            if (!name.isEmpty()) b.setSubText(name);
        }
        boolean resting = WorkoutCard.resting(state, now) && state.optLong("restEndsAt", 0) > now;
        long start = attrs.optLong("start", 0);
        if (resting) {
            // The rest counts down by itself in the system's clock; nothing is reposted per second.
            b.setUsesChronometer(true).setShowWhen(true).setWhen(state.optLong("restEndsAt"));
            if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
            b.setContentTitle(WorkoutCard.label(attrs, "rest", "Rest") + (cur == null ? "" : " · " + cur.optString("exName", "")));
        } else if (start > 0) {
            b.setUsesChronometer(true).setShowWhen(true).setWhen(start);
        } else {
            b.setShowWhen(false);
        }
        progress(b, state.optInt("done", 0), state.optInt("total", 0), accent);
        String wid = wid(attrs);
        if (cur != null) {
            b.addAction(action(ctx, WorkoutCardReceiver.LOG, wid, WorkoutCard.key(cur), WorkoutCard.label(attrs, "done", "Log set"), 61));
            if (resting) b.addAction(action(ctx, WorkoutCardReceiver.SKIP, wid, WorkoutCard.key(cur), WorkoutCard.label(attrs, "skipRest", "Skip rest"), 62));
            else if (WorkoutCard.nextUnitStart(state) != null) b.addAction(action(ctx, WorkoutCardReceiver.NEXT, wid, WorkoutCard.key(cur), WorkoutCard.label(attrs, "nextExercise", "Next exercise"), 63));
        }
        return b.build();
    }

    /**
     * Android 16 and later, a rest while the card is up: the rest as the Live Update, with the set
     * after it underneath. Custom layouts cannot be promoted, so this replaces the rest card there.
     */
    static Notification rest(Context ctx, long leftMs, long totalMs, boolean paused, String pause, String resume, String plus, String skip) {
        JSONObject attrs = attributes(ctx), state = state(ctx);
        if (attrs == null || state == null) return null;
        int accent = accentOf(attrs);
        Notification.Builder b = builder(ctx, accent);
        JSONObject cur = WorkoutCard.cur(state);
        long left = Math.max(0, leftMs);
        String restWord = WorkoutCard.label(attrs, "rest", "Rest");
        if (paused) {
            b.setContentTitle(restWord + " " + RestAlert.clock((int) RestCountdownPlan.clockSeconds(left))).setShowWhen(false);
        } else {
            b.setContentTitle(restWord).setUsesChronometer(true).setShowWhen(true)
                    .setWhen(System.currentTimeMillis() + left + 999);
            if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
        }
        if (cur != null) {
            b.setContentText(WorkoutCard.label(attrs, "next", "Up next") + ": " + cur.optString("exName", "") + ", " + WorkoutCard.setText(cur));
        }
        int total = (int) Math.max(1, Math.round(totalMs / 1000.0));
        int gone = (int) Math.max(0, total - RestCountdownPlan.clockSeconds(left));
        if (Build.VERSION.SDK_INT >= 36) {
            List<Notification.ProgressStyle.Segment> seg = new ArrayList<>();
            seg.add(new Notification.ProgressStyle.Segment(total).setColor(accent));
            b.setStyle(new Notification.ProgressStyle().setProgressSegments(seg).setProgress(Math.min(gone, total)).setStyledByProgress(true));
        } else {
            b.setProgress(total, Math.min(gone, total), false);
        }
        b.addAction(new Notification.Action.Builder(null, paused ? resume : pause, RestAlert.control(ctx, RestAlert.ACTION_PAUSE, 51)).build());
        b.addAction(new Notification.Action.Builder(null, plus, RestAlert.control(ctx, RestAlert.ACTION_PLUS, 53)).build());
        b.addAction(new Notification.Action.Builder(null, skip, RestAlert.control(ctx, RestAlert.ACTION_SKIP, 54)).build());
        return b.build();
    }

    /** The line the rest card (Android 15 and older) shows under its clock: the set after the rest. */
    static String upNext(Context ctx) {
        JSONObject attrs = attributes(ctx), state = state(ctx);
        JSONObject cur = WorkoutCard.cur(state);
        if (attrs == null || cur == null) return null;
        return WorkoutCard.label(attrs, "next", "Up next") + ": " + cur.optString("exName", "") + ", " + WorkoutCard.setText(cur);
    }

    private static Notification.Action action(Context ctx, String what, String wid, String setKey, String title, int code) {
        Intent i = new Intent(ctx, WorkoutCardReceiver.class).setAction(what)
                .putExtra(WorkoutCardReceiver.EXTRA_WID, wid)
                .putExtra(WorkoutCardReceiver.EXTRA_SET, setKey);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, code, i, FLAGS);
        return new Notification.Action.Builder(null, title, pi).build();
    }

    /** A tap on the card: back to the running workout (lib/widget-links.js, opengym://start). */
    private static PendingIntent openWorkout(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("opengym://start"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 60, i, FLAGS);
    }
}
