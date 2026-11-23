package ch.duartesantos.opengym.wear

import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * The end of a workout as a struck medal (the Apple Watch summary, #1309; WatchCore Medal.swift is
 * the twin): what goes where on it, when each beat of its entrance lands, and how the crown's stops
 * move it. The screen (ui/SummaryMedal.kt) only draws. Lengths are face units, 200 across the
 * medal; angles are degrees clockwise from 3 o'clock.
 */
object Medal {
    /* ---------- the face ---------- */

    /** One notch on the rim per work set, up to this many; more would touch, and the legend still gives the true count. */
    const val MAX_NOTCHES = 48

    /** Each notch's angle, the first at 12 o'clock. */
    fun notchAngles(sets: Int): List<Double> {
        val n = min(max(sets, 0), MAX_NOTCHES)
        return (0 until n).map { -90.0 + it * 360.0 / n }
    }

    /** The circle the diamonds sit on, under the time. */
    const val GEM_RING = 50.0

    /** One diamond per record, 7 at most (the legend says how many), centred under the time; past 5 they are smaller and closer. */
    fun gems(records: Int): Pair<List<Double>, Double> {
        val shown = min(max(records, 0), 7)
        val step = if (shown <= 5) 27.0 else 21.0
        return (0 until shown).map { 90 + (it - (shown - 1) / 2.0) * step } to (if (shown <= 5) 8.6 else 7.0)
    }

    private fun rounded(v: Double) = if (v.isFinite()) Math.round(v).toInt() else 0

    /** The time stamped in the middle: minutes under an hour ("52"), else hours and minutes ("1:05"). */
    fun time(seconds: Double): Pair<String, Boolean> {
        val m = rounded(seconds / 60)
        if (m < 60) return max(m, 0).toString() to false
        return "${m / 60}:" + "%02d".format(m % 60) to true
    }

    /**
     * Whether a name can be set one letter at a time round the rim. Scripts whose letters join or
     * stack (Arabic, Hebrew, Indic, Thai) or run right to left would break apart, so they go straight.
     * So do combining marks and variation selectors: split by code point, the accent would drift off its letter.
     */
    fun arcable(s: String): Boolean = s.codePoints().allMatch { u ->
        u in 0x20..0x24F || u in 0x370..0x52F || u in 0x1E00..0x1FFF || u in 0x2000..0x206F ||
            u in 0x20A0..0x20CF || u in 0x2100..0x27BF || u in 0x3000..0x30FF || u in 0x3400..0x9FFF || u in 0xAC00..0xD7AF ||
            u in 0x1100..0x11FF || u in 0xFF00..0xFFEF || u in 0x1F000..0x1FAFF
    }

    /** "62.5" in the app's language ("62,5" in German), at most two decimals. */
    fun number(v: Double, locale: Locale): String =
        java.text.NumberFormat.getNumberInstance(locale).apply { minimumFractionDigits = 0; maximumFractionDigits = 2 }
            .format(if (v.isFinite()) v else 0.0)

    /** A hold's seconds as "1:15". */
    fun clock(seconds: Double): String {
        val s = max(rounded(seconds), 0)
        return "${s / 60}:" + "%02d".format(s % 60)
    }

    /* ---------- the entrance, in seconds from the moment it shows ---------- */

    /** The blank disc lands and the strike stamps the workout in. */
    const val STRIKE_AT = 0.3
    /** It has rocked to rest (the no-records day's "saved" beat). */
    const val SETTLED_AT = 1.15

    /** When each diamond drops into its setting. */
    fun gemTimes(records: Int): List<Double> = listOf(1.55, 1.9, 2.25, 2.33, 2.41, 2.49, 2.57).take(min(max(records, 0), 7))

    /** When the glint crosses the face; the turn that hints at the crown follows 0.95 s later. */
    fun glintAt(records: Int) = if (records > 0) 2.45 else 1.35

    /** Everything has landed: the entrance stops drawing frames. */
    fun entranceEnds(records: Int) = glintAt(records) + 0.95 + 0.7

    enum class Beat { STRIKE, SETTLED, RECORD }

    /**
     * The haptics of the entrance, on its own beats, in place of the old finish taps: the strike's
     * thud, then a success on a no-records day, or a rising tap per diamond (3 at most) on a records
     * day, where the strike already said "saved". 2 or at most 4 taps, 0.35 s apart.
     */
    fun beats(records: Int): List<Pair<Double, Beat>> {
        val rest = if (records > 0) gemTimes(records).take(3).map { it to Beat.RECORD } else listOf(SETTLED_AT to Beat.SETTLED)
        return listOf(STRIKE_AT to Beat.STRIKE) + rest
    }

    /* ---------- size and the crown ---------- */

    /**
     * The medal's width on the round screen: 78 % of it (150 dp on a 192 dp watch, 177 on a 227),
     * kept under the clock above it and clear of the rim below, and never wider than the screen less its margins.
     */
    fun diameter(width: Double, height: Double): Double = min(min(width, height) * 0.78, width - 24)

    /** How small the medal gets at the end stop, to leave room for the records and Done. */
    fun endScale(records: Int) = if (records > 0) 0.46 else 0.6

    /** The crown's stops: 0 the front, 1 the back, 2 the end (the medal small at the top), then one more per page of record bars and Done that runs past the bottom. */
    fun endStops(overflow: Double): Int = if (overflow > 1) ceil(overflow / 60).toInt() else 0

    /** Points scrolled at crown value `c`: none before the end stop, then evenly to the bottom. */
    fun scroll(c: Double, overflow: Double): Double {
        val n = endStops(overflow)
        if (n <= 0) return 0.0
        return min(overflow, max(0.0, c - 2) * overflow / n)
    }

    /** Which of the three marks by the crown is lit: the front, the back, or the end. */
    fun mark(c: Double) = if (c < 0.5) 0 else if (c < 1.5) 1 else 2

    /** A tap on the medal: on to the next stop, and from the end back to the front. */
    fun nextStop(c: Double): Double = if (c >= 1.999) 0.0 else min(2.0, floor(c + 0.001) + 1)
}
