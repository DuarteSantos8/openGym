package android.print;

/**
 * Compile-time bridge to PrintDocumentAdapter's result callbacks.
 *
 * The SDK stubs (android.jar) expose LayoutResultCallback/WriteResultCallback with a
 * package-private constructor, so app code in any other package cannot subclass them — while
 * the constructors are public in the actual framework on every device runtime checked
 * (verified on-device on API 36 via reflection; the same direct-subclass pattern has worked
 * since these callbacks exist). Declaring the subclasses here, in package android.print, lets
 * javac accept the super constructor, and at runtime the public constructor passes the access
 * check.
 *
 * Used by PrintPlugin.sharePdf, which drives a WebView print adapter into a PDF file without
 * involving the system print service (some ROMs ship none).
 */
public final class PdfRenderCallbacks {
    private PdfRenderCallbacks() {}

    public interface LayoutListener {
        void onFinished(PrintDocumentInfo info, boolean changed);
        void onFailed(CharSequence error);
        void onCancelled();
    }

    public interface WriteListener {
        void onFinished(PageRange[] pages);
        void onFailed(CharSequence error);
        void onCancelled();
    }

    public static PrintDocumentAdapter.LayoutResultCallback layout(LayoutListener listener) {
        return new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                listener.onFinished(info, changed);
            }
            @Override
            public void onLayoutFailed(CharSequence error) {
                listener.onFailed(error);
            }
            @Override
            public void onLayoutCancelled() {
                listener.onCancelled();
            }
        };
    }

    public static PrintDocumentAdapter.WriteResultCallback write(WriteListener listener) {
        return new PrintDocumentAdapter.WriteResultCallback() {
            @Override
            public void onWriteFinished(PageRange[] pages) {
                listener.onFinished(pages);
            }
            @Override
            public void onWriteFailed(CharSequence error) {
                listener.onFailed(error);
            }
            @Override
            public void onWriteCancelled() {
                listener.onCancelled();
            }
        };
    }
}
