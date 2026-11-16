package ch.duartesantos.opengym;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import com.garmin.android.connectiq.ConnectIQ;
import com.garmin.android.connectiq.IQApp;
import com.garmin.android.connectiq.IQDevice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The phone's end of the Garmin link (docs/GARMIN.md, watch app in frontend/garmin): Garmin's
 * Connect IQ Mobile SDK, which talks to the watch through Garmin Connect Mobile. One per process,
 * started with the page's plugin (WatchBridgePlugin.load) and kept while the process lives, so a
 * set logged on the watch while the page sleeps is in the queue file at once.
 *
 * Phone → watch: the page's Garmin snapshot (lib/garmin-snapshot.js) as a Connect IQ dictionary,
 * to every connected Garmin that has the app. The last one is kept and sent again when a watch
 * connects or the watch app says hello (it just started and has nothing yet).
 *
 * Watch → phone: `{ events: [...] }`; each event goes into the same queue file as the Wear OS
 * watch's (WatchBridgePlugin.storeEvent), the page drains it the same way. The watch keeps each
 * event until the snapshot's `acked` names it, so one lost on the way (the app was not running)
 * comes again.
 *
 * Without Garmin Connect Mobile, or before the SDK is up, every call answers "no Garmin".
 * Not in the F-Droid build (closed source): app/build.gradle.
 *
 * Nothing of Garmin's runs for someone who never asked for it: the SDK starts once Settings →
 * Garmin was opened (`use`, remembered), and only with Garmin Connect Mobile on the phone. The
 * iPhone waits the same way for "Choose watches".
 *
 * Garmin Connect going away (it was updated, stopped or crashed) ends the SDK's link to it
 * (onSdkShutDown), and with it what the SDK had registered there: the link is then brought up
 * again from scratch (`revive`) and every watch registered anew, or no set from the wrist would
 * arrive until openGym itself was restarted. A start that never comes up is tried a few times
 * and then says "error", which Settings → Garmin's "Look again" starts over.
 */
final class GarminLink {
    /** The watch app's id (frontend/garmin/manifest.xml), without dashes as the SDK wants it. */
    static final String APP_ID = "3c533c63754d40189c000ad529e400b9";
    /** The app's id in the Connect IQ Store (apps.garmin.com/apps/<id>, submitted 2026-11-09; docs/GARMIN.md). */
    static final String STORE_ID = "62e66310-66de-4bdd-8e40-5d2c0d853a08";

    private static GarminLink instance;

    private Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    /** Written on the main thread only; read from the plugin's threads too. */
    private volatile ConnectIQ ciq;
    /** off (never asked for), starting, ready, no-gcm, gcm-upgrade, error */
    private volatile String state = "starting";
    private final Map<Long, IQDevice> devices = new ConcurrentHashMap<>();
    private final Map<Long, Boolean> installed = new ConcurrentHashMap<>();
    private final Map<Long, String> deviceState = new ConcurrentHashMap<>();
    /** The watches registered with this SDK start (main thread): all again after each onSdkReady. */
    private final Set<Long> registered = new HashSet<>();
    /** Starts in a row that did not come up (main thread), and which start a wait belongs to. */
    private int tries = 0;
    private int startNo = 0;
    /** Our own shutdown before a new start: its onSdkShutDown is not Garmin Connect going away. */
    private boolean stopping = false;
    /** The queue file is written off the main thread (it is synced to disk). */
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile Map<String, Object> lastSnapshot;
    private long seq = 0;

    private static final String PREFS = "opengym-garmin";
    private static final String GCM = "com.garmin.android.apps.connectmobile";

    private GarminLink(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        // The watches that had openGym the last time: known at once, so the page makes the Garmin
        // snapshot from its first send and a watch saying hello gets it without a round trip.
        try {
            for (String id : prefs().getStringSet("has", new HashSet<String>())) installed.put(Long.parseLong(id), true);
        } catch (Exception ignored) {}
    }

    private SharedPreferences prefs() { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** Whether openGym is on a watch, remembered for the next launch. */
    private Boolean setInstalled(long id, boolean has) {
        Boolean was = installed.put(id, has);
        if (was == null || was != has) saveInstalled();
        return was;
    }

    private void saveInstalled() {
        try {
            Set<String> ids = new HashSet<>();
            for (Map.Entry<Long, Boolean> e : installed.entrySet()) if (Boolean.TRUE.equals(e.getValue())) ids.add(String.valueOf(e.getKey()));
            prefs().edit().putStringSet("has", ids).apply();
        } catch (Exception ignored) {}
    }

    /** The link, started only if Settings → Garmin was opened before (else it stays quiet). */
    static synchronized GarminLink get(Context ctx) {
        if (instance == null) {
            instance = new GarminLink(ctx);
            boolean on = false;
            try { on = instance.prefs().getBoolean("on", false); } catch (Exception ignored) {}
            if (on) instance.main.post(instance::start);
            else instance.state = "off";
        }
        return instance;
    }

    /** Settings → Garmin is open: the link is wanted from now on, and starts if it has not. */
    static synchronized GarminLink use(Context ctx) {
        GarminLink g = get(ctx);
        try { g.prefs().edit().putBoolean("on", true).apply(); } catch (Exception ignored) {}
        if (g.ciq == null && ("off".equals(g.state) || "no-gcm".equals(g.state))) {
            // Without Garmin Connect: "no-gcm" at once and on every ask (GarminUse, QA66).
            String next = GarminUse.stateOnUse(g.state, false, g.gcmInstalled());
            g.state = next;
            if ("starting".equals(next)) g.main.post(g::start);
        }
        // Garmin Connect was too old and has changed since (updated): the link starts over by itself.
        if (g.ciq == null && "gcm-upgrade".equals(g.state)) {
            long now = g.gcmStamp();
            if (now != g.gcmSeen) { g.gcmSeen = now; g.lookAgain(); }
        }
        return g;
    }

    /** Garmin Connect Mobile on this phone: without it the SDK has nothing to talk to. */
    /** When Garmin Connect was last installed or updated (0 without it), and the one a "too old" was about. */
    private long gcmStamp() {
        try { return ctx.getPackageManager().getPackageInfo(GCM, 0).lastUpdateTime; } catch (Exception e) { return 0; }
    }
    private volatile long gcmSeen = 0;

    private boolean gcmInstalled() {
        try { ctx.getPackageManager().getPackageInfo(GCM, 0); return true; } catch (Exception e) { return false; }
    }

    private final ConnectIQ.IQApplicationEventListener onMessage = (device, app, message, status) -> {
        if (status != ConnectIQ.IQMessageStatus.SUCCESS) return;
        // The watch talks to us: it has the app, and it is there.
        setInstalled(device.getDeviceIdentifier(), true);
        deviceState.put(device.getDeviceIdentifier(), IQDevice.IQDeviceStatus.CONNECTED.name());
        List<String> events = GarminMessages.events(message);
        boolean hello = false;
        for (String json : events) if (GarminMessages.isHello(json)) hello = true;
        if (hello) {
            sendTo(device, lastSnapshot);
            WatchBridgePlugin.notifyState();
        }
        io.execute(() -> {
            boolean any = false;
            for (String json : events) {
                if (GarminMessages.isHello(json)) continue;
                if (WatchBridgePlugin.storeEvent(ctx, json, GarminMessages.seqOf(json, ++seq))) any = true;
            }
            if (any) WatchBridgePlugin.notifyEvent();
        });
    };

    private final ConnectIQ.IQDeviceEventListener onDevice = (device, status) -> {
        deviceState.put(device.getDeviceIdentifier(), status.name());
        if (status == IQDevice.IQDeviceStatus.CONNECTED) {
            askInstalled(device);
            sendTo(device, lastSnapshot);
        }
        WatchBridgePlugin.notifyState();
    };

    /** Main thread. */
    private void start() {
        if (ciq != null) return;
        if (!gcmInstalled()) { state = "no-gcm"; WatchBridgePlugin.notifyState(); return; }
        state = "starting";
        final int mine = ++startNo;
        try {
            ciq = ConnectIQ.getInstance(ctx, ConnectIQ.IQConnectType.WIRELESS);
            ciq.initialize(ctx, false, new ConnectIQ.ConnectIQListener() {
                @Override public void onSdkReady() {
                    // Also after Garmin Connect came back by itself: it has forgotten our watches.
                    state = "ready";
                    tries = 0;
                    registered.clear();
                    refresh();
                }
                @Override public void onInitializeError(ConnectIQ.IQSdkErrorStatus err) {
                    stop();
                    gcmSeen = gcmStamp();
                    state = err == ConnectIQ.IQSdkErrorStatus.GCM_NOT_INSTALLED ? "no-gcm"
                        : err == ConnectIQ.IQSdkErrorStatus.GCM_UPGRADE_NEEDED ? "gcm-upgrade" : "error";
                    WatchBridgePlugin.notifyState();
                }
                @Override public void onSdkShutDown() {
                    if (stopping) return;
                    // Garmin Connect went away (updated, stopped, crashed). Android brings a crashed
                    // one back by itself (onSdkReady again); after an update it does not.
                    state = "starting";
                    registered.clear();
                    for (Long id : deviceState.keySet()) deviceState.put(id, IQDevice.IQDeviceStatus.UNKNOWN.name());
                    WatchBridgePlugin.notifyState();
                    main.postDelayed(() -> { if (mine == startNo && !"ready".equals(state)) revive(); }, GarminUse.REVIVE_MS);
                }
            });
        } catch (Throwable e) {
            stop();
            state = "error";
            WatchBridgePlugin.notifyState();
            return;
        }
        // Never came up (no answer from Garmin Connect's service): once more, then "error".
        main.postDelayed(() -> {
            if (mine != startNo || !"starting".equals(state)) return;
            String next = GarminUse.onStartTimeout(++tries);
            if ("retry".equals(next)) { revive(); return; }
            stop();
            state = "error";
            WatchBridgePlugin.notifyState();
        }, GarminUse.START_WAIT_MS);
    }

    /** The SDK let go of (main thread): its receiver and its binding to Garmin Connect, so a new start is clean. */
    private void stop() {
        ConnectIQ was = ciq;
        ciq = null;
        registered.clear();
        if (was == null) return;
        stopping = true;
        try { was.shutdown(ctx); } catch (Throwable ignored) {} finally { stopping = false; }
    }

    /** From scratch (main thread): after Garmin Connect went away, or a start that did not come up. */
    private void revive() {
        stop();
        start();
        if (!"starting".equals(state)) WatchBridgePlugin.notifyState();
    }

    /**
     * "Look again" in Settings → Garmin: asks Garmin Connect for its watches again; from a state
     * that does not end by itself (error, Garmin Connect too old) it starts over.
     */
    void lookAgain() {
        main.post(() -> {
            if (GarminUse.restartsOnLookAgain(state)) { tries = 0; revive(); }
            else refresh();
        });
    }

    /** The Garmins Garmin Connect knows, each listened to (once per SDK start); asked again by `lookAgain`. */
    void refresh() {
        main.post(() -> {
            if (!"ready".equals(state) || ciq == null) return;
            try {
                List<IQDevice> known = ciq.getKnownDevices();
                IQApp app = new IQApp(APP_ID);
                Set<Long> ids = new HashSet<>();
                for (IQDevice d : known == null ? new ArrayList<IQDevice>() : known) {
                    long id = d.getDeviceIdentifier();
                    ids.add(id);
                    devices.put(id, d);
                    if (registered.add(id)) {
                        // (registerForDeviceEvents answers at once with the watch's state: onDevice)
                        try { ciq.registerForDeviceEvents(d, onDevice); } catch (Exception e) { registered.remove(id); }
                        try { ciq.registerForAppEvents(d, app, onMessage); } catch (Exception e) { registered.remove(id); }
                    }
                    try { deviceState.put(id, ciq.getDeviceStatus(d).name()); } catch (Exception ignored) {}
                    askInstalled(d);
                }
                // A watch taken out of Garmin Connect is not ours any more.
                boolean gone = devices.keySet().retainAll(ids);
                deviceState.keySet().retainAll(ids);
                registered.retainAll(ids);
                if (installed.keySet().retainAll(ids) || gone) saveInstalled();
            } catch (Exception e) {
                // Garmin Connect went away (updated, stopped): the next refresh tries again.
            }
            WatchBridgePlugin.notifyState();
        });
    }

    private void askInstalled(IQDevice d) {
        try {
            ciq.getApplicationInfo(APP_ID, d, new ConnectIQ.IQApplicationInfoListener() {
                @Override public void onApplicationInfoReceived(IQApp app) {
                    Boolean was = setInstalled(d.getDeviceIdentifier(), true);
                    if (was == null || !was) WatchBridgePlugin.notifyState();
                    // It has the app after all (just installed): the latest goes now.
                    if (was != null && !was) sendTo(d, lastSnapshot);
                }
                @Override public void onApplicationNotInstalled(String appId) {
                    // Only a watch that is there can say so: for one out of reach this is no answer,
                    // and what was known before stands (GarminUse.trustsNotInstalled).
                    if (!GarminUse.trustsNotInstalled(connected(d.getDeviceIdentifier()))) return;
                    Boolean was = setInstalled(d.getDeviceIdentifier(), false);
                    if (was == null || was) WatchBridgePlugin.notifyState();
                }
            });
        } catch (Exception ignored) {}
    }

    private boolean connected(long id) { return "CONNECTED".equals(deviceState.get(id)); }

    /** Whether a Garmin with the openGym app is there (connected now or not). */
    boolean anyInstalled() {
        for (Boolean b : installed.values()) if (Boolean.TRUE.equals(b)) return true;
        return false;
    }

    boolean anyKnown() { return !devices.isEmpty(); }

    boolean anyReachable() {
        for (Long id : devices.keySet()) if (connected(id) && Boolean.TRUE.equals(installed.get(id))) return true;
        return false;
    }

    /** For Settings → Garmin and WatchBridge.status: the state and every Garmin. */
    JSObject status() {
        JSObject out = new JSObject();
        out.put("supported", true);
        out.put("state", state);
        out.put("installed", anyInstalled());
        out.put("reachable", anyReachable());
        out.put("store", !STORE_ID.isEmpty());
        JSArray list = new JSArray();
        for (Map.Entry<Long, IQDevice> e : devices.entrySet()) {
            JSObject d = new JSObject();
            d.put("id", String.valueOf(e.getKey()));
            d.put("name", e.getValue().getFriendlyName());
            d.put("connected", connected(e.getKey()));
            Boolean inst = installed.get(e.getKey());
            if (inst != null) d.put("installed", inst);
            list.put(d);
        }
        out.put("devices", list);
        return out;
    }

    /** The page's Garmin snapshot to every connected Garmin with the app. Whether any got it on its way. */
    boolean send(String json) {
        Map<String, Object> snap = GarminMessages.toMonkey(json);
        if (snap == null) return false;
        lastSnapshot = snap;
        boolean any = false;
        for (IQDevice d : new ArrayList<>(devices.values())) {
            long id = d.getDeviceIdentifier();
            if (connected(id) && !Boolean.FALSE.equals(installed.get(id))) { sendTo(d, snap); any = true; }
        }
        return any;
    }

    private void sendTo(IQDevice d, Map<String, Object> snap) { sendTo(d, snap, true); }

    private void sendTo(IQDevice d, Map<String, Object> snap, boolean first) {
        if (snap == null || ciq == null || !"ready".equals(state)) return;
        main.post(() -> {
            try {
                // its `now` is when it goes, not when the page made it (a kept one goes again later)
                ciq.sendMessage(d, new IQApp(APP_ID), GarminMessages.stamped(snap, System.currentTimeMillis()), (device, app, status) -> {
                    // Not there after all: the next connect or hello sends the latest again.
                    if (status == ConnectIQ.IQMessageStatus.FAILURE_DEVICE_NOT_CONNECTED) deviceState.put(device.getDeviceIdentifier(), "NOT_CONNECTED");
                    // Lost on the way with the watch still there: once more, while it is still the latest
                    // (it names the events the watch may let go of; nothing else would send it again).
                    else if (GarminUse.sendsAgain(status == null ? null : status.name(), first) && snap == lastSnapshot) main.postDelayed(() -> sendTo(d, snap, false), GarminUse.RESEND_MS);
                });
            } catch (Exception ignored) {}
        });
    }

    /** A workout started on the phone: each connected Garmin with the app asks "open openGym?". */
    boolean open() {
        if (ciq == null || !"ready".equals(state)) return false;
        boolean any = false;
        for (IQDevice d : new ArrayList<>(devices.values())) {
            long id = d.getDeviceIdentifier();
            if (!connected(id) || !Boolean.TRUE.equals(installed.get(id))) continue;
            any = true;
            main.post(() -> {
                try { ciq.openApplication(d, new IQApp(APP_ID), (device, app, status) -> {}); } catch (Exception ignored) {}
            });
        }
        return any;
    }

    /** The openGym page in the Connect IQ Store (in Garmin Connect), once it is published there. */
    boolean openStore() {
        if (ciq == null || !"ready".equals(state) || STORE_ID.isEmpty()) return false;
        try { return ciq.openStore(STORE_ID); } catch (Exception e) { return false; }
    }
}
