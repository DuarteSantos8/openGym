package ch.duartesantos.opengym;

import java.util.Arrays;
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

    // ---------------------------------------------------------------- keeping the check cheap
    //
    // Most of a check is spent far from the gym (home or work inside the approach zone), where
    // GPS buys nothing: the walk through the door is what has to be seen sharply.

    /** Closer than this to a gym, the check asks for GPS-grade fixes; further, for cheap ones. */
    static final double FAR_M = 400;
    /** Back to cheap fixes only past this, so hovering around 400 m does not flip it every fix. */
    static final double FAR_BACK_M = 500;
    /** A fix this often is plenty at walking pace (30 s is about 40 m) while still far away. */
    static final long FAR_INTERVAL_MS = 30_000L;

    /** True while the phone is beyond FAR_M from every gym (beyond FAR_BACK_M once it came closer). */
    static boolean farFromAll(double[] dist, boolean wasFar) {
        double limit = wasFar ? FAR_M : FAR_BACK_M;
        for (double d : dist) if (d <= limit) return false;
        return true;
    }

    static long intervalFor(boolean far) {
        return far ? FAR_INTERVAL_MS : SCAN_INTERVAL_MS;
    }

    /**
     * Location providers to try, best first (the names are LocationManager's constants). Fused
     * exists from Android 12. Far from the gyms, below 12 only the network one: never the GPS chip.
     */
    static String[] providersFor(boolean far, int sdk) {
        if (sdk >= 31) return far ? new String[] { "fused", "network" } : new String[] { "fused", "gps", "network" };
        return far ? new String[] { "network" } : new String[] { "gps", "network" };
    }

    // ---------------------------------------------------------------- settled somewhere else

    /** Fixes over this long that all sit within SETTLE_M of each other: the phone stays put. */
    static final long SETTLE_MS = 3 * 60_000L;
    static final double SETTLE_M = 60;
    /** A fix vaguer than this (m) proves nothing about standing still, or about a place. */
    static final double SPOT_MAX_ACC_M = 100;

    /**
     * Settling and remembering a spot need every gym more than its radius + 2 x SPOT_M away: a wait
     * in the car park is not "somewhere else", and a kept spot (rounded, then matched within
     * SPOT_M) can never reach into a gym.
     */
    static boolean clearOfAll(double[] dist, double[] radius) {
        for (int i = 0; i < dist.length; i++) if (dist[i] <= radius[i] + 2 * SPOT_M) return false;
        return true;
    }

    /** Metres between two places (haversine). */
    static double metersBetween(double lat1, double lng1, double lat2, double lng2) {
        double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double a = Math.pow(Math.sin((p2 - p1) / 2), 2)
                + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin(Math.toRadians(lng2 - lng1) / 2), 2);
        return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
    }

    /**
     * Whether the phone has stayed put: fixes {at ms, lat, lng, accuracy m}, oldest first, cover at
     * least SETTLE_MS (some fix is that old by the newest one), and every fix from the latest such
     * old one on is sharp and within SETTLE_M of the newest. Caller keeps only fixes clear of every gym (clearOfAll).
     */
    static boolean stayedPut(double[][] fixes) {
        if (fixes.length < 2) return false;
        double[] last = fixes[fixes.length - 1];
        int anchor = -1;
        for (int i = 0; i < fixes.length; i++) if (fixes[i][0] <= last[0] - SETTLE_MS) anchor = i;
        if (anchor < 0) return false;
        for (int i = anchor; i < fixes.length; i++) {
            if (fixes[i][3] > SPOT_MAX_ACC_M || metersBetween(fixes[i][1], fixes[i][2], last[1], last[2]) >= SETTLE_M) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- "not the gym" spots
    //
    // A check that ended without an arrival (the phone stayed put elsewhere, or 15 minutes ran
    // out) remembers where: the next zone alert that finds the phone at that spot starts no check.

    /** Spots are rounded to a grid of about this (m); a phone within it of one is "there". */
    static final double SPOT_M = 150;
    static final long SPOT_KEEP_MS = 30L * 24 * 3600_000L;
    static final int MAX_SPOTS = 5;
    /** A last known fix older than this says where the phone was, not where it is. */
    static final long FRESH_FIX_MS = 10 * 60_000L;

    /**
     * The spots {lat, lng, at ms} with this place added (rounded to the ~150 m grid, so the exact
     * place is not kept): one already near it is replaced, those over 30 days old are dropped, and
     * only the newest MAX_SPOTS stay. A fix vaguer than SPOT_MAX_ACC_M adds nothing.
     */
    static double[][] addSpot(double[][] spots, double lat, double lng, double accuracy, long now) {
        double latStep = SPOT_M / 111_320.0;
        double rLat = Math.round(lat / latStep) * latStep;
        double lngStep = latStep / Math.max(0.01, Math.cos(Math.toRadians(rLat)));
        double rLng = Math.round(lng / lngStep) * lngStep;
        double[][] kept = new double[spots.length + 1][];
        int n = 0;
        for (double[] s : spots) {
            boolean old = now - s[2] > SPOT_KEEP_MS;
            boolean same = accuracy <= SPOT_MAX_ACC_M && metersBetween(s[0], s[1], rLat, rLng) < 1.5 * SPOT_M;
            if (!old && !same) kept[n++] = s;
        }
        if (accuracy <= SPOT_MAX_ACC_M) kept[n++] = new double[] { rLat, rLng, now };
        return Arrays.copyOfRange(kept, Math.max(0, n - MAX_SPOTS), n);
    }

    /** Whether a fix taken at fixAt, at this place, is within SPOT_M of a spot kept less than 30 days. */
    static boolean knownSpot(double[][] spots, double lat, double lng, long fixAt, long now) {
        if (now - fixAt > FRESH_FIX_MS) return false;
        for (double[] s : spots) {
            if (now - s[2] <= SPOT_KEEP_MS && metersBetween(s[0], s[1], lat, lng) <= SPOT_M) return true;
        }
        return false;
    }
}
