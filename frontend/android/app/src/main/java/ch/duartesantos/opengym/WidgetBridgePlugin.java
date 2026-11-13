package ch.duartesantos.opengym;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;

/**
 * Hands the Home Screen widget what it shows (lib/widgets.js builds it, the same snapshot the
 * iPhone widgets get): kept in the app's own SharedPreferences, never synced or backed up anywhere
 * else, and every openGym widget drawn again with it (OpenGymWidgetProvider). The page writes only
 * when something the widgets show changed.
 *
 * Since v1.4.5 it also hands the page the sets logged on the widget (WidgetActionReceiver, lib/
 * widget-logger.js): drain gives the queue, ack takes out what the page applied and saved, and a
 * "widgetEvent" tells a running page that a set came in.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    private static volatile WidgetBridgePlugin live;

    @Override
    public void load() {
        live = this;
    }

    /** A set was queued on the widget: a running page drains it now. */
    static void eventQueued() {
        WidgetBridgePlugin p = live;
        if (p != null) {
            try { p.notifyListeners("widgetEvent", new JSObject()); } catch (Exception e) { /* the next resume drains it */ }
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json is required");
            return;
        }
        try {
            OpenGymWidgetProvider.prefs(getContext()).edit().putString(OpenGymWidgetProvider.SNAPSHOT, json).apply();
            OpenGymWidgetProvider.updateAll(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("could not write the widget data");
        }
    }

    @PluginMethod
    public void drain(PluginCall call) {
        try {
            JSONArray q = WidgetActionReceiver.events(OpenGymWidgetProvider.prefs(getContext()));
            JSObject out = new JSObject();
            out.put("events", new JSArray(q.toString()));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("could not read the widget's sets");
        }
    }

    @PluginMethod
    public void ack(PluginCall call) {
        try {
            JSArray ids = call.getArray("ids", new JSArray());
            Set<String> set = new HashSet<>();
            for (int i = 0; i < ids.length(); i++) set.add(ids.getString(i));
            WidgetActionReceiver.remove(getContext(), set);
            call.resolve();
        } catch (Exception e) {
            call.reject("could not acknowledge the widget's sets");
        }
    }
}
