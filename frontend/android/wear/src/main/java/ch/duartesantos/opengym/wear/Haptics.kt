package ch.duartesantos.opengym.wear

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

object Haptics {
    private fun vibrator(ctx: Context): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        else @Suppress("DEPRECATION") ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator

    private fun play(ctx: Context, pattern: LongArray) {
        try {
            vibrator(ctx)?.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } catch (e: RuntimeException) {
            // No vibrator, or the system refused: the screen still changes.
        }
    }

    /** The rest is over: two firm pulses and a long one, felt with the watch on the wrist and the screen off. */
    fun restOver(ctx: Context) = play(ctx, longArrayOf(0, 250, 120, 250, 120, 500))

    /** A short buzz for a mini-set rest ending, so it is told from a full rest. */
    fun burstReady(ctx: Context) = play(ctx, longArrayOf(0, 120, 80, 120))

    /** A set was logged. */
    fun confirmed(ctx: Context) = play(ctx, longArrayOf(0, 40))
}
