package ch.duartesantos.opengym;

import java.util.Calendar;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The gym reminder's no-nag rule (#614), decided on the phone when a gym is entered, since the
 * page is not running then. The same rule as frontend lib/gym-reminder.js skipReason and
 * ios/App/GymReminderCore GymReminderRules.swift, in the same order; plain Java so the JVM unit
 * test can run it without Android.
 */
final class GymReminderRules {
    /** A running session older than this was never finished; it does not keep the reminder quiet. */
    static final long ACTIVE_FRESH_MS = 12L * 3600 * 1000;
    private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):([0-5]\\d)$");

    private GymReminderRules() {}

    /** Whether a gym's saved place is one on Earth (lat -90..90, lng -180..180, both real numbers). */
    static boolean validPlace(double lat, double lng) {
        return !Double.isNaN(lat) && !Double.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }

    /** "HH:MM" as minutes after midnight, or -1. */
    static int minuteOf(String hhmm) {
        if (hhmm == null) return -1;
        Matcher m = TIME.matcher(hhmm);
        if (!m.matches()) return -1;
        return Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2));
    }

    /** No window (either end missing or invalid, or both the same) means any time; overnight wraps. */
    static boolean inWindow(String from, String to, int minuteOfDay) {
        int f = minuteOf(from), t = minuteOf(to);
        if (f < 0 || t < 0 || f == t) return true;
        return f < t ? minuteOfDay >= f && minuteOfDay < t : minuteOfDay >= f || minuteOfDay < t;
    }

    static String isoOf(Calendar c) {
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /**
     * Why entering a gym now would not notify, or null when it should: off, fired (already today),
     * trained (a workout logged today), quiet (a day note excuses today), active (a session started
     * less than 12 hours ago), window (outside the time window).
     */
    static String skipReason(boolean on, int gyms, String windowFrom, String windowTo,
                             String trainedOn, String quietOn, long activeSince, String lastFired, Calendar now) {
        if (!on || gyms <= 0) return "off";
        String today = isoOf(now);
        if (today.equals(lastFired)) return "fired";
        if (today.equals(trainedOn)) return "trained";
        if (today.equals(quietOn)) return "quiet";
        if (activeSince > 0 && now.getTimeInMillis() - activeSince < ACTIVE_FRESH_MS) return "active";
        int minute = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        if (!inWindow(windowFrom, windowTo, minute)) return "window";
        return null;
    }

    /**
     * A time from the page, in ms. A JSON number reaches a plugin as an Integer, a Long or a
     * Double, and Capacitor's PluginCall.getDouble returns null for a Long, which a millisecond
     * timestamp always is: read that way, the running workout's start was lost and a leave never
     * asked (#1332). Anything that is not a number is 0.
     */
    static long millis(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : 0L;
    }

    /**
     * Settings → Workout → Forgotten workouts: whether walking out of a gym now asks about the
     * workout running ("Looks like you left the gym"). The reminder on, the switch on (the page's
     * status says), and a session that started less than 12 hours ago, not in the future.
     */
    static boolean asksOnLeave(boolean on, boolean leaveGym, long activeSince, long nowMs) {
        return on && leaveGym && activeSince > 0 && nowMs >= activeSince && nowMs - activeSince < ACTIVE_FRESH_MS;
    }

    // ---------------------------------------------------------------- the approach check (Android)
    //
    // Android looks at proximity alerts only every 30 minutes for an app in the background unless
    // some other app's location request feeds it a fix. So each gym also gets a wide "approach"
    // zone. Entering it starts a short, bounded check with live location (GymScanService) that
    // notices the walk through the door within about one fix interval, then stops.

    /** The approach zone around a gym: at least 800 m, wider for a gym with a wide radius. */
    static final double APPROACH_MIN_M = 800;
    /** How long one check may keep the location on, at most: a walk across the zone fits. */
    static final long SCAN_MAX_MS = 15 * 60_000L;
    /** How often it asks for a fix while it runs. */
    static final long SCAN_INTERVAL_MS = 15_000L;
    /** How many checks one day may start (a commute past the gym, a gym next to the office). */
    static final int SCANS_PER_DAY = 3;
    /** A check ends early once the phone is this much beyond every gym's approach zone. */
    static final double AWAY_MARGIN_M = 250;

    static double approachOf(double radius) {
        return Math.max(APPROACH_MIN_M, 5 * radius);
    }

    /**
     * The gym a fix is inside (its index), or -1. Inside means within the gym's radius, with a fix
     * good enough to say so: accuracy no worse than twice the radius (and at least 100 m allowed).
     */
    static int insideOf(double[] dist, double[] radius, double accuracy) {
        int best = -1;
        for (int i = 0; i < dist.length; i++) {
            if (dist[i] > radius[i] || accuracy > Math.max(100, 2 * radius[i])) continue;
            if (best < 0 || dist[i] < dist[best]) best = i;
        }
        return best;
    }

    /** True when the phone has left every gym's approach zone (with a margin): the check stops. */
    static boolean awayFromAll(double[] dist, double[] radius) {
        for (int i = 0; i < dist.length; i++) if (dist[i] <= approachOf(radius[i]) + AWAY_MARGIN_M) return false;
        return true;
    }

    /** Whether another check may start today, given the day the last ones ran and how many. */
    static boolean mayScan(String scanDay, int scansThatDay, String today) {
        return !today.equals(scanDay) || scansThatDay < SCANS_PER_DAY;
    }

    // ---------------------------------------------------------------- keeping the check cheap (#1477)
    //
    // A check used to ask for GPS-grade fixes every 15 s for its whole 15 minutes, three times a
    // day: up to 45 minutes of GPS for a phone that sits at home or at work inside a gym's approach
    // zone. Far from every gym a cheap fix (Wi-Fi and cell, every 30 s) says enough; GPS only
    // matters for the last few hundred metres. And a phone that has not got any closer for a few
    // minutes is not on its way in: the check ends. The idea, and the far/near split, come from
    // cubetes' PR #1478; rebuilt smaller here.

    /** Closer than this to a gym the check asks for GPS-grade fixes; further away, cheap ones. */
    static final double NEAR_M = 400;
    /** Back to cheap fixes only beyond this, so hovering around NEAR_M does not flip every fix. */
    static final double NEAR_BACK_M = 500;
    /** A fix this often while far is plenty at walking pace (about 40 m between two). */
    static final long FAR_INTERVAL_MS = 30_000L;
    /** No step this much closer to a gym for STALL_MS: the phone is not on its way in. */
    static final double PROGRESS_M = 75;
    static final long STALL_MS = 5 * 60_000L;
    /** Unless it waits this close to a gym's edge (the car park, a red light by the door). */
    static final double PARK_M = 200;

    /** The distance to the nearest gym's edge (distance minus radius, never below 0). */
    static double nearestEdge(double[] dist, double[] radius) {
        double best = Double.MAX_VALUE;
        for (int i = 0; i < dist.length; i++) best = Math.min(best, Math.max(0, dist[i] - radius[i]));
        return best;
    }

    /** Whether the check asks for cheap fixes: every gym beyond NEAR_M (NEAR_BACK_M once it came closer). */
    static boolean far(double[] dist, boolean wasFar) {
        double limit = wasFar ? NEAR_M : NEAR_BACK_M;
        for (double d : dist) if (d <= limit) return false;
        return true;
    }

    static long intervalFor(boolean far) {
        return far ? FAR_INTERVAL_MS : SCAN_INTERVAL_MS;
    }

    /**
     * Location providers to try, best first (LocationManager's names). Fused from Android 12, asked
     * for balanced power while far. Below 12 far means the network provider, never the GPS chip,
     * with GPS only as the fallback for a phone that has no network location at all.
     */
    static String[] providersFor(boolean far, int sdk) {
        if (sdk >= 31) return new String[] { "fused", "gps", "network" };
        return far ? new String[] { "network", "gps" } : new String[] { "gps", "network" };
    }

    /** How close the check has come: the best edge distance so far and when it was reached. */
    static final class Progress {
        double best = Double.MAX_VALUE;
        long at;

        /** Counts a fix; true when the phone has not come PROGRESS_M closer for STALL_MS, away from every gym's edge. */
        boolean stalled(double edge, long now) {
            if (best == Double.MAX_VALUE || edge < best - PROGRESS_M) {
                best = edge;
                at = now;
                return false;
            }
            return edge > PARK_M && now - at >= STALL_MS;
        }
    }
}
