package ch.duartesantos.opengym;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Wear OS watch's events waiting for the page (WatchBridgePlugin, WatchListenerService), as
 * pure functions over the queue file's JSON, so they are tested on the JVM (WatchEventQueueTest).
 * The iPhone's twin is the queue file in ios/App/App/WatchBridgePlugin.swift.
 *
 * The queue is a JSON array of { "seq": n, "event": { "id": ..., "type": ..., ... } }, ordered by
 * seq (the watch numbers its events in the order they happened; the Data Layer may deliver them in
 * another). An event is in it once (by its id), until the page acknowledges it. A queue no page
 * drained for a long time is capped, oldest first.
 */
public final class WatchEventQueue {
    public static final int MAX = 500;

    private WatchEventQueue() {}

    /** The queue as stored, or empty for nothing or a broken file. */
    public static JSONArray parse(String text) {
        if (text == null || text.isEmpty()) return new JSONArray();
        try { return new JSONArray(text); } catch (JSONException e) { return new JSONArray(); }
    }

    /**
     * The queue with one event from the watch added: `eventJson` is the event as the watch sent it
     * (the Apple Watch's events: lib/watch-sync.js applyEvents). Null when it is not an event (no
     * id): nothing to store. Already there (the Data Layer delivered it twice): unchanged.
     */
    public static JSONArray add(JSONArray queue, String eventJson, long seq) {
        JSONObject event;
        try { event = new JSONObject(eventJson); } catch (JSONException | NullPointerException e) { return null; }
        String id = event.optString("id", "");
        if (id.isEmpty() || !event.has("type")) return null;
        List<JSONObject> rows = rows(queue);
        for (JSONObject row : rows) {
            JSONObject ev = row.optJSONObject("event");
            if (ev != null && id.equals(ev.optString("id"))) return queue;
        }
        JSONObject row = new JSONObject();
        try {
            row.put("seq", seq);
            row.put("event", event);
        } catch (JSONException e) { return null; }
        rows.add(row);
        Collections.sort(rows, (a, b) -> Long.compare(a.optLong("seq"), b.optLong("seq")));
        int from = Math.max(0, rows.size() - MAX);
        return new JSONArray(rows.subList(from, rows.size()));
    }

    /** The events, in order, for the page's drain. */
    public static JSONArray events(JSONArray queue) {
        JSONArray out = new JSONArray();
        for (JSONObject row : rows(queue)) {
            JSONObject ev = row.optJSONObject("event");
            if (ev != null) out.put(ev);
        }
        return out;
    }

    /** The queue without the events the page is done with. */
    public static JSONArray ack(JSONArray queue, Collection<String> ids) {
        JSONArray out = new JSONArray();
        for (JSONObject row : rows(queue)) {
            JSONObject ev = row.optJSONObject("event");
            if (ev == null || ids.contains(ev.optString("id"))) continue;
            out.put(row);
        }
        return out;
    }

    private static List<JSONObject> rows(JSONArray queue) {
        List<JSONObject> out = new ArrayList<>();
        if (queue == null) return out;
        for (int i = 0; i < queue.length(); i++) {
            JSONObject row = queue.optJSONObject(i);
            if (row != null) out.add(row);
        }
        return out;
    }

    /**
     * The stamp a snapshot goes out with (the data item's "at"): the clock, but never the same as
     * or older than the last one, so a phone whose clock was set back still sends every snapshot
     * as a change and in sending order (the iPhone's stamp follows the same rule).
     */
    public static long nextStamp(long last, long now) { return now > last ? now : last + 1; }

    /** A message stays well under the Data Layer's limit for one (about 100 KB); a bigger snapshot goes as the item only. */
    public static final int MESSAGE_MAX = 90 * 1024;

    /**
     * The snapshot as a message for the Wear OS watch (protocol 2): its stamp on the first line, then
     * the JSON (the watch's SnapshotMessage.decode). Sent next to the data item while the watch is in
     * reach: a message comes on time or not at all, so the watch can tell how far its clock is off
     * from the snapshot's `now` (docs/WATCH_SYNC.md "Clocks"). Null when it is too big to send.
     */
    public static byte[] snapshotMessage(long at, String json) {
        if (json == null) return null;
        byte[] out = (at + "\n" + json).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return out.length <= MESSAGE_MAX ? out : null;
    }

    /**
     * Runs the newest job only, on its own executor: the snapshot messages (protocol 2). A message
     * that waited (behind the stills' uploads, or a watch that takes 5 s to say it is gone) arrives
     * late, and the watch takes the delay for its clock being off; one newer snapshot made the
     * waiting one worthless anyway. So at most one waits, the newest, behind the one being sent.
     */
    public static final class LatestOnly {
        private final java.util.concurrent.Executor exec;
        private final java.util.concurrent.atomic.AtomicReference<Runnable> next = new java.util.concurrent.atomic.AtomicReference<>();
        private final java.util.concurrent.atomic.AtomicBoolean scheduled = new java.util.concurrent.atomic.AtomicBoolean(false);

        public LatestOnly(java.util.concurrent.Executor exec) { this.exec = exec; }

        public void submit(Runnable job) {
            next.set(job);
            if (scheduled.compareAndSet(false, true)) exec.execute(this::drain);
        }

        private void drain() {
            try {
                Runnable job;
                while ((job = next.getAndSet(null)) != null) {
                    try { job.run(); } catch (RuntimeException ignored) { /* the next snapshot goes anyway */ }
                }
            } finally {
                scheduled.set(false);
                // One submitted between the last look and the flag going down: run it too.
                if (next.get() != null && scheduled.compareAndSet(false, true)) exec.execute(this::drain);
            }
        }
    }
}
