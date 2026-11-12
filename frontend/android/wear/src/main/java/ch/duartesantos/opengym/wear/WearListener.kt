package ch.duartesantos.opengym.wear

import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * What the phone sends while the app may be closed: the snapshot (applied, so the Tile, the
 * complication and the next launch are up to date) and "a workout started on the phone" (the
 * ongoing notification that opens the app on a tap).
 */
class WearListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        WearStore.init(this)
        var json: String? = null
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED || e.dataItem.uri.path != Paths.SNAPSHOT) continue
            json = DataMapItem.fromDataItem(e.dataItem).dataMap.getString(Paths.KEY_SNAPSHOT) ?: json
        }
        events.release()
        json?.let { WearStore.applySnapshotJson(it) }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != Paths.OPEN) return
        WearStore.init(this)
        PhoneLink.pull(this)
        WorkoutService.sync(this, fromPhone = true)
    }

    /** The phone's link check: answered at once, nothing else touched. */
    override fun onRequest(nodeId: String, path: String, request: ByteArray): Task<ByteArray>? =
        if (path == Paths.PING) Tasks.forResult(byteArrayOf(1)) else null
}
