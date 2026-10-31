package ch.duartesantos.opengym.wear

import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** The wrist's taps: short for a logged set, a clear double-double when a rest is over. */
object Haptics {
    private fun vibrator(ctx: Context): Vibrator? =
        (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator

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
}
