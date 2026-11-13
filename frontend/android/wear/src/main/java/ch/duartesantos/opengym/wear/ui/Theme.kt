package ch.duartesantos.opengym.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.dynamicColorScheme

/*
 * openGym on the wrist: the app's dark look and lime accent (frontend/src/index.css), made for a
 * glance between sets. One thing in lime per screen, the thing to press; numbers big, tabular and
 * bold; secondary words in a grey that still reads at 4.5:1 on black; targets 48 dp or more.
 */
object Og {
    /** The colours a theme can swap: the app's own, or the watch face's (OpenGymTheme). */
    data class Palette(val lime: Color, val limeDim: Color, val onLime: Color, val bg: Color, val tile: Color, val tileHi: Color)
    val Stock = Palette(
        lime = Color(0xFF30D158), limeDim = Color(0xFF1F8A3A), onLime = Color(0xFF000000),
        bg = Color(0xFF000000), tile = Color(0xFF1C1C1E), tileHi = Color(0xFF2C2C2E),
    )
    internal var palette by mutableStateOf(Stock)

    val Lime get() = palette.lime
    val LimeDim get() = palette.limeDim
    val OnLime get() = palette.onLime
    val Warm = Color(0xFFFF9F0A)
    val Red = Color(0xFFFF453A)
    val Bg get() = palette.bg
    val Tile get() = palette.tile
    val TileHi get() = palette.tileHi
    val Text = Color(0xFFFFFFFF)
    val Quiet = Color(0xFFA1A1A6)
    val Tap = 48.dp

    /** The numbers: big, bold, every digit the same width so they do not jump as they change. */
    val Number = TextStyle(fontWeight = FontWeight.Bold, fontFeatureSettings = "tnum", letterSpacing = (-0.5).sp)
}

private val Scheme = ColorScheme(
    primary = Og.Stock.lime,
    onPrimary = Og.Stock.onLime,
    primaryContainer = Og.Stock.limeDim,
    onPrimaryContainer = Og.Text,
    surfaceContainerLow = Og.Stock.tile,
    surfaceContainer = Og.Stock.tile,
    surfaceContainerHigh = Og.Stock.tileHi,
    onSurface = Og.Text,
    onSurfaceVariant = Og.Quiet,
    background = Og.Stock.bg,
    onBackground = Og.Text,
    error = Og.Red,
)

/**
 * `dynamic`: the phone follows its wallpaper (Settings → Look & Home → Wallpaper colors, sent as
 * settings.dynamicColor), so the watch follows its watch face the same way. Wear OS 6 and later
 * make those colours; before that dynamicColorScheme has none and the app keeps its own. The page
 * stays black either way: it is an OLED screen, and the watch face's own background is black too.
 */
@Composable
fun OpenGymTheme(dynamic: Boolean = false, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val face = remember(dynamic, context) { if (dynamic) dynamicColorScheme(context) else null }
    val palette = face?.let {
        Og.Palette(
            lime = it.primary, limeDim = it.primaryContainer, onLime = it.onPrimary,
            bg = Og.Stock.bg, tile = it.surfaceContainer, tileHi = it.surfaceContainerHigh,
        )
    } ?: Og.Stock
    SideEffect { if (Og.palette != palette) Og.palette = palette }
    MaterialTheme(colorScheme = face?.copy(background = Og.Stock.bg) ?: Scheme, content = content)
}

/** 62.5 → "62.5", 60.0 → "60", 1.25 → "1.25". */
fun fmt(v: Double?): String {
    if (v == null) return "0"
    val r = Math.round(v * 100) / 100.0
    return if (r == Math.floor(r)) r.toLong().toString() else r.toString().trimEnd('0').trimEnd('.')
}

/** 3125 s → "52:05", 4000 s → "1:06:40". */
fun clock(sec: Long): String {
    val s = sec.coerceAtLeast(0)
    val h = s / 3600; val m = (s % 3600) / 60; val r = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, r) else "%d:%02d".format(m, r)
}
