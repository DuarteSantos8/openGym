package ch.duartesantos.opengym;

import android.content.Context;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Settings → Look & Home → Text size (lib/display-prefs.js): the phone's own font size, for the
 * page to apply once.
 *
 * Left alone, Android's WebView zooms every glyph by the system font scale (WebSettings textZoom
 * starts at fontScale × 100). Only the glyphs: the rows, buttons and gaps around them stay the
 * same, so a big system font clipped set rows and buttons, and the app's own Text size multiplied
 * on top of it (Larger on a phone at 130 % came to 162 %). So the zoom is pinned to 100 here, and
 * the page asks for the scale (window.OpenGymText.scale()) and sizes its root font with it when
 * Text size is "Like the phone": rem-based spacing then grows with the words, and a pick of its own
 * replaces the phone's instead of stacking on it.
 *
 * load() runs while the Bridge registers its plugins, before it loads the page, so both the zoom
 * and the interface are in place for the first document. A change of the system font recreates
 * the activity (fontScale is not in the manifest's configChanges), and the new page asks again;
 * the page also asks whenever it comes back to the front.
 */
@CapacitorPlugin(name = "TextScale")
public class TextScalePlugin extends Plugin {
    /** The system font scale, 1 when it cannot be read. Static and pure for the unit test. */
    static float scaleOf(Context ctx) {
        if (ctx == null) return 1f;
        float k = ctx.getResources().getConfiguration().fontScale;
        return k > 0 && !Float.isNaN(k) && !Float.isInfinite(k) ? k : 1f;
    }

    /** What the page reads. Nothing but a number crosses: no method here acts on anything. */
    static final class Bridge {
        private final Context ctx;
        Bridge(Context ctx) { this.ctx = ctx.getApplicationContext(); }
        @JavascriptInterface
        public float scale() { return scaleOf(ctx); }
    }

    @Override
    public void load() {
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null) return;
        web.getSettings().setTextZoom(100);
        web.addJavascriptInterface(new Bridge(getContext()), "OpenGymText");
    }
}
