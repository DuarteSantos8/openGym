package ch.duartesantos.opengym;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataItemBuffer;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The phone's end of the Wear OS companion (frontend/android/wear). The watch records a workout on
 * its own and sends it here; the page (lib/wear-link.js) turns it into a saved workout and says
 * so with ack(). The watch is never the source of truth, so nothing here decides anything about
 * training: this side moves bytes and wakes things up.
 *
 * Usage from JS (src/wear-init.js):
 *   const WearBridge = registerPlugin('WearBridge');
 *   WearBridge.addListener('routineRequested', ({ requestId, routineId }) => ...);   // routineId '' = the list
 *   WearBridge.addListener('sessionFinished', ({ id, payload }) => ...);
 *   await WearBridge.ready();                    // listeners are in: hand over what is waiting
 *   await WearBridge.refresh();                  // the app came forward: offer pending sessions again
 *   await WearBridge.publishIndex({ json });
 *   await WearBridge.publishSnapshot({ routineId, json });
 *   await WearBridge.ack({ id });                // the session is saved (or will never be): the watch may forget it
 *
 * Delivery. A finished session is a Data Layer item the watch keeps until it sees the ack, so the
 * Data Layer is the queue: it survives this process dying, the phone rebooting and the watch being
 * out of range. The events below are only prompts to look. ready() and refresh() list everything
 * pending, and the page ignores one it has already dealt with (the session id makes that safe).
 * A request for a routine is a message and is not kept; if the app is closed it waits in memory
 * for the page, and the watch asks again meanwhile.
 *
 * Needs Google Play services (the Data Layer lives there). Without it the calls fail and the page
 * carries on without a watch.
 */
@CapacitorPlugin(name = "WearBridge")
public class WearBridgePlugin extends Plugin {

    private static final String CHANNEL_ID = "wear-bridge";
    private static final int NOTIFICATION_SESSION = 4301;
    private static final int NOTIFICATION_REQUEST = 4302;
    // A routine request older than this was given up on by the watch long ago.
    private static final long REQUEST_TTL_MS = 2 * 60 * 1000;
    private static final int REQUEST_QUEUE_MAX = 8;

    private static volatile WearBridgePlugin instance;
    // Requests that arrived while no page was there to answer. In memory only, see the class comment.
    private static final ArrayDeque<Object[]> pendingRequests = new ArrayDeque<>();

    @Override
    public void load() {
        super.load();
        instance = this;
        drainRequests();
    }

    @Override
    protected void handleOnDestroy() {
        // The page this instance talked to is gone; deliveries must see "no page" and wait.
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------------ from the service

    static void deliverSession(Context ctx, byte[] data) {
        JSObject event = sessionEvent(data);
        if (event == null) return;
        WearBridgePlugin plugin = instance;
        if (plugin != null) {
            // retainUntilConsumed: a page still starting up gets it when its listener is added.
            plugin.notifyListeners("sessionFinished", event, true);
        } else {
            notifyUser(ctx, NOTIFICATION_SESSION, R.string.wear_session_title, R.string.wear_session_text);
        }
    }

    static void deliverRequest(Context ctx, byte[] data) {
        JSObject event = requestEvent(data);
        if (event == null) return;
        WearBridgePlugin plugin = instance;
        if (plugin != null) {
            plugin.notifyListeners("routineRequested", event, true);
            return;
        }
        synchronized (pendingRequests) {
            while (pendingRequests.size() >= REQUEST_QUEUE_MAX) pendingRequests.pollFirst();
            pendingRequests.addLast(new Object[] {System.currentTimeMillis(), event});
        }
        notifyUser(ctx, NOTIFICATION_REQUEST, R.string.wear_request_title, R.string.wear_request_text);
    }

    private void drainRequests() {
        long now = System.currentTimeMillis();
        while (true) {
            Object[] item;
            synchronized (pendingRequests) {
                item = pendingRequests.pollFirst();
            }
            if (item == null) return;
            if (now - (Long) item[0] <= REQUEST_TTL_MS) notifyListeners("routineRequested", (JSObject) item[1], true);
        }
    }

    private static JSObject sessionEvent(byte[] data) {
        try {
            JSObject payload = new JSObject(new String(data, StandardCharsets.UTF_8));
            String id = payload.getString("id");
            if (id == null || id.isEmpty()) return null;
            JSObject event = new JSObject();
            event.put("id", id);
            event.put("payload", payload);
            return event;
        } catch (JSONException e) {
            return null;
        }
    }

    private static JSObject requestEvent(byte[] data) {
        try {
            JSONObject in = new JSONObject(new String(data == null ? new byte[0] : data, StandardCharsets.UTF_8));
            JSObject event = new JSObject();
            event.put("requestId", in.optString("requestId", ""));
            event.put("routineId", in.optString("routineId", ""));
            return event;
        } catch (JSONException e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ from the page

    /** The page's listeners are in: queued requests go out, and so does every session still pending. */
    @PluginMethod
    public void ready(PluginCall call) {
        drainRequests();
        offerPendingSessions();
        call.resolve();
    }

    /** The app came forward: whatever is still unacked is offered again. */
    @PluginMethod
    public void refresh(PluginCall call) {
        offerPendingSessions();
        call.resolve();
    }

    @PluginMethod
    public void ack(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("id required");
            return;
        }
        JSONObject body = new JSONObject();
        try {
            body.put("id", id);
            body.put("ts", System.currentTimeMillis());
        } catch (JSONException e) {
            call.reject("bad id");
            return;
        }
        put(call, WearPaths.ACK + WearPaths.segment(id), body.toString());
    }

    @PluginMethod
    public void publishIndex(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json required");
            return;
        }
        put(call, WearPaths.INDEX, json);
    }

    @PluginMethod
    public void publishSnapshot(PluginCall call) {
        String routineId = call.getString("routineId");
        String json = call.getString("json");
        if (routineId == null || routineId.isEmpty() || json == null) {
            call.reject("routineId and json required");
            return;
        }
        put(call, WearPaths.SNAPSHOT + WearPaths.segment(routineId), json);
    }

    private void put(PluginCall call, String path, String json) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > WearPaths.MAX_ITEM_BYTES) {
            call.reject("too large for the Data Layer: " + bytes.length + " bytes");
            return;
        }
        try {
            PutDataRequest request = PutDataRequest.create(path).setData(bytes).setUrgent();
            Wearable.getDataClient(ctx).putDataItem(request)
                    .addOnSuccessListener(item -> call.resolve())
                    .addOnFailureListener(e -> call.reject("data layer: " + e.getMessage()));
        } catch (RuntimeException e) {
            call.reject("data layer: " + e.getMessage());
        }
    }

    /** Every session item still in the Data Layer, i.e. every session not acked and removed yet. */
    private void offerPendingSessions() {
        Context ctx = getContext();
        if (ctx == null) return;
        try {
            Uri uri = new Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(WearPaths.SESSION).build();
            Wearable.getDataClient(ctx).getDataItems(uri, DataClient.FILTER_PREFIX)
                    .addOnSuccessListener((DataItemBuffer items) -> {
                        try {
                            for (DataItem item : items) {
                                byte[] data = item.getData();
                                JSObject event = data == null ? null : sessionEvent(data);
                                if (event != null) notifyListeners("sessionFinished", event, true);
                            }
                        } finally {
                            items.release();
                        }
                    })
                    .addOnFailureListener(e -> { /* no Play services, or the watch app was never installed */ });
        } catch (RuntimeException ignored) {
            // The Data Layer client could not be built (no Play services).
        }
    }

    // ------------------------------------------------------------------ the app is closed

    /**
     * Something came from the watch and there is no page to hand it to. The notification opens the
     * app; once the page is up, ready() offers whatever is pending, so nothing depends on it.
     */
    private static void notifyUser(Context ctx, int id, int title, int text) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID, ctx.getString(R.string.wear_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription(ctx.getString(R.string.wear_channel_desc));
                nm.createNotificationChannel(channel);
            }
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pending = PendingIntent.getActivity(
                    ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            nm.notify(id, new NotificationCompat.Builder(ctx, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_dumbbell)
                    .setContentTitle(ctx.getString(title))
                    .setContentText(ctx.getString(text))
                    .setContentIntent(pending)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .build());
        } catch (RuntimeException ignored) {
            // Notifications not allowed: the session still waits in the Data Layer for the next time the app opens.
        }
    }
}
