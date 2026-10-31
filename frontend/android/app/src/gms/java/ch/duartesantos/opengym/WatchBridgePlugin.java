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
import java.util.List;
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
 *   status()             { supported, activated, paired, installed, reachable }
 *   sendSnapshot({json}) { sent }
 *   drain()              { events }
 *   ack({ids})
 *   openOnWatch({type})  { ok }: a workout started here shows on the watch
 *   sendClips / dropClips   no animations go to Wear OS watches: { sent: 0 }
 *   listeners: watchEvent, watchState
 */
@CapacitorPlugin(name = "WatchBridge")
public class WatchBridgePlugin extends Plugin {
    static final String SNAPSHOT = "/opengym/snapshot";
    static final String EVENT_PREFIX = "/opengym/event/";
    static final String OPEN = "/opengym/open";
    static final String CAPABILITY_WEAR = "opengym_wear";
    private static final String QUEUE_FILE = "watch-events.json";
    private static final Object LOCK = new Object();
    private static volatile WatchBridgePlugin live;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private CapabilityClient.OnCapabilityChangedListener capListener;

    @Override
    public void load() {
        live = this;
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
            try {
                Context ctx = getContext();
                List<Node> connected = Tasks.await(Wearable.getNodeClient(ctx).getConnectedNodes(), 5, TimeUnit.SECONDS);
                CapabilityInfo all = Tasks.await(Wearable.getCapabilityClient(ctx).getCapability(CAPABILITY_WEAR, CapabilityClient.FILTER_ALL), 5, TimeUnit.SECONDS);
                CapabilityInfo near = Tasks.await(Wearable.getCapabilityClient(ctx).getCapability(CAPABILITY_WEAR, CapabilityClient.FILTER_REACHABLE), 5, TimeUnit.SECONDS);
                boolean installed = !all.getNodes().isEmpty();
                out.put("supported", true);
                out.put("activated", true);
                out.put("paired", installed || !connected.isEmpty());
                out.put("installed", installed);
                out.put("reachable", !near.getNodes().isEmpty());
            } catch (Exception e) {
                out.put("supported", false);
                out.put("paired", false);
                out.put("installed", false);
                out.put("reachable", false);
            }
            call.resolve(out);
        });
    }

    @PluginMethod
    public void sendSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null) { call.reject("json is required"); return; }
        try {
            PutDataMapRequest req = PutDataMapRequest.create(SNAPSHOT);
            req.getDataMap().putString("snapshot", json);
            // Stamped, so the same snapshot sent again (a reinstalled watch app) is a change too.
            req.getDataMap().putLong("at", System.currentTimeMillis());
            PutDataRequest put = req.asPutDataRequest().setUrgent();
            Wearable.getDataClient(getContext()).putDataItem(put)
                .addOnSuccessListener(item -> call.resolve(new JSObject().put("sent", true)))
                .addOnFailureListener(e -> call.resolve(new JSObject().put("sent", false).put("error", String.valueOf(e.getMessage()))));
        } catch (Exception e) {
            call.resolve(new JSObject().put("sent", false));
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
            call.resolve(new JSObject().put("ok", ok));
        });
    }

    /** No animations go to a Wear OS watch (text and numbers only): nothing to send or cancel. */
    @PluginMethod
    public void sendClips(PluginCall call) { call.resolve(new JSObject().put("sent", 0)); }

    @PluginMethod
    public void dropClips(PluginCall call) { call.resolve(); }

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
            for (DataItem item : items) if (store(ctx, item)) any = true;
            items.release();
        } catch (Exception ignored) {}
        return any;
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
