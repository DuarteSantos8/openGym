package ch.duartesantos.opengym.wear

import android.content.Context
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** The wrist's taps: short for a logged set, a clear double-double when a rest is over. */
object Haptics {
    // VibratorManager is Android 12 (API 31); a Wear OS 3 watch on API 30 has only the old service.
    private fun vibrator(ctx: Context): Vibrator? =
        if (android.os.Build.VERSION.SDK_INT >= 31) (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        else @Suppress("DEPRECATION") (ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)

    /** A set logged: one crisp tick, enough to know it counted without looking. */
    fun tick(ctx: Context) {
        val v = vibrator(ctx) ?: return
        try { v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)) } catch (_: Exception) {}
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

    /** Finished and saved: a long one, then two short ones (the Apple Watch's stop, success, success). */
    fun finished(ctx: Context) = waveform(ctx, longArrayOf(0, 220, 280, 70, 330, 70), intArrayOf(0, 200, 0, 255, 0, 255))

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
