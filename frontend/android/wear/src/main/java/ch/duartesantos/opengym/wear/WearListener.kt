package ch.duartesantos.opengym.wear

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
        val stored = mutableListOf<String>()
        for (e in events) {
            val path = e.dataItem.uri.path ?: continue
            // The phone deleted one of the watch's events: it has it in its queue now.
            if (e.type == DataEvent.TYPE_DELETED && path.startsWith(Paths.EVENT_PREFIX)) { stored += path.removePrefix(Paths.EVENT_PREFIX); continue }
            if (e.type != DataEvent.TYPE_CHANGED || path != Paths.SNAPSHOT) continue
            json = DataMapItem.fromDataItem(e.dataItem).dataMap.getString(Paths.KEY_SNAPSHOT) ?: json
        }
        events.release()
        PhoneLink.delivered(this, stored)
        json?.let { WearStore.applySnapshotJson(it) }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != Paths.OPEN) return
        WearStore.init(this)
        PhoneLink.pull(this)
        WorkoutService.sync(this, fromPhone = true)
    }
}
