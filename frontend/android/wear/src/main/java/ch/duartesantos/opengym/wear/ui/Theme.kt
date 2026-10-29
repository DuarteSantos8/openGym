package ch.duartesantos.opengym.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/*
 * openGym on the wrist: the app's dark look and lime accent (frontend/src/index.css), made for a
 * glance between sets. One thing in lime per screen, the thing to press; numbers big, tabular and
 * bold; secondary words in a grey that still reads at 4.5:1 on black; targets 48 dp or more.
 */
object Og {
    val Lime = Color(0xFF30D158)
    val LimeDim = Color(0xFF1F8A3A)
    val OnLime = Color(0xFF000000)
    val Warm = Color(0xFFFF9F0A)
    val Red = Color(0xFFFF453A)
    val Bg = Color(0xFF000000)
    val Tile = Color(0xFF1C1C1E)
    val TileHi = Color(0xFF2C2C2E)
    val Text = Color(0xFFFFFFFF)
    val Quiet = Color(0xFFA1A1A6)
    val Tap = 48.dp

    /** The numbers: big, bold, every digit the same width so they do not jump as they change. */
    val Number = TextStyle(fontWeight = FontWeight.Bold, fontFeatureSettings = "tnum", letterSpacing = (-0.5).sp)
}

private val Scheme = ColorScheme(
    primary = Og.Lime,
    onPrimary = Og.OnLime,
    primaryContainer = Og.LimeDim,
    onPrimaryContainer = Og.Text,
    surfaceContainerLow = Og.Tile,
    surfaceContainer = Og.Tile,
    surfaceContainerHigh = Og.TileHi,
    onSurface = Og.Text,
    onSurfaceVariant = Og.Quiet,
    background = Og.Bg,
    onBackground = Og.Text,
    error = Og.Red,
)

@Composable
fun OpenGymTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
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
