package ch.duartesantos.opengym;

import java.util.HashMap;
import java.util.Map;

/**
 * The spoken lines handed to TextToSpeech and not finished yet, each with the latest moment it
 * may still hold the audio focus (Reddit: "it stops Spotify"). The focus is given back once the
 * last line ended, and a line the engine never reports done (a failed speak(), an engine that
 * drops its callback) lets go by itself instead of keeping the music ducked for good.
 */
final class CueLines {
    private final Map<String, Long> open = new HashMap<>();

    /** A line went to the engine at `nowMs`. True when it is the first: ask for the focus now. */
    boolean start(String id, String text, float rate, long nowMs) {
        boolean first = open.isEmpty();
        open.put(id, nowMs + capMs(text, rate));
        return first;
    }

    /** A line ended. True when nothing is left: give the focus back. */
    boolean finish(String id) {
        return open.remove(id) != null && open.isEmpty();
    }

    /** Lines past their cap count as ended. True when that left nothing open. */
    boolean expire(long nowMs) {
        if (open.isEmpty()) return false;
        open.values().removeIf(until -> until <= nowMs);
        return open.isEmpty();
    }

    /** All lines cut off at once (a flush, hush). */
    void clear() { open.clear(); }

    boolean isEmpty() { return open.isEmpty(); }

    int size() { return open.size(); }

    /** About 12 characters a second at rate 1, plus slack, between 3 s and a minute. */
    static long capMs(String text, float rate) {
        float r = Float.isNaN(rate) || rate <= 0 ? 1f : Math.max(0.5f, Math.min(2f, rate));
        double secs = (text == null ? 0 : text.length()) / (12.0 * r) + 3;
        return Math.round(Math.max(3, Math.min(60, secs)) * 1000);
    }
}
