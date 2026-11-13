package ch.duartesantos.opengym.wear

import kotlinx.serialization.Serializable

/*
 * Protocol 2 on the watch (docs/WATCH_SYNC.md "One rest", "Clocks"), as pure functions tested on
 * the JVM: how far this watch's clock is off the phone's, which snapshot is newer than the last one
 * applied, and what the watch's rest does with the phone's. WearStore only calls these.
 */

/**
 * How far this watch's clock is off the phone's (watch − phone, ms). Each snapshot that came as a
 * message (never a Data Layer item, which can wait for minutes before it lands) gives one sample:
 * the watch's clock on arrival minus the snapshot's `now`. The transport only ever adds delay, so
 * the smallest sample of the last five minutes is the best guess; without a recent one, the newest.
 */
@Serializable
data class ClockSamples(val at: List<Long> = emptyList(), val gap: List<Long> = emptyList())

object ClockOffset {
    const val KEEP = 8
    const val RECENT_MS = 5 * 60_000L
    /** Beyond this it is a clock that is wrong, not off: the phone leaves it alone, and so does this. */
    const val MAX_MS = 12 * 3_600_000L

    fun add(s: ClockSamples, watchNow: Long, phoneNow: Double?): ClockSamples {
        val p = phoneNow?.takeIf { it > 0 && it.isFinite() } ?: return s
        val gap = watchNow - p.toLong()
        if (kotlin.math.abs(gap) > MAX_MS) return s
        return ClockSamples((s.at + watchNow).takeLast(KEEP), (s.gap + gap).takeLast(KEEP))
    }

    fun off(s: ClockSamples, watchNow: Long): Long {
        if (s.gap.isEmpty()) return 0
        val recent = s.gap.indices.filter { watchNow - s.at[it] in 0..RECENT_MS }.map { s.gap[it] }
        return recent.minOrNull() ?: s.gap.last()
    }
}

/**
 * The phone sends each snapshot twice on Wear OS: as the Data Layer item (kept, delivered whenever
 * the watch is back) and as a message (only while the watch is in reach, and the only one that is
 * on time, for the clock). Both carry the phone's stamp, which always goes up (WatchEventQueue.
 * nextStamp); a snapshot older than the newest applied from the same phone is skipped, so a late
 * item cannot bring back what a message already ended. Another phone has its own stamps.
 */
/** The newest snapshot stamp applied per phone, as saved. */
@Serializable
data class SnapStamps(val at: Map<String, Long> = emptyMap())

object SnapshotOrder {
    fun newer(last: Map<String, Long>, source: String?, at: Long?): Boolean {
        if (source == null || at == null || at <= 0) return true
        return at > (last[source] ?: Long.MIN_VALUE)
    }

    fun note(last: Map<String, Long>, source: String?, at: Long?): Map<String, Long> {
        if (source == null || at == null || at <= 0) return last
        return (last + (source to at)).entries.sortedBy { it.value }.takeLast(4).associate { it.key to it.value }
    }
}

/** The message form of a snapshot: the stamp on the first line, then the JSON (WatchBridgePlugin.java snapshotMessage). */
object SnapshotMessage {
    fun decode(bytes: ByteArray): Pair<Long, String>? {
        val text = try { String(bytes, Charsets.UTF_8) } catch (_: Exception) { return null }
        val nl = text.indexOf('\n')
        if (nl <= 0) return null
        val at = text.substring(0, nl).toLongOrNull() ?: return null
        val json = text.substring(nl + 1)
        return if (json.startsWith("{")) at to json else null
    }
}

/** What the watch's rest does with a snapshot of its own workout (rule 3 of WATCH_SYNC.md "One rest"). */
sealed class RestFollow {
    /** A phone without `restAt` (protocol 1): the old rules (RestMath.follows, the echo, phoneSkipped). */
    object Legacy : RestFollow()
    /** Not newer than the watch's own last change: the snapshot's rest is ignored. */
    object Ignore : RestFollow()
    /** The rest runs until `endsAt` (watch clock); `restart` false when it already ends within 250 ms of that. */
    data class Run(val endsAt: Long, val total: Int?, val restart: Boolean, val restAt: Double) : RestFollow()
    /** Paused on the phone: the countdown stands at `leftMs`, no alarm. */
    data class Pause(val leftMs: Long, val restAt: Double) : RestFollow()
    /** Skipped (or ended) on the phone: the watch's rest ends as its own Skip ends it. */
    data class End(val restAt: Double) : RestFollow()

    companion object {
        const val SAME_MS = 250L

        /**
         * `ownRestAt`: the watch's newest rest change (phone clock), `off`: watch − phone, `ownEnd` the
         * end of the rest running here (watch clock) or null, `ownPausedLeft` a pause shown here.
         */
        fun of(a: ActiveWorkout, ownRestAt: Double, off: Long, ownEnd: Long?, ownPausedLeft: Long? = null): RestFollow {
            val at = a.restAt?.takeIf { it > 0 } ?: return Legacy
            if (at <= ownRestAt) return Ignore
            val rest = a.rest
            if (rest != null) {
                val end = rest.endsAt.toLong() + off
                val total = rest.total?.takeIf { it > 0 }?.let { Math.round(it).toInt() }
                val same = ownEnd != null && ownPausedLeft == null && kotlin.math.abs(ownEnd - end) <= SAME_MS
                return Run(end, total, !same, at)
            }
            if (a.restPaused == true) return Pause(((a.restLeft ?: 0.0) * 1000).toLong().coerceAtLeast(0), at)
            return End(at)
        }
    }
}

/** The watch's own rest changes, as the phone hears of them (the `rest` event, a tick's `restEnd`). */
object RestEvents {
    /** +15, −15 or Skip pressed by the lifter: `endsAt` the new end on the watch's clock, null for Skip. */
    fun rest(wid: String, endsAt: Long?, at: Long, id: String): Event = kotlinx.serialization.json.buildJsonObject {
        put("id", kotlinx.serialization.json.JsonPrimitive(id)); put("type", kotlinx.serialization.json.JsonPrimitive("rest"))
        put("wid", kotlinx.serialization.json.JsonPrimitive(wid))
        put("endsAt", if (endsAt != null) kotlinx.serialization.json.JsonPrimitive(endsAt) else kotlinx.serialization.json.JsonNull)
        put("at", kotlinx.serialization.json.JsonPrimitive(at))
    }

    /** The watch's newest change on the phone's clock: its own time less the offset it sends. */
    fun stamp(at: Long, off: Long): Double = (at - off).toDouble()

    /** Every event carries the offset the watch works with (protocol 2); one that has it keeps it. */
    fun withOff(e: Event, off: Long): Event =
        if (e.containsKey("off")) e else kotlinx.serialization.json.JsonObject(e + ("off" to kotlinx.serialization.json.JsonPrimitive(off)))
}
