package ch.duartesantos.opengym;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/**
 * Hands the background check its days (frontend lib/nudge-check.js), or takes it back. See
 * NudgeCheck for what is kept and NudgeCheckJob for the check.
 *
 * Usage from JS:
 *   const NudgeCheck = registerPlugin('NudgeCheck');
 *   await NudgeCheck.arm({ server, headers, entries: [{ date, at, reminder: [ids], nudge: [ids] }] });
 *   await NudgeCheck.disarm();
 */
@CapacitorPlugin(name = "NudgeCheck")
public class NudgeCheckPlugin extends Plugin {

    @PluginMethod
    public void arm(PluginCall call) {
        String server = call.getString("server");
        if (server == null || server.isEmpty()) {
            call.reject("server is required");
            return;
        }
        try {
            JSObject headers = call.getObject("headers", new JSObject());
            JSArray entries = call.getArray("entries", new JSArray());
            JSONObject config = new JSONObject().put("server", server).put("headers", headers).put("entries", entries);
            if (!NudgeCheck.save(getContext(), config)) {
                call.reject("could not keep the check");
                return;
            }
            NudgeCheck.schedule(getContext(), config);
            call.resolve();
        } catch (Exception e) {
            call.reject("could not keep the check", e);
        }
    }

    @PluginMethod
    public void disarm(PluginCall call) {
        NudgeCheck.clear(getContext());
        call.resolve();
    }
}
