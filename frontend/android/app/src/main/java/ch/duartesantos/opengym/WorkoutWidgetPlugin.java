package ch.duartesantos.opengym;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WorkoutWidgetNative")
public class WorkoutWidgetPlugin extends Plugin {
    private static WorkoutWidgetPlugin instance;
    private static boolean pendingAutoStart = false;

    @Override
    public void load() {
        super.load();
        instance = this;
        if (pendingAutoStart) {
            notifyAutoStartWorkout(getContext());
        }
    }

    public static void notifyStateChanged(Context context) {
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("timestamp", System.currentTimeMillis());
            instance.notifyListeners("onWidgetStateChanged", ret);
        }
    }

    public static void notifyAutoStartWorkout(Context context) {
        if (instance != null) {
            pendingAutoStart = false;
            JSObject ret = new JSObject();
            ret.put("timestamp", System.currentTimeMillis());
            ret.put("autoStart", true);
            instance.notifyListeners("onAutoStartWorkout", ret);
        } else {
            pendingAutoStart = true;
        }
    }

    @PluginMethod
    public void checkPendingAutoStart(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("autoStart", pendingAutoStart);
        pendingAutoStart = false;
        call.resolve(ret);
    }

    @PluginMethod
    public void updateWidget(PluginCall call) {
        WorkoutWidgetManager.updateAllWidgets(getContext());
        call.resolve();
    }
}
