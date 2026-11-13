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

    /**
     * The page's card for this workout (a card for another workout is replaced), unless a button's
     * tap waits for this workout that the page had not drained
     * when it built it (`seen`: the ids it had; null checks nothing): then the card already shows
     * that tap, nothing is saved and this is false. Under the lock the buttons queue and save with
     * (WorkoutCardReceiver: queue, then saveState), so a tap is either seen here or lands on top
     * of what this saved. Checked outside it, a tap could slip in between and be drawn over.
     */
    static boolean saveUnlessUnseen(Context ctx, String attributes, String state, Collection<String> seen) {
        synchronized (LOCK) {
            if (seen != null) {
                String mine = wid(WorkoutCard.parse(attributes));
                if (mine.equals(wid(attributes(ctx))) && WorkoutCard.hasUnseen(events(ctx), mine, seen)) return false;
            }
            prefs(ctx).edit().putString(K_ATTRS, attributes).putString(K_STATE, state).apply();
            return true;
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

    /** Android 16: the text in the status-bar chip, where a chronometer does not give it one. */
    private static void chip(Notification.Builder b, String text) {
        if (Build.VERSION.SDK_INT >= 36 && text != null && !text.isEmpty()) b.setShortCriticalText(text);
    }

    private static int accentOf(JSONObject attrs) {
        String hex = attrs.optString("accent", "");
        try {
            if (hex.startsWith("#") && hex.length() == 7) return 0xFF000000 | Integer.parseInt(hex.substring(1), 16);
        } catch (NumberFormatException ignored) { /* the default */ }
        return 0xFFA3E635;
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
        if (WorkoutCard.glance(state) != null) {
            try { return glanceCard(ctx, attrs, state); } catch (Exception e) { Log.w("openGym", "live widget card, the classic one instead", e); }
        }
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
        // The chip's own text: a rest counts down in it by itself, a set shows how far along you are.
        if (!resting) chip(b, WorkoutCard.chipText(state.optInt("done", 0), state.optInt("total", 0)));
        String wid = wid(attrs);
        if (cur != null) {
            b.addAction(action(ctx, WorkoutCardReceiver.LOG, wid, WorkoutCard.key(cur), WorkoutCard.label(attrs, "done", "Log set"), 61));
            if (resting) b.addAction(action(ctx, WorkoutCardReceiver.SKIP, wid, WorkoutCard.key(cur), WorkoutCard.label(attrs, "skipRest", "Skip rest"), 62));
            else if (WorkoutCard.nextUnitStart(state) != null) b.addAction(action(ctx, WorkoutCardReceiver.NEXT, wid, WorkoutCard.key(cur), WorkoutCard.label(attrs, "nextExercise", "Next exercise"), 63));
        }
        return b.build();
    }

    /**
     * The glance (lib/live-glance.js, v1.4.5): what the set it shows and the moment call for, as
     * text (so Android 16 can still promote it to a Live Update, which a custom view cannot be). The
     * exercise and its set with the details, or during a rest or a hold the clock and what's next;
     * the still as the large icon when asked for; the one clock a notification has (the rest, the
     * hold, or the time since the start when asked for); the bar on the detailed look; the set in a
     * few letters in the status-bar chip; up to three buttons that mean something now.
     */
    static Notification glanceCard(Context ctx, JSONObject attrs, JSONObject state) {
        int accent = accentOf(attrs);
        Notification.Builder b = builder(ctx, accent);
        long now = System.currentTimeMillis();
        JSONObject g = WorkoutCard.glance(state);
        JSONObject cur = WorkoutCard.cur(state);
        String phase = WorkoutCard.phase(state, now);
        String[] words = WorkoutCard.words(attrs, state, now);
        b.setContentTitle(words[0]);
        if (!words[1].isEmpty()) b.setContentText(words[1]);
        String name = state.optString("name", "");
        if ("work".equals(phase) && !name.isEmpty()) b.setSubText(name);
        boolean detailed = "detailed".equals(g.optString("lk"));
        String note = WorkoutCard.note(state);
        long start = attrs.optLong("start", 0);
        boolean clock = false;
        if (("rest".equals(phase) || "between".equals(phase)) && state.optLong("restEndsAt", 0) > now) {
            b.setUsesChronometer(true).setShowWhen(true).setWhen(state.optLong("restEndsAt"));
            if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
            clock = true;
        } else if ("hold".equals(phase) && state.optLong("holdEndsAt", 0) > now) {
            b.setUsesChronometer(true).setShowWhen(true).setWhen(state.optLong("holdEndsAt"));
            if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
            clock = true;
        } else if (start > 0 && g.optBoolean("el", false) && !state.optBoolean("paused", false)) {
            b.setUsesChronometer(true).setShowWhen(true).setWhen(start);
        } else {
            b.setShowWhen(false);
        }
        android.graphics.Bitmap still = g.optBoolean("pic", false) && "work".equals(phase) ? stillOf(ctx, WorkoutCard.stillPath(state)) : null;
        if (still != null) b.setLargeIcon(still);
        if (detailed) progress(b, state.optInt("done", 0), state.optInt("total", 0), accent);
        else if (!note.isEmpty() && Build.VERSION.SDK_INT < 36) b.setStyle(new Notification.BigTextStyle().bigText(words[1] + "\n" + note));
        if (!clock) {
            // The chip shows whole texts under seven letters: the set ("80×8"), else how far along.
            String shortSet = "work".equals(phase) ? WorkoutCard.shortText(cur) : "";
            chip(b, !shortSet.isEmpty() && shortSet.length() < 7 ? shortSet : WorkoutCard.chipText(state.optInt("done", 0), state.optInt("total", 0)));
        }
        String wid = wid(attrs);
        boolean resting = WorkoutCard.resting(state, now);
        int code = 64;
        // Android lists the actions in order: the primary (Log set) first.
        for (String k : WorkoutCard.buttons(state, now, 3)) {
            Notification.Action a = layoutAction(ctx, attrs, state, k, wid, cur, resting, code++);
            if (a != null) b.addAction(a);
        }
        return b.build();
    }

    /** One of the glance's buttons, or null when it means nothing now (Skip rest with no rest). */
    private static Notification.Action layoutAction(Context ctx, JSONObject attrs, JSONObject state, String k, String wid, JSONObject cur, boolean resting, int code) {
        String title = WorkoutCard.tileLabel(state, "a." + k);
        String setKey = WorkoutCard.key(cur);
        switch (k) {
            case "log":
                return cur == null ? null : action(ctx, WorkoutCardReceiver.LOG, wid, setKey, WorkoutCard.label(attrs, "done", "Log set"), code);
            case "restSkip":
                return resting ? action(ctx, WorkoutCardReceiver.SKIP, wid, setKey, WorkoutCard.label(attrs, "skipRest", "Skip rest"), code) : null;
            case "next":
                return cur != null && WorkoutCard.nextUnitStart(state) != null ? action(ctx, WorkoutCardReceiver.NEXT, wid, setKey, WorkoutCard.label(attrs, "nextExercise", "Next exercise"), code) : null;
            case "restAdd":
                return resting ? action(ctx, WorkoutCardReceiver.ADD_REST, wid, setKey, title.isEmpty() ? "+15 s" : title, code) : null;
            case "wDown": case "wUp": case "rDown": case "rUp": case "effort": {
                if (cur == null) return null;
                String field = "effort".equals(k) ? "e" : k.startsWith("w") ? "w" : "r";
                JSONObject adj = cur.optJSONObject("adj");
                if (adj == null || adj.optJSONObject(field) == null) return null;
                int dir = k.endsWith("Down") ? -1 : 1;
                // The effort button says where it stands ("RIR 2"); − and + say what they change.
                String t = "e".equals(field) ? WorkoutCard.text(state, "effort") : title;
                Intent i = new Intent(ctx, WorkoutCardReceiver.class).setAction(WorkoutCardReceiver.ADJ)
                        .putExtra(WorkoutCardReceiver.EXTRA_WID, wid).putExtra(WorkoutCardReceiver.EXTRA_SET, setKey)
                        .putExtra(WorkoutCardReceiver.EXTRA_FIELD, field).putExtra(WorkoutCardReceiver.EXTRA_DIR, dir);
                return new Notification.Action.Builder(null, t.isEmpty() ? (dir < 0 ? "\u2212" : "+") : t, PendingIntent.getBroadcast(ctx, code, i, FLAGS)).build();
            }
            case "prev": case "warm": case "addSet": case "pause": {
                if (cur == null && !"pause".equals(k)) return null;
                String t = "pause".equals(k) && state.optBoolean("paused", false) ? WorkoutCard.tileLabel(state, "a.resume") : title;
                Intent i = new Intent(ctx, WorkoutCardReceiver.class).setAction(WorkoutCardReceiver.QUEUE)
                        .putExtra(WorkoutCardReceiver.EXTRA_WID, wid).putExtra(WorkoutCardReceiver.EXTRA_SET, setKey)
                        .putExtra(WorkoutCardReceiver.EXTRA_KIND, k);
                return t.isEmpty() ? null : new Notification.Action.Builder(null, t, PendingIntent.getBroadcast(ctx, code, i, FLAGS)).build();
            }
            case "finish": {
                if (title.isEmpty()) return null;
                Intent i = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW)
                        .setData(Uri.parse("opengym://start?do=finish"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                return new Notification.Action.Builder(null, title, PendingIntent.getActivity(ctx, code, i, FLAGS)).build();
            }
            default:
                return null;
        }
    }

    /** The exercise's still from the app package, 128 px at most, or null. Never an animation. */
    private static android.graphics.Bitmap stillOf(Context ctx, String path) {
        if (path == null) return null;
        try (java.io.InputStream in = ctx.getAssets().open("public/" + path)) {
            android.graphics.Bitmap full = android.graphics.BitmapFactory.decodeStream(in);
            if (full == null) return null;
            int max = Math.max(full.getWidth(), full.getHeight());
            if (max <= 128) return full;
            float k = 128f / max;
            return android.graphics.Bitmap.createScaledBitmap(full, Math.max(1, Math.round(full.getWidth() * k)), Math.max(1, Math.round(full.getHeight() * k)), true);
        } catch (Exception e) {
            return null;
        }
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
            chip(b, RestAlert.clock((int) RestCountdownPlan.clockSeconds(left)));
        } else {
            b.setContentTitle(restWord).setUsesChronometer(true).setShowWhen(true)
                    .setWhen(System.currentTimeMillis() + left + 999);
            if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
        }
        if (cur != null) b.setContentText(upNextText(attrs, state, cur));
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
        return upNextText(attrs, state, cur);
    }

    /**
     * What comes after the rest, in words: "Up next: Bench Press, Set 3 of 4 · 80 kg × 8", or "Next
     * exercise: ..." when it starts a new one. With the glance's "What's next" off, the workout's name.
     */
    static String upNextText(JSONObject attrs, JSONObject state, JSONObject cur) {
        JSONObject g = WorkoutCard.glance(state);
        if (g == null) return WorkoutCard.label(attrs, "next", "Up next") + ": " + cur.optString("exName", "") + ", " + WorkoutCard.setText(cur);
        if (!g.optBoolean("nx", true)) return state.optString("name", "");
        String head = cur.optBoolean("fr", false) ? WorkoutCard.label(attrs, "nextExercise", "Next exercise") : WorkoutCard.label(attrs, "next", "Up next");
        String line = cur.optString("setLine", "");
        String big = WorkoutCard.big(cur);
        return head + ": " + cur.optString("exName", "") + (line.isEmpty() ? "" : ", " + line) + (big.isEmpty() ? "" : " \u00b7 " + big);
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
