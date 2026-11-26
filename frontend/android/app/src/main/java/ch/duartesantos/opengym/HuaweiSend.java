package ch.duartesantos.opengym;

/**
 * Which snapshot goes to one Huawei watch next (HuaweiLink, src/hms). Plain Java so the JVM tests
 * reach it from every build; one per watch, used on one thread.
 *
 * A snapshot is several frames, and a watch puts frames together only while they come in one
 * message at a time: so one snapshot is on its way to a watch at a time. A newer one waits (only the
 * newest waiting one is kept) and goes when the one before has been sent whole or has failed. One
 * that is the same as the one on its way, or as the last one that went whole a moment ago, is not
 * sent again, unless it is asked for: the watch said hello (it just started and has nothing), or the
 * page resent it on purpose with `again` (an event came a second time, so the watch never got the
 * snapshot that named it: lib/watch-sync.js onAcked).
 *
 * "A moment" is REPEAT_MS, a fallback for a page without `again`. A watch sends an event again 10 to
 * 60 s later, so an identical one after REPEAT_MS goes again, while the page's quick bursts of
 * resends (a state change, a hello) are still dropped.
 */
final class HuaweiSend {
    private String sending;
    private String waiting;
    /** The watch asked (hello) for what waits: it goes even when the one before was the same and went whole. */
    private boolean waitingAsked;
    private String lastWhole;
    private long lastWholeAt;
    static final long REPEAT_MS = 20000;

    /** The same snapshot but for the clock: the page leaves `now` out of its own comparison too (lib/watch-sync.js). */
    private static String key(String snapshot) { return snapshot.replaceAll("\"now\":\\d+,?", ""); }

    private static boolean same(String a, String b) { return a != null && b != null && key(a).equals(key(b)); }

    /** A snapshot is wanted on the watch. The one to start sending now, or null (it waits, or there is nothing new in it). */
    String want(String snapshot, boolean asked, long nowMs) {
        if (sending != null) {
            // The newest one waits; when it is the very one on its way, nothing more is needed unless the watch asked.
            boolean ask = asked || waitingAsked;
            waiting = same(snapshot, sending) && !ask ? null : snapshot;
            waitingAsked = waiting != null && ask;
            return null;
        }
        if (!asked && same(snapshot, lastWhole) && nowMs - lastWholeAt < REPEAT_MS) return null;
        sending = snapshot;
        return snapshot;
    }

    /** The one on its way was sent whole, or failed. The waiting one to start now, or null. */
    String done(boolean whole, long nowMs) {
        if (whole) { lastWhole = sending; lastWholeAt = nowMs; }
        sending = null;
        String next = waiting;
        boolean asked = waitingAsked;
        waiting = null;
        waitingAsked = false;
        if (next == null) return null;
        // It came while the one before was on its way, and is the same as what the watch has now,
        // unless the watch asked: it may have missed the head of the one that went.
        if (whole && !asked && same(next, lastWhole)) return null;
        sending = next;
        return next;
    }
}
