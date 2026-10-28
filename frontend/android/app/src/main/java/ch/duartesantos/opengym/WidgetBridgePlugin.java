package ch.duartesantos.opengym;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands the Home Screen widget what it shows (lib/widgets.js builds it, the same snapshot the
 * iPhone widgets get): kept in the app's own SharedPreferences, never synced or backed up anywhere
 * else, and every openGym widget drawn again with it (OpenGymWidgetProvider). The page writes only
 * when something the widgets show changed.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
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
}
