package ch.duartesantos.opengym.wear

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.MonochromaticImageComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest

/**
 * The complication (the Apple Watch's complications): during a workout the work sets done as a
 * ring with "3/12"; otherwise the week streak. A tap opens the app.
 */
class ProgressComplicationService : ComplicationDataSourceService() {
    override fun onComplicationRequest(request: ComplicationRequest, listener: ComplicationRequestListener) {
        listener.onComplicationData(dataFor(this, request.complicationType, WearStore.peek(this)))
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        dataFor(this, type, SessionState(streak = Streak(12, true), synced = true))

    companion object {
        fun dataFor(ctx: Context, type: ComplicationType, s: SessionState): ComplicationData? {
            val c = Lang.wrap(ctx, s.settings.lang)
            val tap = PendingIntent.getActivity(ctx, 1, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            val icon = MonochromaticImage.Builder(Icon.createWithResource(ctx, R.drawable.ic_barbell)).build()
            val (done, total) = SessionCore.progress(s)
            val running = s.workout != null && total > 0
            val weeks = s.streak?.weeks ?: 0
            val short = if (running) "$done/$total" else weeks.toString()
            val desc = PlainComplicationText.Builder(
                if (running) c.getString(R.string.sets_of, done, total) else "${c.getString(R.string.week_streak)}: $weeks").build()
            val title = PlainComplicationText.Builder(c.getString(if (running) R.string.sets else R.string.week_streak)).build()
            return when (type) {
                ComplicationType.RANGED_VALUE ->
                    RangedValueComplicationData.Builder(
                        value = if (running) done.toFloat() else weeks.coerceAtMost(52).toFloat(),
                        min = 0f, max = if (running) total.toFloat() else 52f, contentDescription = desc)
                        .setText(PlainComplicationText.Builder(short).build())
                        .setMonochromaticImage(icon).setTapAction(tap).build()
                ComplicationType.SHORT_TEXT ->
                    ShortTextComplicationData.Builder(PlainComplicationText.Builder(short).build(), desc)
                        .setTitle(title).setMonochromaticImage(icon).setTapAction(tap).build()
                ComplicationType.MONOCHROMATIC_IMAGE ->
                    MonochromaticImageComplicationData.Builder(icon, desc).setTapAction(tap).build()
                else -> null
            }
        }
    }
}
