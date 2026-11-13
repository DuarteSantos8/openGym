package ch.duartesantos.opengym.wear

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.jsonObject

/**
 * A set taken out here, held for Undo: its removeSet event and the state before it (both JSON, so
 * it can be saved as it is and still reach the phone after the app was killed), and what the
 * "Removed" chip shows.
 */
@Serializable
data class HeldRemoval(val event: String, val before: String, val setNumber: Int, val w: Double?, val r: Double?, val unit: String,
                       /** When it was taken out (ms), so the chip's line keeps its place across recompositions. */
                       val at: Long = 0L,
                       /** How long it waits for Undo (ms): 4 s, longer when TalkBack's timeout setting asks for it. */
                       val ms: Long = 4000L) {
    fun toEvent(): Event = WireJson.parseToJsonElement(event).jsonObject
}

/** A removal waits for Undo ([HeldRemoval.ms]) before it is sent (UndoWindow.swift). One at a time: a second removal flushes the first. */
class UndoWindow {
    var edit: HeldRemoval? = null
        private set

    fun begin(h: HeldRemoval) { edit = h }

    /** Undo pressed: nothing will be sent. */
    fun undo() { edit = null }

    /** The removal now (another event goes out, a snapshot came, the app left the screen), once. */
    fun flush(): HeldRemoval? = edit.also { edit = null }
}
