package ch.duartesantos.opengym;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What goes over the Garmin link (GarminLink in src/ciq, docs/GARMIN.md), as pure functions so the
 * JVM tests cover them without Garmin's SDK (GarminMessagesTest).
 *
 * Phone → watch: the page's Garmin snapshot (lib/garmin-snapshot.js) arrives as a JSON string and
 * goes out as a Connect IQ dictionary: Monkey C has no JSON parser, and the SDK turns maps, lists,
 * strings, numbers and booleans into the watch's own. Nulls are left out (a missing key reads as
 * null on the watch). Whole numbers that fit go as Integer, bigger ones (times in ms) as Long.
 *
 * Watch → phone: `{ "events" => [ ... ] }` (frontend/garmin/source/App.mc Link), each event made
 * back into the JSON the other watches send, for the same queue file (WatchEventQueue).
 */
public final class GarminMessages {
    private GarminMessages() {}

    /** The snapshot as the SDK sends it, or null for something that is not a JSON object. */
    public static Map<String, Object> toMonkey(String json) {
        if (json == null) return null;
        try { return mapOf(new JSONObject(json)); } catch (JSONException e) { return null; }
    }

    private static Map<String, Object> mapOf(JSONObject o) {
        Map<String, Object> out = new LinkedHashMap<>();
        Iterator<String> keys = o.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            Object v = valueOf(o.opt(k));
            if (v != null) out.put(k, v);
        }
        return out;
    }

    private static Object valueOf(Object v) {
        if (v == null || v == JSONObject.NULL) return null;
        if (v instanceof JSONObject) return mapOf((JSONObject) v);
        if (v instanceof JSONArray) {
            JSONArray a = (JSONArray) v;
            List<Object> out = new ArrayList<>();
            for (int i = 0; i < a.length(); i++) {
                Object x = valueOf(a.opt(i));
                if (x != null) out.add(x);
            }
            return out;
        }
        if (v instanceof Number) {
            Number n = (Number) v;
            double d = n.doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) return null;
            boolean whole = d == Math.rint(d);
            if (whole && d >= Integer.MIN_VALUE && d <= Integer.MAX_VALUE) return (int) d;
            if (whole && Math.abs(d) < 9.0e18) return n.longValue();
            return d;
        }
        if (v instanceof Boolean || v instanceof String) return v;
        return String.valueOf(v);
    }

    /**
     * The events in one message from the watch (the SDK hands a message over as a list of the
     * objects in it), each as JSON, in the order the watch sent them. Anything else is skipped.
     */
    public static List<String> events(List<Object> message) {
        if (message == null) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        for (Object part : message) {
            if (!(part instanceof Map)) continue;
            Object list = ((Map<?, ?>) part).get("events");
            if (!(list instanceof List)) continue;
            for (Object ev : (List<?>) list) {
                if (!(ev instanceof Map)) continue;
                Object j = toJson(ev);
                if (j instanceof JSONObject && ((JSONObject) j).optString("id", "").length() > 0) out.add(j.toString());
            }
        }
        return out;
    }

    /** A message's object as JSON: maps, lists and plain values. */
    static Object toJson(Object v) {
        if (v == null) return JSONObject.NULL;
        if (v instanceof Map) {
            JSONObject o = new JSONObject();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                if (e.getKey() == null) continue;
                try { o.put(String.valueOf(e.getKey()), toJson(e.getValue())); } catch (JSONException ignored) {}
            }
            return o;
        }
        if (v instanceof List) {
            JSONArray a = new JSONArray();
            for (Object x : (List<?>) v) a.put(toJson(x));
            return a;
        }
        if (v instanceof Float) return ((Float) v).doubleValue();
        if (v instanceof Number || v instanceof Boolean || v instanceof String) return v;
        return String.valueOf(v);
    }

    /**
     * The snapshot as it leaves for a watch, its `now` (the phone's clock: the watch works out how
     * far off its own is from it, docs/WATCH_SYNC.md "Clocks") the moment it goes. The bridge keeps
     * the last snapshot and sends it again to a watch that says hello or comes back in reach, maybe
     * minutes after the page made it: with the page's time the watch would take those minutes for
     * its clock being off. A copy; a snapshot without `now` (an older page) goes as it is.
     */
    public static Map<String, Object> stamped(Map<String, Object> snap, long now) {
        if (snap == null || !snap.containsKey("now")) return snap;
        Map<String, Object> out = new LinkedHashMap<>(snap);
        out.put("now", now);
        return out;
    }

    /** "Send me the latest" (App.mc Link.hello): for the bridge only, never queued for the page. */
    public static boolean isHello(String eventJson) {
        try { return "hello".equals(new JSONObject(eventJson).optString("type")); } catch (JSONException | NullPointerException e) { return false; }
    }

    /** Where an event goes in the queue: the watch's own time for it, so the order is the watch's. */
    public static long seqOf(String eventJson, long fallback) {
        try {
            long at = new JSONObject(eventJson).optLong("at", 0);
            return at > 0 ? at : fallback;
        } catch (JSONException | NullPointerException e) { return fallback; }
    }
}
