package ch.duartesantos.opengym;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PdfRenderCallbacks;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Minimal local Capacitor plugin for paper output. Android WebView has no window.print(), so
 * printouts (the weekly plan, one workout, the performance report) reach paper through here.
 * No PDF library is bundled — the OS renders it:
 *  - printHtml hands the document to the system print flow (Save as PDF, Drive, a real printer);
 *  - sharePdf renders the document to a PDF file itself (no print service needed — some ROMs
 *    ship none) for the JS side to offer in the OS share sheet.
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
            try {
                Context context = getContext();
                if (context == null) {
                    call.reject("printing is not available right now");
                    return;
                }
                // new WebView() throws on a device whose WebView provider is missing, disabled
                // or mid-update — the try/catch turns that into a failed printout instead of
                // a killed process (the JS side treats a rejection like a dismissed sheet).
                WebView webView = new WebView(context);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        try {
                            Context ctx = getContext();
                            PrintManager printManager = ctx == null ? null
                                    : (PrintManager) ctx.getSystemService(Context.PRINT_SERVICE);
                            if (printManager == null) {
                                printView = null;
                                call.reject("printing is not available on this device");
                                return;
                            }
                            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                            printManager.print(jobName, adapter,
                                    new PrintAttributes.Builder()
                                            .setMediaSize(media)
                                            .build());
                            call.resolve();
                        } catch (ActivityNotFoundException e) {
                            // The ROM has no print service at all (nothing handles the print
                            // dialog — some builds strip it). A stable message the JS side
                            // recognises, so it can say what is missing instead of staying silent.
                            printView = null;
                            call.reject("no print service on this device");
                        } catch (Throwable e) {
                            // The page finished after the activity went away, or the print
                            // framework refused the job: fail this printout, never the app.
                            printView = null;
                            call.reject("printing failed: " + e.getMessage());
                        }
                    }
                });
                // baseURL null: the document is fully self-contained (inline <style>, no assets; the
                // exercise pictures, #817, arrive inline as data: URLs, the 180 px stills only).
                webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                printView = webView;
            } catch (Throwable e) {
                printView = null;
                call.reject("printing failed: " + e.getMessage());
            }
        });
    }

    /**
     * The same self-contained document as a PDF file in the app's cache: the JS side then hands
     * the file to the OS share sheet (Save to Downloads, Telegram, mail, …). A WebView print
     * adapter writes the paginated PDF itself — that is what PrintManager forwards to a print
     * service — so driving it directly needs no print service at all, and this also works on
     * ROMs that have none.
     */
    @PluginMethod
    public void sharePdf(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }
        final String jobName = call.getString("name", "openGym");
        final PrintAttributes.MediaSize media = "letter".equals(call.getString("paper", "a4"))
                ? PrintAttributes.MediaSize.NA_LETTER
                : PrintAttributes.MediaSize.ISO_A4;

        getActivity().runOnUiThread(() -> {
            try {
                Context context = getContext();
                if (context == null) {
                    call.reject("pdf is not available right now");
                    return;
                }
                // Same render path as printHtml above, including its WebView-missing guard.
                WebView webView = new WebView(context);
                // An unattached WebView has no window and no vsync, so without a real size the
                // renderer never lays out or paints and the PDF comes out blank. A4 proportions;
                // the print layout re-paginates for the paper either way.
                webView.layout(0, 0, 794, 1123);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        // onPageFinished beats the first paint — printing right here can capture
                        // an unpainted (blank) page. The visual-state callback fires when the
                        // content is actually presented; the fallback keeps a wedged renderer
                        // from hanging the call forever.
                        final boolean[] done = {false};
                        Runnable proceed = () -> {
                            if (done[0]) return;
                            done[0] = true;
                            writePdfToCache(view, call, jobName, media);
                        };
                        view.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                            @Override
                            public void onComplete(long requestId) {
                                proceed.run();
                            }
                        });
                        new android.os.Handler(android.os.Looper.getMainLooper())
                                .postDelayed(proceed, 3000);
                    }
                });
                webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                printView = webView;
            } catch (Throwable e) {
                printView = null;
                call.reject("pdf failed: " + e.getMessage());
            }
        });
    }

    // Drives the adapter through its print-service protocol — start, layout, write, finish —
    // with the write going to a cache file instead of a spooler. No margins from the framework:
    // the document's own @page rules set them, exactly as in the print flow.
    private void writePdfToCache(WebView view, PluginCall call, String jobName, PrintAttributes.MediaSize media) {
        Context context = getContext();
        if (context == null) {
            printView = null;
            call.reject("pdf is not available right now");
            return;
        }
        // Letters and digits of any script stay (the name is localized); the rest is an underscore.
        String safeName = jobName.replaceAll("[^\\p{L}\\p{N}._-]+", "_");
        final File file = new File(context.getCacheDir(), safeName + ".pdf");
        try {
            final PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
            PrintAttributes attrs = new PrintAttributes.Builder()
                    .setMediaSize(media)
                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .build();
            adapter.onStart();
            adapter.onLayout(attrs, attrs, null, PdfRenderCallbacks.layout(new PdfRenderCallbacks.LayoutListener() {
                @Override
                public void onFinished(PrintDocumentInfo info, boolean changed) {
                    try {
                        ParcelFileDescriptor out = ParcelFileDescriptor.open(file,
                                ParcelFileDescriptor.MODE_CREATE
                                        | ParcelFileDescriptor.MODE_READ_WRITE
                                        | ParcelFileDescriptor.MODE_TRUNCATE);
                        adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, out, null,
                                PdfRenderCallbacks.write(new PdfRenderCallbacks.WriteListener() {
                                    @Override
                                    public void onFinished(PageRange[] pages) {
                                        finishPdf(adapter, call, file, null);
                                    }
                                    @Override
                                    public void onFailed(CharSequence error) {
                                        finishPdf(adapter, call, file, "pdf write failed: " + error);
                                    }
                                    @Override
                                    public void onCancelled() {
                                        finishPdf(adapter, call, file, "pdf write cancelled");
                                    }
                                }));
                    } catch (Throwable e) {
                        finishPdf(adapter, call, file, "pdf failed: " + e.getMessage());
                    }
                }
                @Override
                public void onFailed(CharSequence error) {
                    finishPdf(adapter, call, file, "pdf layout failed: " + error);
                }
                @Override
                public void onCancelled() {
                    finishPdf(adapter, call, file, "pdf layout cancelled");
                }
            }), null);
        } catch (Throwable e) {
            printView = null;
            call.reject("pdf failed: " + e.getMessage());
        }
    }

    // Every adapter end state lands here: the call is answered once, the WebView reference is
    // dropped, and a failed run never leaves a half-written file behind.
    private void finishPdf(PrintDocumentAdapter adapter, PluginCall call, File file, String error) {
        try { adapter.onFinish(); } catch (Throwable e) { /* the adapter is done either way */ }
        printView = null;
        if (error == null && file.isFile() && file.length() > 0) {
            JSObject result = new JSObject();
            result.put("uri", Uri.fromFile(file).toString());
            call.resolve(result);
            return;
        }
        try { file.delete(); } catch (Throwable e) { /* nothing to clean up */ }
        call.reject(error == null ? "pdf came out empty" : error);
    }
}
