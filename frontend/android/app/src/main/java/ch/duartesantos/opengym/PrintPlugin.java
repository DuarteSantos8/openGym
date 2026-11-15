package ch.duartesantos.opengym;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Minimal local Capacitor plugin that hands a self-contained HTML document to the Android
 * system print flow (Save as PDF, Save to Drive, a real printer). Android WebView has no
 * window.print(), so the printable plan page (lib/plan-share.js planPrintHTML) can only reach
 * a PDF this way. No PDF library is bundled — the OS renders it.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const Print = registerPlugin('Print');
 *   await Print.printHtml({ html: '<!doctype html>…', name: 'Weekly Training Plan' });
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    // The print framework drives an off-screen WebView asynchronously; without a strong
    // reference it can be collected mid-spool and the job dies silently. Held until the next
    // print replaces it — one at a time is all the UI can start.
    private WebView printView;

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }
        final String jobName = call.getString("name", "openGym");
        // The sheet starts on the paper people use where the phone is (lib/print-doc.js paperFor);
        // it can be changed there. Page numbers and margins come from the document's own @page
        // rules, which this WebView (Chromium) prints.
        final PrintAttributes.MediaSize media = "letter".equals(call.getString("paper", "a4"))
                ? PrintAttributes.MediaSize.NA_LETTER
                : PrintAttributes.MediaSize.ISO_A4;

        getActivity().runOnUiThread(() -> {
            // #991: anything thrown on the UI thread here took the whole app down. A WebView that
            // cannot be made (its provider mid-update) or a ROM without a print service now fail
            // this printout only.
            try {
                Context ctx = getContext();
                if (ctx == null) {
                    call.reject("printing is not available right now", "unavailable");
                    return;
                }
                WebView webView = new WebView(ctx);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        startPrint(call, view, jobName, media);
                    }
                });
                // baseURL null: the document is fully self-contained (inline <style>, no assets; the
                // exercise pictures, #817, arrive inline as data: URLs, the 180 px stills only).
                webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                printView = webView;
            } catch (Throwable e) {
                printView = null;
                call.reject("printing failed: " + e.getMessage(), "failed");
            }
        });
    }

    // Hands the loaded page to the system print flow. Some ROMs (HyperOS seen) ship no print
    // service: PrintManager.print then throws ActivityNotFoundException, answered as "no-service"
    // so the page can say what is missing.
    private void startPrint(PluginCall call, WebView view, String jobName, PrintAttributes.MediaSize media) {
        try {
            Context ctx = getContext();
            PrintManager printManager = ctx == null ? null : (PrintManager) ctx.getSystemService(Context.PRINT_SERVICE);
            if (printManager == null) {
                printView = null;
                call.reject("printing is not available on this device", "no-service");
                return;
            }
            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
            printManager.print(jobName, adapter, new PrintAttributes.Builder().setMediaSize(media).build());
            call.resolve();
        } catch (ActivityNotFoundException e) {
            printView = null;
            call.reject("no print service on this device", "no-service");
        } catch (Throwable e) {
            printView = null;
            call.reject("printing failed: " + e.getMessage(), "failed");
        }
    }
}
