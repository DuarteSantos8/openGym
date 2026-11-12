package ch.duartesantos.opengym;

import android.content.Context;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.Asset;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataItemBuffer;
import com.google.android.gms.wearable.DataMap;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The phone's end of the Wear OS watch link (frontend lib/watch-sync.js, watch app in android/wear,
 * docs/WEAR_OS.md). The Android twin of ios/App/App/WatchBridgePlugin.swift: the same name, the
 * same calls, the same JSON, carried over the Wearable Data Layer.
 *
 * Phone → watch: the page's snapshot goes out as the data item /opengym/snapshot, which the watch
 * gets whenever it next can (the application context on iOS).
 *
 * Watch → phone: each event is a data item /opengym/event/<id>, kept by the Data Layer until the
 * phone has it (transferUserInfo on iOS). WatchListenerService writes it to the queue file, even
 * with the app closed, and deletes the item; the page drains the file, applies each event once and
 * acknowledges it (WatchEventQueue). A live page is told at once ("watchEvent").
 *
 * Without Google Play services, or without a watch that has the app, every call answers "no watch"
 * and nothing else happens: the page then sends nothing at all (lib/watch-sync.js checkLink).
 *
 * A Garmin rides along (GarminLink, src/ciq, docs/GARMIN.md): status says `garmin: true` when one
 * with the openGym app is there, the page then adds its cut-down snapshot (`garmin`) to each
 * sendSnapshot, and the Garmin's events land in the same queue file.
 *
 *   status()             { supported, activated, paired, installed, reachable, garmin }
 *   sendSnapshot({json, garmin?}) { sent }
 *   drain()              { events }
 *   ack({ids})
 *   openOnWatch({type})  { ok }: a workout started here shows on the watch
 *   sendClips({wid, clips: [{exId, still}]})   each exercise's 180 px still from the app package,
 *                        as the data item /opengym/still/<exId> (its bytes an Asset, and the
 *                        workout's id), for the watch's Overview; no animations. { queued }
 *   dropClips()          the workout is over: the stills go from the Data Layer (the watch deletes its copies)
 *   garminStatus()       { supported, state, installed, reachable, store, devices: [{ id, name, connected, installed? }] }
 *   garminPick()         asks Garmin Connect for its watches again (Android has no picker: Garmin
 *                        Connect pairs them) { ok }
 *   garminStore()        the app's page in the Connect IQ Store { ok }
 *   listeners: watchEvent, watchState
 */
@CapacitorPlugin(name = "WatchBridge")
public class WatchBridgePlugin extends Plugin {
    static final String SNAPSHOT = "/opengym/snapshot";
    static final String EVENT_PREFIX = "/opengym/event/";
    static final String OPEN = "/opengym/open";
    static final String STILL_PREFIX = "/opengym/still/";
    static final String CAPABILITY_WEAR = "opengym_wear";
    private static final String QUEUE_FILE = "watch-events.json";
    private static final Object LOCK = new Object();
    private static volatile WatchBridgePlugin live;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private CapabilityClient.OnCapabilityChangedListener capListener;

    @Override
    public void load() {
        live = this;
        GarminLink.get(getContext());
        try {
            capListener = info -> notifyListeners("watchState", new JSObject().put("installed", !info.getNodes().isEmpty()));
            Wearable.getCapabilityClient(getContext()).addListener(capListener, CAPABILITY_WEAR);
        } catch (Exception ignored) {
            // No Play services: no watch, and nothing to listen to.
        }
        // Events that came while no service ran (the app was just installed or updated).
        io.execute(() -> { if (collect(getContext())) notifyEvent(); });
    }

    @Override
    protected void handleOnDestroy() {
        if (live == this) live = null;
        try { if (capListener != null) Wearable.getCapabilityClient(getContext()).removeListener(capListener); } catch (Exception ignored) {}
        io.shutdown();
    }

    /* ---------- the page's calls ---------- */

    @PluginMethod
    public void status(PluginCall call) {
        io.execute(() -> {
            JSObject out = new JSObject();
            boolean paired = false, installed = false, reachable = false, supported = false;
            JSArray watches = new JSArray();
            try {
                Context ctx = getContext();
                List<Node> connected = Tasks.await(Wearable.getNodeClient(ctx).getConnectedNodes(), 5, TimeUnit.SECONDS);
                CapabilityInfo all = Tasks.await(Wearable.getCapabilityClient(ctx).getCapability(CAPABILITY_WEAR, CapabilityClient.FILTER_ALL), 5, TimeUnit.SECONDS);
                CapabilityInfo near = Tasks.await(Wearable.getCapabilityClient(ctx).getCapability(CAPABILITY_WEAR, CapabilityClient.FILTER_REACHABLE), 5, TimeUnit.SECONDS);
                installed = !all.getNodes().isEmpty();
                supported = true;
                paired = installed || !connected.isEmpty();
                reachable = !near.getNodes().isEmpty();
                watches = WatchNodes.list(nodes(connected), nodes(all.getNodes()), nodes(near.getNodes()));
            } catch (Exception e) {
                // No Play services (or no answer): no Wear OS watch. A Garmin may still be there.
            }
            // The Wear OS link by itself, for Settings → Wear OS watch (a Garmin has its own page).
            JSObject wear = new JSObject();
            wear.put("supported", supported);
            wear.put("paired", paired);
            wear.put("installed", installed);
            wear.put("reachable", reachable);
            wear.put("watches", watches);
            out.put("wear", wear);
            // A Garmin with the openGym app counts as a watch for the page: it then sends snapshots.
            GarminLink g = GarminLink.get(getContext());
            boolean garmin = g.anyInstalled();
            out.put("supported", supported || garmin);
            out.put("activated", true);
            out.put("paired", paired || garmin);
            out.put("installed", installed || garmin);
            out.put("reachable", reachable || g.anyReachable());
            out.put("garmin", garmin);
            call.resolve(out);
        });
    }

    /** Nodes as { id, name } pairs, for WatchNodes (which knows nothing of Play services). */
    private static List<String[]> nodes(java.util.Collection<Node> in) {
        List<String[]> out = new ArrayList<>();
        for (Node n : in) out.add(new String[] { n.getId(), n.getDisplayName() });
        return out;
    }

    @PluginMethod
    public void sendSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null) { call.reject("json is required"); return; }
        // The Garmin's cut-down snapshot (lib/garmin-snapshot.js), when the page made one.
        String garmin = call.getString("garmin");
        boolean garminSent = garmin != null && GarminLink.get(getContext()).send(garmin);
        try {
            PutDataMapRequest req = PutDataMapRequest.create(SNAPSHOT);
            req.getDataMap().putString("snapshot", json);
            // Stamped, so the same snapshot sent again (a reinstalled watch app) is a change too.
            // Never back with the clock (WatchEventQueue.nextStamp); remembered across launches.
            req.getDataMap().putLong("at", stamp(getContext()));
            PutDataRequest put = req.asPutDataRequest().setUrgent();
            Wearable.getDataClient(getContext()).putDataItem(put)
                .addOnSuccessListener(item -> call.resolve(new JSObject().put("sent", true)))
                .addOnFailureListener(e -> call.resolve(new JSObject().put("sent", garminSent).put("error", String.valueOf(e.getMessage()))));
        } catch (Exception e) {
            call.resolve(new JSObject().put("sent", garminSent));
        }
    }

    @PluginMethod
    public void drain(PluginCall call) {
        io.execute(() -> {
            collect(getContext());
            JSONArray events;
            synchronized (LOCK) { events = WatchEventQueue.events(readQueue(getContext())); }
            try {
                call.resolve(new JSObject().put("events", new JSArray(events.toString())));
            } catch (JSONException e) {
                call.resolve(new JSObject().put("events", new JSArray()));
            }
        });
    }

    @PluginMethod
    public void ack(PluginCall call) {
        JSArray arr = call.getArray("ids", new JSArray());
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            String id = arr.optString(i, null);
            if (id != null) ids.add(id);
        }
        io.execute(() -> {
            synchronized (LOCK) { writeQueue(getContext(), WatchEventQueue.ack(readQueue(getContext()), ids)); }
            call.resolve();
        });
    }

    private static synchronized long stamp(Context ctx) {
        android.content.SharedPreferences p = ctx.getSharedPreferences("opengym-watch", Context.MODE_PRIVATE);
        long at = WatchEventQueue.nextStamp(p.getLong("snapshotAt", 0), System.currentTimeMillis());
        p.edit().putLong("snapshotAt", at).apply();
        return at;
    }

    /** A workout started here: the watch shows it (its ongoing notification opens the app). */
    @PluginMethod
    public void openOnWatch(PluginCall call) {
        String type = call.getString("type", "");
        io.execute(() -> {
            boolean ok = false;
            try {
                Context ctx = getContext();
                CapabilityInfo near = Tasks.await(Wearable.getCapabilityClient(ctx).getCapability(CAPABILITY_WEAR, CapabilityClient.FILTER_REACHABLE), 5, TimeUnit.SECONDS);
                for (Node n : near.getNodes()) {
                    Tasks.await(Wearable.getMessageClient(ctx).sendMessage(n.getId(), OPEN, type.getBytes(StandardCharsets.UTF_8)), 5, TimeUnit.SECONDS);
                    ok = true;
                }
            } catch (Exception ignored) {}
            // A Garmin with the app shows its own "open openGym?" prompt.
            if (GarminLink.get(getContext()).open()) ok = true;
            call.resolve(new JSObject().put("ok", ok));
        });
    }

    /* ---------- the Garmin (Settings → Garmin, views/GarminSettings.jsx) ---------- */

    @PluginMethod
    public void garminStatus(PluginCall call) { call.resolve(GarminLink.use(getContext()).status()); }

    @PluginMethod
    public void garminPick(PluginCall call) {
        GarminLink.use(getContext()).lookAgain();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void garminStore(PluginCall call) { call.resolve(new JSObject().put("ok", GarminLink.get(getContext()).openStore())); }

    /** The stills already sent for each workout, by exercise (the Data Layer keeps the rest). */
    private final Map<String, Set<String>> stillsSent = new HashMap<>();

    /**
     * The running workout's stills for the watch's Overview: each the app's own 180 px WebP (about
     * 5 KB), read from the app package by the path the page names (lib/watch-sync.js clipsFor), never
     * fetched. With it the set page's animation ("clip"), when the build has it as animated WebP. Sent once per workout and exercise; the Data Layer delivers them when the watch is near.
     */
    @PluginMethod
    public void sendClips(PluginCall call) {
        String wid = call.getString("wid");
        JSArray clips = call.getArray("clips", new JSArray());
        if (wid == null || wid.isEmpty()) { call.resolve(new JSObject().put("queued", 0)); return; }
        int queued = 0;
        List<String[]> todo = new ArrayList<>();
        for (int i = 0; i < clips.length(); i++) {
            JSONObject c = clips.optJSONObject(i);
            String exId = c == null ? null : c.optString("exId", null);
            String still = c == null ? null : c.optString("still", null);
            // Only what the page marks for Wear OS (watch-sync.js wearClip: a 180 px build's WebP).
            String clip = c == null ? null : c.optString("wear", null);
            if (!safeId(exId) || !inPackage(still)) continue;
            todo.add(new String[] { exId, still, clipInPackage(clip) ? clip : null });
            queued++;
        }
        call.resolve(new JSObject().put("queued", queued));
        io.execute(() -> {
            synchronized (stillsSent) {
                // Another workout's list is no use now: only this one's is kept.
                stillsSent.keySet().retainAll(java.util.Collections.singleton(wid));
            }
            for (String[] t : todo) {
                synchronized (stillsSent) { if (stillsSent.computeIfAbsent(wid, k -> new HashSet<>()).contains(t[0])) continue; }
                try (java.io.InputStream in = getContext().getAssets().open("public/" + t[1])) {
                    byte[] bytes = readAll(in, 64 * 1024);
                    if (bytes == null) continue;
                    PutDataMapRequest req = PutDataMapRequest.create(STILL_PREFIX + t[0]);
                    req.getDataMap().putAsset("img", Asset.createFromBytes(bytes));
                    req.getDataMap().putString("wid", wid);
                    // The set page's animation, where this build ships them as animated WebP (MP4 builds: the still only).
                    if (t[2] != null) {
                        try (java.io.InputStream anim = getContext().getAssets().open("public/" + t[2])) {
                            byte[] clip = readAll(anim, CLIP_MAX);
                            if (clip != null) req.getDataMap().putAsset("clip", Asset.createFromBytes(clip));
                        } catch (Exception ignored) {}
                    }
                    Tasks.await(Wearable.getDataClient(getContext()).putDataItem(req.asPutDataRequest()), 10, TimeUnit.SECONDS);
                    synchronized (stillsSent) { stillsSent.computeIfAbsent(wid, k -> new HashSet<>()).add(t[0]); }
                } catch (Exception ignored) {
                    // Not in this build's package, or no Play services: the row keeps its plain mark.
                }
            }
        });
    }

    /** The workout is over: its stills leave the Data Layer, and the watch drops its copies. */
    @PluginMethod
    public void dropClips(PluginCall call) {
        io.execute(() -> {
            synchronized (stillsSent) { stillsSent.clear(); }
            try {
                Uri prefix = new Uri.Builder().scheme("wear").path(STILL_PREFIX).build();
                Tasks.await(Wearable.getDataClient(getContext()).deleteDataItems(prefix, DataClient.FILTER_PREFIX), 10, TimeUnit.SECONDS);
            } catch (Exception ignored) {}
            call.resolve();
        });
    }

    /** The biggest animation sent to the watch (the 180 px WebPs are far smaller). */
    static final int CLIP_MAX = 512 * 1024;

    /** An animation inside the app package: relative, no way out of it, an animated WebP. */
    static boolean clipInPackage(String p) {
        return p != null && p.matches("[A-Za-z0-9_./-]+\\.webp") && !p.startsWith("/") && !p.contains("..");
    }

    /** An exercise id as a file name on the watch: letters, digits, - and _ only. */
    static boolean safeId(String id) { return id != null && id.matches("[A-Za-z0-9_-]{1,64}"); }

    /** A still inside the app package: relative, no way out of it, a picture. */
    static boolean inPackage(String p) {
        return p != null && p.matches("[A-Za-z0-9_./-]+\\.(webp|jpe?g|png)") && !p.startsWith("/") && !p.contains("..");
    }

    /** All of a stream, or null past `max` bytes (a still is ~5 KB; anything that big is not one). */
    private static byte[] readAll(java.io.InputStream in, int max) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) {
            out.write(buf, 0, n);
            if (out.size() > max) return null;
        }
        return out.toByteArray();
    }

    /* ---------- the watch's events ---------- */

    /** One data item from the watch into the queue file, then out of the Data Layer. */
    static boolean store(Context ctx, DataItem item) {
        Uri uri = item.getUri();
        String path = uri.getPath();
        if (path == null || !path.startsWith(EVENT_PREFIX)) return false;
        DataMap map = DataMapItem.fromDataItem(item).getDataMap();
        String json = map.getString("event");
        long seq = map.getLong("seq", 0);
        boolean added = false;
        synchronized (LOCK) {
            JSONArray next = json == null ? null : WatchEventQueue.add(readQueue(ctx), json, seq);
            if (next != null) added = writeQueue(ctx, next);
        }
        // On disk first: only then is the watch's copy let go of. A bad item is let go of too.
        if (added || json == null) {
            try { Wearable.getDataClient(ctx).deleteDataItems(uri); } catch (Exception ignored) {}
        }
        return added;
    }

    /** Every event item still in the Data Layer, stored (the listener service may not have run). */
    static boolean collect(Context ctx) {
        boolean any = false;
        try {
            Uri prefix = new Uri.Builder().scheme("wear").path(EVENT_PREFIX).build();
            DataItemBuffer items = Tasks.await(Wearable.getDataClient(ctx).getDataItems(prefix, DataClient.FILTER_PREFIX), 5, TimeUnit.SECONDS);
            try {
                for (DataItem item : items) {
                    try { if (store(ctx, item)) any = true; } catch (Exception ignored) {} // one bad item must not stop the rest
                }
            } finally { items.release(); }
        } catch (Exception ignored) {}
        return any;
    }

    /** One event as JSON (the Garmin's, GarminLink) into the queue file. Whether it is new there. */
    static boolean storeEvent(Context ctx, String json, long seq) {
        synchronized (LOCK) {
            JSONArray before = readQueue(ctx);
            JSONArray next = WatchEventQueue.add(before, json, seq);
            return next != null && next != before && writeQueue(ctx, next);
        }
    }

    /** The link changed (a Garmin connected, the app found on it): the page asks status again. */
    static void notifyState() {
        WatchBridgePlugin p = live;
        if (p != null) p.notifyListeners("watchState", new JSObject());
    }

    /** The page, if it is there, drains now. */
    static void notifyEvent() {
        WatchBridgePlugin p = live;
        if (p != null) p.notifyListeners("watchEvent", new JSObject());
    }

    private static File queueFile(Context ctx) { return new File(ctx.getFilesDir(), QUEUE_FILE); }

    private static JSONArray readQueue(Context ctx) {
        File f = queueFile(ctx);
        if (!f.exists()) return new JSONArray();
        try { return WatchEventQueue.parse(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)); } catch (Exception e) { return new JSONArray(); }
    }

    /** Written to a temp file, synced and renamed: the queue is the event's last copy. */
    private static boolean writeQueue(Context ctx, JSONArray queue) {
        File f = queueFile(ctx);
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(queue.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception e) { return false; }
        return tmp.renameTo(f);
    }
}
