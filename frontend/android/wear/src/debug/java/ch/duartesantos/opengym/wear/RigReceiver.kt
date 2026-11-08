package ch.duartesantos.opengym.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import java.io.File

/**
 * Debug builds only: a script plays the phone (no paired phone in the emulator).
 *   adb shell am broadcast -a ch.duartesantos.opengym.wear.RIG -p <pkg> --es do snap   applies files/rig-snapshot.json
 *   ... --es do near --ez near false                                                     phone out of reach / back
 *   ... --es do dump                                                                     outbox + state to files/rig-dump.json
 */
class RigReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (!BuildConfig.DEBUG) return
        WearStore.init(ctx)
        val app = ctx.applicationContext
        val pending = goAsync()
        Handler(Looper.getMainLooper()).post {
            try {
                when (intent.getStringExtra("do")) {
                    "snap" -> File(app.filesDir, "rig-snapshot.json").takeIf { it.exists() }?.let { WearStore.applySnapshotJson(it.readText()) }
                    "near" -> { PhoneLink.nearForTest = intent.getBooleanExtra("near", true); PhoneLink.refreshNear(app) }
                    "dump" -> {
                        val p = app.getSharedPreferences("opengym-wear", Context.MODE_PRIVATE)
                        val out = "{\"outbox\":" + (p.getString("outbox", null) ?: "null") + ",\"state\":" + (p.getString("state", null) ?: "null") + "}"
                        File(app.filesDir, "rig-dump.json").writeText(out)
                    }
                }
            } finally { pending.finish() }
        }
    }
}
