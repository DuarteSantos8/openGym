package ch.duartesantos.opengym.wear

import android.content.Context
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.FontStyle
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * The Tile: one swipe from the watch face, readable at a glance.
 *   no workout   the week streak, big, and today's plan (its name and how many exercises), or a
 *                rest day; a tap starts the app on its start screen
 *   workout      its name, the sets so far as a ring, the set up next; a tap goes back in
 * Plain text and numbers, no media. Refreshed by the app whenever its state changes.
 */
class OpenGymTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val s = WearStore.peek(this)
        val c = Lang.wrap(this, s.settings.lang)
        val layout = layoutFor(c, s, requestParams.deviceConfiguration.screenWidthDp)
        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(RES_VERSION)
            .setFreshnessIntervalMillis(30 * 60 * 1000L)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
            .build()
        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion(RES_VERSION).build())

    companion object {
        private const val RES_VERSION = "1"
        private const val ACCENT = 0xFF30D158.toInt()
        private const val TEXT = 0xFFFFFFFF.toInt()
        // The quiet grey at 4.5:1 or better on black (the app's design review 1.4.5).
        private const val QUIET = 0xFFA1A1A6.toInt()
        private const val TRACK = 0xFF2C2C2E.toInt()

        private fun text(s: String, size: Float, color: Int, bold: Boolean = false, maxLines: Int = 1) =
            LayoutElementBuilders.Text.Builder()
                .setText(s)
                .setMaxLines(maxLines)
                .setFontStyle(FontStyle.Builder().setSize(sp(size)).setColor(argb(color))
                    .setWeight(if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL)
                    .build())
                .build()

        private fun spacer(h: Float) = LayoutElementBuilders.Spacer.Builder().setHeight(dp(h)).build()

        fun layoutFor(c: Context, s: SessionState, widthDp: Int): LayoutElementBuilders.LayoutElement {
            val open = ModifiersBuilders.Clickable.Builder()
                .setId("open")
                .setOnClick(ActionBuilders.LaunchAction.Builder()
                    .setAndroidActivity(ActionBuilders.AndroidActivity.Builder()
                        .setPackageName(c.packageName)
                        .setClassName(MainActivity::class.java.name)
                        .build())
                    .build())
                .build()
            val col = LayoutElementBuilders.Column.Builder()
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            val w = s.workout
            val box = LayoutElementBuilders.Box.Builder()
                .setWidth(expand()).setHeight(expand())
                .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(open).build())
            if (w != null) {
                val (done, total) = SessionCore.progress(s)
                val ring = LayoutElementBuilders.Arc.Builder()
                    .setAnchorAngle(androidx.wear.protolayout.DimensionBuilders.degrees(0f))
                    .setAnchorType(LayoutElementBuilders.ARC_ANCHOR_START)
                    .addContent(LayoutElementBuilders.ArcLine.Builder()
                        .setLength(androidx.wear.protolayout.DimensionBuilders.degrees(if (total > 0) 360f * done / total else 0f))
                        .setThickness(dp(6f)).setColor(argb(ACCENT)).build())
                    .build()
                val track = LayoutElementBuilders.Arc.Builder()
                    .addContent(LayoutElementBuilders.ArcLine.Builder()
                        .setLength(androidx.wear.protolayout.DimensionBuilders.degrees(360f))
                        .setThickness(dp(6f)).setColor(argb(TRACK)).build())
                    .build()
                val ei = s.entryIndex.coerceIn(0, (w.entries.size - 1).coerceAtLeast(0))
                val e = w.entries.getOrNull(ei)
                val si = SessionCore.setIndex(s, ei)
                col.addContent(text(w.name.ifBlank { c.getString(R.string.workout) }, 14f, QUIET))
                    .addContent(spacer(4f))
                    .addContent(text("$done/$total", 40f, TEXT, bold = true))
                    .addContent(text(c.getString(R.string.sets), 13f, QUIET))
                if (e != null && si != null) {
                    col.addContent(spacer(8f)).addContent(text(e.name, 15f, ACCENT, bold = true))
                }
                box.addContent(track).addContent(ring).addContent(col.build())
            } else {
                val weeks = s.streak?.weeks ?: 0
                val today = s.ready?.today
                col.addContent(text(c.getString(R.string.week_streak), 13f, QUIET))
                    .addContent(text(weeks.toString(), 44f, if (s.streak?.thisWeekDone == true) ACCENT else TEXT, bold = true))
                    .addContent(spacer(6f))
                when {
                    !s.synced -> col.addContent(text(c.getString(R.string.not_synced), 14f, QUIET, maxLines = 2))
                    today != null -> col.addContent(text(c.getString(R.string.today), 13f, QUIET))
                        .addContent(text(today.name, 16f, ACCENT, bold = true, maxLines = 2))
                    else -> col.addContent(text(c.getString(R.string.rest_day), 14f, QUIET, maxLines = 2))
                }
                box.addContent(col.build())
            }
            return box.build()
        }
    }
}
