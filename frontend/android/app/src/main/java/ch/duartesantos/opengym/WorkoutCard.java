package ch.duartesantos.opengym;

import java.util.ArrayList;
import java.util.List;

/**
 * The workout card's Log set, decided on the phone while the page may be asleep (#760): the tap
 * ticks the set the card shows, the card moves on to the next one and starts the rest that follows
 * it. The same rule as ios/App/App/WorkoutActivity.swift LiveActivityTick.tick; plain Java so the
 * JVM unit test can run it without Android. The page applies the tap later and sends its own state,
 * which wins.
 */
final class WorkoutCard {
    /** One set as the card shows it, with the rest that follows it (lib/live-activity.js setView). */
    static final class SetInfo {
        String exId = "";
        int entryIdx;
        int setIdx;
        String exName = "";
        String setLine = "";
        String target = "";
        int restAfter;
    }

    String name = "";
    /** The set to do now; null once every set is ticked, or the card ran past the ones it carries. */
    SetInfo cur;
    List<SetInfo> ahead = new ArrayList<>();
    int done;
    int total;

    /** Whether a Log set for this set is about the set shown: a second quick tap is not. */
    boolean shows(String exId, int entryIdx, int setIdx) {
        return cur != null && cur.exId.equals(exId) && cur.entryIdx == entryIdx && cur.setIdx == setIdx;
    }

    /**
     * Log set on the shown set: the card moves on to the next one. Returns the length in ms of the
     * rest that starts now, 0 when the set has none or it was the last one carried.
     */
    long tick() {
        SetInfo was = cur;
        cur = ahead.isEmpty() ? null : ahead.remove(0);
        done = Math.min(total, done + 1);
        return was != null && was.restAfter > 0 && cur != null ? was.restAfter * 1000L : 0;
    }
}
