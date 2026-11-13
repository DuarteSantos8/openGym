package ch.duartesantos.opengym.wear.ui

import android.icu.text.MeasureFormat
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import ch.duartesantos.opengym.wear.Metrics
import ch.duartesantos.opengym.wear.R
import ch.duartesantos.opengym.wear.WearStore
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

private val ZONE_COLOURS = listOf(Og.Teal, Og.Green, Og.Yellow, Og.Orange, Og.Red)

/** "1 hr 2 min 5 sec" for TalkBack, in the app's language; the parts that are zero are left out. */
private fun spokenTime(sec: Long, locale: java.util.Locale): String {
    val parts = listOf(sec / 3600 to MeasureUnit.HOUR, sec % 3600 / 60 to MeasureUnit.MINUTE, sec % 60 to MeasureUnit.SECOND)
        .filter { it.first > 0 }.ifEmpty { listOf(0L to MeasureUnit.SECOND) }
    return MeasureFormat.getInstance(locale, MeasureFormat.FormatWidth.WIDE).formatMeasures(*parts.map { Measure(it.first, it.second) }.toTypedArray())
}

/** Time in each heart-rate zone, Z5 on top to Z1, from the year of birth in the phone's profile. */
@Composable
internal fun ZonesPage() {
    val s by WearStore.state.collectAsState()
    val readings by WearStore.readingCount.collectAsState()   // every reading draws it again
    val dim = LocalAmbient.current
    val round = LocalRound.current
    val locale = LocalConfiguration.current.locales[0]
    val samples = remember(readings) { WearStore.heartSamples() }
    val maxHr = Metrics.age(s.settings.birthYear, java.time.Year.now().value)?.let(Metrics::maxHeartRate)
    val times = remember(readings, maxHr) { if (maxHr != null) Metrics.timeInZones(samples, maxHr) else List(5) { 0.0 } }
    val bands = remember(maxHr) { if (maxHr != null) Metrics.zoneBands(maxHr) else emptyList() }
    val now = remember(readings, maxHr) { if (maxHr != null) samples.lastOrNull()?.let { Metrics.zone(it.second.toDouble(), maxHr) } else null }
    val longest = times.maxOrNull() ?: 0.0
    val zonesTitle = stringResource(R.string.zones)
    CapText { BoxWithConstraints(Modifier.fillMaxSize().semantics { paneTitle = zonesTitle }) {
        val sz = maxWidth.value
        val top = if (round) 36f else 30f
        val bottom = sz - (if (round) 24f else 12f)
        val gap = 3f
        val rowH = (bottom - top - 4 * gap) / 5
        for (k in 0..4) {
            val z = 5 - k   // row k is Z5 .. Z1
            val y0 = top + k * (rowH + gap)
            val x0: Float; val x1: Float
            if (round) {
                val dy = max(kotlin.math.abs(y0 - sz / 2), kotlin.math.abs(y0 + rowH - sz / 2))
                val half = sqrt(max(0f, sz / 2 * (sz / 2) - dy * dy))
                x0 = max(8f, sz / 2 - half + 3); x1 = min(sz - 24, sz / 2 + half - 3)   // 3 dp inside the round edge
            } else { x0 = 10f; x1 = sz - 24 }
            val w = max(0f, x1 - x0)
            val col = ZONE_COLOURS[z - 1]
            val t = times[z - 1]
            val cur = z == now
            val shape = RoundedCornerShape((rowH * 0.3f).dp)
            val rowAlpha = (if (maxHr == null) 0.3f else if (now != null && !cur) 0.7f else 1f) * (if (dim) 0.6f else 1f)
            val track = if (dim) Modifier.border(1.dp, col.copy(alpha = 0.35f), shape) else Modifier.background(col.copy(alpha = 0.22f), shape)
            var m = Modifier.offset(x0.dp, y0.dp).width(w.dp).height(rowH.dp).alpha(rowAlpha).clip(shape).then(track)
            if (cur) m = m.border(2.dp, col, shape)
            if (maxHr == null) m = m.clearAndSetSemantics {}
            else {
                val band = bands[z - 1]
                val spoken = when (z) { 1 -> stringResource(R.string.band_under, band.hi!! + 1); 5 -> stringResource(R.string.band_over, band.lo!!)
                    else -> stringResource(R.string.band_to, band.lo!!, band.hi!!) }
                val desc = stringResource(R.string.zone_n, z) + ", " + spoken + ", " + spokenTime(t.toLong(), locale) +
                    (if (cur) ", " + stringResource(R.string.zone_current) else "")
                m = m.clearAndSetSemantics { contentDescription = desc }
            }
            Box(m) {
                if (maxHr != null && t > 0) Box(Modifier.fillMaxHeight().width(max(rowH * 0.6f, (w * (t / longest)).toFloat()).dp)
                    .background(col.copy(alpha = if (dim) 0.3f else 0.5f), shape))
                if (maxHr != null) {
                    val band = bands[z - 1]
                    val text = when (z) { 1 -> "<${band.hi!! + 1}"; 5 -> "${band.lo}+"; else -> "${band.lo}–${band.hi}" }
                    val big = if (cur) 15.sp else 13.sp; val small = if (cur) 14.sp else 12.sp
                    Row(Modifier.fillMaxSize().padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Z$z", style = Og.Number, fontWeight = FontWeight.Bold, fontSize = big, color = Og.Text, maxLines = 1, softWrap = false)
                        Spacer(Modifier.width(4.dp))
                        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                            Text(text, fontSize = small, fontWeight = FontWeight.Medium, color = Og.Text.copy(alpha = 0.85f), maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
                        }
                        Spacer(Modifier.width(6.dp))
                        Text(clock(t.toLong()), style = Og.Number, fontSize = big, color = Og.Text, maxLines = 1, softWrap = false)
                    }
                }
            }
        }
        if (maxHr == null) Box(Modifier.offset(x = (sz * 0.125f).dp, y = (if (round) 66 else 50).dp).width((sz * 0.75f).dp)
            .background(Og.Surface, RoundedCornerShape(16.dp)).padding(horizontal = 8.dp, vertical = 7.dp)
            .semantics(mergeDescendants = true) {}, contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.no_age_set), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Og.Text, textAlign = TextAlign.Center)
                Text(stringResource(R.string.add_birth_year), fontSize = 12.sp, color = Og.Label2, textAlign = TextAlign.Center, maxLines = 3)
            }
        }
    } }
}
