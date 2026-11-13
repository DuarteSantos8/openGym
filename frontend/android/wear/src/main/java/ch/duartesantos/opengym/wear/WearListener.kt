package ch.duartesantos.opengym.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.util.concurrent.TimeUnit

/**
 * What the phone sends while the app may be closed: the snapshot (applied, so the Tile, the
 * complication and the next launch are up to date), the exercises' stills for the Overview, and
 * "a workout started on the phone" (the ongoing notification that opens the app on a tap).
 */
class WearListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        WearStore.init(this)
        var json: String? = null
        val stored = mutableListOf<String>()
        val stills = mutableListOf<Triple<String?, String, Asset>>()
        val clips = mutableListOf<Triple<String?, String, Asset>>()
        for (e in events) {
            val path = e.dataItem.uri.path ?: continue
            if (e.type == DataEvent.TYPE_CHANGED && path.startsWith(Paths.STILL_PREFIX)) {
                val map = DataMapItem.fromDataItem(e.dataItem.freeze()).dataMap
                map.getAsset(Paths.KEY_IMG)?.let { stills += Triple(map.getString(Paths.KEY_WID), path.removePrefix(Paths.STILL_PREFIX), it) }
                map.getAsset(Paths.KEY_CLIP)?.let { clips += Triple(map.getString(Paths.KEY_WID), path.removePrefix(Paths.STILL_PREFIX), it) }
                continue
            }
            // The phone deleted one of the watch's events: it has it in its queue now.
            if (e.type == DataEvent.TYPE_DELETED && path.startsWith(Paths.EVENT_PREFIX)) { stored += path.removePrefix(Paths.EVENT_PREFIX); continue }
            if (e.type != DataEvent.TYPE_CHANGED || path != Paths.SNAPSHOT) continue
            json = DataMapItem.fromDataItem(e.dataItem).dataMap.getString(Paths.KEY_SNAPSHOT) ?: json
        }
        events.release()
        PhoneLink.delivered(this, stored)
        json?.let { onMain { WearStore.applySnapshotJson(it) } }
        // This service's thread may wait for the bytes; a still that does not come is a plain mark.
        for ((wid, exId, asset) in stills) {
            try {
                val fd = Tasks.await(Wearable.getDataClient(this).getFdForAsset(asset), 10, TimeUnit.SECONDS)
                fd.inputStream.use { WearStore.saveStill(wid, exId, readUpTo(it, Stills.MAX_BYTES + 1)) }
            } catch (_: Exception) {}
        }
        for ((wid, exId, asset) in clips) {
            try {
                val fd = Tasks.await(Wearable.getDataClient(this).getFdForAsset(asset), 10, TimeUnit.SECONDS)
                fd.inputStream.use { WearStore.saveStill(wid, exId, readUpTo(it, Stills.CLIP_MAX_BYTES + 1), clip = true) }
            } catch (_: Exception) {}
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != Paths.OPEN) return
        WearStore.init(this)
        PhoneLink.pull(this)
        WorkoutService.sync(this, fromPhone = true)
    }

    /**
     * The store is the main thread's (the screens, the timers, the heart rate all change it there);
     * this service's callbacks come on a thread of their own. A snapshot applied from here while a
     * Done was being handled could overwrite that tick's state. So: on the main thread, and waited
     * for, so the service is still alive when it runs.
     */
    private fun onMain(block: () -> Unit) {
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) { block(); return }
        val done = java.util.concurrent.CountDownLatch(1)
        android.os.Handler(android.os.Looper.getMainLooper()).post { try { block() } finally { done.countDown() } }
        try { done.await(10, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
    }

    /** At most `max` bytes of a stream (InputStream.readNBytes is Android 13 and later only). */
    private fun readUpTo(input: java.io.InputStream, max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < max) {
            val n = input.read(buf, 0, minOf(buf.size, max - out.size()))
            if (n <= 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }
}
