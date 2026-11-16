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
 * The watch's end of the Data Layer (Paths.kt). Every event goes into the outbox first (saved, the
 * OutboxCore rules in SessionCore.kt), then out as a data item, which the Data Layer keeps and
 * delivers once the phone is there (the Apple Watch's transferUserInfo); the phone stores each and
 * deletes it, which tells the watch it got there. An event leaves the outbox only once the phone
 * has applied it (its id in a snapshot's `acked`); until then it goes out again at launch, on
 * reconnect and when a snapshot shows it missing. Nothing here throws: without a phone, events
 * wait and the workout goes on.
 */
object PhoneLink {
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private const val OUTBOX = "outbox"

    /** Events not applied on the phone yet (the small "syncs later" count). */
    val waiting = kotlinx.coroutines.flow.MutableStateFlow(0)
    /** Sets logged here the phone's side has not stored yet: the "Waiting to sync 3" pill (1.4.5). */
    val waitingSets = kotlinx.coroutines.flow.MutableStateFlow(0)

    /** The same count read from the saved outbox, for the Tile and the complication. */
    fun waitingSetsNow(ctx: Context): Int = OutboxCore.waitingSets(load(ctx.applicationContext))

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("opengym-wear", Context.MODE_PRIVATE)

    private fun load(ctx: Context): Outbox {
        val p = prefs(ctx)
        val saved = p.getString(OUTBOX, null)?.let { try { WireJson.decodeFromString(Outbox.serializer(), it) } catch (_: Exception) { null } }
        // Before the outbox (1.4.4) the seq lived on its own: carried on, so the order holds.
        return saved ?: Outbox(seq = p.getLong("seq", 0))
    }

    private fun save(ctx: Context, o: Outbox) {
        // commit, not apply: the outbox is the event's only copy until the Data Layer has it.
        prefs(ctx).edit().putString(OUTBOX, WireJson.encodeToString(Outbox.serializer(), o)).putLong("seq", o.seq).commit()
        waiting.value = OutboxCore.waiting(o)
        val sets = OutboxCore.waitingSets(o)
        val changed = sets != waitingSets.value
        waitingSets.value = sets
        if (changed) WearStore.refreshSurfacesSoon()
    }

    private fun <T> edit(ctx: Context, fn: (Outbox) -> Pair<Outbox, T>): T = synchronized(this) {
        val (o, out) = fn(load(ctx))
        save(ctx, o)
        out
    }

    /** One event for the phone: saved in the outbox, then sent. */
    fun send(ctx: Context, event: Event) {
        val app = ctx.applicationContext
        // Every event says how far this watch's clock is off the phone's when it was made (protocol 2):
        // the phone moves its times onto its own clock. Resends keep it (the times are of that moment).
        val withOff = RestEvents.withOff(event, WearStore.clockOff())
        val item = edit(app) { o -> OutboxCore.add(o, withOff) ?: (o to null) } ?: return
        io.launch { put(app, listOf(item)); refreshNear(app) }
    }

    /** The phone applied these: out of the outbox. Then whatever is due goes out again. */
    fun acked(ctx: Context, ids: List<String>?) {
        val app = ctx.applicationContext
        if (!ids.isNullOrEmpty()) edit(app) { o -> OutboxCore.ack(o, ids) to Unit }
        flush(app)
    }

    /** The phone stored these (it deleted their data items): sent again only rarely now. */
    fun delivered(ctx: Context, ids: List<String>) {
        if (ids.isNotEmpty()) edit(ctx.applicationContext) { o -> OutboxCore.delivered(o, ids) to Unit }
    }

    /** What is due goes out (at launch, on a snapshot); `all`: the phone is back, all not delivered goes. */
    fun flush(ctx: Context, all: Boolean = false) {
        val app = ctx.applicationContext
        val now = System.currentTimeMillis()
        val (items, box) = synchronized(this) { load(app).let { (if (all) OutboxCore.onReconnect(it, now) else OutboxCore.due(it, now)) to it } }
        waiting.value = OutboxCore.waiting(box)
        waitingSets.value = OutboxCore.waitingSets(box)
        if (items.isEmpty()) return
        io.launch { put(app, items) }
    }

    private suspend fun put(app: Context, items: List<OutItem>) {
        val sent = mutableListOf<String>()
        for (item in items) {
            try {
                val req = PutDataMapRequest.create(Paths.EVENT_PREFIX + item.id).apply {
                    dataMap.putString(Paths.KEY_EVENT, item.json)
                    dataMap.putLong(Paths.KEY_SEQ, item.seq)
                }.asPutDataRequest().setUrgent()
                Wearable.getDataClient(app).putDataItem(req).await()
                sent += item.id
            } catch (_: Exception) { /* no Play services, or not now: it stays in the outbox */ }
        }
        if (sent.isNotEmpty()) edit(app) { o -> OutboxCore.sent(o, sent, System.currentTimeMillis()) to Unit }
    }

    /** The snapshot the phone left in the Data Layer, read at launch (it may have come while closed). */
    fun pull(ctx: Context) {
        val app = ctx.applicationContext
        io.launch {
            try {
                val uri = Uri.Builder().scheme("wear").path(Paths.SNAPSHOT).build()
                val items = Wearable.getDataClient(app).getDataItems(uri, DataClient.FILTER_LITERAL).await()
                var newest: Triple<Long, String, String?>? = null
                for (item in items) {
                    val map = DataMapItem.fromDataItem(item).dataMap
                    val json = map.getString(Paths.KEY_SNAPSHOT) ?: continue
                    val at = map.getLong(Paths.KEY_AT)
                    if (newest == null || at > newest.first) newest = Triple(at, json, item.uri.host)
                }
                items.release()
                newest?.let { (at, json, host) -> withContext(Dispatchers.Main) { WearStore.applySnapshotJson(json, host, at.takeIf { it > 0 }) } }
            } catch (_: Exception) {}
            refreshNear(app)
        }
    }

    /** Every 30 s while a workout runs or something waits (WearStore's idle loop): reach, and what is due. */
    fun upkeep(ctx: Context) {
        refreshNear(ctx)
        flush(ctx)
    }

    /** Debug builds only: the e2e rig (src/debug RigReceiver) plays the phone and says whether it is near. */
    @Volatile var nearForTest: Boolean? = null

    /** Whether the phone is connected right now. */
    fun refreshNear(ctx: Context) {
        val app = ctx.applicationContext
        io.launch {
            val near = nearForTest ?: try { Reach.phone(Wearable.getNodeClient(app).connectedNodes.await().size) } catch (_: Exception) { false }
            val back = near && !WearStore.phoneNear.value
            withContext(Dispatchers.Main) { WearStore.phoneNear.value = near }
            // The phone is back: everything it has not applied goes out again (it may have missed it).
            if (back) flush(app, all = true)
        }
    }
}
