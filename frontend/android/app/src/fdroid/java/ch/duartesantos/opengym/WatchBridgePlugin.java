package ch.duartesantos.opengym;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSArray;

/**
 * The Wear OS watch link in the F-Droid build: there is none. Wear OS watches reach the phone only
 * through the Wearable Data Layer of Google Play services, and an F-Droid app carries nothing from
 * Google Play services. Same name and calls as the real plugin (src/gms), so the page needs no
 * second code path: status() says "no watch" and lib/watch-sync.js then sends nothing at all.
 * Settings → About says so in words (views/Settings.jsx, channel "fdroid").
 */
@CapacitorPlugin(name = "WatchBridge")
public class WatchBridgePlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("supported", false);
        out.put("activated", false);
        out.put("paired", false);
        out.put("installed", false);
        out.put("reachable", false);
        call.resolve(out);
    }

    @PluginMethod
    public void sendSnapshot(PluginCall call) { call.resolve(new JSObject().put("sent", false)); }

    @PluginMethod
    public void drain(PluginCall call) { call.resolve(new JSObject().put("events", new JSArray())); }

    @PluginMethod
    public void ack(PluginCall call) { call.resolve(); }

    @PluginMethod
    public void openOnWatch(PluginCall call) { call.resolve(new JSObject().put("ok", false)); }

    @PluginMethod
    public void sendClips(PluginCall call) { call.resolve(new JSObject().put("sent", 0)); }

    @PluginMethod
    public void dropClips(PluginCall call) { call.resolve(); }
}
