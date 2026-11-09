package ch.duartesantos.opengym;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Settings → Workout → Screen orientation (#821): openGym follows the phone, or stays upright or
 * sideways whatever the phone does, without touching the system's own auto-rotate. The page
 * (lib/orientation.js) calls lock() with its choice; the choice is also kept in the app's
 * preferences, and MainActivity applies it in onCreate, so the app opens the right way up before
 * the page has loaded.
 *
 * Usage from JS:
 *   registerPlugin('Orientation').lock({ mode: 'portrait' })   // 'auto' | 'portrait' | 'landscape'
 */
@CapacitorPlugin(name = "Orientation")
public class OrientationPlugin extends Plugin {
    static final String PREFS = "opengym_orientation";
    static final String KEY = "mode";

    /** The ActivityInfo constant for a mode; anything unknown follows the phone. */
    static int requested(String mode) {
        if ("portrait".equals(mode)) return ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        if ("landscape".equals(mode)) return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        // Follow the phone, its auto-rotate switch included.
        return ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    }

    /** Applies the saved mode; called by MainActivity before the page loads. */
    static void applySaved(Activity activity) {
        if (activity == null) return;
        String mode = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "auto");
        activity.setRequestedOrientation(requested(mode));
    }

    @PluginMethod
    public void lock(PluginCall call) {
        final String mode = call.getString("mode", "auto");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        SharedPreferences.Editor e = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putString(KEY, mode).apply();
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(requested(mode));
            call.resolve();
        });
    }
}
