package ch.duartesantos.opengym;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The running workout as one ongoing notification (#760), the Android side of the page's
 * lib/live-activity.js, with the same methods as the iPhone's LiveActivityPlugin.swift: `update`
 * shows or changes the card, `end` takes it down, `drain`/`ack` hand the page the taps (Log set,
 * Skip rest, a tap on the card) it has not applied yet. RestTimerService shows the card between
 * sets and the rest countdown during a rest, in the same notification.
 *
 * Card and queue live in SharedPreferences, so a tap made while the page is frozen or the process
 * was gone is still there when the page comes back.
 */
@CapacitorPlugin(name = "LiveActivity")
public class LiveActivityPlugin extends Plugin {
    static final String EXTRA_OPEN = "ch.duartesantos.opengym.live.OPEN";
    private static final String PREFS = "opengym.live";
    private static final int QUEUE_MAX = 200;
    private static LiveActivityPlugin instance;

    @Override
    public void load() {
        instance = this;
        super.load();
        Activity a = getActivity();
        if (a != null) opened(a.getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        opened(intent);
    }

    /** A tap on the card opens the workout: queued like the buttons, so a cold start sees it too. */
    private void opened(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(EXTRA_OPEN, false)) return;
        intent.removeExtra(EXTRA_OPEN);
        Context ctx = getContext();
        if (ctx == null) return;
        queue(ctx, event("open", cardWid(ctx)));
        changed();
    }

    /** Tells the page a tap is queued. A page that is not there drains the queue when it comes back. */
    static void changed() {
        if (instance != null) instance.notifyListeners("liveActivityEvent", new JSObject());
    }

    /** Always: notifications allowed later (asked at the first rest) count from the next update on. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", true);
        call.resolve(r);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String attributes = call.getString("attributes");
        String state = call.getString("state");
        if (attributes == null || state == null) {
            call.reject("attributes and state are required");
            return;
        }
        Context ctx = getContext().getApplicationContext();
        synchronized (LiveActivityPlugin.class) {
            prefs(ctx).edit().putString("attributes", attributes).putString("state", state).apply();
        }
        RestTimerService.refresh(ctx, true);
        call.resolve();
    }

    @PluginMethod
    public void end(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        synchronized (LiveActivityPlugin.class) {
            prefs(ctx).edit().remove("attributes").remove("state").apply();
        }
        RestTimerService.refresh(ctx, false);
        call.resolve();
    }

    @PluginMethod
    public void drain(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("events", new JSArray(queued(getContext()).toString()));
        } catch (Exception e) {
            r.put("events", new JSArray());
        }
        call.resolve(r);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        Set<String> ids = new HashSet<>();
        JSArray list = call.getArray("ids");
        if (list != null) for (int i = 0; i < list.length(); i++) ids.add(list.optString(i));
        Context ctx = getContext();
        synchronized (LiveActivityPlugin.class) {
            JSONArray keep = new JSONArray();
            JSONArray all = queued(ctx);
            for (int i = 0; i < all.length(); i++) {
                JSONObject ev = all.optJSONObject(i);
                if (ev != null && !ids.contains(ev.optString("id"))) keep.put(ev);
            }
            prefs(ctx).edit().putString("events", keep.toString()).commit();
        }
        call.resolve();
    }

    /* ---------- the card and the queue, for RestTimerService ---------- */

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONObject attributes(Context ctx) {
        return parse(prefs(ctx).getString("attributes", null));
    }

    /** The card as stored, or null when no workout is running. */
    static synchronized WorkoutCard card(Context ctx) {
        JSONObject st = parse(prefs(ctx).getString("state", null));
        if (st == null) return null;
        WorkoutCard c = new WorkoutCard();
        c.name = st.optString("name", "");
        c.cur = setOf(st.optJSONObject("cur"));
        JSONArray ahead = st.optJSONArray("ahead");
        if (ahead != null) for (int i = 0; i < ahead.length(); i++) {
            WorkoutCard.SetInfo s = setOf(ahead.optJSONObject(i));
            if (s != null) c.ahead.add(s);
        }
        c.done = st.optInt("done", 0);
        c.total = st.optInt("total", 0);
        return c;
    }

    static String cardWid(Context ctx) {
        JSONObject a = attributes(ctx);
        return a == null ? "" : a.optString("wid", "");
    }

    /**
     * Log set on the card: ticks `exId`/`entryIdx`/`setIdx` if it is still the set shown, queues
     * the tap for the page and stores the card moved on. Returns the rest that starts in ms, 0 for
     * none, or -1 when the tap was not about the set shown (a second quick tap).
     */
    static synchronized long logSet(Context ctx, String exId, int entryIdx, int setIdx, long now) {
        WorkoutCard c = card(ctx);
        if (c == null || !c.shows(exId, entryIdx, setIdx)) return -1;
        JSONObject ev = event("setDone", cardWid(ctx));
        try {
            ev.put("exId", exId).put("entryIdx", entryIdx).put("setIdx", setIdx).put("at", now);
        } catch (Exception ignored) { /* plain values */ }
        queue(ctx, ev);
        long rest = c.tick();
        JSONObject st = parse(prefs(ctx).getString("state", null));
        try {
            // The stored sets move along as they are (WorkoutCard.tick took the first of `ahead`);
            // the page's next state replaces all of it.
            JSONArray ahead = st.optJSONArray("ahead");
            boolean more = ahead != null && ahead.length() > 0;
            st.put("cur", more ? ahead.get(0) : JSONObject.NULL);
            if (more) ahead.remove(0);
            st.put("done", c.done);
            prefs(ctx).edit().putString("state", st.toString()).commit();
        } catch (Exception ignored) { /* the tap is queued; the page sends the card again */ }
        return rest;
    }

    static synchronized void queue(Context ctx, JSONObject ev) {
        JSONArray all = queued(ctx);
        all.put(ev);
        // A queue nobody drained for a long time keeps its newest taps, not every one ever made.
        while (all.length() > QUEUE_MAX) all.remove(0);
        // commit, not apply: the queue is the tap's only copy until the page acknowledges it.
        prefs(ctx).edit().putString("events", all.toString()).commit();
    }

    static JSONObject event(String type, String wid) {
        JSONObject ev = new JSONObject();
        try {
            ev.put("id", UUID.randomUUID().toString()).put("type", type).put("wid", wid)
                    .put("at", System.currentTimeMillis());
        } catch (Exception ignored) { /* plain values */ }
        return ev;
    }

    private static synchronized JSONArray queued(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString("events", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static JSONObject parse(String json) {
        if (json == null) return null;
        try {
            return new JSONObject(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static WorkoutCard.SetInfo setOf(JSONObject o) {
        if (o == null) return null;
        WorkoutCard.SetInfo s = new WorkoutCard.SetInfo();
        s.exId = o.optString("exId", "");
        s.entryIdx = o.optInt("entryIdx", -1);
        s.setIdx = o.optInt("setIdx", -1);
        s.exName = o.optString("exName", "");
        s.setLine = o.optString("setLine", "");
        s.target = o.optString("target", "");
        s.restAfter = o.optInt("restAfter", 0);
        return s;
    }
}
