package ch.duartesantos.opengym.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/**
 * The watch's end of the Data Layer (Paths.kt). Events go out as data items, which the Data Layer
 * keeps and delivers once the phone is there (the Apple Watch's transferUserInfo); the phone stores
 * each and deletes it. Nothing here throws: without a phone, events wait and the workout goes on.
 */
object PhoneLink {
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** One event for the phone, in order (`seq`, kept across launches). */
    fun send(ctx: Context, event: Event) {
        val app = ctx.applicationContext
        val prefs = app.getSharedPreferences("opengym-wear", Context.MODE_PRIVATE)
        val seq = synchronized(this) {
            val n = prefs.getLong("seq", 0) + 1
            prefs.edit().putLong("seq", n).commit()
            n
        }
        val id = (event["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return
        io.launch {
            try {
                val req = PutDataMapRequest.create(Paths.EVENT_PREFIX + id).apply {
                    dataMap.putString(Paths.KEY_EVENT, event.toString())
                    dataMap.putLong(Paths.KEY_SEQ, seq)
                }.asPutDataRequest().setUrgent()
                Wearable.getDataClient(app).putDataItem(req).await()
            } catch (_: Exception) { /* no Play services on this watch: nothing to send to */ }
            refreshNear(app)
        }
    }

    /** The snapshot the phone left in the Data Layer, read at launch (it may have come while closed). */
    fun pull(ctx: Context) {
        val app = ctx.applicationContext
        io.launch {
            try {
                val uri = Uri.Builder().scheme("wear").path(Paths.SNAPSHOT).build()
                val items = Wearable.getDataClient(app).getDataItems(uri, DataClient.FILTER_LITERAL).await()
                var newest: Pair<Long, String>? = null
                for (item in items) {
                    val map = DataMapItem.fromDataItem(item).dataMap
                    val json = map.getString(Paths.KEY_SNAPSHOT) ?: continue
                    val at = map.getLong(Paths.KEY_AT)
                    if (newest == null || at > newest.first) newest = at to json
                }
                items.release()
                newest?.let { (_, json) -> withContext(Dispatchers.Main) { WearStore.applySnapshotJson(json) } }
            } catch (_: Exception) {}
            refreshNear(app)
        }
    }

    /** Whether the phone is connected right now. */
    fun refreshNear(ctx: Context) {
        val app = ctx.applicationContext
        io.launch {
            val near = try { Wearable.getNodeClient(app).connectedNodes.await().any { it.isNearby } } catch (_: Exception) { false }
            withContext(Dispatchers.Main) { WearStore.phoneNear.value = near }
        }
    }
}
