package ch.duartesantos.opengym.wear.ui

import android.graphics.Paint
import android.graphics.Typeface
import android.view.accessibility.AccessibilityManager
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import ch.duartesantos.opengym.wear.Haptics
import ch.duartesantos.opengym.wear.Medal
import ch.duartesantos.opengym.wear.R
import ch.duartesantos.opengym.wear.RecordLine
import ch.duartesantos.opengym.wear.WearStore
import ch.duartesantos.opengym.wear.WorkoutSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * The end of a workout, struck as a medal: the Apple Watch's summary (#1309, ios/App/Watch/SummaryMedal.swift),
 * on the round Wear screen.
 *
 *   0.0 s    a blank disc falls onto the glass (scale 1.5 to 1, speeding up)
 *   0.3 s    the strike: the workout stamps into it, a shock ring, sparks, a 4 % squash (a thud)
 *   to 1.45  it rocks to rest like a coin on a table, the light sliding over it; a light runs round
 *            the rim, one notch per set
 *   1.55 on  a records day (gold): a diamond drops into its setting per record (a rising tap each)
 *            a day without records (steel): the volume is stamped in, a success tap at 1.15
 *   then     one glint, and a small turn that says the crown spins it
 *
 * The crown (one value, stops at whole numbers): 0 the front, 1 the back (sets, volume, heart rate,
 * calories, the date) with its edge on the way, 2 home to the front, small at the top, with the
 * record bars and Done under it, then a page at a time down to Done. A tap on the medal goes to the
 * next stop; a swipe turns it too. Always On: the front as a line engraving, nothing moves. Remove
 * animations: a fade, and the crown cross-fades the faces instead of spinning them.
 *
 * Round screen: the medal is 78 % of it, centred under the clock, which carries the "Saved" status
 * (OgTimeText); the record bars are 80 % wide and Done narrower, so no corner clips them. Medal
 * lengths are face units, 200 across (Medal.kt holds the layout rules). Not carried over: the
 * entrance's blur (Remove animations aside, API 31+).
 */

/** The words on the medal, worked out once per summary. */
private class Words(
    val name: String, val arcable: Boolean, val time: String, val timeLabel: String, val legend: String,
    val sets: String, val setsWord: String, val volume: String, val unit: String, val avgLabel: String, val kcalLabel: String,
    val hrAvg: String?, val peak: String?, val kcal: String?, val kcalOn: Boolean, val date: String?, val reps: String, val spoken: String,
)

/** Where the medal sits on this screen (dp), and how the crown's stops map to points. */
private class Lay(val w: Double, val h: Double, records: Int, restHeight: Double) {
    val d = Medal.diameter(w, h)
    val u = d / 200
    /** Centred under the clock's 30 dp. */
    val cy0 = 30 + (h - 30) / 2 - 2
    val endScale = Medal.endScale(records)
    val cyEnd = 29 + d * endScale / 2
    val restTop = cyEnd + d * endScale / 2 + (if (records > 0) 9 else 12)
    /** Done stops 18 dp above the rim's bottom: the screen is round. */
    val overflow = if (restHeight > 0) max(0.0, restTop + restHeight + 18 - h) else 0.0
    val cMax = (2 + Medal.endStops(overflow)).toFloat()
    private val page = if (cMax > 2) overflow / (cMax - 2) else 60.0
    fun points(c: Double) = if (c <= 2) c * 60 else 120 + (c - 2) * page
    fun c(points: Double) = if (points <= 120) points / 60 else 2 + (points - 120) / page
}

/* ---------- the metals ---------- */

private fun rgb(hex: Long, a: Float = 1f) = Color(((hex shr 16) and 0xff).toInt(), ((hex shr 8) and 0xff).toInt(), (hex and 0xff).toInt(), (a * 255).roundToInt())

/** Gold for a records day, forged steel without; never the accent. Ink on the darkest part of each field. Always On draws in `aod` on black. */
private class Metal(val hi: Color, val lt: Color, val md: Color, val dk: Color, val sh: Color, val ink: Color, val rimDark: Color,
                    val glow: Color, val aod: Color, val aodLine: Color) {
    /** Two highlight lobes as a conic gradient starting at `deg` (0 = up, clockwise, as CSS); drawn rotated into place. */
    private fun conic(stops: List<Pair<Color, Float>>) = Brush.sweepGradient(*stops.map { it.second to it.first }.toTypedArray(), center = Offset.Zero)
    fun rim() = conic(listOf(hi to 0f, md to .14f, sh to .28f, md to .42f, hi to .5f, md to .64f, sh to .78f, md to .92f, hi to 1f))
    fun bevel() = conic(listOf(hi to 0f, sh to .25f, hi to .5f, sh to .75f, hi to 1f))
    fun field() = conic(listOf(lt to 0f, md to .2f, dk to .3f, md to .4f, lt to .5f, md to .7f, dk to .8f, md to .9f, lt to 1f))

    companion object {
        val gold = Metal(rgb(0xfff3cf), rgb(0xf2d791), rgb(0xd9b45f), rgb(0xbb9545), rgb(0x7a5a1e), rgb(0x2a1c07), rgb(0x5b4214),
            rgb(0xffba40, 0.22f), rgb(0xd6b25e), rgb(0xd6b25e, 0.5f))
        val steel = Metal(rgb(0xf4f7fb), rgb(0xd4dae1), rgb(0xb0b8c2), rgb(0x949da8), rgb(0x4f5762), rgb(0x13171c), rgb(0x30363e),
            rgb(0xa0c3eb, 0.17f), rgb(0xb4bcc6), rgb(0xb4bcc6, 0.45f))
    }
}

private fun clamp(x: Double, a: Double = 0.0, b: Double = 1.0) = min(b, max(a, x))
private fun smooth(x: Double): Double { val y = clamp(x); return y * y * (3 - 2 * y) }
private fun lerp(a: Double, b: Double, p: Double) = a + (b - a) * p

/** The coin's settle (Euler's disk): the tilt dies away while the wobble speeds up. The wobble's angle, 240 steps a second. */
private val wobble: DoubleArray = run {
    val out = DoubleArray(401)
    var psi = 0.0
    for (i in 0..400) {
        val a = 8 * exp(-i / 240.0 * 3.4)
        out[i] = psi
        psi += min(44.0, 7 * sqrt(8 / max(a, 0.05))) / 240
    }
    out
}

/** The medal's thickness, for its edge while it spins. */
private const val THICKNESS = 14.0

/** Everything drawn at one moment, from the crown's value and the entrance's clock. */
private class Frame(
    val fall: Double, val opacity: Double, val struck: Double, val tilt: Double, val psi: Double, val ring: Double, val sparks: Double,
    val halo: Double, val glint: Double, val marks: Double, val p: Double, val scroll: Double, val th: Double, val scale: Double,
    val cy: Double, val light: Double, val fx: Double, val fade: Double, val restY: Double,
)

private fun frameOf(c: Double, t: Double, lay: Lay, records: Int, reduce: Boolean, dimmed: Boolean): Frame {
    var fall = 1.0; var opacity = 1.0; var struck = 1.0; var tilt = 0.0; var psi = 0.0
    var ring = -1.0; var sparks = -1.0; var halo = 0.55; var glint = -1.0; var peek = 0.0; var marks = 1.0
    val glintAt = Medal.glintAt(records); val peekAt = glintAt + 0.95
    if (dimmed) halo = 0.0
    else if (reduce) { opacity = clamp(t / 0.3); halo = 0.55 * opacity; marks = opacity }
    else {
        if (t < Medal.STRIKE_AT) {
            val p = t / Medal.STRIKE_AT
            fall = 1.5 - 0.5 * p.pow(2.2); opacity = clamp(t / 0.12); struck = 0.0; halo = 0.0
        } else {
            val v = t - Medal.STRIKE_AT
            fall = 1 - 0.04 * exp(-v * 12) * cos(v * 38)
            struck = clamp(v / 0.09)
            tilt = if (v < 1.4) 8 * exp(-v * 3.4) else 0.0
            psi = wobble[min(wobble.size - 1, (v * 240).roundToInt())]
            if (v < 0.45) ring = v / 0.45
            if (v < 0.5) sparks = v / 0.5
            halo = 0.55 + 0.45 * exp(-v * 5)
        }
        if (t >= glintAt && t < glintAt + 0.7) glint = (t - glintAt) / 0.7
        // A hint that it turns, only while the crown is untouched.
        if (t > peekAt && t < peekAt + 0.7 && c == 0.0) peek = 16 * sin(PI * (t - peekAt) / 0.7)
        marks = clamp((t - 2.2) / 0.3)
    }
    val p = smooth(c - 1)
    val scroll = Medal.scroll(c, lay.overflow)
    val th = if (reduce || dimmed) 0.0 else PI * min(c, 2.0) + peek * PI / 180
    val sn = sin(th)
    return Frame(fall, opacity, struck, tilt, psi, ring, sparks, halo, glint, marks, p, scroll, th,
        fall * lerp(1.0, lay.endScale, p), lerp(lay.cy0, lay.cyEnd, p) - scroll,
        300 + th * 90 / PI + 28 * (tilt / 8) * sin(psi), THICKNESS / 2 * sn, 1 - smooth(c) + smooth(c - 1),
        lerp(lay.h + 8, lay.restTop, p) - scroll)
}

/* ---------- the screen ---------- */

/**
 * "Workout saved", as a medal. Done ignores taps for its first second: the thumb on Finish is still
 * on the glass. It takes the crown as soon as it opens: it replaces the workout, whose crown
 * control is gone.
 */
@Composable
fun SummaryScreen(sum: WorkoutSummary) {
    val ambient = LocalAmbient.current
    val reduce = LocalReduceMotion.current
    val ctx = LocalContext.current
    val locale = LocalConfiguration.current.locales[0]
    val density = LocalDensity.current
    val st by WearStore.state.collectAsState()
    val scope = rememberCoroutineScope()
    val records = sum.prs.size
    val shownAt = remember { System.currentTimeMillis() }
    val words = rememberWords(sum, locale, st.settings.show?.showKcal != false)
    val metal = if (records > 0) Metal.gold else Metal.steel
    var restPx by remember { mutableIntStateOf(0) }
    val c = remember { Animatable(0f) }
    // The entrance's clock: from the first moment the medal is seen (not while the wrist is down).
    val t = remember { mutableFloatStateOf(if (ambient) 99f else 0f) }
    var played by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val talkBack = remember { (ctx.getSystemService(android.content.Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager)?.isTouchExplorationEnabled == true }
    val hrIn by animateFloatAsState(if (sum.hrAvg != null) 1f else 0f, tween(350), label = "hr")
    val kcalIn by animateFloatAsState(if (sum.kcal != null) 1f else 0f, tween(350), label = "kcal")
    val spring = if (reduce) tween<Float>(300) else spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val lay = Lay(maxWidth.value.toDouble(), maxHeight.value.toDouble(), records, with(density) { restPx.toDp().value.toDouble() })
        val frame by remember(lay, reduce, ambient) { derivedStateOf { frameOf(c.value.toDouble(), t.floatValue.toDouble(), lay, records, reduce, ambient) } }

        LaunchedEffect(Unit) { focus.requestFocus() }
        // Wrist down: back to the front, nothing moves. Up again for the first time: the entrance plays now.
        LaunchedEffect(ambient) {
            if (ambient) { t.floatValue = 99f; c.snapTo(0f); return@LaunchedEffect }
            if (played) return@LaunchedEffect
            played = true
            t.floatValue = 0f // woken from Always On: the clock sat at the end, the entrance starts now
            val demo = WearStore.demoScreen
            if (demo == "summary-back") c.snapTo(1f)
            if (demo == "summary-records") c.snapTo(2f)
            launch {
                var prev = 0.0
                for ((at, beat) in Medal.beats(records)) { delay(((at - prev) * 1000).toLong()); prev = at; Haptics.medal(ctx, beat, records) }
            }
            val end = if (reduce) 0.6f else Medal.entranceEnds(records).toFloat()
            val t0 = withFrameNanos { it }
            while (t.floatValue < end) withFrameNanos { n -> t.floatValue = (n - t0) / 1e9f }
            t.floatValue = 99f
        }
        // TalkBack: open at the end, where the records and Done are on screen (and the shots' end screen).
        LaunchedEffect(talkBack, lay.cMax, ambient) { if (!ambient && (talkBack || WearStore.demoScreen == "summary-end")) c.snapTo(lay.cMax) }

        // The drag handler outlives a remeasure that keeps cMax: it reads the latest layout.
        val cur by rememberUpdatedState(lay)

        fun turn(to: Float) { scope.launch { c.animateTo(to.coerceIn(0f, lay.cMax), spring) } }

        Box(
            Modifier.fillMaxSize()
                .crown(focus) { step -> turn(c.targetValue.roundToInt() + step.toFloat()) }
                .pointerInput(lay.cMax) {
                    // A swipe turns it like the crown: the medal follows the finger, then settles on the nearest stop, one at most.
                    var from = 0f
                    var moved = 0f
                    detectVerticalDragGestures(
                        onDragStart = { from = c.value; moved = 0f },
                        onDragEnd = {
                            val a = from.roundToInt()
                            val aim = cur.c(cur.points(from.toDouble()) - moved / density.density).roundToInt()
                            turn(aim.coerceIn(max(a - 1, 0), min(a + 1, cur.cMax.toInt())).toFloat())
                        },
                        onVerticalDrag = { _, dy ->
                            moved += dy
                            scope.launch { c.snapTo(cur.c(cur.points(from.toDouble()) - moved / density.density).toFloat().coerceIn(0f, cur.cMax)) }
                        },
                    )
                },
        ) {
            if (!ambient) Glow(lay, metal) { frame }
            if (!ambient) ShockAndSparks(lay, metal) { frame }
            MedalDisc(lay, metal, sum, words, records, ambient, reduce, hrIn, kcalIn, { frame }, { t.floatValue.toDouble() },
                onTap = { turn(Medal.nextStop(c.value.toDouble()).toFloat()) })
            Rest(lay, metal, sum, words, ambient, shownAt, { frame }) { restPx = it }
            // Scrolled: nothing runs under the clock, then a soft edge.
            Box(Modifier.fillMaxWidth().height(42.dp).graphicsLayer { alpha = clamp(frame.scroll / 8).toFloat() }
                .background(Brush.verticalGradient(0.67f to Color.Black, 1f to Color.Transparent)))
            if (!ambient) StopMarks({ frame }) { c.value.toDouble() }
        }
    }
}

@Composable
private fun rememberWords(sum: WorkoutSummary, locale: Locale, showKcal: Boolean): Words {
    val k = sum.prs.size
    val up = { s: String -> s.uppercase(locale) }
    val bpm = stringResource(R.string.bpm, "").trim()
    val sets = java.text.NumberFormat.getIntegerInstance(locale).format(sum.sets)
    val volume = java.text.NumberFormat.getIntegerInstance(locale).format(Math.round(sum.volume))
    val time = sum.duration?.let { Medal.time(it) }
    val setsLine = stringResource(R.string.n_sets, sets)
    val legend = if (k == 0) setsLine else if (k == 1) stringResource(R.string.new_record) else "$k " + stringResource(R.string.records)
    val setsWord = stringResource(R.string.sets)
    val timeLabel = up(if (time == null) setsWord else if (time.second) stringResource(R.string.hours) else stringResource(R.string.min_minutes))
    val max = stringResource(R.string.max)
    val kcalValue = sum.kcal?.takeIf { showKcal }
    val date = sum.endedAt?.let { android.icu.text.DateFormat.getInstanceForSkeleton("dMMMy", locale).format(java.util.Date(it.toLong())) }
    val saved = stringResource(if (sum.endedOnPhone) R.string.ended_on_phone else R.string.workout_saved)
    val hrLine = if (sum.hrAvg != null && sum.hrMax != null) stringResource(R.string.heart_rate) + " " + stringResource(R.string.hr_avg_max, sum.hrAvg, sum.hrMax) else null
    val dur = sum.duration?.let { duration(it, locale) }
    val spoken = listOfNotNull(saved, sum.name, dur, if (k == 0) setsLine else "$legend: " + sum.prs.joinToString(", "),
        if (k > 0) setsLine else null, "$volume ${sum.unit}", hrLine, kcalValue?.let { "$it kcal" }, date).joinToString(", ")
    val avg = stringResource(R.string.avg)
    val reps = stringResource(R.string.reps).lowercase(locale)
    return remember(sum, locale, showKcal, spoken) {
        Words(
            name = up(sum.name), arcable = Medal.arcable(sum.name), time = time?.first ?: sets, timeLabel = timeLabel, legend = up(legend),
            sets = sets, setsWord = up(setsWord), volume = volume, unit = up(sum.unit), avgLabel = up("$avg $bpm"), kcalLabel = "KCAL",
            hrAvg = sum.hrAvg?.toString(), peak = sum.hrMax?.let { up("$max $it $bpm") }, kcal = kcalValue?.toString(), kcalOn = showKcal,
            date = date?.let(up), reps = reps, spoken = spoken,
        )
    }
}

/* ---------- around the medal ---------- */

@Composable
private fun Glow(lay: Lay, metal: Metal, frame: () -> Frame) {
    Canvas(Modifier.fillMaxSize().graphicsLayer { alpha = (frame().halo * (1 - frame().p * 0.7)).toFloat() }) {
        val f = frame()
        val r = (lay.d * 0.875 * f.scale).dp.toPx()
        val c = Offset(size.width / 2, f.cy.dp.toPx())
        drawCircle(Brush.radialGradient(listOf(metal.glow, metal.glow.copy(alpha = 0f)), center = c, radius = r), r, c)
    }
}

/** The strike's shock ring and ten sparks thrown off the rim. */
@Composable
private fun ShockAndSparks(lay: Lay, metal: Metal, frame: () -> Frame) {
    Canvas(Modifier.fillMaxSize()) {
        val f = frame()
        val c = Offset(size.width / 2, lay.cy0.dp.toPx())
        val d = lay.d.dp.toPx()
        if (f.ring >= 0) drawCircle(metal.lt.copy(alpha = (0.7 * (1 - f.ring)).toFloat()), d / 2 * (1 + 0.3f * f.ring.toFloat()), c, style = Stroke(1.4.dp.toPx()))
        if (f.sparks >= 0) for (i in 0 until 10) {
            val a = (i * 36 + 13 * (i % 3)) * PI / 180
            val r = d / 2 + 4.dp.toPx() + (10 + 12 * (i % 3)).dp.toPx() * (1 - (1 - f.sparks).pow(2)).toFloat()
            val p = Offset(c.x + r * cos(a).toFloat(), c.y + r * sin(a).toFloat())
            drawCircle(metal.hi.copy(alpha = (0.3 * (1 - f.sparks)).toFloat()), 3.dp.toPx(), p)
            drawCircle(metal.hi.copy(alpha = (1 - f.sparks).toFloat()), 1.1.dp.toPx(), p)
        }
    }
}

/** Which stop the crown is at: the front, the back, the end. */
@Composable
private fun StopMarks(frame: () -> Frame, c: () -> Double) {
    val on by remember { derivedStateOf { Medal.mark(c()) } }
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = frame().marks.toFloat() }, contentAlignment = Alignment.CenterEnd) {
        Column(Modifier.padding(end = 6.dp).clearAndSetSemantics {}, verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(3.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            for (i in 0..2) Box(Modifier.width(4.dp).height(if (i == on) 10.dp else 4.dp).clip(RoundedCornerShape(2.dp))
                .background(Color.White.copy(alpha = if (i == on) 1f else 0.3f)))
        }
    }
}

/* ---------- the medal ---------- */

@Composable
private fun MedalDisc(
    lay: Lay, metal: Metal, sum: WorkoutSummary, words: Words, records: Int, dimmed: Boolean, reduce: Boolean, hrIn: Float, kcalIn: Float,
    frame: () -> Frame, clock: () -> Double, onTap: () -> Unit,
) {
    val d = lay.d.dp
    Box(
        Modifier
            .offset { IntOffset(((lay.w / 2 - lay.d / 2).dp.roundToPx()), ((lay.cy0 - lay.d / 2).dp.roundToPx())) }
            .size(d)
            .graphicsLayer {
                val f = frame()
                translationY = ((f.cy - lay.cy0).dp.toPx()).toFloat()
                scaleX = f.scale.toFloat(); scaleY = f.scale.toFloat()
                alpha = f.opacity.toFloat()
                cameraDistance = 12 * density
                rotationX = (f.tilt * cos(f.psi)).toFloat(); rotationY = (f.tilt * sin(f.psi)).toFloat()
            }
            .semantics(mergeDescendants = true) { contentDescription = words.spoken }
            .clickable(interactionSource = null, indication = null, onClick = onTap),
    ) {
        if (!reduce && !dimmed) Edge(lay, metal, sum.sets) { frame() }
        Face(front = true, lay, metal, sum, words, records, dimmed, reduce, hrIn, kcalIn, frame, clock)
        Face(front = false, lay, metal, sum, words, records, dimmed, reduce, hrIn, kcalIn, frame, clock)
    }
}

/** One face: its metal, notches, engraving, and on the front the diamonds and the glint. */
@Composable
private fun Face(
    front: Boolean, lay: Lay, metal: Metal, sum: WorkoutSummary, words: Words, records: Int, dimmed: Boolean, reduce: Boolean,
    hrIn: Float, kcalIn: Float, frame: () -> Frame, clock: () -> Double,
) {
    val d = lay.d.dp
    Box(
        Modifier.size(d).graphicsLayer {
            val f = frame()
            val cs = cos(f.th)
            // Reduce motion: the faces cross-fade where they are; else each squeezes to its edge as it turns away.
            val share = if (front) f.fade else 1 - f.fade
            val visible = if (reduce) share else if ((cs > 0) == front) 1.0 else 0.0
            alpha = visible.toFloat()
            scaleX = if (reduce) 1f else max(if (front) cs else -cs, 0.001).toFloat()
            translationX = if (reduce) 0f else ((if (front) 1 else -1) * f.fx * lay.u).dp.toPx().toFloat()
        },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val f = frame()
            val light = f.light + if (front) 0.0 else 40.0
            if (dimmed) drawAodFace(metal)
            else drawMetalFace(metal, light)
        }
        if (!dimmed) Canvas(Modifier.fillMaxSize().graphicsLayer()) { drawGrain(front) }
        Canvas(Modifier.fillMaxSize().graphicsLayer { alpha = frame().struck.toFloat() }) { drawNotches(sum.sets, metal, dimmed) }
        if (!dimmed) Canvas(Modifier.fillMaxSize().graphicsLayer { alpha = frame().struck.toFloat() }) {
            drawNotchLights(sum.sets, if (front && !reduce) min(clock(), 3.0) else 99.0)
        }
        Canvas(Modifier.fillMaxSize().graphicsLayer {
            val f = frame()
            alpha = f.struck.toFloat(); val s = (1 + 0.08 * (1 - f.struck)).toFloat(); scaleX = s; scaleY = s
        }) { stamp(if (front) frontMarks(words, records, dimmed) else backMarks(words), metal, dimmed) }
        if (front) {
            if (records > 0) Canvas(Modifier.fillMaxSize()) { drawGems(records, min(clock(), 4.0), metal, dimmed, reduce) }
            Canvas(Modifier.fillMaxSize()) { frame().glint.takeIf { it >= 0 }?.let { drawGlint(it) } }
        } else {
            // Heart rate and calories reach the back a moment late: each fills its own engraved recess, and the peak fades in on the bottom arc.
            Canvas(Modifier.fillMaxSize()) { drawRecesses(metal, hrIn, kcalIn.takeIf { words.kcalOn }, dimmed) }
            if (words.hrAvg != null) Canvas(Modifier.fillMaxSize().graphicsLayer { alpha = hrIn }) {
                stamp(listOf(Mark.Text(words.hrAvg, 24.0, -0.4, -4.0, 22.0, Align.TRAILING, valueWidth(22.0), mono = true)) +
                    (words.peak?.let { listOf(Mark.Arc(it, 16.0, 1.4, 79.0, false, 190.0)) } ?: emptyList()), metal, dimmed)
            }
            if (words.kcal != null) Canvas(Modifier.fillMaxSize().graphicsLayer { alpha = kcalIn }) {
                stamp(listOf(Mark.Text(words.kcal, 24.0, -0.4, -4.0, 48.0, Align.TRAILING, valueWidth(48.0), mono = true)), metal, dimmed)
            }
        }
        // Turning away it goes darker, as a coin does.
        Canvas(Modifier.fillMaxSize()) {
            val cs = abs(cos(frame().th)).toFloat()
            if (!reduce && !dimmed && cs < 1f) drawCircle(Color.Black.copy(alpha = 0.4f * (1 - cs)), size.width / 2)
        }
    }
}

/** Room on the field for a row's number (right-aligned at -4) and its label (from 2), at that baseline. */
private fun halfChord(y: Double) = sqrt(84.0 * 84 - (y - 8) * (y - 8)) - 6
private fun valueWidth(y: Double) = halfChord(y) - 4
private fun labelWidth(y: Double) = halfChord(y) - 2

private fun frontMarks(w: Words, records: Int, dimmed: Boolean): List<Mark> {
    val m = mutableListOf(
        Mark.Ring, Mark.Name(w.name, w.arcable), Mark.Arc(w.legend, 16.0, 1.6, 79.0, false, 190.0),
        Mark.Text(w.time, if (w.time.length > 2) 52.0 else 62.0, -1.5, 0.0, 12.0, Align.CENTER, 132.0, mono = true, opacity = if (dimmed) 0.8f else 1f),
        Mark.Text(w.timeLabel, 16.0, 2.0, 0.0, 30.0, Align.CENTER, 110.0),
    )
    if (records == 0) {
        m += Mark.Rule(38.5, 13.0)
        m += Mark.Text("${w.volume} ${w.unit}", 16.5, 0.4, 0.0, 56.0, Align.CENTER, 120.0, mono = true)
    }
    return m
}

private fun backMarks(w: Words): List<Mark> {
    val m = mutableListOf<Mark>()
    w.date?.let { m += Mark.Arc(it, 16.0, 1.6, 70.0, true, 200.0) }
    val rows = listOf(Triple(-30.0, w.sets, w.setsWord), Triple(-4.0, w.volume, w.unit), Triple(22.0, null, w.avgLabel)) +
        if (w.kcalOn) listOf(Triple(48.0, null, w.kcalLabel)) else emptyList()
    for ((y, value, label) in rows) {
        if (value != null) m += Mark.Text(value, 24.0, -0.4, -4.0, y, Align.TRAILING, valueWidth(y), mono = true)
        m += Mark.Text(label, 16.0, 0.4, 2.0, y, Align.LEADING, labelWidth(y))
    }
    return m
}

/* ---------- the metal ---------- */

private fun DrawScope.drawAodFace(metal: Metal) {
    val r = size.width / 2
    drawCircle(metal.aodLine, r - 0.55.dp.toPx(), style = Stroke(1.1.dp.toPx()))
    drawCircle(metal.aodLine, r * 0.84f - 0.35.dp.toPx(), style = Stroke(0.7.dp.toPx()))
}

private fun DrawScope.drawMetalFace(metal: Metal, light: Double) {
    val r = size.width / 2
    withTransform({ translate(r, r) }) {
        rotate((light + 5).toFloat(), Offset.Zero) { drawCircle(metal.rim(), r, Offset.Zero) }
        rotate((light + 110).toFloat(), Offset.Zero) { drawCircle(metal.bevel(), r * 0.88f, Offset.Zero) }
        rotate((light - 90).toFloat(), Offset.Zero) { drawCircle(metal.field(), r * 0.84f, Offset.Zero) }
        // The field sits below the bevel: a dark rim and a soft shadow from the top edge.
        drawCircle(Color.Black.copy(alpha = 0.35f), r * 0.84f - 0.3f, Offset.Zero, style = Stroke(0.6f))
        drawCircle(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.3f), 0.5f to Color.Transparent, startY = -r * 0.84f, endY = 0f),
            r * 0.84f - 0.9f * (r / 100), Offset.Zero, style = Stroke(1.8f * (r / 100)))
    }
}

/** Brushed metal on the front (a sunburst of hairline spokes), circular graining on the back. */
private fun DrawScope.drawGrain(front: Boolean) {
    val r = size.width / 2 * 0.84f
    val c = Offset(size.width / 2, size.height / 2)
    val u = size.width / 200
    val clip = Path().apply { addOval(androidx.compose.ui.geometry.Rect(c, r)) }
    clipPath(clip) {
        if (front) {
            val light = Path(); val dark = Path()
            val step = 1.4f
            val box = androidx.compose.ui.geometry.Rect(c, r)
            for (i in 0 until (360 / step).toInt()) {
                val a = i * step
                light.moveTo(c.x, c.y); light.arcTo(box, a, step / 2, false); light.close()
                dark.moveTo(c.x, c.y); dark.arcTo(box, a + step / 2, step / 2, false); dark.close()
            }
            drawPath(light, Color.White.copy(alpha = 0.075f))
            drawPath(dark, Color.Black.copy(alpha = 0.05f))
        } else {
            val light = Path(); val dark = Path()
            var k = 0
            while (k * 1.5f * u < r) {
                light.addOval(androidx.compose.ui.geometry.Rect(c, (k * 1.5f + 0.275f) * u))
                dark.addOval(androidx.compose.ui.geometry.Rect(c, (k * 1.5f + 1.025f) * u))
                k++
            }
            drawPath(light, Color.White.copy(alpha = 0.09f), style = Stroke(0.55f * u))
            drawPath(dark, Color.Black.copy(alpha = 0.07f), style = Stroke(0.95f * u))
        }
    }
}

private fun DrawScope.face(block: DrawScope.() -> Unit) {
    val u = size.width / 200
    withTransform({ translate(size.width / 2, size.height / 2); scale(u, u, Offset.Zero) }) { block() }
}

/** A V cut into the rim per set (48 at most), with a lit edge. */
private fun DrawScope.drawNotches(sets: Int, metal: Metal, aod: Boolean) = face {
    val cuts = Path()
    val w = 1.7 * PI / 180; val w2 = 0.45 * PI / 180
    for (deg in Medal.notchAngles(sets)) {
        val a = deg * PI / 180
        fun p(r: Double, b: Double) = Offset((r * cos(b)).toFloat(), (r * sin(b)).toFloat())
        cuts.moveTo(p(100.5, a - w)); cuts.lineTo(p(100.5, a + w)); cuts.lineTo(p(89.0, a + w2)); cuts.lineTo(p(89.0, a - w2)); cuts.close()
    }
    if (aod) drawPath(cuts, metal.aodLine, style = Stroke(1f)) else drawPath(cuts, metal.ink.copy(alpha = 0.6f))
}

private fun Path.moveTo(o: Offset) = moveTo(o.x, o.y)
private fun Path.lineTo(o: Offset) = lineTo(o.x, o.y)

/** The notches' lit edges. From 0.5 s a light runs once round the rim, lighting one per set. */
private fun DrawScope.drawNotchLights(sets: Int, t: Double) = face {
    val angles = Medal.notchAngles(sets)
    val w = 1.7 * PI / 180; val w2 = 0.45 * PI / 180
    for ((i, deg) in angles.withIndex()) {
        val a = deg * PI / 180
        val at = 0.5 + i * 0.6 / angles.size
        val o = if (t < at) 0.2 else 0.45 + 0.55 * exp(-(t - at) * 7)
        drawLine(Color.White.copy(alpha = o.toFloat()), Offset((100 * cos(a + w)).toFloat(), (100 * sin(a + w)).toFloat()),
            Offset((89.5 * cos(a + w2)).toFloat(), (89.5 * sin(a + w2)).toFloat()), 0.7f)
    }
}

/** The back's two empty slots for heart rate and calories, until the readings fill them. */
private fun DrawScope.drawRecesses(metal: Metal, hr: Float, kcal: Float?, aod: Boolean) = face {
    // kcal null: calories are switched off, no slot for them.
    for ((y, filled) in listOfNotNull(3.5f to hr, kcal?.let { 29.5f to it })) {
        val a = 1 - filled
        if (aod) drawRoundRect(metal.aodLine.copy(alpha = metal.aodLine.alpha * a), Offset(-38f, y), Size(32f, 20f), CornerRadius(5f), Stroke(0.7f))
        else drawRoundRect(metal.ink.copy(alpha = 0.14f * a), Offset(-38f, y), Size(32f, 20f), CornerRadius(5f))
    }
}

/** One diamond per record, each dropping into its setting with a small overshoot and a twinkle. */
private fun DrawScope.drawGems(count: Int, t: Double, metal: Metal, aod: Boolean, reduce: Boolean) = face {
    val (angles, r) = Medal.gems(count)
    val times = Medal.gemTimes(count)
    for ((j, deg) in angles.withIndex()) {
        val a = deg * PI / 180
        val x = (Medal.GEM_RING * cos(a)).toFloat(); val y = (Medal.GEM_RING * sin(a)).toFloat()
        val at = if (reduce) 0.3 else times[j]
        val q = clamp((t - at) / 0.28)
        val scale = if (reduce || q >= 1) 1.0 else 1 + 0.75 * (1 - q).pow(3) - 0.07 * sin(PI * q)
        val alpha = if (reduce) clamp((t - at) / 0.3) else clamp(q * 3)
        if (alpha > 0) withTransform({ translate(x, y); scale(scale.toFloat(), scale.toFloat(), Offset.Zero) }) { drawGem(r, metal, aod, alpha.toFloat()) }
        if (aod || reduce) continue
        val w = (t - at - 0.1) / 0.5
        if (w > 0 && w < 1) { val s = sin(PI * w); star(x + 7.5f, y - 7.5f, (s * 0.95).toFloat(), (w * 50).toFloat(), s.toFloat()) }
        else if (j == 0 && t > at + 0.6) star(x + 6.5f, y - 6.5f, 0.5f, 0f, 0.9f)
    }
}

private fun DrawScope.star(x: Float, y: Float, scale: Float, turn: Float, opacity: Float) {
    withTransform({ translate(x, y); rotate(turn, Offset.Zero); scale(max(scale, 0.001f), max(scale, 0.001f), Offset.Zero) }) {
        drawPath(sparkle, Color.White.copy(alpha = opacity))
    }
}

/** A 4-point star, 7 units each way. */
private val sparkle = Path().apply {
    moveTo(0f, -7f)
    cubicTo(0.6f, -1.2f, 1.2f, -0.6f, 7f, 0f); cubicTo(1.2f, 0.6f, 0.6f, 1.2f, 0f, 7f)
    cubicTo(-0.6f, 1.2f, -1.2f, 0.6f, -7f, 0f); cubicTo(-1.2f, -0.6f, -0.6f, -1.2f, 0f, -7f)
    close()
}

private val facets = listOf(rgb(0xffffff), rgb(0x6f87ad), rgb(0xe8f1ff), rgb(0x8aa0c4), rgb(0xffffff), rgb(0x5d7499), rgb(0xdbe8fb), rgb(0x9db2d3))

/** A round brilliant from above: crown facets round an octagonal table, a bezel and 4 prongs, in face units at the origin. */
private fun DrawScope.drawGem(r: Double, metal: Metal, aod: Boolean, alpha: Float = 1f) {
    fun p(rr: Double, k: Double): Offset { val a = (k * 45 - 22.5) * PI / 180; return Offset((rr * cos(a)).toFloat(), (rr * sin(a)).toFloat()) }
    fun poly(pts: List<Offset>) = Path().apply { moveTo(pts[0]); for (i in 1 until pts.size) lineTo(pts[i]); close() }
    fun poly(a: Offset, b: Offset, c: Offset, d: Offset? = null) = poly(listOfNotNull(a, b, c, d))
    val rf = r.toFloat()
    val table = poly(List(8) { p(r * 0.5, it.toDouble()) })
    fun a(c: Color) = c.copy(alpha = c.alpha * alpha)
    if (aod) {
        drawCircle(a(metal.aodLine), rf * 1.2f, Offset.Zero, style = Stroke(0.7f))
        for (k in 0 until 8) {
            val kk = k.toDouble()
            drawPath(poly(p(r, kk), p(r, kk + 0.5), p(r * 0.5, kk)), a(metal.aod), style = Stroke(0.55f))
            drawPath(poly(p(r, kk + 0.5), p(r, kk + 1), p(r * 0.5, kk + 1), p(r * 0.5, kk)), a(metal.aod), style = Stroke(0.55f))
        }
        drawPath(table, a(metal.aod), style = Stroke(0.55f))
        return
    }
    drawCircle(a(metal.rimDark), rf * 1.2f, Offset.Zero)
    drawCircle(a(metal.hi.copy(alpha = 0.7f)), rf * 1.06f, Offset.Zero)
    for (k in 0 until 8) {
        val kk = k.toDouble()
        drawPath(poly(p(r, kk), p(r, kk + 0.5), p(r * 0.5, kk)), a(facets[k]))
        drawPath(poly(p(r, kk + 0.5), p(r, kk + 1), p(r * 0.5, kk + 1), p(r * 0.5, kk)), a(facets[(k + 3) % 8]))
    }
    for (k in 0 until 4) {
        val c = p(r * 1.04, (k * 2) + 0.5)
        drawCircle(a(metal.hi), rf * 0.17f, c)
        drawCircle(a(metal.rimDark), rf * 0.17f, c, style = Stroke(0.35f))
    }
    drawPath(table, a(rgb(0xf4f9ff)))
    drawPath(poly(p(r * 0.5, 5.0), p(r * 0.5, 6.0), p(r * 0.12, 5.5)), a(Color.White))
    drawPath(table, a(rgb(0x506e96, 0.35f)), style = Stroke(0.35f))
}

/** One glint across the face: a band of added light, clipped to the field. */
private fun DrawScope.drawGlint(progress: Double) {
    val field = size.width * 0.84f
    val c = Offset(size.width / 2, size.height / 2)
    val x = (0.19 * field + lerp(-1.3, 3.0, smooth(progress)) * 0.38 * field - field / 2).toFloat()
    clipPath(Path().apply { addOval(androidx.compose.ui.geometry.Rect(c, field / 2)) }) {
        rotate(22f, c) {
            drawRect(Brush.horizontalGradient(listOf(Color.White.copy(alpha = 0f), Color.White.copy(alpha = 0.38f), Color.White.copy(alpha = 0f)),
                startX = c.x + x - field * 0.19f, endX = c.x + x + field * 0.19f),
                Offset(c.x + x - field * 0.19f, c.y - field * 0.8f), Size(field * 0.38f, field * 1.6f), blendMode = BlendMode.Plus)
        }
    }
}

/** The medal's edge while it turns: an orthographic coin, its far face's outline, the band between the faces, and one groove across the band per set. */
@Composable
private fun Edge(lay: Lay, metal: Metal, sets: Int, frame: () -> Frame) {
    Canvas(Modifier.fillMaxSize()) {
        val th = frame().th
        if (abs(sin(th)) < 0.01) return@Canvas
        face {
            val cs = cos(th).toFloat(); val sn = sin(th).toFloat()
            val fx = (THICKNESS / 2 * sn).toFloat(); val rx = 100 * abs(cs)
            val band = Brush.verticalGradient(0f to metal.sh, 0.3f to metal.hi, 0.55f to metal.md, 1f to metal.sh, startY = -100f, endY = 100f)
            drawOval(band, Offset(-fx - rx, -100f), Size(2 * rx, 200f))
            drawOval(band, Offset(fx - rx, -100f), Size(2 * rx, 200f))
            drawRect(band, Offset(-abs(fx), -100f), Size(2 * abs(fx), 200f))
            for (deg in Medal.notchAngles(sets)) {
                val ph = deg * PI / 180
                if (cos(ph) * sn >= 0) continue   // only the grooves on the side we see
                val x0 = (100 * cos(ph) * cs).toFloat(); val y = (100 * sin(ph)).toFloat()
                drawLine(metal.ink.copy(alpha = 0.55f), Offset(x0 - fx, y), Offset(x0 + fx, y), 2.4f)
                drawLine(Color.White.copy(alpha = 0.35f), Offset(x0 - fx, y + 1.6f), Offset(x0 + fx, y + 1.6f), 0.8f)
            }
        }
    }
}

/* ---------- the engraving ---------- */

private enum class Align { LEADING, CENTER, TRAILING }

/** What is stamped into a face, in face units. */
private sealed interface Mark {
    /** The two thin rings round the field's middle. */
    data object Ring : Mark
    /** The workout's name round the top: half the rim with a star each side, or 220° when long, then smaller, then cut. Scripts whose letters join go straight across instead. */
    data class Name(val s: String, val arcable: Boolean) : Mark
    data class Arc(val s: String, val size: Double, val tracking: Double, val radius: Double, val top: Boolean, val length: Double) : Mark
    data class Text(val s: String, val size: Double, val tracking: Double, val x: Double, val y: Double, val align: Align, val width: Double,
                    val mono: Boolean = false, val opacity: Float = 1f) : Mark
    data class Rule(val y: Double, val half: Double) : Mark
}

/** A recessed engraving: the ink, and a light edge 0.9 units under it (none in Always On). */
private fun DrawScope.stamp(marks: List<Mark>, metal: Metal, aod: Boolean) {
    val n = drawContext.canvas.nativeCanvas
    val u = size.width / 200
    n.save(); n.translate(size.width / 2, size.height / 2); n.scale(u, u)
    if (!aod) { n.save(); n.translate(0f, 0.9f); for (m in marks) Engraver.draw(n, m, Color.White.copy(alpha = 0.5f), true, null); n.restore() }
    for (m in marks) Engraver.draw(n, m, if (aod) metal.aod else metal.ink, false, if (aod) metal.aodLine else null)
    n.restore()
}

private object Engraver {
    private val face: Typeface = Typeface.create(Typeface.DEFAULT, 800, false)

    private fun paint(size: Double, color: Color, mono: Boolean = false, tracking: Double = 0.0) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = face; textSize = size.toFloat(); this.color = color.toArgb(); letterSpacing = (tracking / size).toFloat()
        if (mono) fontFeatureSettings = "tnum"
    }

    fun draw(n: android.graphics.Canvas, m: Mark, color: Color, edge: Boolean, line: Color?) {
        when (m) {
            Mark.Ring -> {
                if (edge) return
                val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 0.8f; this.color = (line ?: color.copy(alpha = 0.32f)).toArgb() }
                n.drawCircle(0f, 0f, 61.6f, p)
                if (line == null) { p.strokeWidth = 0.6f; p.color = Color.White.copy(alpha = 0.4f).toArgb(); n.drawCircle(0f, 0f, 62.4f, p) }
            }
            is Mark.Rule -> {
                if (edge) return
                val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 1.1f; this.color = (line ?: color.copy(alpha = 0.55f)).toArgb() }
                n.drawLine(-m.half.toFloat(), m.y.toFloat(), m.half.toFloat(), m.y.toFloat(), p)
            }
            is Mark.Name -> name(n, m.s, m.arcable, color)
            is Mark.Arc ->
                // Joined scripts fall apart a letter at a time on the rim: straight across just inside it instead, as the name does.
                if (Medal.arcable(m.s)) {
                    val (text, fs) = fit(m.s, m.size, m.tracking, m.length, 13.0)
                    arc(n, text, fs, m.tracking, m.radius, m.top, color)
                } else straight(n, m.s, min(m.size, 15.0), 0.4, 0.0, if (m.top) -(m.radius - 8) else m.radius - 8, Align.CENTER, 100.0, false, color)
            is Mark.Text -> straight(n, m.s, m.size, m.tracking, m.x, m.y, m.align, m.width, m.mono, color.copy(alpha = color.alpha * m.opacity))
        }
    }

    /** The name round the top. Short: half the rim, a star each side. Long: a 220° arc, down to 13.5 units, then cut with an ellipsis. */
    private fun name(n: android.graphics.Canvas, s: String, arcable: Boolean, color: Color) {
        if (!arcable) { straight(n, s, 15.0, 0.4, 0.0, -42.0, Align.CENTER, 112.0, false, color); return }
        if (width(s, 16.0, 1.6) <= 183) {
            arc(n, s, 16.0, 1.6, 70.0, true, color)
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color.toArgb() }
            for (x in listOf(-74f, 74f)) { n.save(); n.translate(x, 0f); n.scale(0.42f, 0.42f); n.drawPath(sparkle.asAndroidPath(), p); n.restore() }
        } else {
            val (text, fs) = fit(s, 16.0, 0.9, 262.0, 13.5)
            arc(n, text, fs, 0.9, 70.0, true, color)
        }
    }

    private fun glyphWidth(ch: String, size: Double): Double {
        val w = paint(size, Color.Black).measureText(ch).toDouble()
        return if (ch == " ") max(w, size * 0.27) else w
    }

    private fun chars(s: String) = s.codePoints().toArray().map { String(Character.toChars(it)) }

    fun width(s: String, size: Double, tracking: Double): Double {
        val g = chars(s)
        return g.sumOf { glyphWidth(it, size) } + tracking * max(g.size - 1, 0)
    }

    /** Smaller until it fits the arc (not under `smallest`), then cut with an ellipsis. */
    fun fit(s: String, size: Double, tracking: Double, length: Double, smallest: Double): Pair<String, Double> {
        val full = width(s, size, tracking)
        if (full <= length) return s to size
        val fs = max(smallest, ((size * length / full) * 2).toInt() / 2.0)
        var text = s
        while (text.length > 2 && width(text, fs, tracking) > length) text = text.dropLast(2).trimEnd() + "…"
        return text to fs
    }

    /** One letter at a time along a circle: round the top reading clockwise, letters standing outward; round the bottom reading left to right, letters standing inward. */
    private fun arc(n: android.graphics.Canvas, s: String, size: Double, tracking: Double, r: Double, top: Boolean, color: Color) {
        val g = chars(s)
        val p = paint(size, color).apply { textAlign = Paint.Align.CENTER }
        val total = g.sumOf { glyphWidth(it, size) } + tracking * max(g.size - 1, 0)
        var pos = 0.0
        for (ch in g) {
            val gw = glyphWidth(ch, size)
            val mid = pos + gw / 2
            val a = if (top) -PI / 2 - total / (2 * r) + mid / r else PI / 2 + total / (2 * r) - mid / r
            n.save()
            n.translate((r * cos(a)).toFloat(), (r * sin(a)).toFloat())
            n.rotate(Math.toDegrees(if (top) a + PI / 2 else a - PI / 2).toFloat())
            n.drawText(ch, 0f, 0f, p)
            n.restore()
            pos += gw + tracking
        }
    }

    /** A line on its baseline at (x, y), smaller to fit `width`. */
    private fun straight(n: android.graphics.Canvas, s: String, size: Double, tracking: Double, x: Double, y: Double, align: Align, width: Double,
                         mono: Boolean, color: Color) {
        var p = paint(size, color, mono, tracking)
        val w = p.measureText(s)
        if (w > width && w > 0) p = paint(size * width / w, color, mono, tracking)
        p.textAlign = when (align) { Align.LEADING -> Paint.Align.LEFT; Align.CENTER -> Paint.Align.CENTER; Align.TRAILING -> Paint.Align.RIGHT }
        n.drawText(s, x.toFloat(), y.toFloat(), p)
    }
}

/* ---------- the records, the sync line and Done ---------- */

/** A gold bar per record: the exercise, then its old best (dimmed) to its new one; then the sync line and Done, risen into the space the medal left. */
@Composable
private fun Rest(lay: Lay, metal: Metal, sum: WorkoutSummary, words: Words, ambient: Boolean, shownAt: Long, frame: () -> Frame, onHeight: (Int) -> Unit) {
    val sync = rememberSync()
    val st by WearStore.state.collectAsState()
    val plates = if (sum.records.isEmpty()) sum.prs.map { it to null } else sum.records.map { it.name to it }
    val ready by remember(frame) { derivedStateOf { frame().p > 0.9 } }
    val shown by remember(frame) { derivedStateOf { frame().p >= 0.5 } }
    Box(
        Modifier
            .offset { IntOffset((lay.w * 0.1).dp.roundToPx(), frame().restY.dp.roundToPx()) }
            .width((lay.w * 0.8).dp)
            .graphicsLayer { alpha = frame().p.toFloat() }
            .then(if (shown) Modifier else Modifier.clearAndSetSemantics {})
            // As tall as its content, even past the screen: how far it scrolls comes from this.
            .wrapContentHeight(Alignment.Top, unbounded = true)
            .onSizeChanged { onHeight(it.height) },
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            for ((name, line) in plates) { RecordPlate(name, line, words.reps, metal, ambient); Spacer(Modifier.height(6.dp)) }
            if (sum.endedOnPhone) Quiet(stringResource(R.string.ended_on_phone), 12.sp, Modifier.padding(bottom = 4.dp))
            SyncLine(sync, heard = st.synced, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
            PrimaryButton(stringResource(R.string.done), Modifier.fillMaxWidth(0.72f)) {
                if (ready && System.currentTimeMillis() - shownAt >= 1000) WearStore.dismissSummary()
            }
        }
    }
}

@Composable
private fun RecordPlate(name: String, line: RecordLine?, reps: String, metal: Metal, dimmed: Boolean) {
    val locale = LocalConfiguration.current.locales[0]
    val ink = if (dimmed) metal.aod else metal.ink
    val shape = RoundedCornerShape(12.dp)
    val bg = if (dimmed) Modifier.border(1.dp, metal.aodLine, shape)
    else Modifier.background(Brush.linearGradient(0f to rgb(0xf6e3a6), 0.42f to rgb(0xdcb45e), 0.72f to rgb(0xc19a48), 1f to rgb(0xdcbb6c)), shape)
    val unit = if (line == null || line.kind == RecordLine.Kind.hold) "" else if (line.kind == RecordLine.Kind.reps) " $reps" else " ${line.unit}"
    val spoken = if (line == null) name else "$name, ${line.texts(locale).second}$unit"
    Row(
        Modifier.fillMaxWidth().clip(shape).then(bg).padding(start = 7.dp, top = 6.dp, end = 10.dp, bottom = 7.dp).semantics(mergeDescendants = true) { contentDescription = spoken },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Canvas(Modifier.size(21.dp)) {
            withTransform({ translate(size.width / 2, size.height / 2); scale(size.width / 20, size.width / 20, Offset.Zero) }) { drawGem(6.6, metal, dimmed) }
        }
        Spacer(Modifier.width(6.dp))
        Column {
            Text(name.uppercase(locale), color = ink, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.4.sp, maxLines = 2, lineHeight = 14.sp)
            if (line != null) {
                val (old, new) = line.texts(locale)
                val text = buildAnnotatedString {
                    withStyle(SpanStyle(color = ink.copy(alpha = 0.6f))) { append(old) }
                    withStyle(SpanStyle(fontSize = 13.sp, color = ink.copy(alpha = 0.7f))) { append(" → ") }
                    append(new)
                    withStyle(SpanStyle(fontSize = 12.sp)) { append(unit) }
                }
                var scale by remember(text) { mutableFloatStateOf(1f) }
                Text(text, color = ink, fontSize = 18.sp * scale, fontWeight = FontWeight.ExtraBold, style = Og.Number, maxLines = 1, softWrap = false, textAlign = TextAlign.Start,
                    onTextLayout = { r -> if (r.hasVisualOverflow && scale > 0.6f) scale -= 0.08f })
            }
        }
    }
}
