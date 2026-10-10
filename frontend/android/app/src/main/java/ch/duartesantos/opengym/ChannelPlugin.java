package ch.duartesantos.opengym;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Which build this is: "sideload" (the APK from GitHub and opengym.ch, which updates itself) or
 * "play" (Google Play, which updates it). The page asks once (lib/channel.js) and shows the
 * updater only in the first.
 */
@CapacitorPlugin(name = "Channel")
public class ChannelPlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("channel", BuildConfig.CHANNEL);
        call.resolve(ret);
    }
}
