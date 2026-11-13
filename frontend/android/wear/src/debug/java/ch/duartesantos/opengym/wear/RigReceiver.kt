package ch.duartesantos.opengym.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import java.io.File

/**
 * Debug builds only: a script plays the phone (no paired phone in the emulator).
 *   adb shell am broadcast -a ch.duartesantos.opengym.wear.RIG -p <pkg> --es do snap   applies files/rig-snapshot.json
 *   ... --es do near --ez near false                                                     phone out of reach / back
 *   ... --es do dump                                                                     outbox + state to files/rig-dump.json
 * And the Data Layer itself, for the two-emulator rig (the phone's WatchRigReceiver is its twin):
 *   ... --es do put-snap        files/rig-snapshot.json as the /opengym/snapshot item: the real WearListener applies it
 *   ... --es do items           files/rig-items.json: the watch's event items still in the Data Layer [{ id, seq, event }]
 *   ... --es do del-event --es id <id>   deletes that item, as the phone does once it stored it
 */
class RigReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (!BuildConfig.DEBUG) return
        WearStore.init(ctx)
        val app = ctx.applicationContext
        val pending = goAsync()
        val what = intent.getStringExtra("do")
        if (what in setOf("put-snap", "items", "del-event")) {
            Thread {
                try { dataLayer(app, what!!, intent.getStringExtra("id")) } catch (e: Exception) {
                    File(app.filesDir, "rig-items.json").writeText("{\"error\":\"${e.toString().replace("\"", "'")}\"}")
                } finally { pending.finish() }
            }.start()
            return
        }
        Handler(Looper.getMainLooper()).post {
            try {
                when (intent.getStringExtra("do")) {
                    "snap" -> File(app.filesDir, "rig-snapshot.json").takeIf { it.exists() }?.let { WearStore.applySnapshotJson(it.readText()) }
                    "near" -> { PhoneLink.nearForTest = intent.getBooleanExtra("near", true); PhoneLink.refreshNear(app) }
                    "dump" -> {
                        val p = app.getSharedPreferences("opengym-wear", Context.MODE_PRIVATE)
                        val out = "{\"outbox\":" + (p.getString("outbox", null) ?: "null") + ",\"state\":" + (p.getString("state", null) ?: "null") + "}"
                        File(app.filesDir, "rig-dump.json").writeText(out)
                    }
                }
            } finally { pending.finish() }
        }
    }

    private fun dataLayer(app: Context, what: String, id: String?) {
        val dc = com.google.android.gms.wearable.Wearable.getDataClient(app)
        fun <T> wait(t: com.google.android.gms.tasks.Task<T>): T = com.google.android.gms.tasks.Tasks.await(t, 5, java.util.concurrent.TimeUnit.SECONDS)
        val events = android.net.Uri.Builder().scheme("wear").path(Paths.EVENT_PREFIX).build()
        when (what) {
            "put-snap" -> {
                val req = com.google.android.gms.wearable.PutDataMapRequest.create(Paths.SNAPSHOT)
                req.dataMap.putString(Paths.KEY_SNAPSHOT, File(app.filesDir, "rig-snapshot.json").readText())
                req.dataMap.putLong(Paths.KEY_AT, System.currentTimeMillis())
                wait(dc.putDataItem(req.asPutDataRequest().setUrgent()))
            }
            "items" -> {
                val items = wait(dc.getDataItems(events, com.google.android.gms.wearable.DataClient.FILTER_PREFIX))
                val out = org.json.JSONArray()
                for (item in items) {
                    val map = com.google.android.gms.wearable.DataMapItem.fromDataItem(item).dataMap
                    out.put(org.json.JSONObject().put("id", item.uri.lastPathSegment).put("seq", map.getLong(Paths.KEY_SEQ)).put("event", map.getString(Paths.KEY_EVENT)))
                }
                items.release()
                File(app.filesDir, "rig-items.json").writeText(out.toString())
            }
            "del-event" -> wait(dc.deleteDataItems(android.net.Uri.Builder().scheme("wear").path(Paths.EVENT_PREFIX + id).build()))
        }
    }
}
