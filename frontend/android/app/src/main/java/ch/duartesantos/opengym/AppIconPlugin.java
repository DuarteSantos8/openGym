package ch.duartesantos.opengym;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The home-screen icon (Settings → Look & Home → App icon, lib/app-icon.js). Android has no API
 * for it: each icon is a launcher activity-alias (AppIcons), and switching enables the chosen one
 * and disables the rest.
 *
 * The switch waits until the app goes to the background. Disabling the alias the running task was
 * started from closes the app on several Android versions even with DONT_KILL_APP, so the choice
 * is kept in this phone's preferences and applied in handleOnStop. Some launchers then take a few
 * seconds to redraw the icon. Notifications and Health Connect's links name MainActivity itself
 * (or an alias of their own), which is never disabled, so they keep working whichever icon is on.
 *
 * Usage from JS:
 *   const AppIcon = registerPlugin('AppIcon')
 *   await AppIcon.getIcon()                  // { supported: true, name: 'default', pending: false }
 *   await AppIcon.setIcon({ name: 'sky' })   // { name: 'sky', later: true }
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
    private static final String TAG = "AppIconPlugin";
    private static final String PREFS = "opengym_app_icon";
    private static final String PENDING = "pending";

    @PluginMethod
    public void getIcon(PluginCall call) {
        String pending = prefs().getString(PENDING, null);
        JSObject r = new JSObject();
        r.put("supported", true);
        r.put("name", pending != null ? pending : current());
        r.put("pending", pending != null);
        call.resolve(r);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String name = call.getString("name");
        if (AppIcons.aliasFor(name) == null) {
            call.reject("unknown icon");
            return;
        }
        // Picking the icon already on the home screen again just drops a pending switch.
        boolean later = !name.equals(current());
        if (later) prefs().edit().putString(PENDING, name).apply();
        else prefs().edit().remove(PENDING).apply();
        JSObject r = new JSObject();
        r.put("name", name);
        r.put("later", later);
        call.resolve(r);
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        String pending = prefs().getString(PENDING, null);
        if (pending == null) return;
        prefs().edit().remove(PENDING).apply();
        apply(pending);
    }

    private void apply(String id) {
        String target = AppIcons.aliasFor(id);
        if (target == null) return;
        PackageManager pm = getContext().getPackageManager();
        try {
            // The new entry first, so the launcher never sees the app without one.
            pm.setComponentEnabledSetting(component(target), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            for (String alias : AppIcons.ALIASES) {
                if (alias.equals(target)) continue;
                pm.setComponentEnabledSetting(component(alias), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "could not switch the launcher icon", e);
        }
    }

    /** The icon the launcher shows now, from the aliases' enabled state. */
    private String current() {
        PackageManager pm = getContext().getPackageManager();
        boolean[] byHand = new boolean[AppIcons.ALIASES.length];
        for (int i = 0; i < byHand.length; i++) {
            byHand[i] = pm.getComponentEnabledSetting(component(AppIcons.ALIASES[i])) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
        }
        return AppIcons.current(byHand);
    }

    // The package is the applicationId (".test" on the debug build), the class part the manifest's
    // namespace, which is MainActivity's package whatever the build.
    private ComponentName component(String alias) {
        return new ComponentName(getContext(), MainActivity.class.getPackage().getName() + "." + alias);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
