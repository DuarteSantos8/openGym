package ch.duartesantos.opengym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.DataItem;
import com.google.android.gms.wearable.DataItemBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.Wearable;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Debug builds only (src/sideloadDebug): the e2e rig plays the Bluetooth link. Two emulators cannot
 * be paired without a Google account, but each has a working Data Layer of its own, so a script
 * carries the items across: what the phone app put (the snapshot) is read here and put on the
 * watch, what the watch put (its events) is put here, where the real WatchListenerService and the
 * real page take over. Everything but the radio is the shipped code.
 *
 *   adb shell am broadcast -a ch.duartesantos.opengym.WATCH_RIG -p <pkg> --es do items
 *       files/rig-items.json: { snapshot, at, events: [ids in the Data Layer], queue: [...] }
 *   ... --es do put-events     files/rig-events.json [{ id, seq, event }] become /opengym/event/<id> items
 */
public class WatchRigReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final Context ctx = context.getApplicationContext();
        final String what = intent.getStringExtra("do");
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                DataClient dc = Wearable.getDataClient(ctx);
                if ("put-events".equals(what)) {
                    JSONArray in = new JSONArray(new String(Files.readAllBytes(new File(ctx.getFilesDir(), "rig-events.json").toPath()), StandardCharsets.UTF_8));
                    for (int i = 0; i < in.length(); i++) {
                        JSONObject e = in.getJSONObject(i);
                        PutDataMapRequest req = PutDataMapRequest.create(WatchBridgePlugin.EVENT_PREFIX + e.getString("id"));
                        req.getDataMap().putString("event", e.getString("event"));
                        req.getDataMap().putLong("seq", e.optLong("seq"));
                        Tasks.await(dc.putDataItem(req.asPutDataRequest().setUrgent()), 5, TimeUnit.SECONDS);
                    }
                } else if ("items".equals(what)) {
                    JSONObject out = new JSONObject();
                    DataItemBuffer snaps = Tasks.await(dc.getDataItems(new Uri.Builder().scheme("wear").path(WatchBridgePlugin.SNAPSHOT).build(), DataClient.FILTER_LITERAL), 5, TimeUnit.SECONDS);
                    for (DataItem item : snaps) {
                        out.put("snapshot", DataMapItem.fromDataItem(item).getDataMap().getString("snapshot"));
                        out.put("at", DataMapItem.fromDataItem(item).getDataMap().getLong("at"));
                    }
                    snaps.release();
                    JSONArray ids = new JSONArray();
                    DataItemBuffer evs = Tasks.await(dc.getDataItems(new Uri.Builder().scheme("wear").path(WatchBridgePlugin.EVENT_PREFIX).build(), DataClient.FILTER_PREFIX), 5, TimeUnit.SECONDS);
                    for (DataItem item : evs) ids.put(item.getUri().getLastPathSegment());
                    evs.release();
                    out.put("events", ids);
                    File q = new File(ctx.getFilesDir(), "watch-events.json");
                    out.put("queue", q.exists() ? new JSONArray(new String(Files.readAllBytes(q.toPath()), StandardCharsets.UTF_8)) : new JSONArray());
                    Files.write(new File(ctx.getFilesDir(), "rig-items.json").toPath(), out.toString().getBytes(StandardCharsets.UTF_8));
                }
            } catch (Exception e) {
                try { Files.write(new File(ctx.getFilesDir(), "rig-items.json").toPath(), ("{\"error\":" + JSONObject.quote(String.valueOf(e)) + "}").getBytes(StandardCharsets.UTF_8)); } catch (Exception ignored) {}
            } finally { pending.finish(); }
        }).start();
    }
}
