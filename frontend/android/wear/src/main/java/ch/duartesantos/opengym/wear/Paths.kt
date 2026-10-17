package ch.duartesantos.opengym.wear

import android.net.Uri

/** The names the watch and the phone agree on; WearPaths.java on the phone keeps the same list. */
object Paths {
    /** Watch to phone: a finished session, one Data Layer item per session id. */
    const val SESSION = "/opengym/session/"
    /** Phone to watch: "this session id is saved". */
    const val ACK = "/opengym/ack/"
    /** Phone to watch: the routine list. */
    const val INDEX = "/opengym/index"
    /** Phone to watch: a routine's snapshot, one item per routine id. */
    const val SNAPSHOT = "/opengym/snapshot/"
    /** Watch to phone, a message: {"requestId","routineId"} (routineId empty for the list). */
    const val REQUEST = "/opengym/request"

    /** A request id starting with this is the watch checking in, not waiting: the phone sends only what changed. */
    const val QUIET_PREFIX = "quiet-"

    const val CAPABILITY_PHONE = "opengym_phone"

    fun segment(id: String): String = Uri.encode(id)
    fun idOf(path: String, prefix: String): String = Uri.decode(path.removePrefix(prefix))
}
