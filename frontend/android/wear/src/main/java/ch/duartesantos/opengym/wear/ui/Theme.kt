package ch.duartesantos.opengym.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import ch.duartesantos.opengym.wear.Hex
import ch.duartesantos.opengym.wear.WatchSettings

/*
 * openGym on the wrist, the same look as the Apple Watch (ios/App/Watch/Theme.swift): the app's
 * dark tokens (frontend/src/index.css), black page, grey surfaces one step up, and the accent the
 * app wears (the phone sends it, WatchSettings.accent/onAccent) only on the one thing to press.
 * Numbers big, tabular and bold; targets 48 dp or more.
 *
 * Always On (ambient): no lit fills, only their outlines, the text a little dimmer, nothing moves.
 */
object Og {
    /** The brand's green (#a3e635, a new profile's accent since 1.4.5), until the phone has said which one it wears. */
    val Green = Color(0xFFA3E635)
    /** The brand's near-black (#0c0e12): what reads on the green. */
    val OnGreen = Color(0xFF0C0E12)
    val Orange = Color(0xFFFF9F0A)
    val Red = Color(0xFFFF453A)
    val Yellow = Color(0xFFFFD60A)
    val Teal = Color(0xFF40C8E0)
    val Purple = Color(0xFFBF5AF2)
    val Warmup = Orange
    val Bg = Color(0xFF000000)
    /** --surface and --surface-2: a card, and what sits on a card or is pressed. */
    val Surface = Color(0xFF1C1C1E)
    val Surface2 = Color(0xFF2C2C2E)
    val Text = Color(0xFFFFFFFF)
    /** --label-2 and --label-3 (on black). */
    val Label2 = Color(0x99EBEBF5)
    val Label3 = Color(0x52EBEBF5)
    val Tap = 48.dp
    val Radius = 14.dp

    /** The numbers: bold, every digit the same width so they do not jump as they change. */
    val Number = TextStyle(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum", letterSpacing = (-0.5).sp)

    /** The effort colours, by the phone's band (lib/effort.js), as on the Apple Watch. */
    fun effortColor(band: Int, accent: Color) = listOf(Purple, Red, Orange, Yellow, accent, Teal)[band.coerceIn(0, 5)]
}

/** The accent and the ink on it, as the phone sends them; the brand's green and near-black until it has. */
data class Accent(val accent: Color = Og.Green, val on: Color = Og.OnGreen) {
    companion object {
        fun of(s: WatchSettings): Accent {
            val a = Hex.argb(s.accent) ?: return Accent()
            val on = Hex.argb(s.onAccent)?.let { Color(it) } ?: Color.Black   // a colour the phone chose: black reads on it as before
            return Accent(Color(a), on)
        }
    }
}

val LocalAccent = compositionLocalOf { Accent() }
/** Always On: outlines only, nothing animates. */
val LocalAmbient = compositionLocalOf { false }
/** Android's "Remove animations": short fades instead of slides, springs and scaling. */
val LocalReduceMotion = staticCompositionLocalOf { false }
/** A round screen (most Wear OS watches) or a square one. */
val LocalRound = staticCompositionLocalOf { true }

@Composable
fun OpenGymTheme(accent: Accent = Accent(), ambient: Boolean = false, reduceMotion: Boolean = false, round: Boolean = true,
                 content: @Composable () -> Unit) {
    val scheme = ColorScheme(
        primary = accent.accent,
        onPrimary = accent.on,
        primaryContainer = Og.Surface2,
        onPrimaryContainer = Og.Text,
        surfaceContainerLow = Og.Surface,
        surfaceContainer = Og.Surface,
        surfaceContainerHigh = Og.Surface2,
        onSurface = Og.Text,
        onSurfaceVariant = Og.Label2,
        background = Og.Bg,
        onBackground = Og.Text,
        error = Og.Red,
    )
    CompositionLocalProvider(
        LocalAccent provides accent, LocalAmbient provides ambient,
        LocalReduceMotion provides reduceMotion, LocalRound provides round,
    ) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

/**
 * A screen that can't scroll (the set, the rest, a hold) takes the watch's font size only up to
 * 1.12×, like the Apple Watch's `.dynamicTypeSize(...accessibility2)` there; lists take it all.
 */
@Composable
fun CapText(content: @Composable () -> Unit) {
    val d = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(d.density, d.fontScale.coerceAtMost(1.12f)), content = content)
}

/** 62.5 → "62.5", 60.0 → "60", 1.25 → "1.25". */
fun fmt(v: Double?): String = ch.duartesantos.opengym.wear.formatNumber(v ?: 0.0)

/** 3125 s → "52:05", 4000 s → "1:06:40". */
fun clock(sec: Long): String {
    val s = sec.coerceAtLeast(0)
    val h = s / 3600; val m = (s % 3600) / 60; val r = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, r) else "%d:%02d".format(m, r)
}
