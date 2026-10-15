package ch.duartesantos.opengym;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Schedules the rest-over alarm from the WebView. The receiver fires it later, so the
 * WebView being frozen does not matter.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const RestAlert = registerPlugin('RestAlert');
 *   await RestAlert.schedule({ id, at, title, sound, tone, classic, vibrate, channelId, visibility, importance, localOnly });
 *   await RestAlert.cancel({ id });
 *   await RestAlert.buzz({ pattern: [200, 100, 200] });   // navigator.vibrate's shape, as an alarm
 */
@CapacitorPlugin(name = "RestAlert")
public class RestAlertPlugin extends Plugin {
    private static RestAlertPlugin instance;
    // Started to stopped is when the page is visible (document.hidden flips with it), so it is
    // when the page's own countdown plays the end of a rest.
    private static volatile boolean inFront;

    @Override
    public void load() {
        instance = this;
        super.load();
    }

    @Override
    protected void handleOnStart() {
        inFront = true;
    }

    @Override
    protected void handleOnStop() {
        inFront = false;
    }

    static boolean appInFront() {
        return inFront;
    }

    static void emit(String type, long endsAt, long totalMs, long leftMs, boolean paused) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("type", type);
        data.put("endsAt", endsAt);
        data.put("totalMs", totalMs);
        data.put("leftMs", leftMs);
        data.put("paused", paused);
        instance.notifyListeners("rest", data);
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        long at = number(call, "at", -1);
        if (at <= System.currentTimeMillis()) {
            call.reject("at must be in the future");
            return;
        }
        RestAlert.setAccentColor((int) number(call, "accent", 0xFF30D158L), (int) number(call, "ink", 0xFF000000L));
        RestAlert.setLabels(
                call.getString("pause", "Pause"),
                call.getString("resume", "Resume"),
                call.getString("minus", "\u2212 15s"),
                call.getString("plus", "+ 15s"),
                call.getString("skip", "Skip")
        );
        RestAlert.schedule(
                ctx.getApplicationContext(),
                at,
                (int) number(call, "id", RestAlert.NOTIFICATION_ID),
                call.getString("title", "Rest over"),
                !Boolean.FALSE.equals(call.getBoolean("sound", Boolean.TRUE)),
                // Settings → Sound (#306): the sound by name; a page from before it sends only `classic`.
                call.getString("tone", Boolean.TRUE.equals(call.getBoolean("classic", Boolean.FALSE)) ? "classic" : "chime"),
                !Boolean.FALSE.equals(call.getBoolean("vibrate", Boolean.TRUE)),
                Boolean.TRUE.equals(call.getBoolean("alarmBuzz", Boolean.FALSE)),
                call.getString("channelId", RestAlert.CHANNEL_ID),
                call.getString("visibility", "public"),
                call.getString("importance", "high"),
                Boolean.TRUE.equals(call.getBoolean("localOnly", Boolean.FALSE)),
                call.getString("countdownTitle", "Rest"),
                number(call, "totalMs", 0)
        );
        call.resolve();
    }

    /**
     * The page's end-of-rest or end-of-hold buzz with Settings → "Vibrate when the phone is on
     * silent" on (#375). `pattern` is navigator.vibrate's (on, off, on…); Android's waveform starts
     * with an off, so a 0 goes in front.
     */
    @PluginMethod
    public void buzz(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        long[] pattern = new long[] {0, 200, 100, 200};
        JSArray given = call.getArray("pattern");
        if (given != null && given.length() > 0 && given.length() <= 20) {
            long[] p = new long[given.length() + 1];
            boolean ok = true;
            for (int i = 0; i < given.length(); i++) {
                long v = given.optLong(i, -1);
                if (v < 0 || v > 10_000) { ok = false; break; }
                p[i + 1] = v;
            }
            if (ok) pattern = p;
        }
        RestAlert.buzz(ctx.getApplicationContext(), pattern);
        call.resolve();
    }

    /** The end tone now, over whatever plays, which ducks for it (see RestAlert.playNow). */
    @PluginMethod
    public void tone(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        RestAlert.playNow(ctx.getApplicationContext(), call.getString("kind", "chime"));
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        RestAlert.cancel(ctx.getApplicationContext(), (int) number(call, "id", RestAlert.NOTIFICATION_ID));
        call.resolve();
    }

    /**
     * The rest was paused in the app. The alarm for the old end is called off here, whether or
     * not a countdown is on screen, and the countdown holds at the time the app shows. Resuming
     * in the app schedules the new end, which restarts the clock.
     */
    @PluginMethod
    public void hold(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        Context app = ctx.getApplicationContext();
        RestAlert.cancelAlarmOnly(app, (int) number(call, "id", RestAlert.NOTIFICATION_ID));
        Intent i = new Intent(app, RestTimerService.class);
        i.setAction(RestAlert.ACTION_HOLD);
        i.putExtra("leftMs", number(call, "leftMs", 0));
        i.putExtra("totalMs", number(call, "totalMs", 0));
        try { app.startService(i); } catch (Exception ignored) { /* no countdown on screen to hold */ }
        call.resolve();
    }

    @PluginMethod
    public void setAccent(PluginCall call) {
        int color = (int) number(call, "accent", 0xFF30D158L);
        int ink = (int) number(call, "ink", 0xFF000000L);
        RestAlert.setAccentColor(color, ink);
        Context ctx = getContext();
        if (ctx != null) {
            Intent i = new Intent(ctx, RestTimerService.class);
            i.setAction(RestAlert.ACTION_ACCENT);
            i.putExtra("accent", color);
            i.putExtra("ink", ink);
            try { ctx.startService(i); } catch (Exception ignored) { /* no rest running */ }
        }
        call.resolve();
    }

    // PluginCall.getLong only accepts a Long, and a JS timestamp often arrives as a Double
    // (or a Long when it no longer fits in an int). Number covers all three.
    private static long number(PluginCall call, String name, long fallback) {
        JSObject data = call.getData();
        if (data == null) return fallback;
        Object value = data.opt(name);
        if (value instanceof Number) return ((Number) value).longValue();
        return fallback;
    }
}
