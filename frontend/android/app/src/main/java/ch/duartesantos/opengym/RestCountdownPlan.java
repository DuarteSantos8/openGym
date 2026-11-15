package ch.duartesantos.opengym;

/**
 * The battery side of the rest countdown, kept free of Android classes so it is unit tested.
 *
 * The clock in the countdown card is a Chronometer that the system draws itself, so the card is
 * reposted only for the bar, and only while someone can see it (screen on). With the screen off
 * nothing is reposted, and turning the screen on brings the card up to date at once.
 *
 * The end is sounded by an exact alarm where Android allows one: that alarm wakes the phone,
 * also in Doze, and RestAlert.fire holds the CPU for the few seconds of the alert. The countdown
 * then holds no wake lock during the rest. Without the exact-alarm permission the alarm may come
 * most of a rest late, so the countdown keeps the CPU awake to sound the end on time, as before.
 */
final class RestCountdownPlan {
    /** Held past the end so the alert can take over before this lock runs out. */
    static final long END_GRACE_MS = 10_000;

    private RestCountdownPlan() {}

    /** How long the countdown holds the CPU for a rest with `leftMs` to go; 0 = no lock at all. */
    static long cpuHoldMs(boolean exactAlarm, long leftMs) {
        if (exactAlarm) return 0;
        return Math.max(0, leftMs) + END_GRACE_MS;
    }

    /**
     * Delay to the next run of the countdown loop. With the screen on, the next whole second so
     * the bar moves with the clock and the last run lands on the end itself. With the screen off
     * nothing is drawn, so the loop only wakes for the end.
     */
    static long nextTickMs(long leftMs, boolean interactive) {
        if (leftMs <= 0) return 0;
        if (!interactive) return leftMs;
        return ((leftMs - 1) % 1000) + 1;
    }

    /**
     * Chronometer base (elapsed-realtime clock) for a countdown with `leftMs` to go. The
     * Chronometer shows whole seconds rounded down; +999 makes it round up like the in-app clock
     * (and RestAlert.clock), so 1:30 is shown for the whole first second of a 90 s rest and
     * 0:00 at the end.
     */
    static long chronometerBase(long elapsedNow, long leftMs) {
        return elapsedNow + Math.max(0, leftMs) + 999;
    }

    /** Seconds a Chronometer counting down to `base` shows at `elapsedNow` (its own rounding). */
    static long chronometerShows(long base, long elapsedNow) {
        return (base - elapsedNow) / 1000;
    }

    /** An alarm this close before its end rings as it is (the clocks of two calls never match). */
    static final long EARLY_SLACK_MS = 1_500;
    /** An alarm at most this early waits for the end itself, with the CPU held. */
    static final long WAIT_MAX_MS = 5_000;
    static final int FIRE = 0, WAIT = 1, REBOOK = 2, STALE = 3;

    /**
     * How far apart the page's end and the alarm's end may be and still be the one rest (#1007).
     * Both come from the same endsAt, but a WebView thawing after a freeze reads its clock late.
     */
    static final long SAME_END_MS = 2_000;

    /**
     * Whether an end already rang (`rang`, 0 for none) covers `at`: the page played the tone on
     * screen and the alarm for that rest arrives, or the other way round. Exactly the same end
     * between two native callers, since a chain of holds rings its cues seconds apart.
     */
    static boolean alreadyRang(long at, long rang, boolean nearEnough) {
        if (at <= 0 || rang <= 0) return false;
        return nearEnough ? Math.abs(at - rang) <= SAME_END_MS : at == rang;
    }

    /**
     * What an arriving rest alarm does (#995). Some phones (ColorOS seen) hand an exact alarm over
     * a minute early, and the alert then ended a rest the page and the card still ran: an alarm
     * for an end still ahead is booked again for that end (or waited out when it is seconds away).
     * `bookedAt` is the end booked last in this process (0: none known, after a restart); an alarm
     * for any other end is left over and stays quiet. `fromCountdown`: the card's own clock
     * reached the end, which is always the current rest.
     */
    static int alarmVerdict(long at, long now, long bookedAt, boolean fromCountdown) {
        if (!fromCountdown && bookedAt > 0 && at > 0 && at != bookedAt) return STALE;
        long early = at - now;
        if (at <= 0 || early <= EARLY_SLACK_MS) return FIRE;
        return early <= WAIT_MAX_MS ? WAIT : REBOOK;
    }

    /** The in-app clock's seconds for `leftMs` (round up), what the card used to print. */
    static long clockSeconds(long leftMs) {
        return (Math.max(0, leftMs) + 999) / 1000;
    }
}
