package ch.duartesantos.opengym;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RestTimerNative")
public class RestTimerPlugin extends Plugin {

    private RestTimerManager manager;

    @Override
    public void load() {
        super.load();
        manager = RestTimerManager.getInstance(getContext());
        manager.setActionListener(actionId -> {
            JSObject ret = new JSObject();
            ret.put("action", actionId);
            notifyListeners("onRestAction", ret);
        });
    }

    @PluginMethod
    public void startRest(PluginCall call) {
        int seconds = call.getInt("seconds", 90);
        String exercise = call.getString("exercise", "");
        String set = call.getString("set", "");
        String accentColor = call.getString("accentColor", "#30D158");
        manager.start(seconds, exercise, set, accentColor);
        call.resolve();
    }

    @PluginMethod
    public void addRest(PluginCall call) {
        int seconds = call.getInt("seconds", 15);
        manager.addSeconds(seconds);
        call.resolve();
    }

    @PluginMethod
    public void stopRest(PluginCall call) {
        manager.stop();
        call.resolve();
    }
}
