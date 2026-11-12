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

    /**
     * A tap for workout `wid` waits in `events` that the page did not have when it built the state
     * it is sending (`seen`: the ids of its last drain). The card already moved on for that tap, so
     * the page's state is the older one and must not replace it (LiveActivityPlugin.update).
     */
    static boolean hasUnseen(JSONArray events, String wid, java.util.Collection<String> seen) {
        if (events == null || wid == null || seen == null) return false;
        for (int i = 0; i < events.length(); i++) {
            JSONObject ev = events.optJSONObject(i);
            if (ev != null && wid.equals(ev.optString("wid")) && !seen.contains(ev.optString("id"))) return true;
        }
        return false;
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

    /* ---------- the glance (lib/live-glance.js, LIVE_VERSION 4) ---------- */

    /** The glance's choices from Settings, or null for a card from before them (the classic card). */
    static JSONObject glance(JSONObject state) {
        return state == null ? null : state.optJSONObject("g");
    }

    private static String tv(JSONObject set, String k) {
        JSONObject tv = set == null ? null : set.optJSONObject("tv");
        return tv == null ? "" : tv.optString(k, "");
    }

    /** The set's big line: weight × reps for a plain lift (− and + rewrite both), else its own. */
    static String big(JSONObject set) {
        if (set == null) return "";
        String w = tv(set, "weight"), r = tv(set, "reps");
        if (!set.has("kd") && !set.has("bg") && !w.isEmpty() && !r.isEmpty()) return w + " \u00d7 " + r;
        String bg = set.optString("bg", "");
        return bg.isEmpty() ? set.optString("target", "") : bg;
    }

    /** A few letters for the status-bar chip: "80×8", "45 s"; "" when there are none. */
    static String shortText(JSONObject set) {
        if (set == null) return "";
        String w = tv(set, "weight"), r = tv(set, "reps");
        if (!set.has("kd") && !set.has("sh") && !w.isEmpty() && !r.isEmpty()) {
            int sp = w.indexOf(' ');
            return (sp > 0 ? w.substring(0, sp) : w) + "\u00d7" + r;
        }
        return set.optString("sh", "");
    }

    /** The moment: "done", "hold", "between" (a rest before a new exercise), "rest" or "work". */
    static String phase(JSONObject state, long now) {
        JSONObject cur = cur(state);
        if (cur == null) return "done";
        boolean holding = (state.has("holdLeft") && !state.isNull("holdLeft")) || state.optLong("holdEndsAt", 0) > now;
        if (holding) return "hold";
        if (resting(state, now)) return cur.optBoolean("fr", false) ? "between" : "rest";
        return "work";
    }

    /** The details beside the set, at most two (clean) or four (detailed): "RIR 2", "132 bpm". */
    static java.util.List<String> chips(JSONObject state, boolean withSet) {
        java.util.List<String> out = new java.util.ArrayList<>();
        JSONObject g = glance(state);
        if (g == null) return out;
        int room = "clean".equals(g.optString("lk")) ? 2 : 4;
        JSONObject cur = cur(state);
        JSONArray ck = withSet && cur != null ? cur.optJSONArray("ck") : null;
        for (int i = 0; ck != null && i < ck.length(); i++) {
            String v = tv(cur, ck.optString(i, ""));
            if (!v.isEmpty()) out.add(v);
        }
        JSONArray sx = g.optJSONArray("sx");
        JSONObject stv = state.optJSONObject("tv");
        for (int i = 0; sx != null && stv != null && i < sx.length(); i++) {
            String v = stv.optString(sx.optString(i, ""), "");
            if (!v.isEmpty()) out.add(v);
        }
        return out.size() > room ? new java.util.ArrayList<>(out.subList(0, room)) : out;
    }

    private static final String[] PRIORITY = {"log", "wDown", "wUp", "rDown", "rUp", "effort", "restAdd", "restSkip", "next", "pause", "warm", "addSet", "finish"};

    private static int rank(String k) {
        for (int i = 0; i < PRIORITY.length; i++) if (PRIORITY[i].equals(k)) return i;
        return PRIORITY.length;
    }

    /**
     * The buttons now, those that mean something, most important first, at most `room`: the set's
     * own while it is up next, the rest's while one runs, Log set during a hold, Finish at the end.
     */
    static java.util.List<String> buttons(JSONObject state, long now, int room) {
        java.util.List<String> out = new java.util.ArrayList<>();
        JSONObject g = glance(state);
        JSONObject cur = cur(state);
        String ph = phase(state, now);
        JSONArray list;
        try {
            if ("done".equals(ph)) list = new JSONArray("[\"finish\"]");
            else if ("hold".equals(ph)) list = new JSONArray("[\"log\"]");
            else if ("rest".equals(ph) || "between".equals(ph)) list = g != null && g.optJSONArray("rb") != null ? g.optJSONArray("rb") : new JSONArray("[\"log\",\"restSkip\"]");
            else list = cur.optJSONArray("b") != null ? cur.optJSONArray("b") : new JSONArray("[\"log\"]");
        } catch (JSONException e) {
            return out;
        }
        JSONObject adj = cur == null ? null : cur.optJSONObject("adj");
        boolean rest = resting(state, now);
        for (int i = 0; i < list.length(); i++) {
            String k = list.optString(i, "");
            if (k.isEmpty() || out.contains(k)) continue;
            if ("next".equals(k) && nextUnitStart(state) == null) continue;
            if (("restAdd".equals(k) || "restSkip".equals(k)) && !rest) continue;
            String f = "wDown".equals(k) || "wUp".equals(k) ? "w" : "rDown".equals(k) || "rUp".equals(k) ? "r" : "effort".equals(k) ? "e" : null;
            if (f != null && (adj == null || adj.optJSONObject(f) == null)) continue;
            out.add(k);
        }
        java.util.Collections.sort(out, (x, y) -> Integer.compare(rank(x), rank(y)));
        return out.size() > room ? new java.util.ArrayList<>(out.subList(0, Math.max(1, room))) : out;
    }

    /**
     * The notification's words for the moment: [title, text]. The text joins the set's line, its
     * big line and its details ("Set 3 of 4 · 80 kg × 8 · RIR 2"); during a rest, what is next.
     */
    static String[] words(JSONObject attrs, JSONObject state, long now) {
        JSONObject cur = cur(state);
        JSONObject g = glance(state);
        String ph = phase(state, now);
        String name = state.optString("name", "");
        if ("done".equals(ph)) {
            int done = state.optInt("done", 0), total = state.optInt("total", 0);
            return new String[] {done < total ? label(attrs, "openApp", "Open openGym for the next set") : label(attrs, "allDone", "All sets done"), name};
        }
        java.util.List<String> parts = new java.util.ArrayList<>();
        if ("rest".equals(ph) || "between".equals(ph)) {
            String rest = label(attrs, "rest", "Rest");
            if (g != null && !g.optBoolean("nx", true)) return new String[] {rest, name};
            String head = "between".equals(ph) ? tileLabel(state, "nextEx") : "";
            if (head.isEmpty()) head = "between".equals(ph) ? label(attrs, "nextExercise", "Next exercise") : label(attrs, "next", "Up next");
            parts.add(cur.optString("setLine", ""));
            parts.add(big(cur));
            return new String[] {rest + " \u00b7 " + cur.optString("exName", ""), head + ": " + join(parts)};
        }
        if ("hold".equals(ph)) {
            String word = "countin".equals(state.optString("holdKind")) ? label(attrs, "getReady", "Get ready") : label(attrs, "hold", "Hold");
            parts.add(cur.optString("setLine", ""));
            parts.add(big(cur));
            return new String[] {word + " \u00b7 " + cur.optString("exName", ""), join(parts)};
        }
        parts.add(cur.optString("setLine", ""));
        parts.add(big(cur));
        parts.addAll(chips(state, true));
        return new String[] {cur.optString("exName", name), join(parts)};
    }

    /** The record line under the set on the detailed look, or "". */
    static String note(JSONObject state) {
        JSONObject g = glance(state);
        if (g == null || !"detailed".equals(g.optString("lk"))) return "";
        return tv(cur(state), "pr");
    }

    private static String join(java.util.List<String> parts) {
        StringBuilder b = new StringBuilder();
        for (String p : parts) {
            if (p == null || p.isEmpty()) continue;
            if (b.length() > 0) b.append(" \u00b7 ");
            b.append(p);
        }
        return b.toString();
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
