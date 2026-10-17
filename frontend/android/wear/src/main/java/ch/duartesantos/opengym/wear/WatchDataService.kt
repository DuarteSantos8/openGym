package ch.duartesantos.opengym.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.runBlocking

/**
 * Receives what the phone puts in the Data Layer, with the watch app closed: the routine list, a
 * routine's snapshot, the ack of a session. Play services call this on a background thread, and the
 * buffer is gone when it returns, so everything is copied and applied before returning.
 */
class WatchDataService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        val changed = events.filter { it.type == DataEvent.TYPE_CHANGED }
            .map { (it.dataItem.uri.path ?: "") to it.dataItem.data }
        if (changed.isEmpty()) return
        Repository.init(applicationContext)
        runBlocking { changed.forEach { (path, data) -> Repository.onItem(path, data) } }
    }
}
