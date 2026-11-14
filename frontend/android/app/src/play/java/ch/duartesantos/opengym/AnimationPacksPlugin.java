package ch.duartesantos.opengym;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.assetpacks.AssetPackLocation;
import com.google.android.play.core.assetpacks.AssetPackManager;
import com.google.android.play.core.assetpacks.AssetPackManagerFactory;
import com.google.android.play.core.assetpacks.AssetPackState;
import com.google.android.play.core.assetpacks.AssetPackStateUpdateListener;
import com.google.android.play.core.assetpacks.model.AssetPackStatus;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The sharper exercise animations as Google Play asset packs (Play Asset Delivery, on demand),
 * the Google Play build's side of frontend lib/anim-packs.js; the same calls as the iPhone's
 * AnimationPacksPlugin.swift.
 *
 * Which packs this build has is assets/anim-packs.json, written with the packs themselves by
 * scripts/android/make-asset-packs.mjs on the release machine: one entry per pack the page knows
 * (anim-480-male), with the Play packs it is made of (anim_480_male, or _p1, _p2 for one over Play's
 * 1.5 GB limit). Without that file (a build without packs) there is nothing to offer and the app
 * keeps its built-in animations. Google Play delivers the packs; nothing comes from a server of
 * ours (Gym visual licence, Part B).
 *
 * The page never gets a file path: it reads https://localhost/_opengym_pack/<packId>/<drawing>.webp,
 * which this plugin's WebViewClient answers from the pack's folder on the device, only for the
 * app's own pack ids and plain drawing names.
 */
@CapacitorPlugin(name = "AnimationPacks")
public class AnimationPacksPlugin extends Plugin {

    static final String ROUTE = "/_opengym_pack/";
    private static final Pattern PACK = Pattern.compile("^anim-(240|360|480|720|1080)-(male|female)$");
    private static final Pattern FILE = Pattern.compile("^[A-Za-z0-9_-]{1,64}\\.webp$");
    private static final Pattern PROBE = Pattern.compile("^[0-9]{4,5}$");

    /** packId → the Play packs it is made of. */
    private final Map<String, List<String>> parts = new HashMap<>();
    /** Play pack → the page's pack it belongs to. */
    private final Map<String, String> ownerOf = new HashMap<>();
    /** Play pack → its folder on the device, while it is installed. */
    private final Map<String, File> folders = new ConcurrentHashMap<>();
    /** packId → the download the page waits for. */
    private final Map<String, PluginCall> waiting = new ConcurrentHashMap<>();
    private final Map<String, Boolean> wifiOnlyOf = new ConcurrentHashMap<>();
    private AssetPackManager manager;
    private ActivityResultLauncher<IntentSenderRequest> confirm;
    private AssetPackStateUpdateListener listener;

    @Override
    public void load() {
        readIndex();
        if (parts.isEmpty()) return;
        manager = AssetPackManagerFactory.getInstance(getContext());
        listener = this::onState;
        manager.registerListener(listener);
        // Play asks before a large download over mobile data, through its own dialog.
        confirm = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), r -> {});
        Bridge bridge = getBridge();
        bridge.setWebViewClient(new PackClient(bridge, this));
    }

    @Override
    protected void handleOnDestroy() {
        if (manager != null && listener != null) manager.unregisterListener(listener);
    }

    private void readIndex() {
        try (InputStream in = getContext().getAssets().open("anim-packs.json")) {
            JSONObject index = new JSONObject(new String(readAll(in), StandardCharsets.UTF_8));
            for (Iterator<String> it = index.keys(); it.hasNext(); ) {
                String id = it.next();
                if (!PACK.matcher(id).matches()) continue;
                JSONArray list = index.getJSONObject(id).getJSONArray("parts");
                List<String> names = new ArrayList<>();
                for (int i = 0; i < list.length(); i++) {
                    names.add(list.getString(i));
                    ownerOf.put(list.getString(i), id);
                }
                if (!names.isEmpty()) parts.put(id, names);
            }
        } catch (Exception e) {
            parts.clear();
        }
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private String packArg(PluginCall call) {
        String id = call.getString("packId", "");
        if (id == null || !PACK.matcher(id).matches() || !parts.containsKey(id)) {
            call.reject("unknown pack", "failed");
            return null;
        }
        return id;
    }

    /** The folder a Play pack's files are in, or null while it is not installed. */
    private File folderOf(String part) {
        File known = folders.get(part);
        if (known != null && known.isDirectory()) return known;
        folders.remove(part);
        if (manager == null) return null;
        AssetPackLocation loc = manager.getPackLocation(part);
        if (loc == null || loc.assetsPath() == null) return null;
        File dir = new File(loc.assetsPath());
        if (!dir.isDirectory()) return null;
        folders.put(part, dir);
        return dir;
    }

    /** A drawing of a pack on this device: in whichever of its Play packs holds it. */
    File fileOf(String packId, String name) {
        List<String> list = parts.get(packId);
        if (list == null) return null;
        for (String part : list) {
            File dir = folderOf(part);
            if (dir == null) continue;
            File f = new File(new File(dir, packId), name);
            if (f.isFile()) return f;
        }
        return null;
    }

    private boolean installed(String packId) {
        for (String part : parts.get(packId)) if (folderOf(part) == null) return false;
        return true;
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", !parts.isEmpty());
        ret.put("testflight", BuildConfig.DEBUG);
        // The packs this build has: the page offers only those (a quality may not be encoded yet).
        JSArray ids = new JSArray();
        for (String id : parts.keySet()) ids.put(id);
        ret.put("packs", ids);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        String id = packArg(call);
        if (id == null) return;
        String probe = call.getString("probe", "");
        JSObject ret = new JSObject();
        if (!installed(id) || probe == null || !PROBE.matcher(probe).matches() || fileOf(id, probe + ".webp") == null) {
            ret.put("state", "none");
            call.resolve(ret);
            return;
        }
        ret.put("state", "ready");
        ret.put("base", ROUTE + id);
        ret.put("bytes", bytesOf(id));
        call.resolve(ret);
    }

    @PluginMethod
    public void localPath(PluginCall call) {
        String id = packArg(call);
        if (id == null) return;
        if (!installed(id)) {
            call.reject("not downloaded", "unavailable");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("base", ROUTE + id);
        ret.put("path", ROUTE + id);
        call.resolve(ret);
    }

    /** What the download costs, from Google Play: { downloadSize } in bytes. */
    @PluginMethod
    public void info(PluginCall call) {
        String id = packArg(call);
        if (id == null) return;
        manager.getPackStates(parts.get(id))
            .addOnSuccessListener(states -> {
                long total = 0;
                for (AssetPackState s : states.packStates().values()) total += s.totalBytesToDownload();
                JSObject ret = new JSObject();
                if (total > 0) ret.put("downloadSize", total);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.resolve(new JSObject()));
    }

    @PluginMethod
    public void download(PluginCall call) {
        String id = packArg(call);
        if (id == null) return;
        boolean wifiOnly = call.getBoolean("wifiOnly", true);
        if (installed(id)) {
            call.resolve();
            return;
        }
        if (wifiOnly && !onFreeNetwork()) {
            call.reject("waiting for Wi-Fi", "needs-wifi");
            return;
        }
        PluginCall before = waiting.put(id, call);
        if (before != null) before.reject("replaced", "cancelled");
        wifiOnlyOf.put(id, wifiOnly);
        call.setKeepAlive(true);
        manager.fetch(parts.get(id)).addOnFailureListener(e -> finish(id, "failed", e.getMessage()));
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = packArg(call);
        if (id == null) return;
        List<String> list = parts.get(id);
        final int[] left = { list.size() };
        for (String part : list) {
            folders.remove(part);
            manager.removePack(part).addOnCompleteListener(t -> {
                if (--left[0] == 0) {
                    forgetBytes(id);
                    call.resolve();
                }
            });
        }
    }

    /** For the details row: what this side knows about one pack. */
    @PluginMethod
    public void diagnose(PluginCall call) {
        String id = packArg(call);
        if (id == null) return;
        String probe = call.getString("probe", "");
        JSObject out = new JSObject();
        out.put("supported", true);
        out.put("base", ROUTE + id);
        out.put("probe", id + "/" + probe + ".webp");
        JSArray list = new JSArray();
        for (String part : parts.get(id)) {
            JSObject p = new JSObject();
            p.put("pack", part);
            File dir = folderOf(part);
            p.put("folder", dir == null ? null : dir.getPath());
            if (dir != null) {
                File[] files = new File(dir, id).listFiles();
                p.put("files", files == null ? -1 : files.length);
            }
            list.put(p);
        }
        out.put("parts", list);
        File f = fileOf(id, probe + ".webp");
        out.put("probeBytes", f == null ? -1 : f.length());
        manager.getPackStates(parts.get(id))
            .addOnSuccessListener(states -> {
                JSArray st = new JSArray();
                for (AssetPackState s : states.packStates().values()) {
                    JSObject o = new JSObject();
                    o.put("pack", s.name());
                    o.put("status", s.status());
                    o.put("error", s.errorCode());
                    o.put("downloaded", s.bytesDownloaded());
                    o.put("total", s.totalBytesToDownload());
                    st.put(o);
                }
                out.put("states", st);
                call.resolve(out);
            })
            .addOnFailureListener(e -> {
                out.put("statesError", String.valueOf(e.getMessage()));
                call.resolve(out);
            });
    }

    /** One Play pack's update: the page's pack moves on when all of its parts have. */
    private void onState(AssetPackState state) {
        String id = ownerOf.get(state.name());
        if (id == null) return;
        int s = state.status();
        if (s == AssetPackStatus.FAILED) {
            finish(id, "failed", "error " + state.errorCode());
            return;
        }
        if (s == AssetPackStatus.CANCELED) {
            finish(id, "cancelled", "cancelled");
            return;
        }
        if (s == AssetPackStatus.WAITING_FOR_WIFI || s == AssetPackStatus.REQUIRES_USER_CONFIRMATION) {
            if (Boolean.TRUE.equals(wifiOnlyOf.get(id)) && s == AssetPackStatus.WAITING_FOR_WIFI) {
                finish(id, "needs-wifi", "waiting for Wi-Fi");
            } else if (confirm != null) {
                manager.showConfirmationDialog(confirm);
            }
            return;
        }
        if (s == AssetPackStatus.DOWNLOADING || s == AssetPackStatus.TRANSFERRING || s == AssetPackStatus.COMPLETED) {
            reportProgress(id);
        }
        if (s == AssetPackStatus.COMPLETED) {
            folders.remove(state.name());
            if (installed(id)) {
                forgetBytes(id);
                finish(id, null, null);
            }
        }
    }

    private void reportProgress(String id) {
        manager.getPackStates(parts.get(id)).addOnSuccessListener(states -> {
            long done = 0, total = 0;
            for (AssetPackState s : states.packStates().values()) {
                total += s.totalBytesToDownload();
                done += s.status() == AssetPackStatus.COMPLETED ? s.totalBytesToDownload() : s.bytesDownloaded();
            }
            if (total <= 0) return;
            JSObject ev = new JSObject();
            ev.put("packId", id);
            ev.put("fraction", Math.min(1.0, (double) done / total));
            notifyListeners("progress", ev);
        });
    }

    private void finish(String id, String code, String message) {
        PluginCall call = waiting.remove(id);
        wifiOnlyOf.remove(id);
        if (call == null) return;
        call.setKeepAlive(false);
        if (code == null) call.resolve();
        else call.reject(message, code);
    }

    /** Wi-Fi or a cable: a network that costs nothing extra, now. */
    private boolean onFreeNetwork() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network n = cm.getActiveNetwork();
        NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
    }

    /* ---- the size on disk, counted once per download and kept ---- */

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("anim-packs", Context.MODE_PRIVATE);
    }

    private long bytesOf(String id) {
        long kept = prefs().getLong(id, 0);
        if (kept > 0) return kept;
        long total = 0;
        for (String part : parts.get(id)) {
            File dir = folderOf(part);
            File[] files = dir == null ? null : new File(dir, id).listFiles();
            if (files != null) for (File f : files) total += f.length();
        }
        if (total > 0) prefs().edit().putLong(id, total).apply();
        return total;
    }

    private void forgetBytes(String id) {
        prefs().edit().remove(id).apply();
    }

    /**
     * Capacitor's own WebViewClient, plus the packs' route: https://localhost/_opengym_pack/<packId>/<drawing>.webp
     * from the pack's folder, a 404 for anything else under the route.
     */
    static final class PackClient extends BridgeWebViewClient {
        private final Bridge bridge;
        private final AnimationPacksPlugin plugin;

        PackClient(Bridge bridge, AnimationPacksPlugin plugin) {
            super(bridge);
            this.bridge = bridge;
            this.plugin = plugin;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String path = url.getPath();
            if (path != null && path.startsWith(ROUTE) && bridge.getHost().equals(url.getHost())) {
                return serve(path.substring(ROUTE.length()));
            }
            return super.shouldInterceptRequest(view, request);
        }

        private WebResourceResponse serve(String rest) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "max-age=31536000, immutable");
            String[] bits = rest.split("/");
            if (bits.length == 2 && PACK.matcher(bits[0]).matches() && FILE.matcher(bits[1]).matches()) {
                File f = plugin.fileOf(bits[0], bits[1]);
                if (f != null) {
                    try {
                        return new WebResourceResponse("image/webp", null, 200, "OK", headers, new FileInputStream(f));
                    } catch (Exception ignored) {
                        // gone between the check and the read: a 404 like any other miss
                    }
                }
            }
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
        }
    }
}
