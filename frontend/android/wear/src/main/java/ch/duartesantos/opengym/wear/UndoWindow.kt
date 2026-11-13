package ch.duartesantos.opengym.wear

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.jsonObject

/**
 * A set taken out here, held for Undo: its removeSet event and the state before it (both JSON, so
 * it can be saved as it is and still reach the phone after the app was killed), and what the
 * "Removed" chip shows.
 */
@Serializable
data class HeldRemoval(val event: String, val before: String, val setNumber: Int, val w: Double?, val r: Double?, val unit: String) {
    fun toEvent(): Event = WireJson.parseToJsonElement(event).jsonObject
}

/** A removal waits [SECONDS] for Undo before it is sent (UndoWindow.swift). One at a time: a second removal flushes the first. */
class UndoWindow {
    companion object { const val SECONDS = 4.0 }

    var edit: HeldRemoval? = null
        private set
    private var started = Double.NEGATIVE_INFINITY

    /** [at] in seconds. */
    fun begin(h: HeldRemoval, at: Double) { edit = h; started = at }

    /** Undo pressed: nothing will be sent. */
    fun undo() { edit = null }

    /** The removal once its time is up, once. */
    fun due(at: Double): HeldRemoval? = if (at - started >= SECONDS) flush() else null

    /** The removal now (another event goes out, a snapshot came, the app left the screen), once. */
    fun flush(): HeldRemoval? = edit.also { edit = null }
}
