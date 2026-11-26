package ch.duartesantos.opengym;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.huawei.wearengine.HiWear;
import com.huawei.wearengine.auth.AuthCallback;
import com.huawei.wearengine.auth.Permission;
import com.huawei.wearengine.client.ServiceConnectionListener;
import com.huawei.wearengine.client.WearEngineClient;
import com.huawei.wearengine.device.Device;
import com.huawei.wearengine.monitor.MonitorItem;
import com.huawei.wearengine.monitor.MonitorListener;
import com.huawei.wearengine.p2p.Message;
import com.huawei.wearengine.p2p.P2pClient;
import com.huawei.wearengine.p2p.Receiver;
import com.huawei.wearengine.p2p.SendCallback;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The phone's end of the Huawei watch link (watch app in watch-huawei): Huawei's Wear Engine SDK,
 * which talks to a Huawei or Honor watch through the Huawei Health app. The twin of GarminLink.
 * One per process, started with the page's plugin (WatchBridgePlugin.load) once Settings → Huawei
 * watch was opened (`use`, remembered), so a set logged on the wrist while the page sleeps is in the
 * queue file at once. The wire is HuaweiFrames: the Garmin link's messages as JSON text in frames
 * of at most 1 KB.
 *
 * Phone → watch: the page's Huawei snapshot (lib/huawei-snapshot.js), as it is, to every connected
 * watch that has the app, one snapshot at a time per watch (HuaweiSend). The last one is kept and
 * sent when the watch says hello. Huawei holds nothing back: a message to a watch whose app is not
 * in front is lost (code 206, ignored), and the watch's hello when it opens brings the latest.
 *
 * Watch → phone: `{ events: [...] }`, each event into the queue file the Wear OS watch and the
 * Garmin use (WatchBridgePlugin.storeEvent); `hello` is never queued.
 *
 * Without Huawei Health, or before the user allowed openGym there, every call says why in `state`.
 * Not in the F-Droid and Offline builds (closed source), and not in a build without the app id and
 * the watch app's fingerprint (app/huawei.gradle: huaweiAppId, huaweiWatchFingerprint): "build".
 * Nothing of Huawei's runs for someone who never opened Settings → Huawei watch.
 *
 * Huawei Health going away (updated, stopped, killed) takes with it the receivers and connection
 * listeners it held for us: the SDK says so (ServiceConnectionListener) and the link registers
 * everything again when it is back. A start that does not come up is tried a few times and then says
 * "error", which "Choose watches" starts over; a refresh that fails is just tried again.
 *
 * The SDK's calls and callbacks are on the main thread; the queue file is written off it.
 */
final class HuaweiLink {
    /** The watch app's bundleName (watch-huawei/entry/src/main/config.json). */
    static final String WATCH_PKG = "ch.duartesantos.opengym.huawei";
    private static final String HEALTH = "com.huawei.health";
    private static final String PREFS = "opengym-huawei";
    /** Wear Engine's result for a message that reached the watch (WearEngineErrorCode.ERROR_CODE_COMM_SUCCESS). */
    private static final int SENT = 207;
    /** A frame that gets no answer in this time stalls its message; the next one waits for the frame's answer, or this long again (GRACE), so the two never mix on the watch. */
    private static final long STALL_MS = 10000;
    private static final long GRACE_MS = 30000;
    /** The SDK itself waits up to 30 s for Huawei Health to bind, so a start may take that long. */
    private static final long START_WAIT_MS = 35000;
    /** After Huawei Health's service went away and did not come back by itself: asked again after 5 s, doubling up to 5 minutes. */
    private static final long REVIVE_FIRST_MS = 5000;
    private static final long REVIVE_MAX_MS = 300000;
    /** A watch is asked whether it has the app at most this often. */
    private static final long ASK_MS = 30000;
    /** How often the permission is looked at again while "no-permission" (the user gives it in Huawei Health), and a watch without a receiver is looked for. */
    private static final long RECHECK_MS = 5000;
    private static final long NUDGE_MS = 30000;

    private static HuaweiLink instance;

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    /** off (never asked for), starting, ready, no-health, no-permission, error, build */
    private volatile String state = "starting";
    /** Written on the main thread; read from the plugin's threads too. */
    private final Map<String, Device> devices = new ConcurrentHashMap<>();
    private final Map<String, Boolean> connected = new ConcurrentHashMap<>();
    private final Map<String, Boolean> installed = new ConcurrentHashMap<>();
    /** Watches that ever spoke to us, remembered across launches: the SDK's "app not installed" does not outvote them. */
    private final Set<String> heard = ConcurrentHashMap.newKeySet();
    /** Main thread: the receiver and the connection listener each watch has, by its uuid. */
    private final Map<String, Receiver> receivers = new ConcurrentHashMap<>();
    private final Map<String, MonitorListener> watched = new HashMap<>();
    /** Which watch's missing from Huawei Health's answers how often (HuaweiForget), and when each was last asked about the app. */
    private final HuaweiForget forget = new HuaweiForget();
    private final Map<String, Long> askedAt = new HashMap<>();
    /** Main thread: the frame each message is at, and the messages that gave up waiting for a frame (their answer or GRACE_MS ends them). */
    private final Map<String, Integer> frameAt = new HashMap<>();
    private final Set<String> stalled = new HashSet<>();
    /** The wait before the next try to bring the link back after the service went away (0: not trying), and which wait is current. */
    private long reviveMs = 0;
    private int reviveNo = 0;
    /** The wait before the next look for watches while none is heard (HuaweiLook; 0: not looking), and which wait is current. */
    private long lookMs = 0;
    private int lookNo = 0;
    private final Map<String, HuaweiFrames.Receiver> gathered = new ConcurrentHashMap<>();
    /** Main thread: what goes to each watch next (HuaweiSend), and which message is on its way (a token, to tell stale answers). */
    private final Map<String, HuaweiSend> slots = new HashMap<>();
    private final Map<String, Integer> chains = new HashMap<>();
    private int chainNo = 0;
    private int startNo = 0;
    /** Starts in a row that did not come up (main thread). */
    private int tries = 0;
    private long lastRecheck = 0, lastNudge = 0;
    private P2pClient p2p;
    private WearEngineClient serviceWatch;
    /** The queue file is written off the main thread (it is synced to disk). */
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile String lastSnapshot;
    private long seq = 0;
    // lean: a message id is the clock in seconds, then counting up; it only has to differ from the
    // one before, also after a restart. Six base-36 digits last until 2038; shorten the clock then.
    private long counter = System.currentTimeMillis() / 1000;

    private HuaweiLink(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        // A build without the ids has no link: nothing remembered from one that had it counts.
        if (!configured()) return;
        // The watches that had openGym the last time: known at once, so a snapshot goes out from the first send.
        try {
            for (String id : prefs().getStringSet("has", new HashSet<String>())) installed.put(id, true);
            heard.addAll(prefs().getStringSet("heard", new HashSet<String>()));
        } catch (Exception ignored) {}
    }

    private SharedPreferences prefs() { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** Without the app id and the watch app's fingerprint Wear Engine would refuse every call. */
    private static boolean configured() {
        return !BuildConfig.HUAWEI_APP_ID.isEmpty() && !BuildConfig.HUAWEI_WATCH_FINGERPRINT.isEmpty();
    }

    /** The link, started only if Settings → Huawei watch was opened before (else it stays quiet). */
    static synchronized HuaweiLink get(Context ctx) {
        if (instance == null) {
            instance = new HuaweiLink(ctx);
            boolean on = false;
            try { on = instance.prefs().getBoolean("on", false); } catch (Exception ignored) {}
            if (!configured()) instance.state = "build";
            else if (on) instance.main.post(instance::start);
            else instance.state = "off";
        }
        return instance;
    }

    /** Settings → Huawei watch is open: the link is wanted from now on, and starts if it has not. */
    static synchronized HuaweiLink use(Context ctx) {
        HuaweiLink h = get(ctx);
        if (!configured()) return h;
        try { h.prefs().edit().putBoolean("on", true).apply(); } catch (Exception ignored) {}
        // Huawei Health installed since it said "no-health": the page asks every 3 s, so it is noticed.
        if ("off".equals(h.state) || ("no-health".equals(h.state) && h.healthInstalled())) { h.state = "starting"; h.main.post(h::start); }
        else if ("ready".equals(h.state)) h.refresh();
        else if ("no-permission".equals(h.state)) h.main.post(h::recheckPermission);
        return h;
    }

    String state() { return state; }

    private boolean healthInstalled() {
        try { ctx.getPackageManager().getPackageInfo(HEALTH, 0); return true; } catch (Exception e) { return false; }
    }

    /** Main thread: Huawei Health is there, and has openGym been allowed to see the watches? From scratch: nothing registered before counts. */
    private void start() {
        // Huawei Health may well be alive: what was registered there is let go of before it is again.
        for (String id : new ArrayList<>(receivers.keySet())) unlisten(id);
        for (MonitorListener l : watched.values()) {
            try { HiWear.getMonitorClient(ctx).unregister(l); } catch (Throwable ignored) {}
        }
        clearAll();
        if (!healthInstalled()) { state = "no-health"; WatchBridgePlugin.notifyState(); return; }
        state = "starting";
        final int mine = ++startNo;
        try {
            p2p = HiWear.getP2pClient(ctx);
            // The phone's own package and its signing key are what Huawei knows (huaweiAppId): a debug build
            // ("...opengym.test") is most likely refused unless that package is registered there too.
            p2p.setPeerPkgName(WATCH_PKG);
            p2p.setPeerFingerPrint(BuildConfig.HUAWEI_WATCH_FINGERPRINT);
            watchService();
            HiWear.getAuthClient(ctx).checkPermission(Permission.DEVICE_MANAGER)
                .addOnSuccessListener(granted -> {
                    if (mine != startNo) return;
                    tries = 0;
                    state = Boolean.TRUE.equals(granted) ? "ready" : "no-permission";
                    if ("ready".equals(state)) refresh();
                    WatchBridgePlugin.notifyState();
                })
                .addOnFailureListener(e -> failed(mine));
        } catch (Throwable e) {
            failed(mine);
            return;
        }
        // No answer at all (Huawei Health was stopped, the system would not bind it).
        main.postDelayed(() -> { if (mine == startNo && "starting".equals(state)) failed(mine); }, START_WAIT_MS);
    }

    /** A start that did not come up: tried again a few times (as GarminLink), then "error". */
    private void failed(int mine) {
        if (mine != startNo) return;
        startNo++;
        if (GarminUse.onStartTimeout(++tries).equals("retry")) {
            state = "starting";
            main.postDelayed(this::start, GarminUse.REVIVE_MS);
            return;
        }
        state = "error";
        WatchBridgePlugin.notifyState();
    }

    /** Huawei Health's service going away and coming back (once per link): its receivers and listeners are gone with it. */
    private void watchService() {
        if (serviceWatch != null) return;
        try {
            serviceWatch = HiWear.getWearEngineClient(ctx, new ServiceConnectionListener() {
                @Override public void onServiceConnect() {
                    main.post(() -> {
                        reviveMs = 0;
                        reviveNo++;
                        // Huawei Health back after the starts gave up (an update): the link comes up by itself.
                        if ("error".equals(state)) { tries = 0; start(); }
                        else if ("ready".equals(state)) refresh();
                    });
                }
                @Override public void onServiceDisconnect() { main.post(HuaweiLink.this::serviceLost); }
            });
            serviceWatch.registerServiceConnectionListener().addOnFailureListener(e -> serviceWatch = null);
        } catch (Throwable e) {
            serviceWatch = null;
        }
    }

    /** Main thread: the watches are registered again by the refresh when Huawei Health is back (or by "Choose watches"). */
    private void serviceLost() {
        clearAll();
        for (String id : connected.keySet()) connected.put(id, false);
        WatchBridgePlugin.notifyState();
        // After an update or a stop Android does not bind Huawei Health again by itself: asked again
        // by this link, with a wait that doubles (refresh's failure goes on with it).
        if ("ready".equals(state)) { reviveMs = REVIVE_FIRST_MS; reviveSoon(); }
    }

    /** Nothing registered with Huawei Health counts any more (it is gone, or about to be started over). */
    private void clearAll() {
        receivers.clear();
        watched.clear();
        gathered.clear();
        chains.clear();
        frameAt.clear();
        stalled.clear();
        slots.clear();
    }

    private void reviveSoon() {
        final int mine = ++reviveNo;
        main.postDelayed(() -> { if (mine == reviveNo && reviveMs != 0 && "ready".equals(state)) refresh(); }, reviveMs);
    }

    /** Main thread: while the link is up and no watch has a receiver, Huawei Health is asked again, with a wait that doubles. */
    private void lookAgainSoon() {
        if (!HuaweiLook.deaf("ready".equals(state), receivers.size())) { lookMs = 0; lookNo++; return; }
        if (lookMs != 0) return;
        lookMs = HuaweiLook.next(0);
        scheduleLook();
    }

    private void scheduleLook() {
        final int mine = ++lookNo;
        main.postDelayed(() -> {
            if (mine != lookNo) return;
            if (!HuaweiLook.deaf("ready".equals(state), receivers.size())) { lookMs = 0; return; }
            lookMs = HuaweiLook.next(lookMs);
            scheduleLook();
            refresh();
        }, lookMs);
    }

    /** A refresh that got no answer: Huawei Health is gone for good, or busy; while the service is being waited for, the next try is later. */
    private void refreshFailed() {
        lookAgainSoon();
        if (!healthInstalled()) { reviveMs = 0; reviveNo++; state = "no-health"; WatchBridgePlugin.notifyState(); return; }
        if (reviveMs != 0 && "ready".equals(state)) { reviveMs = Math.min(reviveMs * 2, REVIVE_MAX_MS); reviveSoon(); }
    }

    /** "no-permission": the user may have given it in Huawei Health since; looked at every few seconds, quietly. */
    private void recheckPermission() {
        long now = SystemClock.elapsedRealtime();
        if (!"no-permission".equals(state) || now - lastRecheck < RECHECK_MS) return;
        lastRecheck = now;
        try {
            HiWear.getAuthClient(ctx).checkPermission(Permission.DEVICE_MANAGER)
                .addOnSuccessListener(granted -> { if (Boolean.TRUE.equals(granted) && "no-permission".equals(state)) start(); });
        } catch (Throwable ignored) {}
    }

    /**
     * "Choose watches" in Settings → Huawei watch: without permission Huawei Health's own screen
     * asks for it; from an error the link starts over; else it looks for the watches again.
     */
    void lookAgain() {
        main.post(() -> {
            if (!configured()) return;
            if ("no-permission".equals(state)) { askPermission(); return; }
            if ("error".equals(state) || "no-health".equals(state)) { tries = 0; start(); }
            else refresh();
        });
    }

    private void askPermission() {
        try {
            AuthCallback done = new AuthCallback() {
                @Override public void onOk(Permission[] permissions) { main.post(() -> { if ("no-permission".equals(state)) start(); }); }
                @Override public void onCancel() {}
            };
            HiWear.getAuthClient(ctx).requestPermission(done, Permission.DEVICE_MANAGER)
                // Huawei Health could not show its screen (HMS Core missing on a phone that is not Huawei's): said so.
                .addOnFailureListener(e -> { state = "error"; WatchBridgePlugin.notifyState(); });
        } catch (Throwable e) {
            state = "error";
            WatchBridgePlugin.notifyState();
        }
    }

    /** The watches Huawei Health knows, each connected one listened to; asked again by `lookAgain`, by the page's poll, and when one connects or goes. */
    void refresh() {
        main.post(() -> {
            if (!"ready".equals(state)) return;
            try {
                HiWear.getDeviceClient(ctx).getBondedDevices()
                    .addOnSuccessListener(this::known)
                    // Huawei Health is busy or restarting: the next refresh tries again.
                    .addOnFailureListener(e -> refreshFailed());
            } catch (Throwable e) { refreshFailed(); }
        });
    }

    /** Main thread. */
    private void known(List<Device> list) {
        boolean changed = false;
        Set<String> ids = new HashSet<>();
        for (Device d : list == null ? new ArrayList<Device>() : list) {
            String id = d.getUuid();
            if (id == null) continue;
            ids.add(id);
            // Huawei Health speaks to one watch at a time: a watch that is not connected is out of reach.
            boolean up = d.isConnected();
            boolean now = devices.put(id, d) == null | !Boolean.valueOf(up).equals(connected.put(id, up));
            if (now) changed = true;
            if (up) {
                listen(d);
                askInstalled(d);
                // It just came into reach (or into view): it gets the latest, as a Garmin does on connect.
                if (now && !Boolean.FALSE.equals(installed.get(id))) sendTo(d, lastSnapshot, false);
            }
            else unlisten(id);
            if (!watched.containsKey(id)) {
                // One listener object per watch: the SDK tells the listeners apart by identity.
                MonitorListener onConnection = (errorCode, item, data) -> { if (id != null) refresh(); };
                watched.put(id, onConnection);
                try {
                    HiWear.getMonitorClient(ctx).register(d, MonitorItem.MONITOR_ITEM_CONNECTION, onConnection)
                        .addOnFailureListener(e -> watched.remove(id));
                } catch (Throwable e) { watched.remove(id); }
            }
        }
        // Huawei Health answered: a watch it leaves out is out of reach; it is forgotten only when two answers in a row
        // leave it out (HuaweiForget), and never because of an empty one.
        reviveMs = 0;
        reviveNo++;
        Set<String> out = forget.missing(new HashSet<>(devices.keySet()), ids);
        if (!ids.isEmpty()) {
            for (String id : new ArrayList<>(devices.keySet())) if (!ids.contains(id)) { if (Boolean.TRUE.equals(connected.put(id, false))) changed = true; unlisten(id); }
        }
        boolean gone = false;
        for (String id : out) {
            unlisten(id);
            slots.remove(id);
            chains.remove(id);
            frameAt.remove(id);
            stalled.remove(id);
            askedAt.remove(id);
            watched.remove(id);
            devices.remove(id);
            connected.remove(id);
            gone = true;
        }
        boolean forgotten = heard.removeAll(out);
        if (installed.keySet().removeAll(out) || gone || forgotten) saveInstalled();
        // Only a change is told to the page: it answers by sending its snapshot again.
        if (changed || gone) WatchBridgePlugin.notifyState();
        lookAgainSoon();
    }

    private void listen(Device d) {
        String id = d.getUuid();
        if (receivers.containsKey(id)) return;
        Receiver r = message -> onMessage(d, message);
        receivers.put(id, r);
        try { p2p.registerReceiver(d, r).addOnFailureListener(e -> receivers.remove(id)); } catch (Throwable e) { receivers.remove(id); }
    }

    private void unlisten(String id) {
        gathered.remove(id);
        Receiver r = receivers.remove(id);
        if (r == null) return;
        try { p2p.unregisterReceiver(r); } catch (Throwable ignored) {}
    }

    /** Whether openGym is on a watch, remembered for the next launch. */
    private Boolean setInstalled(String id, boolean has) {
        Boolean was = installed.put(id, has);
        if (was == null || was != has) saveInstalled();
        return was;
    }

    /** Both threads call this (the watch's messages come on a binder thread): the sets are built and written under one lock. */
    private synchronized void saveInstalled() {
        try {
            Set<String> ids = new HashSet<>();
            for (Map.Entry<String, Boolean> e : installed.entrySet()) if (Boolean.TRUE.equals(e.getValue())) ids.add(e.getKey());
            prefs().edit().putStringSet("has", ids).putStringSet("heard", new HashSet<>(heard)).apply();
        } catch (Exception ignored) {}
    }

    /** Does the watch have the app? (A ping would open it on the watch: only a workout does that.) */
    private void askInstalled(Device d) {
        String id = d.getUuid();
        // A round trip to the watch: not again while the page polls every 3 s.
        long now = SystemClock.elapsedRealtime();
        Long last = askedAt.get(id);
        if (last != null && now - last < ASK_MS) return;
        askedAt.put(id, now);
        try {
            p2p.isAppInstalled(d, WATCH_PKG).addOnSuccessListener(has -> {
                boolean yes = Boolean.TRUE.equals(has);
                // lean: unsure the SDK answers this for a lite watch. A watch that ever spoke to us has the
                // app whatever it says; it is only forgotten when it leaves Huawei Health.
                if (!yes && heard.contains(id)) return;
                Boolean was = setInstalled(id, yes);
                if (was == null || was != yes) WatchBridgePlugin.notifyState();
                if (yes && !Boolean.TRUE.equals(was)) sendTo(d, lastSnapshot, false);
            });
        } catch (Throwable ignored) {}
    }

    /** A message from a watch (any thread): frames are gathered, a whole one is read off the main thread. */
    private void onMessage(Device d, Message message) {
        if (message == null || message.getType() != Message.MESSAGE_TYPE_DATA || message.getData() == null) return;
        String id = d.getUuid();
        HuaweiFrames.Receiver g = gathered.computeIfAbsent(id, k -> new HuaweiFrames.Receiver());
        String text;
        synchronized (g) { text = g.accept(new String(message.getData(), StandardCharsets.UTF_8)); }
        if (text == null) return;
        // The watch talks to us: it has the app, and it is there.
        boolean first = heard.add(id);
        connected.put(id, true);
        Boolean was = setInstalled(id, true);
        if (first) saveInstalled();
        if (was == null || !was) WatchBridgePlugin.notifyState();
        io.execute(() -> {
            boolean any = false, hello = false;
            try {
                JSONArray events = new JSONObject(text).optJSONArray("events");
                for (int i = 0; events != null && i < events.length(); i++) {
                    JSONObject e = events.optJSONObject(i);
                    if (e == null) continue;
                    String json = e.toString();
                    if (GarminMessages.isHello(json)) { hello = true; continue; }
                    if (WatchBridgePlugin.storeEvent(ctx, json, GarminMessages.seqOf(json, ++seq))) any = true;
                }
            } catch (Exception ignored) {}
            // Only this watch is answered: the page is told by the changes above, not by every hello.
            if (hello) main.post(() -> sendTo(d, lastSnapshot, true));
            if (any) WatchBridgePlugin.notifyEvent();
        });
    }

    /** Whether a Huawei watch with the openGym app is there (connected now or not). */
    boolean anyInstalled() {
        for (Boolean b : installed.values()) if (Boolean.TRUE.equals(b)) return true;
        return false;
    }

    boolean anyReachable() {
        for (String id : devices.keySet()) if (Boolean.TRUE.equals(connected.get(id)) && Boolean.TRUE.equals(installed.get(id))) return true;
        return false;
    }

    /** For Settings → Huawei watch: the state and every watch Huawei Health knows. */
    JSObject status() {
        JSObject out = new JSObject();
        out.put("supported", !"build".equals(state));
        out.put("state", state);
        out.put("installed", anyInstalled());
        out.put("reachable", anyReachable());
        JSArray list = new JSArray();
        for (Map.Entry<String, Device> e : devices.entrySet()) {
            JSObject d = new JSObject();
            d.put("id", e.getKey());
            d.put("name", e.getValue().getName());
            d.put("connected", Boolean.TRUE.equals(connected.get(e.getKey())));
            Boolean inst = installed.get(e.getKey());
            if (inst != null) d.put("installed", inst);
            list.put(d);
        }
        out.put("devices", list);
        return out;
    }

    /**
     * The page's Huawei snapshot (the Garmin's for an older page) to every connected watch with the app. Whether any got it on its way.
     * `again`: the page resends it on purpose (an event came twice, so the watch missed it), so it goes even if it is the same.
     */
    boolean send(String json, boolean again) {
        if (json == null || !json.startsWith("{")) return false;
        // Too long for 16 frames: not sent, and not kept to be sent on a hello either.
        if (!HuaweiFrames.fits(json)) return false;
        lastSnapshot = json;
        // Not up: nothing can go, and the page must not take it as sent.
        if (!"ready".equals(state)) return false;
        nudge();
        boolean any = false;
        for (Device d : new ArrayList<>(devices.values())) {
            String id = d.getUuid();
            if (Boolean.TRUE.equals(connected.get(id)) && !Boolean.FALSE.equals(installed.get(id))) { sendTo(d, json, again); any = true; }
        }
        return any;
    }

    /** A watch Huawei Health knows but nobody listens to (its connection listener never fired): looked for again, at most every 30 s. */
    private void nudge() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastNudge < NUDGE_MS) return;
        // Also with no watch known at all (the first list was empty or failed): the page sending is a reason to look again.
        if (devices.isEmpty()) { lastNudge = now; main.post(() -> { lookMs = 0; lookNo++; }); refresh(); return; }
        for (String id : devices.keySet()) if (!receivers.containsKey(id)) { lastNudge = now; refresh(); return; }
    }

    /** `asked`: the watch said hello, or the page resent on purpose, so it gets the snapshot even if it is the one it had. */
    private void sendTo(Device d, String json, boolean asked) {
        if (json == null) return;
        main.post(() -> {
            if (p2p == null || !"ready".equals(state)) return;
            String next = slots.computeIfAbsent(d.getUuid(), k -> new HuaweiSend()).want(json, asked, SystemClock.elapsedRealtime());
            if (next != null) start(d, next);
        });
    }

    /** Main thread: the message goes frame by frame; its end (whole, failed or silent) lets the next one start. */
    private void start(Device d, String json) {
        // its `now` is when it goes, not when the page made it (a kept one goes again later)
        String text = json.replaceFirst("\"now\":\\d+", "\"now\":" + System.currentTimeMillis());
        List<String> frames = HuaweiFrames.frames(text, Long.toString(++counter, 36));
        int mine = ++chainNo;
        chains.put(d.getUuid(), mine);
        if (frames.isEmpty()) { finish(d, mine, false); return; }
        sendFrame(d, frames, 0, mine);
    }

    private void finish(Device d, int mine, boolean whole) {
        String id = d.getUuid();
        if (!Integer.valueOf(mine).equals(chains.get(id))) return;
        chains.remove(id);
        frameAt.remove(id);
        stalled.remove(id);
        HuaweiSend slot = slots.get(id);
        String next = slot == null ? null : slot.done(whole, SystemClock.elapsedRealtime());
        if (next != null) start(d, next);
    }

    /**
     * Main thread: frame `i`, and the next when it was sent. A failure ends the message: the next hello or
     * snapshot sends the latest whole. Whole is only when the last frame said so, and only if the message
     * had not given up waiting by then.
     */
    private void sendFrame(Device d, List<String> frames, int i, int mine) {
        String id = d.getUuid();
        if (!Integer.valueOf(mine).equals(chains.get(id))) return;
        frameAt.put(id, i);
        // A frame with no answer: the message is stalled. The next one waits for this frame's answer
        // (or GRACE_MS), or the two could meet on the watch and the newer be lost.
        main.postDelayed(() -> {
            if (!Integer.valueOf(mine).equals(chains.get(id)) || !Integer.valueOf(i).equals(frameAt.get(id))) return;
            stalled.add(id);
            main.postDelayed(() -> finish(d, mine, false), GRACE_MS);
        }, STALL_MS);
        try {
            Message.Builder b = new Message.Builder();
            b.setPayload(frames.get(i).getBytes(StandardCharsets.UTF_8));
            p2p.send(d, b.build(), new SendCallback() {
                @Override public void onSendResult(int resultCode) {
                    // 206 is a watch whose app is not in front: normal, and the hello when it opens brings the latest.
                    main.post(() -> {
                        if (!Integer.valueOf(mine).equals(chains.get(id))) return;
                        if (resultCode != SENT || stalled.contains(id)) finish(d, mine, false);
                        else if (i + 1 < frames.size()) sendFrame(d, frames, i + 1, mine);
                        else finish(d, mine, true);
                    });
                }
                @Override public void onSendProgress(long progress) {}
            }).addOnFailureListener(e -> finish(d, mine, false));
        } catch (Throwable e) {
            finish(d, mine, false);
        }
    }

    /** A workout started on the phone: each connected watch with the app is pinged, which opens the app on a lite watch (it then says hello). */
    boolean open() {
        if (p2p == null || !"ready".equals(state)) return false;
        boolean any = false;
        for (Device d : new ArrayList<>(devices.values())) {
            String id = d.getUuid();
            // A watch that ever spoke to us has the app, whatever the SDK says about it.
            if (!Boolean.TRUE.equals(connected.get(id)) || !(Boolean.TRUE.equals(installed.get(id)) || heard.contains(id))) continue;
            any = true;
            main.post(() -> {
                try { p2p.ping(d, resultCode -> {}).addOnFailureListener(e -> {}); } catch (Throwable ignored) {}
            });
        }
        return any;
    }
}
