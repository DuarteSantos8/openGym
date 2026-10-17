package ch.duartesantos.opengym;

import android.net.Uri;

/**
 * The names the phone and the watch app agree on (wear/.../Paths.kt keeps the same list).
 *
 * Sessions and acks are Data Layer items, not messages: an item is kept and delivered when the
 * other side is next reachable, which is what lets a workout finished far from the phone arrive
 * later and be acknowledged later. The request for a routine is a message: it only means
 * something while the watch is waiting for the answer, and the watch asks again if none comes.
 */
final class WearPaths {
    private WearPaths() {}

    /** Watch to phone: a finished session, one item per session id. Removed by the watch once acked. */
    static final String SESSION = "/opengym/session/";
    /** Phone to watch: "this session id is saved", one item per session id. */
    static final String ACK = "/opengym/ack/";
    /** Phone to watch: the routine list. */
    static final String INDEX = "/opengym/index";
    /** Phone to watch: one routine's snapshot, one item per routine id. */
    static final String SNAPSHOT = "/opengym/snapshot/";
    /** Watch to phone, as a message: {"requestId", "routineId"} (routineId empty for the list). */
    static final String REQUEST = "/opengym/request";

    /** Capabilities each app advertises (res/values/wear.xml), so the other can find it. */
    static final String CAPABILITY_PHONE = "opengym_phone";
    static final String CAPABILITY_WATCH = "opengym_watch";

    /** A DataItem holds 100 KB; stay under it. */
    static final int MAX_ITEM_BYTES = 95 * 1024;

    static String segment(String id) {
        return Uri.encode(id);
    }
}
