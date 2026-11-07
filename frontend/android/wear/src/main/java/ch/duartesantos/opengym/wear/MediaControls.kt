package ch.duartesantos.opengym.wear

import android.content.Context
import android.content.Intent

/**
 * The watch's own Media Controls app: what plays on the phone (Spotify, YouTube Music, a podcast)
 * is controlled from the wrist there, through the phone's media session, without this app needing
 * notification access to read it. Each watch maker ships its own; the first one installed wins.
 * The packages are named in the manifest's <queries>, or Android 11+ would not let us see them.
 */
object MediaControls {
    const val ACTION = "com.google.android.wearable.action.MEDIA_CONTROLS"

    val PACKAGES = listOf(
        "com.google.android.wearable.media.sessions",   // Wear OS by Google: Media Controls
        "com.samsung.android.wearable.mediacontroller", // Galaxy Watch
        "com.samsung.android.watch.mediacontroller",
        "com.mobvoi.ticwear.media",                    // TicWatch
    )

    /** The launch intent of the first media controls app on this watch, or null. */
    fun intent(ctx: Context): Intent? {
        val pm = ctx.packageManager
        // Wear OS's own action for its media controls, whoever ships them.
        val action = Intent(ACTION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { if (action.resolveActivity(pm) != null) return action } catch (_: Exception) {}
        for (p in PACKAGES) {
            val i = try { pm.getLaunchIntentForPackage(p) } catch (_: Exception) { null }
            if (i != null) return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return null
    }
}
