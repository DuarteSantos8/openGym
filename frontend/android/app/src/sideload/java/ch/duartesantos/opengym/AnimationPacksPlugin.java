package ch.duartesantos.opengym;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The sharper exercise animations as asset packs (frontend lib/anim-packs.js), in the sideloaded
 * APK: it has no Play Store behind it to deliver them, so there are none. Every call answers
 * "unavailable" and the app shows the animations built into it (240 px in the release APK). The
 * Google Play build has the real one (src/play, Play Asset Delivery); the interface is the iOS
 * plugin's, so the page needs no Android branch.
 */
@CapacitorPlugin(name = "AnimationPacks")
public class AnimationPacksPlugin extends Plugin {

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("state", "none");
        call.resolve(ret);
    }

    @PluginMethod
    public void download(PluginCall call) {
        call.reject("asset packs are not available on Android yet", "unavailable");
    }

    @PluginMethod
    public void remove(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void localPath(PluginCall call) {
        call.reject("not downloaded", "unavailable");
    }
}
