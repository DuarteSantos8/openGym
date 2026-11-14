package ch.duartesantos.opengym;

import android.app.Activity;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android 15 draws the page under the status bar and the navigation bar, so the clock, the battery
 * and the three buttons sit on the page's own background. The system draws them white unless told
 * otherwise, and on the light theme (#f2f2f7) they all but vanished. The page tells this plugin
 * which theme it resolved to (lib/system-bars.js), at start and on every change, and the bars
 * follow with dark icons on light and light icons on dark. Before Android 15 the bars keep their
 * own background and there is nothing to change.
 *
 * Usage from JS:
 *   registerPlugin('BarIcons').setStyle({ light: true })
 */
@CapacitorPlugin(name = "BarIcons")
public class BarIconsPlugin extends Plugin {

    @PluginMethod
    public void setStyle(PluginCall call) {
        final boolean light = Boolean.TRUE.equals(call.getBoolean("light", false));
        final Activity activity = getActivity();
        if (Build.VERSION.SDK_INT < 35 || activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
            bars.setAppearanceLightStatusBars(light);
            bars.setAppearanceLightNavigationBars(light);
            call.resolve();
        });
    }
}
