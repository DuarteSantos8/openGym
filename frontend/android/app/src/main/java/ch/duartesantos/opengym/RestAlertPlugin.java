package ch.duartesantos.opengym;

import android.content.Context;
import android.content.Intent;
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
 *   await RestAlert.schedule({ id, at, title, sound, channelId, visibility, importance, localOnly });
 *   await RestAlert.cancel({ id });
 */
@CapacitorPlugin(name = "RestAlert")
public class RestAlertPlugin extends Plugin {
    private static RestAlertPlugin instance;

    @Override
    public void load() {
        instance = this;
        super.load();
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
                call.getString("channelId", RestAlert.CHANNEL_ID),
                call.getString("visibility", "public"),
                call.getString("importance", "high"),
                Boolean.TRUE.equals(call.getBoolean("localOnly", Boolean.FALSE)),
                call.getString("countdownTitle", "Rest"),
                number(call, "totalMs", 0)
        );
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

    @PluginMethod
    public void suppressTone(PluginCall call) {
        RestAlert.suppressTone();
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
