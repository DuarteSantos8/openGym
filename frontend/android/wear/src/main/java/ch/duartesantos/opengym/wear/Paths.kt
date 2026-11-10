package ch.duartesantos.opengym.wear

/**
 * The Wearable Data Layer between the phone app (app/: WatchBridgePlugin, WatchListenerService,
 * WearPaths.java) and this watch app. Keep both sides in step.
 *
 *   /opengym/snapshot      data item, phone → watch: "snapshot" (the JSON of lib/watch-sync.js
 *                          buildSnapshot, the Apple Watch's), "at" (ms; a resend always changes it)
 *   /opengym/event/<id>    data item, watch → phone: "event" (one event's JSON, the Apple Watch's
 *                          events), "seq" (its order). The phone stores it, then deletes the item:
 *                          until then the Data Layer keeps it, phone asleep or out of reach.
 *   /opengym/open          message, phone → watch: a workout started on the phone, show it here.
 */
object Paths {
    const val SNAPSHOT = "/opengym/snapshot"
    const val EVENT_PREFIX = "/opengym/event/"
    const val OPEN = "/opengym/open"
    const val KEY_SNAPSHOT = "snapshot"
    const val KEY_AT = "at"
    const val KEY_EVENT = "event"
    const val KEY_SEQ = "seq"
    const val CAPABILITY_PHONE = "opengym_phone"
}
