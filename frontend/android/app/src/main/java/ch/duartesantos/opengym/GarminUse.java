package ch.duartesantos.opengym;

/**
 * What opening Settings → Garmin (it asks every 3 s) does to the Garmin link's state (GarminLink,
 * src/ciq). Plain Java so the JVM tests reach it from every build.
 */
final class GarminUse {
    private GarminUse() {}

    /**
     * The state after an ask. Only "off" and "no-gcm" move, and only while the SDK is not up:
     * to "starting" when Garmin Connect is on the phone (the SDK starts), else "no-gcm" at once.
     * Setting "starting" without Garmin Connect, as before, made every ask answer "starting" and
     * left the page on "Checking…" for good (QA66).
     */
    static String stateOnUse(String state, boolean sdkUp, boolean gcmInstalled) {
        if (sdkUp || !("off".equals(state) || "no-gcm".equals(state))) return state;
        return gcmInstalled ? "starting" : "no-gcm";
    }

    /** How long a start may take before it is tried again, and how soon after Garmin Connect went away. */
    static final long START_WAIT_MS = 15000;
    static final long REVIVE_MS = 3000;
    static final int MAX_TRIES = 3;

    /**
     * A start that has not come up after START_WAIT_MS (Garmin Connect's service did not answer:
     * it is being updated, or the system would not bind it): "retry" up to MAX_TRIES in a row,
     * then "error", which says so in Settings → Garmin instead of "Checking…" for good.
     */
    static String onStartTimeout(int tries) {
        return tries < MAX_TRIES ? "retry" : "error";
    }

    /**
     * Whether "Look again" starts the link over: from the states that do not end by themselves.
     * "gcm-upgrade" stays until Garmin Connect was updated, and nobody tells us when; "error" is
     * the end of the retries; "starting" has its own retries, "ready" only asks for the watches.
     */
    static boolean restartsOnLookAgain(String state) {
        return "error".equals(state) || "gcm-upgrade".equals(state);
    }

    /**
     * Whether Garmin Connect's "not installed" counts. It answers that for a watch it cannot ask
     * (out of reach) as well, and taking it would say "openGym isn’t on it yet" about a watch that
     * has it, and stop the snapshots until it said hello again.
     */
    static boolean trustsNotInstalled(boolean connected) {
        return connected;
    }

    static final long RESEND_MS = 2000;

    /**
     * Whether a snapshot that did not get through goes once more by itself: when it was lost on
     * the way (the watch is still connected), and only the first time. A watch that is not
     * connected gets the latest when it connects; a message Garmin Connect will never take (too
     * large, a type it cannot carry) is not sent again.
     */
    static boolean sendsAgain(String status, boolean first) {
        return first && ("FAILURE_DURING_TRANSFER".equals(status) || "FAILURE_UNKNOWN".equals(status));
    }
}
