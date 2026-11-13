package ch.duartesantos.opengym.wear.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Text
import ch.duartesantos.opengym.wear.Disc
import ch.duartesantos.opengym.wear.Entry
import ch.duartesantos.opengym.wear.MarkKind
import ch.duartesantos.opengym.wear.MenuOffer
import ch.duartesantos.opengym.wear.R
import ch.duartesantos.opengym.wear.WearStore

/**
 * The set menu (frames D-K of the mockup): the set as it is now, a row each for warm-up, failure and drop, then Add and Remove.
 * It scrolls with the crown. Back or swipe-to-dismiss closes it, and so does Always On. A tap that changes the set is
 * closed by the store; the haptics are the store's too.
 */
@Composable
fun SetMenuView(e: Entry, si: Int, offer: MenuOffer, onMark: (MarkKind, Boolean) -> Unit, onAdd: () -> Unit, onRemove: () -> Unit, onClose: () -> Unit) {
    val row = e.sets.getOrNull(si) ?: return
    val ambient = LocalAmbient.current
    BackHandler(onBack = onClose)
    LaunchedEffect(ambient) { if (ambient) onClose() }
    val unit = WearStore.state.collectAsState().value.workout?.let { e.weightUnit(it.unit) }
    val list = rememberTransformingLazyColumnState()
    TransformingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 34.dp, bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item {
            Column(
                Modifier.clip(RoundedCornerShape(18.dp)).background(Og.Surface).padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val reps = when {
                    e.isTimed -> "${fmt(row.sec)} s"
                    e.isBodyweight && (row.w ?: 0.0) <= 0 -> "${fmt(row.r)}"
                    else -> "${fmt(row.w)} $unit × ${fmt(row.r)}"
                }
                Text(reps, style = Og.Number, fontSize = 18.sp, color = Og.Text, textAlign = TextAlign.Center)
                if (row.warmup || row.failure == true || row.drop != null || row.drops != null) Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    if (row.warmup) Tag(stringResource(R.string.warmup), Og.Warmup, mixedCase = true)
                    if (row.failure == true) Tag(stringResource(R.string.failure_tag), Og.Red, mixedCase = true)
                    if (row.drop != null || row.drops != null) Tag(stringResource(R.string.drop_tag), Og.Purple, mixedCase = true)
                }
            }
        }
        if (offer.warmup != Disc.HIDDEN) item {
            ToggleRow(stringResource(R.string.warmup), stringResource(R.string.warmup), Og.Warmup, offer.warmup) { onMark(MarkKind.WARMUP, offer.warmup != Disc.ON) }
        }
        if (offer.failure != Disc.HIDDEN) item {
            ToggleRow(stringResource(R.string.to_failure), stringResource(R.string.failure_tag), Og.Red, offer.failure) { onMark(MarkKind.FAILURE, offer.failure != Disc.ON) }
        }
        if (offer.drop != Disc.HIDDEN) item {
            ToggleRow(stringResource(R.string.drop_set), stringResource(R.string.drop_tag), Og.Purple, offer.drop) { onMark(MarkKind.DROP, offer.drop != Disc.ON) }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (offer.canAdd) EditButton(stringResource(R.string.add_short), stringResource(R.string.add_set), G.PLUS, Og.Green, Og.Surface2, true, Modifier.weight(1.2f), onAdd)
                else Spacer(Modifier.weight(1.2f))
                EditButton(stringResource(R.string.remove_short), stringResource(R.string.remove_set), G.MINUS, Color(0xFFFF6A60), Og.Red.copy(alpha = 0.2f), offer.canRemove, Modifier.weight(1f), onRemove)
            }
        }
    }
}

/** A row of 44 dp inside a 48 dp tap area, so the rows touch without overlapping. The letter comes from `word`, the type's own short name. */
@Composable
private fun ToggleRow(label: String, word: String, color: Color, disc: Disc, onClick: () -> Unit) {
    val on = disc == Disc.ON
    val locked = disc == Disc.LOCKED
    Box(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 2.dp).alpha(if (locked) 0.55f else 1f)
            .clip(RoundedCornerShape(22.dp))
            .toggleable(value = on, enabled = !locked, role = Role.Switch, onValueChange = { onClick() })
            .semantics { contentDescription = label },
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp))
                .background(if (on) color.copy(alpha = 0.22f) else Og.Surface)
                .then(if (on) Modifier.border(2.dp, color, RoundedCornerShape(22.dp)) else Modifier)
                .padding(start = 9.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.size(26.dp).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
                if (on) Box(Modifier.size(26.dp).background(color, CircleShape), contentAlignment = Alignment.Center) { Glyph(G.CHECK, Og.OnGreen, 16.dp) }
                else {
                    val ring = if (locked) Color(0xFF8E8E93) else color
                    Canvas(Modifier.size(26.dp)) {
                        val w = 2.dp.toPx()
                        drawCircle(ring, radius = (size.minDimension - w) / 2, style = Stroke(w, pathEffect = if (locked) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())) else null))
                    }
                    Text(word.take(1).uppercase(), color = ring, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }
            // two lines allowed: a long word wraps, never clips
            Text(label, color = Og.Text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (locked) Canvas(Modifier.size(12.dp).clearAndSetSemantics {}) {
                // a padlock: body and shackle
                val c = Color(0xFF8E8E93); val w = size.width; val h = size.height
                drawRoundRect(c, androidx.compose.ui.geometry.Offset(w * 0.12f, h * 0.45f), Size(w * 0.76f, h * 0.5f), androidx.compose.ui.geometry.CornerRadius(w * 0.1f))
                drawArc(c, 180f, 180f, false, androidx.compose.ui.geometry.Offset(w * 0.27f, h * 0.05f), Size(w * 0.46f, h * 0.8f), style = Stroke(w * 0.14f))
            }
        }
    }
}

@Composable
private fun EditButton(label: String, said: String, glyph: G, ink: Color, fill: Color, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.heightIn(min = 48.dp).alpha(if (enabled) 1f else 0.4f).clip(RoundedCornerShape(24.dp)).background(fill)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = said }.padding(horizontal = 4.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Glyph(glyph, ink, 16.dp)
        Text(label, color = ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    }
}
