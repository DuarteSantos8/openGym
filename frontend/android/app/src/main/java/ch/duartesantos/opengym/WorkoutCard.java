package ch.duartesantos.opengym;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The running workout's notification, as data (#760): the state the page sends (lib/live-activity.js
 * buildLiveActivity, the same one the iPhone's Live Activity gets) and what its buttons do to it
 * while the page sleeps. No Android classes here, so it runs on the JVM (WorkoutCardTest).
 *
 * The iPhone does the same moves in ios/App/App/WorkoutActivity.swift (LiveActivityTick): Log set
 * takes the next carried set and starts the rest after it, Next exercise jumps to the next unit's
 * first open set, Skip rest ends the rest. Each also returns the event the page applies later.
 */
final class WorkoutCard {
    private WorkoutCard() {}

    /** A move: the card after it and the event for the page's queue. */
    static final class Move {
        final JSONObject state;
        final JSONObject event;
        final long restMs;

        Move(JSONObject state, JSONObject event, long restMs) {
            this.state = state;
            this.event = event;
            this.restMs = restMs;
        }
    }

    static JSONObject parse(String text) {
        if (text == null || text.isEmpty()) return null;
        try { return new JSONObject(text); } catch (JSONException e) { return null; }
    }

    static JSONObject cur(JSONObject state) {
        return state == null ? null : state.optJSONObject("cur");
    }

    /** A rest counting down (or held) on the card at `now`. */
    static boolean resting(JSONObject state, long now) {
        if (state == null) return false;
        if (state.has("restLeft") && !state.isNull("restLeft")) return true;
        return state.optLong("restEndsAt", 0) > now;
    }

    private static int unitKey(JSONObject set) {
        return set.has("unit") && !set.isNull("unit") ? set.optInt("unit") : set.optInt("entryIdx");
    }

    /** The first carried exercise start after the current set's unit, or null. */
    static JSONObject nextUnitStart(JSONObject state) {
        JSONObject cur = cur(state);
        JSONArray starts = state == null ? null : state.optJSONArray("unitStarts");
        if (cur == null || starts == null) return null;
        for (int i = 0; i < starts.length(); i++) {
            JSONObject s = starts.optJSONObject(i);
            if (s != null && unitKey(s) != unitKey(cur)) return s;
        }
        return null;
    }

    private static JSONArray startsAfter(JSONArray starts, JSONObject set) {
        if (starts == null) return new JSONArray();
        if (set == null) return new JSONArray();
        int from = -1;
        for (int i = 0; i < starts.length(); i++) {
            JSONObject s = starts.optJSONObject(i);
            if (s != null && unitKey(s) == unitKey(set)) { from = i; break; }
        }
        if (from < 0) return starts;
        JSONArray out = new JSONArray();
        for (int i = from + 1; i < starts.length(); i++) out.put(starts.opt(i));
        return out;
    }

    private static JSONArray drop(JSONArray a, int n) {
        JSONArray out = new JSONArray();
        if (a == null) return out;
        for (int i = n; i < a.length(); i++) out.put(a.opt(i));
        return out;
    }

    private static JSONObject copy(JSONObject o) throws JSONException {
        return new JSONObject(o.toString());
    }

    private static JSONObject event(String type, String wid, long now) throws JSONException {
        JSONObject e = new JSONObject();
        e.put("id", UUID.randomUUID().toString());
        e.put("type", type);
        e.put("wid", wid == null ? "" : wid);
        e.put("at", now);
        return e;
    }

    private static void clearRest(JSONObject s) {
        s.remove("restEndsAt");
        s.remove("restLeft");
        s.remove("restTotal");
    }

    private static void clearHold(JSONObject s) {
        s.remove("holdEndsAt");
        s.remove("holdLeft");
        s.remove("holdTotal");
        s.remove("holdKind");
    }

    /**
     * Log set on the current set. Null when there is none, or the button belongs to a card that
     * moved on since it was drawn (`setKey` is "entryIdx:setIdx" of the set it showed).
     */
    static Move logSet(JSONObject state, String wid, String setKey, long now) {
        JSONObject cur = cur(state);
        if (cur == null || !key(cur).equals(setKey)) return null;
        try {
            JSONObject ev = event("setDone", wid, now);
            ev.put("exId", cur.optString("exId"));
            ev.put("entryIdx", cur.optInt("entryIdx"));
            ev.put("setIdx", cur.optInt("setIdx"));
            JSONObject next = copy(state);
            JSONArray ahead = state.optJSONArray("ahead");
            JSONObject nextCur = ahead != null && ahead.length() > 0 ? ahead.optJSONObject(0) : null;
            if (nextCur != null) next.put("cur", nextCur);
            else next.remove("cur");
            next.put("ahead", drop(ahead, 1));
            next.put("unitStarts", startsAfter(state.optJSONArray("unitStarts"), nextCur));
            int total = state.optInt("total", 0);
            next.put("done", Math.min(total, state.optInt("done", 0) + 1));
            clearRest(next);
            clearHold(next);
            long restMs = nextCur != null ? Math.max(0, cur.optLong("restAfter", 0)) * 1000 : 0;
            if (restMs > 0) {
                next.put("restEndsAt", now + restMs);
                next.put("restTotal", restMs / 1000);
            }
            return new Move(next, ev, restMs);
        } catch (JSONException e) {
            return null;
        }
    }

    /** Next exercise: on to the next unit's first open set, nothing ticked. */
    static Move nextExercise(JSONObject state, String wid, String setKey, long now) {
        JSONObject cur = cur(state);
        JSONObject target = nextUnitStart(state);
        if (cur == null || target == null || !key(cur).equals(setKey)) return null;
        try {
            JSONObject ev = event("next", wid, now);
            ev.put("fromEntryIdx", cur.optInt("entryIdx"));
            JSONObject next = copy(state);
            JSONArray ahead = state.optJSONArray("ahead");
            int at = -1;
            if (ahead != null) {
                for (int i = 0; i < ahead.length(); i++) {
                    JSONObject s = ahead.optJSONObject(i);
                    if (s != null && unitKey(s) == unitKey(target)) { at = i; break; }
                }
            }
            if (at >= 0) {
                next.put("cur", ahead.optJSONObject(at));
                next.put("ahead", drop(ahead, at + 1));
            } else {
                next.put("cur", target);
                next.put("ahead", new JSONArray());
            }
            next.put("unitStarts", startsAfter(state.optJSONArray("unitStarts"), next.optJSONObject("cur")));
            return new Move(next, ev, 0);
        } catch (JSONException e) {
            return null;
        }
    }

    /** Skip rest: the rest is over now. Null when none runs. */
    static Move skipRest(JSONObject state, String wid, long now) {
        if (!resting(state, now)) return null;
        try {
            JSONObject next = copy(state);
            clearRest(next);
            return new Move(next, event("restSkip", wid, now), 0);
        } catch (JSONException e) {
            return null;
        }
    }

    /* ---------- the live widget builder's layout (lib/live-layout.js, v1.4.5) ---------- */

    /** The layout's tiles or buttons for Android ("t" or "a"), or null without a layout. */
    static JSONArray layout(JSONObject state, String what) {
        JSONObject lay = state == null ? null : state.optJSONObject("lay");
        JSONObject and = lay == null ? null : lay.optJSONObject("android");
        return and == null ? null : and.optJSONArray(what);
    }

    /** A tile's text now: the set's own fields, the set's tile texts, then the session's; "" for none. */
    static String text(JSONObject state, String k) {
        JSONObject cur = cur(state);
        if (cur != null) {
            switch (k) {
                case "ex": return cur.optString("exName", "");
                case "setOf": return cur.optString("setLine", "");
                case "target": return cur.optString("target", "");
                default:
                    JSONObject tv = cur.optJSONObject("tv");
                    String v = tv == null ? "" : tv.optString(k, "");
                    if (!v.isEmpty()) return v;
            }
        }
        JSONObject tv = state == null ? null : state.optJSONObject("tv");
        return tv == null ? "" : tv.optString(k, "");
    }

    /** The page's label of a tile ("weight") or a button ("a.log"), or "". */
    static String tileLabel(JSONObject state, String k) {
        JSONObject tl = state == null ? null : state.optJSONObject("tl");
        return tl == null ? "" : tl.optString(k, "");
    }

    /**
     * The words of the text tiles in order, each with its label unless it is the set's own
     * (the name, "Set 2 of 4", the target): "Weight 80 kg", "Reps 8". Countdowns, the bar and the
     * still are drawn by the notification itself.
     */
    static java.util.List<String> lines(JSONObject state) {
        java.util.List<String> out = new java.util.ArrayList<>();
        JSONArray t = layout(state, "t");
        if (t == null) return out;
        for (int i = 0; i < t.length(); i++) {
            JSONObject tile = t.optJSONObject(i);
            String k = tile == null ? "" : tile.optString("k", "");
            if (k.isEmpty() || "still".equals(k) || "progress".equals(k) || "rest".equals(k) || "elapsed".equals(k)) continue;
            String v = text(state, k);
            if (v.isEmpty()) continue;
            boolean own = "ex".equals(k) || "setOf".equals(k) || "target".equals(k);
            String label = own ? "" : tileLabel(state, k);
            out.add(label.isEmpty() ? v : label + " " + v);
        }
        return out;
    }

    /** Whether the Android layout has tile `k`. */
    static boolean hasTile(JSONObject state, String k) {
        JSONArray t = layout(state, "t");
        if (t == null) return false;
        for (int i = 0; i < t.length(); i++) {
            JSONObject tile = t.optJSONObject(i);
            if (tile != null && k.equals(tile.optString("k"))) return true;
        }
        return false;
    }

    /** A still inside the app package (assets/public/...): relative, a picture, no way out. */
    static String stillPath(JSONObject state) {
        JSONObject cur = cur(state);
        String p = cur == null ? "" : cur.optString("img", "");
        if (p.isEmpty() || p.length() > 120 || p.startsWith("/") || p.contains("..") || p.contains(":")) return null;
        String low = p.toLowerCase(java.util.Locale.ROOT);
        return low.endsWith(".webp") || low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg") ? p : null;
    }

    static String tileKey(String field) {
        return "w".equals(field) ? "weight" : "r".equals(field) ? "reps" : "effort";
    }

    /**
     * − or + (or the effort button) on the set shown: one step along its list (`adj`), shown at
     * once, the value queued for the page. Null at the end of the list or from a card that moved on.
     */
    static Move adjust(JSONObject state, String wid, String setKey, String field, int dir, long now) {
        JSONObject cur = cur(state);
        if (cur == null || !key(cur).equals(setKey)) return null;
        JSONObject adj = cur.optJSONObject("adj");
        JSONObject list = adj == null ? null : adj.optJSONObject(field);
        JSONArray v = list == null ? null : list.optJSONArray("v");
        JSONArray t = list == null ? null : list.optJSONArray("t");
        if (v == null || t == null || v.length() == 0 || v.length() != t.length()) return null;
        int n = v.length();
        int at = Math.max(0, Math.min(n - 1, list.optInt("i", 0)));
        int j;
        if ("e".equals(field)) j = (at + (dir > 0 ? 1 : n - 1)) % n;
        else {
            j = at + (dir > 0 ? 1 : -1);
            if (j < 0 || j >= n) return null;
        }
        double value = v.optDouble(j, Double.NaN);
        if (Double.isNaN(value) || Double.isInfinite(value)) return null;
        try {
            JSONObject ev = event("adjust", wid, now);
            ev.put("exId", cur.optString("exId"));
            ev.put("entryIdx", cur.optInt("entryIdx"));
            ev.put("setIdx", cur.optInt("setIdx"));
            ev.put("field", field);
            ev.put("value", value);
            JSONObject next = copy(state);
            JSONObject c = next.getJSONObject("cur");
            c.getJSONObject("adj").getJSONObject(field).put("i", j);
            JSONObject tv = c.optJSONObject("tv");
            if (tv == null) { tv = new JSONObject(); c.put("tv", tv); }
            tv.put(tileKey(field), t.optString(j, ""));
            return new Move(next, ev, 0);
        } catch (JSONException e) {
            return null;
        }
    }

    /** +15 s on the rest running: its end moves on, and so does its alert (restMs is the new length). */
    static Move addRest(JSONObject state, String wid, int sec, long now) {
        if (!resting(state, now)) return null;
        try {
            JSONObject ev = event("restAdd", wid, now);
            ev.put("sec", sec);
            JSONObject next = copy(state);
            long more = sec * 1000L;
            if (state.has("restLeft") && !state.isNull("restLeft")) {
                next.put("restLeft", state.optDouble("restLeft", 0) + sec);
                return new Move(next, ev, 0);
            }
            long end = state.optLong("restEndsAt", 0) + more;
            next.put("restEndsAt", end);
            next.put("restTotal", state.optDouble("restTotal", 0) + sec);
            return new Move(next, ev, Math.max(0, end - now));
        } catch (JSONException e) {
            return null;
        }
    }

    /** A tap the page does all of (Previous exercise, Warm-up, Add set, Pause): queued only; Pause shows at once. */
    static Move queueOnly(JSONObject state, String wid, String kind, long now) {
        if (!"prev".equals(kind) && !"warm".equals(kind) && !"addSet".equals(kind) && !"pause".equals(kind)) return null;
        JSONObject cur = cur(state);
        if (cur == null && !"pause".equals(kind)) return null;
        try {
            JSONObject ev = event(kind, wid, now);
            JSONObject next = copy(state);
            switch (kind) {
                case "prev": ev.put("fromEntryIdx", cur.optInt("entryIdx")); break;
                case "warm": ev.put("exId", cur.optString("exId")); ev.put("entryIdx", cur.optInt("entryIdx")); ev.put("setIdx", cur.optInt("setIdx")); break;
                case "addSet": ev.put("exId", cur.optString("exId")); ev.put("entryIdx", cur.optInt("entryIdx")); break;
                default:
                    boolean on = !state.optBoolean("paused", false);
                    ev.put("on", on);
                    next.put("paused", on);
            }
            return new Move(next, ev, 0);
        } catch (JSONException e) {
            return null;
        }
    }

    /** Which set a button was drawn for. */
    static String key(JSONObject set) {
        return set == null ? "" : set.optInt("entryIdx", -1) + ":" + set.optInt("setIdx", -1);
    }

    /** The line under the exercise: "Set 2 of 4 · 80 kg × 8". */
    /**
     * The chip by the clock on Android 16 (a Live Update's short critical text, #874): sets done of
     * all, "3/12", where nothing else gives it a text (the set card; a paused rest has its clock).
     * Empty without a plan. Samsung's Now Bar was seen without a chip when only a chronometer
     * stood behind it.
     */
    static String chipText(int done, int total) {
        if (total <= 0) return "";
        return Math.max(0, Math.min(done, total)) + "/" + total;
    }

    static String setText(JSONObject set) {
        if (set == null) return "";
        String line = set.optString("setLine", "");
        String target = set.optString("target", "");
        if (line.isEmpty()) return target;
        return target.isEmpty() ? line : line + " · " + target;
    }

    /** A label from the page's attributes, or the English one. */
    static String label(JSONObject attributes, String name, String fallback) {
        JSONObject labels = attributes == null ? null : attributes.optJSONObject("labels");
        String v = labels == null ? "" : labels.optString(name, "");
        return v.isEmpty() ? fallback : v;
    }
}
