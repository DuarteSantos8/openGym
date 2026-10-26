package ch.duartesantos.opengym;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/**
 * The page's side of the gym reminder (#614, frontend lib/gym-reminder.js); GymReminder does the
 * watching and the posting.
 *
 * Usage from JS:
 *   const GR = registerPlugin('GymReminder');
 *   await GR.configure({ config });          // { watching, permission }
 *   await GR.status({ trainedOn, quietOn, activeSince, title, body, channel, scan });
 *   await GR.server({ server, headers });    // the paired server, asked about today before posting ('' forgets it)
 *   await GR.get();                          // { config, permission, watching }
 *   await GR.permission();                   // { location, background, notifications }
 *   await GR.requestForeground();            // while-in-use location
 *   await GR.requestBackground();            // "Allow all the time" (Android 10+), after the in-app explainer
 *   await GR.currentPosition();              // { lat, lng, accuracy }
 *   await GR.openSettings();
 *   GR.addListener('open', fn);              // the notification was tapped
 */
@CapacitorPlugin(
    name = "GymReminder",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
    }
)
public class GymReminderPlugin extends Plugin {

    @Override
    public void load() {
        // Launched by a tap on the notification: told to the page once it listens.
        Intent i = getActivity() == null ? null : getActivity().getIntent();
        if (i != null && GymReminder.actionOpen(getContext()).equals(i.getAction())) {
            i.setAction(Intent.ACTION_MAIN);
            notifyListeners("open", new JSObject(), true);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && GymReminder.actionOpen(getContext()).equals(intent.getAction())) {
            notifyListeners("open", new JSObject(), true);
        }
    }

    private JSObject permissions() {
        Context ctx = getContext();
        JSObject r = new JSObject();
        boolean fine = GymReminder.hasFine(ctx);
        PermissionState loc = getPermissionState("location");
        r.put("location", fine ? "granted" : loc == PermissionState.DENIED ? "denied" : "prompt");
        if (GymReminder.hasBackground(ctx)) r.put("background", "granted");
        else if (Build.VERSION.SDK_INT >= 29 && getPermissionState("background") == PermissionState.DENIED && fine) r.put("background", "denied");
        else r.put("background", "prompt");
        android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        r.put("notifications", nm != null && nm.areNotificationsEnabled() ? "granted" : "denied");
        // Whether the approach check may start from the background (GymReminder.launchCheck).
        r.put("quick", GymReminder.quickCheckAllowed(ctx) ? "granted" : "off");
        return r;
    }

    @PluginMethod
    public void configure(PluginCall call) {
        JSObject config = call.getObject("config");
        if (config == null) {
            call.reject("config is required");
            return;
        }
        GymReminder.saveConfig(getContext(), config);
        int n = GymReminder.register(getContext());
        JSObject r = new JSObject();
        r.put("watching", n);
        r.put("permission", permissions());
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject s = new JSObject();
        s.put("trainedOn", call.getString("trainedOn", ""));
        s.put("quietOn", call.getString("quietOn", ""));
        Double since = call.getDouble("activeSince");
        s.put("activeSince", since == null ? 0L : since.longValue());
        s.put("title", call.getString("title", ""));
        s.put("body", call.getString("body", ""));
        s.put("channel", call.getString("channel", ""));
        s.put("scan", call.getString("scan", ""));
        GymReminder.saveStatus(getContext(), s);
        call.resolve();
    }

    @PluginMethod
    public void server(PluginCall call) {
        String server = call.getString("server", "");
        JSONObject auth = null;
        if (server != null && !server.isEmpty()) {
            auth = new JSONObject();
            try {
                auth.put("server", server);
                JSObject h = call.getObject("headers");
                auth.put("headers", h == null ? new JSONObject() : h);
            } catch (Exception e) {
                auth = null;
            }
        }
        GymReminder.saveServer(getContext(), auth);
        call.resolve();
    }

    @PluginMethod
    public void get(PluginCall call) {
        Context ctx = getContext();
        JSONObject c = GymReminder.config(ctx);
        // Alerts lost while the app could not watch (permission taken back and given again):
        // the page opening the settings is a good moment to arm them again.
        if (c != null && c.optBoolean("on", false) && GymReminder.watching(ctx) == 0 && GymReminder.hasFine(ctx)) GymReminder.register(ctx);
        JSObject r = new JSObject();
        try {
            if (c != null) r.put("config", JSObject.fromJSONObject(c));
        } catch (Exception ignored) {
            // an unreadable copy: the page falls back to its own
        }
        r.put("permission", permissions());
        r.put("watching", GymReminder.watching(ctx));
        call.resolve(r);
    }

    @PluginMethod
    public void permission(PluginCall call) {
        call.resolve(permissions());
    }

    @PluginMethod
    public void requestForeground(PluginCall call) {
        if (GymReminder.hasFine(getContext())) {
            call.resolve(permissions());
            return;
        }
        requestPermissionForAlias("location", call, "afterPermission");
    }

    @PluginMethod
    public void requestBackground(PluginCall call) {
        Context ctx = getContext();
        if (GymReminder.hasBackground(ctx) || Build.VERSION.SDK_INT < 29) {
            call.resolve(permissions());
            return;
        }
        if (!GymReminder.hasFine(ctx)) {
            // Android grants "all the time" only on top of while-in-use location.
            requestPermissionForAlias("location", call, "afterForegroundForBackground");
            return;
        }
        requestPermissionForAlias("background", call, "afterPermission");
    }

    @PermissionCallback
    private void afterForegroundForBackground(PluginCall call) {
        if (!GymReminder.hasFine(getContext())) {
            call.resolve(permissions());
            return;
        }
        requestPermissionForAlias("background", call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        // Allowed now: whatever the page saved earlier is watched from here on.
        GymReminder.register(getContext());
        call.resolve(permissions());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** One fix, from whichever provider is on; a recent last known one if none answers in time. */
    @PluginMethod
    public void currentPosition(PluginCall call) {
        Context ctx = getContext();
        if (!GymReminder.hasFine(ctx)) {
            call.reject("location not allowed");
            return;
        }
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) {
            call.reject("no location service");
            return;
        }
        String provider = null;
        for (String p : new String[] { Build.VERSION.SDK_INT >= 31 ? LocationManager.FUSED_PROVIDER : null, LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
            if (p != null && lm.getAllProviders().contains(p) && lm.isProviderEnabled(p)) {
                provider = p;
                break;
            }
        }
        if (provider == null) {
            call.reject("location is switched off");
            return;
        }
        AtomicBoolean done = new AtomicBoolean(false);
        Handler main = new Handler(Looper.getMainLooper());
        final String used = provider;
        Runnable fallback = () -> {
            if (done.getAndSet(true)) return;
            Location last = lastKnown(lm);
            if (last != null && System.currentTimeMillis() - last.getTime() < 10 * 60_000L) answer(call, last);
            else call.reject("no fix");
        };
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                CancellationSignal cancel = new CancellationSignal();
                lm.getCurrentLocation(used, cancel, ctx.getMainExecutor(), loc -> {
                    if (loc == null) {
                        fallback.run();
                        return;
                    }
                    if (done.getAndSet(true)) return;
                    answer(call, loc);
                });
                main.postDelayed(() -> {
                    cancel.cancel();
                    fallback.run();
                }, 25_000);
            } else {
                lm.requestSingleUpdate(used, new android.location.LocationListener() {
                    @Override
                    public void onLocationChanged(Location loc) {
                        if (done.getAndSet(true)) return;
                        answer(call, loc);
                    }

                    @Override
                    public void onStatusChanged(String p, int s, android.os.Bundle b) {}

                    @Override
                    public void onProviderEnabled(String p) {}

                    @Override
                    public void onProviderDisabled(String p) {}
                }, Looper.getMainLooper());
                main.postDelayed(fallback, 25_000);
            }
        } catch (SecurityException e) {
            call.reject("location not allowed");
        }
    }

    private static Location lastKnown(LocationManager lm) {
        Location best = null;
        try {
            for (String p : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
        } catch (SecurityException ignored) {
            // asked without permission: nothing known
        }
        return best;
    }

    private static void answer(PluginCall call, Location loc) {
        JSObject r = new JSObject();
        r.put("lat", loc.getLatitude());
        r.put("lng", loc.getLongitude());
        r.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : null);
        call.resolve(r);
    }
}
