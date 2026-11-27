package ch.duartesantos.opengym.wear

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.annotation.RequiresApi
import kotlin.math.min

/** The wrist's taps: short for a logged set, a clear double-double when a rest is over. */
object Haptics {
    // VibratorManager only exists from Android 12 (API 31). A Wear OS 3 watch is API 30: naming the
    // class there fails to load it and the app stops the moment a set is logged (#1168).
    private fun vibrator(ctx: Context): Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) Api31.vibrator(ctx)
        else @Suppress("DEPRECATION") (ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)

    /** Kept apart so API 30 never has to load VibratorManager. */
    @RequiresApi(31)
    private object Api31 {
        fun vibrator(ctx: Context): Vibrator? =
            (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    }

    /** A set logged: one crisp tick, enough to know it counted without looking. */
    fun tick(ctx: Context) {
        val v = vibrator(ctx) ?: return
        try { v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)) } catch (_: Exception) {}
    }

    /** A set menu change (a mark, an added set, Undo): the same tick as a logged set. */
    fun mark(ctx: Context) = tick(ctx)

    /** A set taken out: one firm pulse, unlike any tick. */
    fun remove(ctx: Context) {
        val v = vibrator(ctx) ?: return
        try { v.vibrate(VibrationEffect.createOneShot(40, 255)) } catch (_: Exception) {}
    }

    /** The rest is over: two pairs of strong pulses, felt through a sleeve. */
    fun restOver(ctx: Context) {
        val v = vibrator(ctx) ?: return
        val timings = longArrayOf(0, 180, 110, 180, 380, 180, 110, 180)
        val amps = intArrayOf(0, 255, 0, 255, 0, 255, 0, 255)
        try { v.vibrate(VibrationEffect.createWaveform(timings, amps, -1)) } catch (_: Exception) {}
    }

    /** Ten seconds left: one soft nudge to pick the bar up. */
    fun restSoon(ctx: Context) {
        val v = vibrator(ctx) ?: return
        try { v.vibrate(VibrationEffect.createOneShot(60, 120)) } catch (_: Exception) {}
    }

    /** One side of a per-side set done, the other side next: lighter than a set. */
    fun side(ctx: Context) = predefined(ctx, VibrationEffect.EFFECT_TICK)

    /** The workout starts (Go!): one firm click. */
    fun start(ctx: Context) = predefined(ctx, VibrationEffect.EFFECT_HEAVY_CLICK)

    /** The medal's entrance (Medal.beats): the strike's thud, then a success on a no-records day or a rising tap per diamond (`records`, 3 at most). */
    private var recordTap = 0

    fun medal(ctx: Context, beat: Medal.Beat, records: Int) {
        when (beat) {
            Medal.Beat.STRIKE -> { recordTap = 0; start(ctx) }
            Medal.Beat.SETTLED -> waveform(ctx, longArrayOf(0, 70, 110, 70), intArrayOf(0, 200, 0, 255))
            Medal.Beat.RECORD -> {
                val amp = intArrayOf(130, 190, 255)[min(recordTap++, 2)]
                waveform(ctx, longArrayOf(0, 60), intArrayOf(0, amp))
            }
        }
    }

    /** A set passed over: one soft drop. */
    fun skip(ctx: Context) = waveform(ctx, longArrayOf(0, 45), intArrayOf(0, 90))

    /** "Still training?" and "Left the gym?": two even taps, a question, not the rest's alarm. */
    fun ask(ctx: Context) = waveform(ctx, longArrayOf(0, 120, 480, 120), intArrayOf(0, 200, 0, 200))

    /** Discarded: one long, low pulse. */
    fun discarded(ctx: Context) = waveform(ctx, longArrayOf(0, 260), intArrayOf(0, 140))

    private fun predefined(ctx: Context, effect: Int) {
        val v = vibrator(ctx) ?: return
        try { v.vibrate(VibrationEffect.createPredefined(effect)) } catch (_: Exception) {}
    }

    private fun waveform(ctx: Context, timings: LongArray, amps: IntArray) {
        val v = vibrator(ctx) ?: return
        try { v.vibrate(VibrationEffect.createWaveform(timings, amps, -1)) } catch (_: Exception) {}
    }

    /** One beat of a 3-2-1 (and the last seconds of a hold): a light tick. */
    fun count(ctx: Context) {
        val v = vibrator(ctx) ?: return
        try { v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)) } catch (_: Exception) {}
    }

    /** One beat of the rest's last 3 seconds: a heavy click, a tick is lost with the wrist down. */
    fun restCount(ctx: Context) = predefined(ctx, VibrationEffect.EFFECT_HEAVY_CLICK)
}

/**
 * Awake for a countdown (AwakePlan): a partial wake lock per countdown ("rest", "hold"), with its
 * own time limit, so one that is never released still ends. Nothing here throws.
 */
object Awake {
    private val locks = mutableMapOf<String, PowerManager.WakeLock>()

    @Synchronized fun until(ctx: Context, name: String, endsAt: Long) {
        release(name)
        val ms = AwakePlan.holdMs(endsAt, System.currentTimeMillis())
        if (ms <= 0) return
        try {
            val pm = ctx.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            locks[name] = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:$name").apply { setReferenceCounted(false); acquire(ms) }
        } catch (_: Exception) {}
    }

    @Synchronized fun release(name: String) {
        try { locks.remove(name)?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
    }
}
