package ch.duartesantos.opengym.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/**
 * Everything the watch says to the phone, over the Wearable Data Layer. The watch never reaches a
 * server. Every call here can fail (the phone is out of range, Play services are updating) and
 * answers false or an empty result when it does: nothing on the watch depends on one succeeding.
 *
 * A session goes as a Data Layer item, which the system keeps and delivers whenever the phone is
 * next reachable, so "send it again later" is the Data Layer's job and not a retry loop of ours.
 */
object PhoneLink {

    private fun uri(path: String, host: String? = null): Uri =
        Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(path).apply { if (host != null) authority(host) }.build()

    /** Asks the phone for the routine list (routineId null) or one routine's snapshot. False if no phone is reachable. */
    suspend fun request(ctx: Context, routineId: String?, quiet: Boolean = false): Boolean = try {
        val nodes = Wearable.getCapabilityClient(ctx)
            .getCapability(Paths.CAPABILITY_PHONE, CapabilityClient.FILTER_REACHABLE).await().nodes
        val node = nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
        if (node == null) false
        else {
            val body = JSONObject().put("requestId", (if (quiet) Paths.QUIET_PREFIX else "") + UUID.randomUUID().toString()).put("routineId", routineId ?: "")
            Wearable.getMessageClient(ctx).sendMessage(node.id, Paths.REQUEST, body.toString().toByteArray()).await()
            true
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }

    /** Hands a finished session to the Data Layer; false if even that failed. Putting the same session again is harmless. */
    suspend fun putSession(ctx: Context, id: String, payload: String): Boolean = try {
        val request = PutDataRequest.create(Paths.SESSION + Paths.segment(id)).setData(payload.toByteArray()).setUrgent()
        Wearable.getDataClient(ctx).putDataItem(request).await()
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }

    /** The phone saved the session: take it out of the Data Layer. (The phone removes its own ack once it sees this.) */
    suspend fun deleteSession(ctx: Context, id: String) {
        try {
            val node = Wearable.getNodeClient(ctx).localNode.await().id
            Wearable.getDataClient(ctx).deleteDataItems(uri(Paths.SESSION + Paths.segment(id), node)).await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Still there: the next ack for it, or the next start, tries again.
        }
    }

    /** Ids of every ack the phone has put and the watch may not have seen (it was not running). */
    suspend fun pendingAcks(ctx: Context): List<String> = try {
        val items = Wearable.getDataClient(ctx).getDataItems(uri(Paths.ACK), com.google.android.gms.wearable.DataClient.FILTER_PREFIX).await()
        try {
            items.mapNotNull { it.uri.path?.let { p -> Paths.idOf(p, Paths.ACK) } }
        } finally {
            items.release()
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        emptyList()
    }

    /** The routine list the phone last published, for a watch that was not running when it did. */
    suspend fun lastIndex(ctx: Context): String? = try {
        val items = Wearable.getDataClient(ctx).getDataItems(uri(Paths.INDEX)).await()
        try {
            items.firstOrNull()?.data?.toString(Charsets.UTF_8)
        } finally {
            items.release()
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** Every routine snapshot the phone has published, as (path, JSON), for a watch that was not running when it did. */
    suspend fun allSnapshots(ctx: Context): List<Pair<String, String>> = try {
        val items = Wearable.getDataClient(ctx).getDataItems(uri(Paths.SNAPSHOT), com.google.android.gms.wearable.DataClient.FILTER_PREFIX).await()
        try {
            items.mapNotNull { item ->
                val path = item.uri.path ?: return@mapNotNull null
                val data = item.data ?: return@mapNotNull null
                path to data.toString(Charsets.UTF_8)
            }
        } finally {
            items.release()
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        emptyList()
    }

    /** Asks for a refresh and does not wait for it or report on it: the copies the watch holds are already usable. */
    suspend fun nudge(ctx: Context) {
        request(ctx, null, quiet = true)
    }
}
