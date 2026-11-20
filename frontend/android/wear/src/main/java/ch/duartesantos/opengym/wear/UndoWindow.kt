package ch.duartesantos.opengym.wear

/**
 * A set taken out here, held for Undo: the held edit's id (SetMenu.removeSet, in state.edits) and
 * what the "Removed" chip shows.
 */
data class HeldRemoval(val id: String, val setNumber: Int, val w: Double?, val r: Double?, val unit: String,
                       /** When it was taken out (ms), so the chip's line keeps its place across recompositions. */
                       val at: Long = 0L,
                       /** How long it waits for Undo (ms): 4 s, longer when TalkBack's timeout setting asks for it. */
                       val ms: Long = 4000L)

/**
 * A removal waits for Undo ([HeldRemoval.ms]) before it is sent (SetMenu.release, UndoWindow.swift).
 * One at a time: a second removal sends the first. Meanwhile it is a held edit in the state, replayed over snapshots.
 */
class UndoWindow {
    var edit: HeldRemoval? = null
        private set

    fun begin(h: HeldRemoval) { edit = h }

    /** Undo pressed: nothing will be sent. */
    fun undo() { edit = null }

    /** The removal now (its time is up, the app left the screen), once. */
    fun flush(): HeldRemoval? = edit.also { edit = null }
}
