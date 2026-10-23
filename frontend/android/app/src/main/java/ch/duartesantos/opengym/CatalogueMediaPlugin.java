package ch.duartesantos.opengym;

import android.os.StatFs;
import android.system.ErrnoException;
import android.system.OsConstants;
import android.system.Os;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.CookieHandler;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The small part Filesystem.downloadFile cannot supply: bounded streaming and response metadata.
 * This plugin only writes inside the catalogue staging directory; file commit stays in the store.
 * No API cookies, authorization headers, global HTTP client, or third-party library are used.
 */
@CapacitorPlugin(name = "CatalogueMedia")
public class CatalogueMediaPlugin extends Plugin {
    private static final String ROOT = "opengym-catalogue-media";
    private static final int BUFFER = 64 * 1024;
    private final ExecutorService io = Executors.newFixedThreadPool(2);

    // Capacitor installs a process CookieHandler backed by WebView cookies. URLConnection
    // consults it even when an empty Cookie header was supplied. Delegate transparently for
    // all other requests, and suppress both reading and storing cookies on our I/O threads.
    static final class CatalogueCookies extends CookieHandler {
        private static final ThreadLocal<Boolean> isolated = new ThreadLocal<>();
        private final CookieHandler delegate;
        CatalogueCookies(CookieHandler delegate) { this.delegate = delegate; }
        static synchronized void enter() {
            CookieHandler current = CookieHandler.getDefault();
            if (!(current instanceof CatalogueCookies)) CookieHandler.setDefault(new CatalogueCookies(current));
            isolated.set(Boolean.TRUE);
        }
        static void leave() { isolated.remove(); }
        @Override
        public Map<String, List<String>> get(URI uri, Map<String, List<String>> headers) throws IOException {
            return Boolean.TRUE.equals(isolated.get()) || delegate == null ? Collections.emptyMap() : delegate.get(uri, headers);
        }
        @Override
        public void put(URI uri, Map<String, List<String>> headers) throws IOException {
            if (!Boolean.TRUE.equals(isolated.get()) && delegate != null) delegate.put(uri, headers);
        }
    }

    static class Failure extends IOException {
        final String code;
        final Integer status;
        final Long retryAfterMs;
        Failure(String code, String message) { this(code, message, null, null); }
        Failure(String code, String message, Integer status, Long retryAfterMs) {
            super(message); this.code = code; this.status = status; this.retryAfterMs = retryAfterMs;
        }
    }

    private File safeFile(String path) throws IOException {
        if (path == null || path.contains("\\") || path.startsWith("/") || path.contains(":")) throw new Failure("io", "Invalid catalogue path");
        for (String part : path.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new Failure("io", "Invalid catalogue path");
        File root = new File(getContext().getFilesDir(), ROOT).getCanonicalFile();
        File file = new File(getContext().getFilesDir(), path).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator)) throw new Failure("io", "Path outside catalogue storage");
        return file;
    }

    private static long positive(PluginCall call, String name) throws Failure {
        Double value = call.getDouble(name);
        if (value == null) { Long integer = call.getLong(name); if (integer != null) value = integer.doubleValue(); }
        if (value == null || value.isNaN() || value.isInfinite() || value <= 0 || value != Math.floor(value) || value > 9007199254740991d) throw new Failure("size", "Invalid expected file size");
        return value.longValue();
    }

    static URI secureUrl(String value) throws Failure {
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) throw new Exception();
            return uri;
        } catch (Exception e) { throw new Failure("redirect", "Only credential-free HTTPS media URLs are accepted"); }
    }

    private static int port(URI uri) { return uri.getPort() < 0 ? 443 : uri.getPort(); }
    static boolean sameOrigin(URI a, URI b) { return a.getHost().equalsIgnoreCase(b.getHost()) && port(a) == port(b); }
    private static boolean redirect(int status) { return status == 301 || status == 302 || status == 303 || status == 307 || status == 308; }

    private static Failure networkFailure(IOException e) {
        return new Failure(e instanceof SocketTimeoutException ? "timeout" : "network", e.getMessage() == null ? "Media connection failed" : e.getMessage());
    }

    private static int readNetwork(InputStream input, byte[] buffer) throws Failure {
        try { return input.read(buffer); } catch (IOException e) { throw networkFailure(e); }
    }

    interface Progress { void received(long bytes); }
    static long copyBounded(InputStream input, OutputStream output, long expected, Progress progress) throws IOException {
        byte[] buffer = new byte[BUFFER];
        long written = 0, lastProgress = 0;
        for (int n; (n = readNetwork(input, buffer)) != -1; ) {
            if (n > expected - written) throw new Failure("size", "Media response exceeds its declared size");
            output.write(buffer, 0, n); written += n;
            long now = System.currentTimeMillis();
            if (now - lastProgress >= 200 || written == expected) { progress.received(written); lastProgress = now; }
        }
        if (written != expected) throw new Failure("size", "Media response is incomplete");
        return written;
    }

    private static long contentLength(HttpURLConnection connection) throws Failure {
        String value = connection.getHeaderField("Content-Length");
        if (value == null) return -1;
        try { long bytes = Long.parseLong(value); if (bytes < 0) throw new NumberFormatException(); return bytes; }
        catch (NumberFormatException e) { throw new Failure("size", "Invalid media response length"); }
    }

    static Long retryAfter(String value, long now) {
        if (value == null) return null;
        value = value.trim();
        try {
            if (value.matches("[0-9]+")) {
                long seconds = Long.parseLong(value);
                return seconds <= Long.MAX_VALUE / 1000 ? seconds * 1000 : null;
            }
            SimpleDateFormat format = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
            format.setLenient(false); format.setTimeZone(TimeZone.getTimeZone("GMT"));
            ParsePosition at = new ParsePosition(0);
            Date date = format.parse(value, at);
            if (date != null && at.getIndex() == value.length()) return Math.max(0L, date.getTime() - now);
        } catch (Exception ignored) { }
        return null;
    }

    static String classify(Exception e) {
        if (e instanceof Failure) return ((Failure) e).code;
        if (e instanceof SocketTimeoutException) return "timeout";
        if (e instanceof UnknownHostException) return "network";
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof ErrnoException && ((ErrnoException) cause).errno == OsConstants.ENOSPC) return "no-space";
            if (cause.getMessage() != null && cause.getMessage().matches("(?is).*(ENOSPC|no space left|disk full).*")) return "no-space";
        }
        return "io";
    }

    private void failed(PluginCall call, Exception e) {
        JSObject result = new JSObject(), error = new JSObject();
        error.put("code", classify(e));
        error.put("message", e.getMessage() == null ? "Catalogue media operation failed" : e.getMessage());
        error.put("status", e instanceof Failure && ((Failure) e).status != null ? ((Failure) e).status : org.json.JSONObject.NULL);
        error.put("retryAfterMs", e instanceof Failure && ((Failure) e).retryAfterMs != null ? ((Failure) e).retryAfterMs : org.json.JSONObject.NULL);
        result.put("error", error); call.resolve(result);
    }

    @PluginMethod
    public void download(PluginCall call) {
        io.execute(() -> {
            File destination = null;
            HttpURLConnection connection = null;
            try {
                CatalogueCookies.enter();
                String path = call.getString("destination");
                if (path == null || !path.matches(ROOT + "/staging/[A-Za-z0-9_-]{1,160}\\.part")) throw new Failure("io", "Invalid staging destination");
                destination = safeFile(path);
                long expected = positive(call, "expectedBytes");
                if (new StatFs(getContext().getFilesDir().getAbsolutePath()).getAvailableBytes() < expected) throw new Failure("no-space", "Not enough space for this animation");
                URI first = secureUrl(call.getString("url")), current = first;
                int status = 0;
                for (int hop = 0; ; hop++) {
                    connection = (HttpURLConnection) new URL(current.toASCIIString()).openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(30000); connection.setReadTimeout(30000);
                    connection.setRequestMethod("GET"); connection.setUseCaches(false);
                    connection.setRequestProperty("Accept-Encoding", "identity");
                    // Defence in depth; CatalogueCookies also suppresses the CookieHandler.
                    connection.setRequestProperty("Cookie", "");
                    try { status = connection.getResponseCode(); } catch (IOException e) { throw networkFailure(e); }
                    if (!redirect(status)) break;
                    String location = connection.getHeaderField("Location");
                    connection.disconnect(); connection = null;
                    if (hop >= 4 || location == null) throw new Failure("redirect", "Media redirect limit exceeded");
                    URI next = secureUrl(current.resolve(location).toString());
                    if (!sameOrigin(first, next)) throw new Failure("redirect", "Media redirect changed origin");
                    current = next;
                }
                if (status != 200) throw new Failure("http", "Media server returned HTTP " + status, status, retryAfter(connection.getHeaderField("Retry-After"), System.currentTimeMillis()));
                String encoding = connection.getHeaderField("Content-Encoding");
                if (encoding != null && !encoding.isEmpty() && !"identity".equalsIgnoreCase(encoding)) throw new Failure("type", "Encoded media response is not accepted");
                long declared = contentLength(connection);
                if (declared >= 0 && declared != expected) throw new Failure("size", "Media response has the wrong length");
                File parent = destination.getParentFile();
                if (!parent.isDirectory() && !parent.mkdirs()) throw new Failure("io", "Could not create staging folder");
                long written;
                InputStream response;
                try { response = connection.getInputStream(); } catch (IOException e) { throw networkFailure(e); }
                try (InputStream input = response; FileOutputStream output = new FileOutputStream(destination)) {
                    written = copyBounded(input, output, expected, bytes -> {
                        JSObject progress = new JSObject(); progress.put("destination", path); progress.put("bytesWritten", bytes);
                        notifyListeners("progress", progress);
                    });
                    output.getFD().sync();
                }
                JSObject result = new JSObject(); result.put("bytesWritten", written); result.put("finalUrl", current.toASCIIString()); call.resolve(result);
            } catch (Exception e) {
                if (destination != null && destination.isFile()) destination.delete();
                failed(call, e);
            } finally {
                if (connection != null) connection.disconnect();
                CatalogueCookies.leave();
            }
        });
    }

    private static String ascii(byte[] bytes, int start, int length) { return new String(bytes, start, length, StandardCharsets.US_ASCII); }
    static boolean signature(byte[] header, String format) {
        return header.length >= 12 && ("webp".equals(format)
            ? ascii(header, 0, 4).equals("RIFF") && ascii(header, 8, 4).equals("WEBP")
            : "mp4".equals(format) && ascii(header, 4, 4).equals("ftyp") && ascii(header, 8, 4).matches("isom|iso[2-6]|mp4[12]|avc1|M4V |M4VP|dash|mmp4|MSNV|3gp[456]|3g2a"));
    }

    @PluginMethod
    public void verify(PluginCall call) {
        io.execute(() -> {
            try {
                File file = safeFile(call.getString("path"));
                long expectedBytes = positive(call, "bytes");
                String expectedHash = call.getString("sha256"), format = call.getString("format");
                if (expectedHash == null || !expectedHash.matches("[0-9a-f]{64}")) throw new Failure("hash", "Invalid media checksum");
                if (!"webp".equals(format) && !"mp4".equals(format)) throw new Failure("type", "Unsupported media format");
                if (!file.isFile() || file.length() != expectedBytes) throw new Failure("size", "Media file is missing or incomplete");
                MessageDigest hash = MessageDigest.getInstance("SHA-256");
                byte[] buffer = new byte[BUFFER], header = new byte[12];
                long read = 0;
                try (InputStream in = new FileInputStream(file)) {
                    for (int n; (n = in.read(buffer)) != -1; ) {
                        if (read < header.length) System.arraycopy(buffer, 0, header, (int) read, (int) Math.min(n, header.length - read));
                        read += n; if (read > expectedBytes) throw new Failure("size", "Media file changed during verification");
                        hash.update(buffer, 0, n);
                    }
                }
                if (read != expectedBytes) throw new Failure("size", "Media file changed during verification");
                if (read < 12 || !signature(header, format)) throw new Failure("type", "Media file has an unexpected format");
                StringBuilder actual = new StringBuilder();
                for (byte b : hash.digest()) actual.append(String.format(Locale.US, "%02x", b & 0xff));
                if (!expectedHash.equals(actual.toString())) throw new Failure("hash", "Media checksum does not match");
                JSObject result = new JSObject(); result.put("bytes", read); result.put("sha256", actual.toString()); result.put("format", format); call.resolve(result);
            } catch (Exception e) { failed(call, e); }
        });
    }

    @PluginMethod
    public void rename(PluginCall call) {
        io.execute(() -> {
            try {
                File source = safeFile(call.getString("from")), destination = safeFile(call.getString("to"));
                Os.rename(source.getAbsolutePath(), destination.getAbsolutePath());
                call.resolve(new JSObject());
            } catch (Exception e) { failed(call, e); }
        });
    }

    @PluginMethod
    public void freeSpace(PluginCall call) {
        try {
            JSObject result = new JSObject(); result.put("bytes", new StatFs(getContext().getFilesDir().getAbsolutePath()).getAvailableBytes()); call.resolve(result);
        } catch (Exception e) { failed(call, e); }
    }

    @Override
    protected void handleOnDestroy() { io.shutdown(); }
}
