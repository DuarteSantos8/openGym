package ch.duartesantos.opengym;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Sign in with the server's identity provider (OIDC) in the system browser (lib/oidc-app.js), as
 * a Custom Tab where the browser has them. The way back is opengym://oidc, which the manifest's
 * opengym intent filter hands to MainActivity, and Capacitor's App plugin passes on as appUrlOpen.
 *
 * No androidx.browser dependency for one intent: the session extra below is what asks a
 * supporting browser for a Custom Tab, and any other browser just opens the page.
 *
 * Usage from JS:
 *   const OidcBrowser = registerPlugin('OidcBrowser');
 *   await OidcBrowser.open({ url });   // { opened: true }; the result comes as appUrlOpen
 */
@CapacitorPlugin(name = "OidcBrowser")
public class OidcBrowserPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String raw = call.getString("url", "");
        Uri uri = Uri.parse(raw);
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) {
            call.reject("not a web address", "failed");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        Bundle extras = new Bundle();
        extras.putBinder("android.support.customtabs.extra.SESSION", null);
        intent.putExtras(extras);
        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            call.reject("no browser on this phone", "failed");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("opened", true);
        call.resolve(ret);
    }
}
