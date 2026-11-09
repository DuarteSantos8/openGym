package ch.duartesantos.opengym;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The widget's set buttons (− and + for weight, reps or seconds, and Log set), run here without
 * opening the app: the widget's copy of the set changes and it is drawn again at once (WidgetLogger).
 * Log set also queues the set for the app, which applies it the next time it runs, or right away
 * when it is running (WidgetBridgePlugin tells the page). Never exported: only the widget's own
 * PendingIntents reach it.
 */
public class WidgetActionReceiver extends BroadcastReceiver {
    static final String ACTION = "ch.duartesantos.opengym.WIDGET_SET";
    static final String EXTRA_OP = "op";
    static final String[] OPS = { "w-", "w+", "r-", "r+", "s-", "s+", "log" };
    private static final Object LOCK = new Object();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        String op = intent.getStringExtra(EXTRA_OP);
        boolean queued = press(context, op);
        OpenGymWidgetProvider.updateAll(context);
        if (queued) WidgetBridgePlugin.eventQueued();
    }

    /** Applies one button to the stored state; true when it queued a set for the app. */
    static boolean press(Context context, String op) {
        synchronized (LOCK) {
            SharedPreferences p = OpenGymWidgetProvider.prefs(context);
            JSONObject lg = WidgetLogger.loggerOf(OpenGymWidgetProvider.snapshot(context));
            if (lg == null) return false;
            JSONObject stored = null;
            try { String s = p.getString(WidgetLogger.STATE, null); stored = s == null ? null : new JSONObject(s); } catch (Exception e) { stored = null; }
            JSONObject[] ev = new JSONObject[1];
            JSONObject next = WidgetLogger.press(lg, stored, op, UUID.randomUUID().toString(), System.currentTimeMillis(), ev);
            SharedPreferences.Editor e = p.edit().putString(WidgetLogger.STATE, next.toString());
            if (ev[0] != null) e.putString(WidgetLogger.EVENTS, WidgetLogger.append(events(p), ev[0]).toString());
            e.apply();
            return ev[0] != null;
        }
    }

    static JSONArray events(SharedPreferences p) {
        try { String s = p.getString(WidgetLogger.EVENTS, null); return s == null ? new JSONArray() : new JSONArray(s); } catch (Exception e) { return new JSONArray(); }
    }

    static void remove(Context context, java.util.Set<String> ids) {
        synchronized (LOCK) {
            SharedPreferences p = OpenGymWidgetProvider.prefs(context);
            p.edit().putString(WidgetLogger.EVENTS, WidgetLogger.without(events(p), ids).toString()).apply();
        }
    }

    /** A button's broadcast, one per widget and button. */
    static PendingIntent intent(Context context, int widgetId, String op) {
        int k = 0;
        for (int i = 0; i < OPS.length; i++) if (OPS[i].equals(op)) k = i;
        Intent i = new Intent(context, WidgetActionReceiver.class).setAction(ACTION).putExtra(EXTRA_OP, op);
        return PendingIntent.getBroadcast(context, 100000 + widgetId * 16 + k, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
