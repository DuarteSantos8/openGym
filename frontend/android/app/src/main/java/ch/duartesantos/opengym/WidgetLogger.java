package ch.duartesantos.opengym;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Logging a set from the Home Screen widget (v1.4.5): the widget's own copy of the set it shows,
 * and what its buttons do to it. The app hands the widget the running workout's next sets in the
 * snapshot (`logger`, lib/widget-logger.js), each with what − and + walk through: a list of
 * weights already on the exercise's step, the dumbbells or the stack you own, reps with their step
 * (2 on a per-side exercise), seconds for a hold. So nothing here knows about plates or units; it
 * only moves along those lists.
 *
 * The state is { base, pos, wi, r, sec }: `base` is the key of the snapshot's first set it was made
 * from (a new snapshot, one the app wrote after applying the taps, starts over), `pos` the set
 * shown, and the rest the numbers changed on it, absent while untouched. Log set queues an event
 * for the app and moves on to the next set. Pure: OpenGymWidgetProvider draws, WidgetActionReceiver
 * stores; tested in WidgetLoggerTest.
 */
final class WidgetLogger {
    private WidgetLogger() {}

    static final String STATE = "logger_state";
    static final String EVENTS = "widget_events";
    static final int EVENTS_MAX = 200;

    /** What one shape of the widget draws. */
    static final class View {
        String name = "", line = "", wText = "", rText = "", secText = "", wLabel = "", rLabel = "", secLabel = "";
        boolean weight, reps, time, allDone;
        String logSet = "Log set", allDoneText = "", less = "-", more = "+";
    }

    static JSONObject loggerOf(JSONObject snap) {
        if (snap == null) return null;
        JSONObject lg = snap.optJSONObject("logger");
        if (lg == null || lg.optJSONArray("sets") == null) return null;
        return lg;
    }

    private static JSONArray sets(JSONObject lg) {
        JSONArray a = lg == null ? null : lg.optJSONArray("sets");
        return a == null ? new JSONArray() : a;
    }

    private static String baseOf(JSONObject lg) {
        JSONArray s = sets(lg);
        JSONObject first = s.length() > 0 ? s.optJSONObject(0) : null;
        return (lg == null ? "" : lg.optString("wid", "")) + "|" + (first == null ? "" : first.optString("k", ""));
    }

    /** The state for this logger: the stored one while it was made from the same snapshot, else a fresh one. */
    static JSONObject stateFor(JSONObject lg, JSONObject stored) {
        String base = baseOf(lg);
        try {
            if (stored != null && base.equals(stored.optString("base", null))) return new JSONObject(stored.toString());
            JSONObject s = new JSONObject();
            s.put("base", base);
            s.put("pos", 0);
            return s;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static JSONObject currentSet(JSONObject lg, JSONObject state) {
        JSONArray s = sets(lg);
        int pos = state == null ? 0 : state.optInt("pos", 0);
        return pos >= 0 && pos < s.length() ? s.optJSONObject(pos) : null;
    }

    static int weightIndex(JSONObject set, JSONObject state) {
        JSONObject w = set == null ? null : set.optJSONObject("w");
        if (w == null) return -1;
        JSONArray v = w.optJSONArray("v");
        int n = v == null ? 0 : v.length();
        if (n == 0) return -1;
        int i = state != null && state.has("wi") ? state.optInt("wi") : w.optInt("i", 0);
        return Math.max(0, Math.min(n - 1, i));
    }

    static int reps(JSONObject set, JSONObject state) {
        JSONObject r = set == null ? null : set.optJSONObject("r");
        if (r == null) return -1;
        return Math.max(0, state != null && state.has("r") ? state.optInt("r") : r.optInt("v", 0));
    }

    static int seconds(JSONObject set, JSONObject state) {
        JSONObject s = set == null ? null : set.optJSONObject("sec");
        if (s == null) return -1;
        return Math.max(0, state != null && state.has("sec") ? state.optInt("sec") : s.optInt("v", 0));
    }

    /** What the widget shows for this logger and state. */
    static View view(JSONObject lg, JSONObject state) {
        View v = new View();
        JSONObject labels = lg == null ? null : lg.optJSONObject("labels");
        if (labels != null) {
            v.logSet = labels.optString("logSet", v.logSet);
            v.allDoneText = labels.optString("allDone", "");
            v.less = labels.optString("less", v.less);
            v.more = labels.optString("more", v.more);
        }
        JSONObject set = currentSet(lg, state);
        if (set == null) {
            v.allDone = true;
            // Sets are left that the widget does not carry (a cardio set, or many taps): the app's.
            if (lg != null && lg.optBoolean("more", false) && labels != null) v.allDoneText = labels.optString("openApp", v.allDoneText);
            return v;
        }
        v.name = set.optString("name", "");
        v.line = set.optString("line", "");
        // The lines picked for the widget in the app's live widget builder (lib/widget-logger.js info).
        String info = set.optString("info", "");
        if (!info.isEmpty()) v.line = v.line.isEmpty() ? info : v.line + " \u00b7 " + info;
        int wi = weightIndex(set, state);
        if (wi >= 0) {
            v.weight = true;
            JSONArray t = set.optJSONObject("w").optJSONArray("t");
            v.wText = t != null && wi < t.length() ? t.optString(wi, "") : "";
            v.wLabel = set.optString("wLabel", "");
        }
        int r = reps(set, state);
        if (r >= 0) {
            v.reps = true;
            v.rText = Integer.toString(r);
            v.rLabel = set.optString("rLabel", "");
        }
        int sec = seconds(set, state);
        if (sec >= 0) {
            v.time = true;
            v.secText = sec + " s";
            v.secLabel = set.optString("secLabel", "");
        }
        return v;
    }

    /**
     * One button: "w-", "w+", "r-", "r+", "s-", "s+" change the numbers, "log" queues the set and
     * moves on. Returns the new state; `event` (when given and the button was Log set) gets the event.
     */
    static JSONObject press(JSONObject lg, JSONObject state, String op, String eventId, long now, JSONObject[] event) {
        JSONObject st = stateFor(lg, state);
        JSONObject set = currentSet(lg, st);
        if (set == null || op == null) return st;
        try {
            switch (op) {
                case "w-": case "w+": {
                    int i = weightIndex(set, st);
                    if (i < 0) break;
                    int n = set.optJSONObject("w").optJSONArray("v").length();
                    st.put("wi", Math.max(0, Math.min(n - 1, i + ("w+".equals(op) ? 1 : -1))));
                    break;
                }
                case "r-": case "r+": {
                    int r = reps(set, st);
                    if (r < 0) break;
                    int step = Math.max(1, set.optJSONObject("r").optInt("step", 1));
                    st.put("r", Math.max(0, r + ("r+".equals(op) ? step : -step)));
                    break;
                }
                case "s-": case "s+": {
                    int s = seconds(set, st);
                    if (s < 0) break;
                    int step = Math.max(1, set.optJSONObject("sec").optInt("step", 5));
                    st.put("sec", Math.max(step, s + ("s+".equals(op) ? step : -step)));
                    break;
                }
                case "log": {
                    JSONObject ev = new JSONObject();
                    ev.put("id", eventId);
                    ev.put("type", "setDone");
                    ev.put("src", "widget");
                    ev.put("wid", lg.optString("wid", ""));
                    ev.put("exId", set.optString("exId", ""));
                    ev.put("entryIdx", set.optInt("entryIdx"));
                    ev.put("setIdx", set.optInt("setIdx"));
                    int wi = weightIndex(set, st);
                    if (wi >= 0) ev.put("w", set.optJSONObject("w").optJSONArray("v").optDouble(wi));
                    int r = reps(set, st);
                    if (r >= 0) ev.put("r", r);
                    int sec = seconds(set, st);
                    if (sec >= 0) ev.put("sec", sec);
                    ev.put("at", now);
                    if (event != null && event.length > 0) event[0] = ev;
                    st.put("pos", st.optInt("pos", 0) + 1);
                    st.remove("wi");
                    st.remove("r");
                    st.remove("sec");
                    break;
                }
                default:
                    break;
            }
        } catch (Exception e) {
            // A malformed snapshot: the widget stays as it was.
        }
        return st;
    }

    /** The queue with `ev` added, oldest first, keeping the newest EVENTS_MAX. */
    static JSONArray append(JSONArray queue, JSONObject ev) {
        JSONArray out = new JSONArray();
        int from = queue == null ? 0 : Math.max(0, queue.length() + 1 - EVENTS_MAX);
        if (queue != null) for (int i = from; i < queue.length(); i++) out.put(queue.opt(i));
        out.put(ev);
        return out;
    }

    /** The queue without the events the app acknowledged. */
    static JSONArray without(JSONArray queue, java.util.Set<String> ids) {
        JSONArray out = new JSONArray();
        if (queue == null) return out;
        for (int i = 0; i < queue.length(); i++) {
            JSONObject ev = queue.optJSONObject(i);
            if (ev != null && !ids.contains(ev.optString("id", ""))) out.put(ev);
        }
        return out;
    }
}
