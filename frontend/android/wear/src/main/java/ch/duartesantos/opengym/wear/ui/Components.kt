package ch.duartesantos.opengym.wear.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.platform.LocalDensity
import androidx.wear.compose.material3.LocalTextStyle
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.view.HapticFeedbackConstants
import androidx.compose.ui.res.stringResource
import androidx.wear.compose.material3.Text
import ch.duartesantos.opengym.wear.R
import ch.duartesantos.opengym.wear.SyncState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/* ---------- glyphs: drawn, so they look the same on every watch (no emoji fonts) ---------- */

enum class G { CLOSE, CHECK, LEFT, RIGHT, PLAY, PAUSE, PLAY_PAUSE, PREV, NEXT, FLAG, UP, PHONE_OFF, BACK, MINUS, PLUS, CROWN, HEART, STOP, LINK }

@Composable
fun Glyph(g: G, color: Color, size: Dp = 16.dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val w = this.size.width; val h = this.size.height
        val st = Stroke(width = w * 0.13f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun tri(x0: Float, x1: Float) = Path().apply { moveTo(x0, h * 0.18f); lineTo(x1, h * 0.5f); lineTo(x0, h * 0.82f); close() }
        when (g) {
            G.CLOSE -> { drawLine(color, Offset(w * 0.24f, h * 0.24f), Offset(w * 0.76f, h * 0.76f), w * 0.13f, StrokeCap.Round); drawLine(color, Offset(w * 0.76f, h * 0.24f), Offset(w * 0.24f, h * 0.76f), w * 0.13f, StrokeCap.Round) }
            G.CHECK -> drawPath(Path().apply { moveTo(w * 0.18f, h * 0.52f); lineTo(w * 0.42f, h * 0.76f); lineTo(w * 0.84f, h * 0.26f) }, color, style = st)
            G.LEFT -> drawPath(Path().apply { moveTo(w * 0.64f, h * 0.18f); lineTo(w * 0.32f, h * 0.5f); lineTo(w * 0.64f, h * 0.82f) }, color, style = st)
            G.RIGHT -> drawPath(Path().apply { moveTo(w * 0.36f, h * 0.18f); lineTo(w * 0.68f, h * 0.5f); lineTo(w * 0.36f, h * 0.82f) }, color, style = st)
            G.PLAY -> drawPath(tri(w * 0.26f, w * 0.84f), color)
            G.PAUSE -> { drawRect(color, Offset(w * 0.22f, h * 0.18f), Size(w * 0.18f, h * 0.64f)); drawRect(color, Offset(w * 0.6f, h * 0.18f), Size(w * 0.18f, h * 0.64f)) }
            G.PLAY_PAUSE -> { drawPath(tri(w * 0.08f, w * 0.5f), color); drawRect(color, Offset(w * 0.6f, h * 0.22f), Size(w * 0.11f, h * 0.56f)); drawRect(color, Offset(w * 0.8f, h * 0.22f), Size(w * 0.11f, h * 0.56f)) }
            G.NEXT -> { drawPath(tri(w * 0.14f, w * 0.7f), color); drawRect(color, Offset(w * 0.72f, h * 0.18f), Size(w * 0.13f, h * 0.64f)) }
            G.PREV -> { drawPath(Path().apply { moveTo(w * 0.86f, h * 0.18f); lineTo(w * 0.3f, h * 0.5f); lineTo(w * 0.86f, h * 0.82f); close() }, color); drawRect(color, Offset(w * 0.15f, h * 0.18f), Size(w * 0.13f, h * 0.64f)) }
            G.FLAG -> { drawLine(color, Offset(w * 0.24f, h * 0.12f), Offset(w * 0.24f, h * 0.9f), w * 0.12f, StrokeCap.Round); drawRect(color, Offset(w * 0.24f, h * 0.14f), Size(w * 0.56f, h * 0.38f)) }
            G.UP -> { drawLine(color, Offset(w * 0.5f, h * 0.85f), Offset(w * 0.5f, h * 0.18f), w * 0.14f, StrokeCap.Round); drawPath(Path().apply { moveTo(w * 0.2f, h * 0.45f); lineTo(w * 0.5f, h * 0.16f); lineTo(w * 0.8f, h * 0.45f) }, color, style = st) }
            G.PHONE_OFF -> { drawRoundRect(color, Offset(w * 0.28f, h * 0.08f), Size(w * 0.44f, h * 0.84f), androidx.compose.ui.geometry.CornerRadius(w * 0.1f), style = Stroke(w * 0.1f)); drawLine(color, Offset(w * 0.1f, h * 0.1f), Offset(w * 0.9f, h * 0.9f), w * 0.11f, StrokeCap.Round) }
            G.BACK -> { drawPath(Path().apply { moveTo(w * 0.36f, h * 0.22f); lineTo(w * 0.9f, h * 0.22f); lineTo(w * 0.9f, h * 0.78f); lineTo(w * 0.36f, h * 0.78f); lineTo(w * 0.08f, h * 0.5f); close() }, color, style = Stroke(w * 0.1f, join = StrokeJoin.Round)); drawLine(color, Offset(w * 0.5f, h * 0.38f), Offset(w * 0.72f, h * 0.62f), w * 0.09f, StrokeCap.Round); drawLine(color, Offset(w * 0.72f, h * 0.38f), Offset(w * 0.5f, h * 0.62f), w * 0.09f, StrokeCap.Round) }
            G.MINUS -> drawLine(color, Offset(w * 0.2f, h * 0.5f), Offset(w * 0.8f, h * 0.5f), w * 0.14f, StrokeCap.Round)
            G.PLUS -> { drawLine(color, Offset(w * 0.2f, h * 0.5f), Offset(w * 0.8f, h * 0.5f), w * 0.14f, StrokeCap.Round); drawLine(color, Offset(w * 0.5f, h * 0.2f), Offset(w * 0.5f, h * 0.8f), w * 0.14f, StrokeCap.Round) }
            G.CROWN -> { drawArc(color, -60f, 300f, false, Offset(w * 0.15f, h * 0.15f), Size(w * 0.7f, h * 0.7f), style = Stroke(w * 0.12f, cap = StrokeCap.Round)); drawPath(Path().apply { moveTo(w * 0.62f, h * 0.02f); lineTo(w * 0.86f, h * 0.2f); lineTo(w * 0.6f, h * 0.36f); close() }, color) }
            G.HEART -> drawPath(Path().apply {
                moveTo(w * 0.5f, h * 0.88f)
                cubicTo(w * 0.05f, h * 0.58f, w * 0.0f, h * 0.2f, w * 0.28f, h * 0.14f)
                cubicTo(w * 0.42f, h * 0.11f, w * 0.5f, h * 0.24f, w * 0.5f, h * 0.3f)
                cubicTo(w * 0.5f, h * 0.24f, w * 0.58f, h * 0.11f, w * 0.72f, h * 0.14f)
                cubicTo(w * 1.0f, h * 0.2f, w * 0.95f, h * 0.58f, w * 0.5f, h * 0.88f); close()
            }, color)
            G.STOP -> drawRoundRect(color, Offset(w * 0.2f, h * 0.2f), Size(w * 0.6f, h * 0.6f), androidx.compose.ui.geometry.CornerRadius(w * 0.08f))
            G.LINK -> { drawRoundRect(color, Offset(w * 0.05f, h * 0.3f), Size(w * 0.5f, h * 0.4f), androidx.compose.ui.geometry.CornerRadius(h * 0.2f), style = Stroke(w * 0.1f)); drawRoundRect(color, Offset(w * 0.45f, h * 0.3f), Size(w * 0.5f, h * 0.4f), androidx.compose.ui.geometry.CornerRadius(h * 0.2f), style = Stroke(w * 0.1f)) }
        }
    }
}

/* ---------- buttons ---------- */

/** Press feedback on touch-down: a small squeeze, none with Remove animations or in Always On. */
@Composable
private fun pressScale(source: MutableInteractionSource): Float {
    val pressed by source.collectIsPressedAsState()
    val still = LocalReduceMotion.current || LocalAmbient.current
    val s by animateFloatAsState(if (pressed && !still) 0.96f else 1f, tween(120), label = "press")
    return s
}

/** The one thing to press on a screen: full width, a capsule in the accent, the ink on it. */
@Composable
fun PrimaryButton(label: String, modifier: Modifier = Modifier, icon: G? = null, enabled: Boolean = true,
                  iconWhenTight: Boolean = false, onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    val a = LocalAccent.current
    val dim = LocalAmbient.current
    val source = remember { MutableInteractionSource() }
    val fg = if (dim) a.accent else a.on
    Row(
        modifier
            .alpha(if (enabled) 1f else 0.35f)
            .scale(pressScale(source))
            .heightIn(min = Og.Tap)
            .clip(CircleShape)
            .background(if (dim) Color.Transparent else a.accent)
            .border(if (dim) 1.5.dp else 0.dp, a.accent, CircleShape)
            .combinedClickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button,
                onLongClick = onLongClick, onClick = onClick)
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconLabel(label, icon, fg, 14.dp, FontWeight.SemiBold, iconWhenTight)
    }
}

/**
 * The icon and the word of a button. With `iconWhenTight`, a word that does not fit beside its
 * icon even at 12 sp (a long word, a small watch) goes: the icon alone, the word still said.
 */
@Composable
private fun IconLabel(label: String, icon: G?, color: Color, iconSize: Dp, weight: FontWeight, iconWhenTight: Boolean) {
    if (icon == null || !iconWhenTight) {
        if (icon != null) { Glyph(icon, color, iconSize); Box(Modifier.width(6.dp)) }
        FitText(label, color, 15.sp, weight)
        return
    }
    val measurer = rememberTextMeasurer()
    val small = LocalTextStyle.current.merge(TextStyle(fontSize = 12.sp, fontWeight = weight))
    val labelAt12 = remember(label, small, measurer) { measurer.measure(label, small, maxLines = 1, softWrap = false).size.width }
    val iconPx = with(LocalDensity.current) { (iconSize + 6.dp).roundToPx() }
    BoxWithConstraints(contentAlignment = Alignment.Center) {
        if (labelAt12 + iconPx > constraints.maxWidth) Glyph(icon, color, iconSize + 4.dp, Modifier.semantics { contentDescription = label })
        else Row(verticalAlignment = Alignment.CenterVertically) { Glyph(icon, color, iconSize); Box(Modifier.width(6.dp)); FitText(label, color, 15.sp, weight) }
    }
}

/**
 * A one-line label at `size`, made smaller just enough to fit when it would not (never under
 * 12 sp), instead of ending in "…": minimumScaleFactor on the Apple Watch.
 */
@Composable
fun FitText(text: String, color: Color, size: TextUnit, weight: FontWeight = FontWeight.Normal, align: TextAlign = TextAlign.Center) {
    val measurer = rememberTextMeasurer()
    val style = LocalTextStyle.current.merge(TextStyle(color = color, fontSize = size, fontWeight = weight, textAlign = align))
    BoxWithConstraints {
        val full = remember(text, style, measurer) { measurer.measure(text, style, maxLines = 1, softWrap = false).size.width }
        val max = constraints.maxWidth
        // 5 % under the exact fit: rounding glyph widths must not tip it into "…".
        val fit = if (full <= max || full == 0) size else (size.value * max / full * 0.95f).coerceAtLeast(12f).sp
        Text(text, style = style.copy(fontSize = fit), maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
    }
}

/** A quieter choice: a grey row, like a row in the app's grouped lists. */
@Composable
fun RowButton(label: String, modifier: Modifier = Modifier, tint: Color = Og.Text, icon: G? = null, center: Boolean = true,
              enabled: Boolean = true, lines: Int = 2, iconWhenTight: Boolean = false, onClick: () -> Unit) {
    val dim = LocalAmbient.current
    val source = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(Og.Radius)
    Row(
        modifier
            .scale(pressScale(source))
            .heightIn(min = Og.Tap)
            .clip(shape)
            .background(if (dim) Color.Transparent else Og.Surface)
            .border(if (dim) 1.dp else 0.dp, Og.Surface2, shape)
            .combinedClickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = if (center) Arrangement.Center else Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val c = tint.copy(alpha = if (!enabled) 0.35f else if (dim) 0.7f else 1f)
        if (iconWhenTight) { IconLabel(label, icon, c, 13.dp, FontWeight.Normal, true); return@Row }
        if (icon != null) { Glyph(icon, c, 13.dp); Box(Modifier.width(6.dp)) }
        if (lines == 1) FitText(label, c, 15.sp, align = if (center) TextAlign.Center else TextAlign.Start)
        else Text(label, color = c, fontSize = 15.sp, maxLines = lines, overflow = TextOverflow.Ellipsis,
            textAlign = if (center) TextAlign.Center else TextAlign.Start)
    }
}

/** A small round secondary button: a glyph or short text on a grey disc. */
@Composable
fun EdgeButton(said: String, modifier: Modifier = Modifier, glyph: G? = null, text: String? = null, size: Dp = Og.Tap,
               enabled: Boolean = true, onClick: () -> Unit) {
    val dim = LocalAmbient.current
    val source = remember { MutableInteractionSource() }
    Box(
        modifier
            .scale(pressScale(source))
            .size(size)
            .clip(CircleShape)
            .background(if (dim) Color.Transparent else Og.Surface2)
            .border(if (dim) 1.dp else 0.dp, Og.Surface2, CircleShape)
            .combinedClickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = said },
        contentAlignment = Alignment.Center,
    ) {
        val c = Og.Text.copy(alpha = if (!enabled) 0.3f else if (dim) 0.7f else 1f)
        if (glyph != null) Glyph(glyph, c, size * 0.36f)
        if (text != null) FitText(text, c, 13.sp, FontWeight.SemiBold)
    }
}

/** ‹ or ›, as tall as the button between them. */
@Composable
fun ArrowButton(left: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val dim = LocalAmbient.current
    val said = stringResource(if (left) R.string.previous_set else R.string.next_set_btn)
    Box(
        Modifier
            .width(32.dp).height(Og.Tap)
            .clip(RoundedCornerShape(10.dp))
            .background(if (dim) Color.Transparent else Og.Surface)
            .combinedClickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = said },
        contentAlignment = Alignment.Center,
    ) {
        Glyph(if (left) G.LEFT else G.RIGHT, Og.Text.copy(alpha = if (!enabled) 0.25f else if (dim) 0.6f else 1f), 16.dp)
    }
}

/** A word in a small capsule: "Warm-up", "Left", "Superset". */
@Composable
fun Tag(text: String, color: Color) {
    Box(Modifier.clip(CircleShape).background(color.copy(alpha = 0.18f)).padding(horizontal = 6.dp, vertical = 1.dp)) {
        Text(text.uppercase(), color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
fun Quiet(text: String, size: TextUnit = 12.sp, modifier: Modifier = Modifier, lines: Int = 2, align: TextAlign = TextAlign.Center,
          color: Color = Og.Label2) =
    Text(text, modifier = modifier, color = color, fontSize = size, textAlign = align, maxLines = lines, overflow = TextOverflow.Ellipsis)

/**
 * A number you can turn, in Apple Workout's style (#1107): its name small and in capitals on top, the
 * number big under it, both in `tint` (the accent; orange on a warm-up) on a dark tint of it, and an
 * outline in the same colour while the crown turns it. The number grows with the box's height and
 * shrinks to fit its width rather than end in "…".
 */
@Composable
fun NumberBox(value: String, unit: String?, label: String, selected: Boolean, modifier: Modifier = Modifier,
              tint: Color = LocalAccent.current.accent, showLabel: Boolean = true, onAdjust: ((Int) -> Unit)? = null,
              onClick: () -> Unit) {
    val adjust = adjustActions(onAdjust)
    val dim = LocalAmbient.current
    val shape = RoundedCornerShape(12.dp)
    val ink = tint.copy(alpha = if (dim) 0.7f else 1f)
    BoxWithConstraints(
        modifier
            .heightIn(min = Og.Tap)
            .clip(shape)
            .background(if (dim) Color.Transparent else tint.copy(alpha = 0.16f))
            .then(when {
                selected -> Modifier.border(2.dp, tint, shape)
                dim -> Modifier.border(1.dp, Og.Surface2, shape)
                else -> Modifier
            })
            .combinedClickable(role = Role.Button, onClick = onClick)
            .semantics {
                contentDescription = label
                stateDescription = if (unit != null) "$value $unit" else value
                if (adjust != null) customActions = adjust
            },
        contentAlignment = Alignment.Center,
    ) {
        // The number is 0.42 of the box's height (40 sp at most), and shrinks to fit its width:
        // digits ~0.62 of the size wide, the unit ~7 dp a letter, 8 dp of padding.
        // Its line (~1.3 of the size) must fit under the label; a box too short for both drops the label
        // (still read by TalkBack) rather than shrink the number (40 mm emulator: the "g" of "kg" was cut).
        val fs = LocalDensity.current.fontScale
        val room = maxWidth.value - 8f - (unit?.let { (it.length + 1) * 7f * fs } ?: 0f)
        val withLabel = showLabel && (maxHeight.value - 6f - 13f * fs * 1.3f) / 1.3f >= 18f
        val tall = (maxHeight.value - 6f - (if (withLabel) 13f * fs * 1.3f else 0f)) / 1.3f
        val size = minOf(40f, minOf(maxHeight.value * 0.42f, tall, room / (value.length.coerceAtLeast(1) * 0.62f)) / fs)
            .coerceAtLeast(12f)
        Column(Modifier.padding(horizontal = 4.dp, vertical = 3.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (withLabel) Row(verticalAlignment = Alignment.CenterVertically) {
                if (selected) { Glyph(G.CROWN, ink, 8.dp); Box(Modifier.width(2.dp)) }
                Text(label.uppercase(), color = ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row {
                Text(value, style = Og.Number, fontSize = size.sp, color = ink, maxLines = 1, softWrap = false, modifier = Modifier.alignByBaseline())
                if (unit != null) Text(" $unit", color = ink.copy(alpha = 0.8f), fontSize = 14.sp, modifier = Modifier.alignByBaseline(), maxLines = 1)
            }
        }
    }
}

/** TalkBack's More and Less on a number the crown turns (the Apple Watch's adjustable action). */
@Composable
fun adjustActions(onAdjust: ((Int) -> Unit)?): List<CustomAccessibilityAction>? {
    onAdjust ?: return null
    val more = stringResource(R.string.more); val less = stringResource(R.string.less)
    return listOf(CustomAccessibilityAction(more) { onAdjust(1); true }, CustomAccessibilityAction(less) { onAdjust(-1); true })
}

/** A clock that ticks: four times a second awake, once a second in Always On. */
@Composable
fun rememberNow(fast: Boolean = false): Long {
    val dim = LocalAmbient.current
    val now by produceState(System.currentTimeMillis(), dim, fast) {
        while (true) { value = System.currentTimeMillis(); delay(if (dim) 1000L else if (fast) 33L else 250L) }
    }
    return now
}

/** A bar that empties from `start` to `end`. */
@Composable
fun TimeBar(start: Long, end: Long, color: Color, modifier: Modifier = Modifier) {
    val now = rememberNow()
    val left = ch.duartesantos.opengym.wear.RestMath.left(start, end, now)
    val dim = LocalAmbient.current
    Box(modifier.height(5.dp).fillMaxWidth().clip(CircleShape).background(Og.Surface2)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(left).clip(CircleShape).background(color.copy(alpha = if (dim) 0.6f else 1f)))
    }
}

/** A ring: the track, and the part of it that is left. */
@Composable
fun Ring(fraction: Float, color: Color, modifier: Modifier = Modifier, stroke: Dp = 7.dp) {
    Canvas(modifier) {
        val px = stroke.toPx()
        val inset = px / 2 + 2
        val sz = Size(size.width - inset * 2, size.height - inset * 2)
        val tl = Offset(inset, inset)
        drawArc(Og.Surface2, 0f, 360f, false, tl, sz, style = Stroke(px))
        if (fraction > 0f) drawArc(color, -90f, 360f * fraction.coerceIn(0f, 1f), false, tl, sz, style = Stroke(px, cap = StrokeCap.Round))
    }
}

/* ---------- the sync status ---------- */

/** Sets on their way to the phone: an arrow and how many, quiet but there; the phone crossed out while it is out of reach. */
@Composable
fun SyncPill(state: SyncState) {
    if (state.count <= 0) return
    val dim = LocalAmbient.current
    val said = stringResource(R.string.waiting_sync) + " ${state.count}"
    Row(
        Modifier.clip(CircleShape).background(if (dim) Color.Transparent else Og.Orange.copy(alpha = 0.18f))
            .border(if (dim) 1.dp else 0.dp, Og.Orange.copy(alpha = 0.6f), CircleShape)
            .padding(horizontal = 6.dp, vertical = 1.dp)
            .semantics { contentDescription = said },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(if (state is SyncState.Away) G.PHONE_OFF else G.UP, Og.Orange, 9.dp)
        Box(Modifier.width(2.dp))
        Text("${state.count}", color = Og.Orange, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, style = Og.Number)
    }
}

/** The same in words: "Waiting to sync 3" (and "Phone out of reach"), or "All synced". The count comes after the words: no plurals needed. */
@Composable
fun SyncLine(state: SyncState, showSynced: Boolean = true, heard: Boolean = true, modifier: Modifier = Modifier) {
    if (state.count > 0) {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Glyph(G.UP, Og.Orange, 10.dp); Box(Modifier.width(4.dp))
                Text(stringResource(R.string.waiting_sync) + " ${state.count}", color = Og.Orange, fontSize = 12.sp, maxLines = 1)
            }
            if (state is SyncState.Away) Quiet(stringResource(R.string.phone_out_of_reach), 12.sp)
        }
    } else if (showSynced && heard) {
        Row(modifier, verticalAlignment = Alignment.CenterVertically) {
            Glyph(G.CHECK, Og.Label2, 10.dp); Box(Modifier.width(4.dp))
            Text(stringResource(R.string.all_synced), color = Og.Label2, fontSize = 12.sp, maxLines = 1)
        }
    }
}

/* ---------- Finish, held for a second ---------- */

/**
 * The accent fills the button from the start edge while the finger stays; lifting early lets go.
 * One tick when it starts. TalkBack: a plain action (a double tap there is never a stray one).
 */
@Composable
fun HoldToFinish(modifier: Modifier = Modifier, onDone: () -> Unit) {
    val a = LocalAccent.current
    val dim = LocalAmbient.current
    val reduce = LocalReduceMotion.current
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val label = stringResource(R.string.hold_to_finish)
    val said = stringResource(R.string.finish_workout)
    Box(
        modifier
            .fillMaxWidth().height(Og.Tap)
            .clip(CircleShape)
            .background(if (dim) Color.Transparent else Og.Surface2)
            .border(1.5.dp, a.accent, CircleShape)
            .semantics { contentDescription = said; role = Role.Button; onClick { onDone(); true } }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    val run = scope.launch {
                        progress.animateTo(1f, tween((HOLD_MS * (1 - progress.value)).toInt(), easing = LinearEasing))
                        onDone()
                    }
                    waitForUpOrCancellation()
                    if (progress.value < 1f) {
                        run.cancel()
                        scope.launch { if (reduce) progress.snapTo(0f) else progress.animateTo(0f, tween(200)) }
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        HoldLabel(label, Og.Text)
        // The filled part, with the label in the ink on top of it.
        Box(Modifier.fillMaxSize().drawWithContent {
            clipRect(right = size.width * progress.value) { this@drawWithContent.drawContent() }
        }) {
            Box(Modifier.fillMaxSize().background(a.accent), contentAlignment = Alignment.Center) { HoldLabel(label, a.on) }
        }
    }
}

const val HOLD_MS = 1000

@Composable
private fun HoldLabel(text: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Glyph(G.FLAG, color, 13.dp); Box(Modifier.width(6.dp))
        Text(text, color = color, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/* ---------- the crown ---------- */

/** The crown (or a rotating bezel) turns this, one notch at a time. */
fun Modifier.crown(focus: FocusRequester, onStep: (Int) -> Unit): Modifier {
    var acc = 0f
    return this
        .onRotaryScrollEvent { e ->
            acc += e.verticalScrollPixels
            val notch = 40f
            while (abs(acc) >= notch) {
                val d = if (acc > 0) 1 else -1
                onStep(d)
                acc -= d * notch
            }
            true
        }
        .focusRequester(focus)
        .focusable()
}

/**
 * The exercise's animation the phone sent for this workout (a 180 px animated WebP, Android
 * decodes it itself): it moves only while its page is on screen, one still frame in Always On
 * (the Apple Watch's ClipView). TalkBack skips it; the name beside it says what it is.
 */
@Composable
fun ClipView(file: java.io.File, animating: Boolean, modifier: Modifier = Modifier) {
    val clip = remember(file) {
        try { android.graphics.ImageDecoder.decodeDrawable(android.graphics.ImageDecoder.createSource(file)) } catch (_: Exception) { null }
    } ?: return
    DisposableEffect(clip) { onDispose { (clip as? android.graphics.drawable.AnimatedImageDrawable)?.stop() } }
    AndroidView(
        factory = { ctx ->
            android.widget.ImageView(ctx).apply {
                scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
        },
        update = { v ->
            if (v.drawable !== clip) v.setImageDrawable(clip)
            (clip as? android.graphics.drawable.AnimatedImageDrawable)?.let { if (animating) it.start() else it.stop() }
        },
        modifier = modifier.clip(RoundedCornerShape(6.dp)),
    )
}
