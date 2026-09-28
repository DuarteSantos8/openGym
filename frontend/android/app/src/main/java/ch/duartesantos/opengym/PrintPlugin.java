package ch.duartesantos.opengym;

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

        getActivity().runOnUiThread(() -> {
            WebView webView = new WebView(getContext());
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    PrintManager printManager =
                            (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                    if (printManager == null) {
                        printView = null;
                        call.reject("printing is not available on this device");
                        return;
                    }
                    PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                    printManager.print(jobName, adapter,
                            new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .build());
                    call.resolve();
                }
            });
            // baseURL null: the document is fully self-contained (inline <style>, no assets).
            webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            printView = webView;
        });
    }
}
