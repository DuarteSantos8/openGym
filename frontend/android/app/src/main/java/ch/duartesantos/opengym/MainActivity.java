package ch.duartesantos.opengym;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    // Where the status bar (or the camera cutout) ends and the navigation bar starts, in CSS
    // pixels; negative until the window has said.
    private float barTop = -1;
    private float barBottom = -1;
    // How much of the page the soft keyboard covers, in CSS pixels; 0 while it is down.
    private float keyboard = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InstallPlugin.class);
        registerPlugin(PrintPlugin.class);
        registerPlugin(RestAlertPlugin.class);
        registerPlugin(BackupFolderPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
        passSystemBarsToPage();
    }

    /**
     * Android 15 draws an app that targets it edge to edge: the page runs under the status bar and
     * under the navigation bar. The WebView reports only the camera cutout as
     * env(safe-area-inset-*), and on some cold starts not even that, so the tab bar sat under the
     * navigation bar (with three buttons, a tap on a tab hit Home or Recents) and now and then the
     * header sat under the status bar. The window's own insets go to the page as --native-sat and
     * --native-sab, which index.css takes over env() wherever they are larger. Before Android 15
     * the window stops at the bars and there is nothing to pass.
     */
    private void passSystemBarsToPage() {
        if (Build.VERSION.SDK_INT < 35 || bridge == null) return;
        WebView web = bridge.getWebView();
        if (web == null || !(web.getParent() instanceof View)) return;
        // Read on the WebView's parent, which hands them on to the WebView untouched. A listener on
        // the WebView itself would replace the one the WebView installs for its own insets, and
        // env(safe-area-inset-top) went to 0 on every start.
        View holder = (View) web.getParent();
        ViewCompat.setOnApplyWindowInsetsListener(holder, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = v.getResources().getDisplayMetrics().density;
            barTop = bars.top / density;
            barBottom = bars.bottom / density;
            float kb = coveredByKeyboard(v, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom) / density;
            boolean kbChanged = kb != keyboard;
            keyboard = kb;
            applyBars(web);
            if (kbChanged) web.evaluateJavascript(keyboardScript(keyboard), null);
            return ViewCompat.onApplyWindowInsets(v, insets);
        });
        // A page that loads (the first one, or a reload) starts without them.
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                applyBars(view);
                view.evaluateJavascript(keyboardScript(keyboard), null);
            }
        });
        ViewCompat.requestApplyInsets(holder);
    }

    /**
     * Edge to edge, adjustResize no longer shrinks the window for the soft keyboard: the WebView
     * keeps its full height, innerHeight and visualViewport do not move, and a bottom sheet stays
     * under the keys. The IME inset is the keyboard's top measured from the foot of the window;
     * whatever the system did shrink the view by (should a device still resize it) is taken off,
     * so the page is never lifted twice.
     */
    static int coveredByKeyboard(View v, int imeBottom) {
        if (imeBottom <= 0) return 0;
        View root = v.getRootView();
        int[] at = new int[2];
        v.getLocationInWindow(at);
        int below = root.getHeight() - (at[1] + v.getHeight());
        return Math.max(0, imeBottom - Math.max(0, below));
    }

    private void applyBars(WebView web) {
        if (barTop < 0 || barBottom < 0) return;
        web.evaluateJavascript(barsScript(barTop, barBottom), null);
    }

    /** Float.toString: a decimal point in every locale, where String.format could write a comma. */
    static String barsScript(float top, float bottom) {
        return "(function(e){if(!e)return;"
                + "e.style.setProperty('--native-sat','" + Float.toString(top) + "px');"
                + "e.style.setProperty('--native-sab','" + Float.toString(bottom) + "px')"
                + "})(document.documentElement)";
    }

    /** --native-kb on the page, and an event its sheets listen for (lib/native-keyboard.js). */
    static String keyboardScript(float height) {
        String px = Float.toString(height);
        return "(function(e){if(!e)return;"
                + "e.style.setProperty('--native-kb','" + px + "px');"
                + "if(" + px + ">0)e.setAttribute('data-native-kb','');else e.removeAttribute('data-native-kb');"
                + "window.dispatchEvent(new CustomEvent('opengym:native-keyboard',{detail:{height:" + px + "}}))"
                + "})(document.documentElement)";
    }
}
