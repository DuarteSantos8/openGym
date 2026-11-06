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
