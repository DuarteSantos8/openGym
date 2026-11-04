package ch.duartesantos.opengym.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Text
import ch.duartesantos.opengym.wear.Entry
import ch.duartesantos.opengym.wear.R
import ch.duartesantos.opengym.wear.ReadySession
import ch.duartesantos.opengym.wear.Rest
import ch.duartesantos.opengym.wear.SessionCore
import ch.duartesantos.opengym.wear.SessionState
import ch.duartesantos.opengym.wear.WearStore
import ch.duartesantos.opengym.wear.WorkoutSummary
import kotlinx.coroutines.delay
import kotlin.math.abs

/* ---------- the app: one screen at a time, picked from the state ---------- */

@Composable
fun WearApp(onWorkoutShown: () -> Unit = {}) {
    val s by WearStore.state.collectAsState()
    val rest by WearStore.rest.collectAsState()
    val summary by WearStore.summary.collectAsState()
    val hr by WearStore.heartRate.collectAsState()
    val near by WearStore.phoneNear.collectAsState()
    var overview by remember { mutableStateOf(false) }
    val w = s.workout
    LaunchedEffect(w?.id) { if (w != null) onWorkoutShown() }
    Box(Modifier.fillMaxSize().background(Og.Bg)) {
        when {
            summary != null -> SummaryScreen(summary!!, near) { WearStore.dismissSummary() }
            w == null -> IdleScreen(s, near) { WearStore.startSession(it) }
            overview -> OverviewScreen(s, onPick = { WearStore.setEntryIndex(it); overview = false }, onBack = { overview = false })
            rest != null -> RestScreen(s, rest!!, hr)
            s.entryIndex >= w.entries.size -> FinishScreen(s, near)
            else -> SetScreen(s, s.entryIndex, hr) { overview = true }
        }
    }
}

/* ---------- building blocks ---------- */

/** A big rounded button: lime for the one thing to press, a dark tile for the rest. 48 dp tall at least. */
@Composable
fun Pill(
    label: String, modifier: Modifier = Modifier, primary: Boolean = false, danger: Boolean = false,
    armed: Boolean = false, onLongClick: (() -> Unit)? = null, onClick: () -> Unit,
) {
    // `armed`: a destructive button after its first tap, filled red; the second tap does it.
    val bg = when { armed -> Og.Red; primary -> Og.Lime; else -> Og.Tile }
    val fg = when { armed -> Og.Text; primary -> Og.OnLime; danger -> Og.Red; else -> Og.Text }
    Box(
        modifier
            .heightIn(min = Og.Tap)
            .clip(RoundedCornerShape(50))
            .background(bg)
            .combinedClickable(role = Role.Button, onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = fg, fontSize = 15.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2)
    }
}

@Composable
fun Quiet(text: String, size: TextUnit = 12.sp, modifier: Modifier = Modifier, lines: Int = 2, align: TextAlign = TextAlign.Center) =
    Text(text, modifier = modifier, color = Og.Quiet, fontSize = size, textAlign = align, maxLines = lines, overflow = TextOverflow.Ellipsis)

@Composable
fun Tag(text: String, color: Color) {
    Box(Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.18f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
        Text(text, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** A ring that empties as `fraction` goes from 1 to 0 (the rest), or fills (progress). */
@Composable
fun Ring(fraction: Float, modifier: Modifier = Modifier, stroke: Dp = 8.dp, color: Color = Og.Lime) {
    Canvas(modifier) {
        val px = stroke.toPx()
        val inset = px / 2 + 2
        val sz = Size(size.width - inset * 2, size.height - inset * 2)
        val tl = Offset(inset, inset)
        drawArc(Og.TileHi, 0f, 360f, false, tl, sz, style = Stroke(px))
        if (fraction > 0f) drawArc(color, -90f, 360f * fraction.coerceIn(0f, 1f), false, tl, sz, style = Stroke(px, cap = StrokeCap.Round))
    }
}

@Composable
fun PhoneAway(near: Boolean) {
    if (!near) Quiet(stringResource(R.string.phone_away), 11.sp, Modifier.padding(top = 6.dp))
}

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

/* ---------- idle: start today's routine, or another ---------- */

@Composable
fun IdleScreen(s: SessionState, near: Boolean, onStart: (ReadySession) -> Unit) {
    val list = rememberScalingLazyListState()
    val today = s.ready?.today
    val others = s.ready?.others.orEmpty()
    ScalingLazyColumn(
        state = list,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 30.dp, bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text((s.streak?.weeks ?: 0).toString(), style = Og.Number, fontSize = 34.sp,
                    color = if (s.streak?.thisWeekDone == true) Og.Lime else Og.Text)
                Quiet(stringResource(R.string.week_streak), 11.sp)
            }
        }
        if (!s.synced) {
            item { Text(stringResource(R.string.not_synced), fontWeight = FontWeight.Bold, fontSize = 15.sp, textAlign = TextAlign.Center) }
            item { Quiet(stringResource(R.string.open_phone_once), lines = 4) }
            return@ScalingLazyColumn
        }
        if (today != null) {
            item { Quiet(stringResource(R.string.today), 12.sp) }
            item { Text(today.name, fontWeight = FontWeight.Bold, fontSize = 17.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            item { Pill(stringResource(R.string.start_workout), Modifier.fillMaxWidth(), primary = true) { onStart(today) } }
        } else {
            item { Quiet(stringResource(R.string.rest_day), 13.sp) }
            others.firstOrNull()?.let { first ->
                item { Pill(stringResource(R.string.quick_start), Modifier.fillMaxWidth(), primary = true) { onStart(first) } }
            }
        }
        if (others.isNotEmpty()) {
            item { Quiet(stringResource(R.string.routines), 12.sp, Modifier.padding(top = 8.dp)) }
            items(others) { r -> RoutineRow(r) { onStart(r) } }
        }
        if (today == null && others.isEmpty()) item { Quiet(stringResource(R.string.start_on_phone), lines = 3) }
        item { PhoneAway(near) }
    }
}

@Composable
fun RoutineRow(r: ReadySession, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(26.dp)).background(Og.Tile)
            .combinedClickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(r.name, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Quiet(r.entries.take(3).joinToString(", ") { it.name }, 11.sp, lines = 1, align = TextAlign.Start)
    }
}

/* ---------- the set: big numbers, the crown, Done ---------- */

private enum class Field { W, R, SEC }

@Composable
fun SetScreen(s: SessionState, ei: Int, hr: Int?, onOverview: () -> Unit) {
    val w = s.workout ?: return
    val e = w.entries.getOrNull(ei) ?: return
    val si = SessionCore.setIndex(s, ei)
    val unit = e.weightUnit(w.unit)
    if (si == null) {
        // Everything of this exercise done or skipped: on to the next, or Finish.
        Column(Modifier.fillMaxSize().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(e.name, fontWeight = FontWeight.Bold, fontSize = 15.sp, textAlign = TextAlign.Center, maxLines = 2)
            Quiet(stringResource(R.string.all_sets_done), 13.sp)
            Spacer(Modifier.height(10.dp))
            Pill(stringResource(R.string.continue_workout), primary = true) { WearStore.setEntryIndex(SessionCore.next(s, ei, e.sets.lastIndex).first) }
        }
        return
    }
    val row = e.sets[si]
    val side = row.sideUp
    val sideRow = side?.let { row.sides?.get(it) }
    // The draft: what Done will log, from the set's planned numbers, per set and side.
    var dw by remember(w.id, ei, si, side) { mutableStateOf(sideRow?.w ?: row.w) }
    var dr by remember(w.id, ei, si, side) { mutableStateOf(sideRow?.r ?: row.r) }
    var dsec by remember(w.id, ei, si, side) { mutableStateOf(row.sec) }
    val fields = when {
        e.isCardio -> emptyList()
        e.isTimed -> listOf(Field.SEC)
        e.isBodyweight -> listOf(Field.R, Field.W)
        else -> listOf(Field.W, Field.R)
    }
    val crownFirst = if (s.settings.crown == "weight" && Field.W in fields) Field.W else fields.firstOrNull { it != Field.W } ?: fields.firstOrNull()
    var sel by remember(w.id, ei, si, side) { mutableStateOf(crownFirst) }
    var editing by remember(w.id, ei, si, side) { mutableStateOf<Field?>(null) }
    val step = e.stepOr(w.unit)
    val bump: (Field, Int) -> Unit = { f, d ->
        when (f) {
            Field.W -> dw = SessionCore.stepWeight(dw, step, d)
            Field.R -> dr = SessionCore.stepReps(dr, d)
            Field.SEC -> dsec = ((dsec ?: 0.0) + d * 5).coerceIn(0.0, 3600.0)
        }
    }
    editing?.let { f ->
        ValueEditor(
            label = stringResource(when (f) { Field.W -> if (e.isBodyweight) R.string.added_weight else R.string.weight; Field.R -> R.string.reps; Field.SEC -> R.string.time }),
            value = when (f) { Field.W -> fmt(dw); Field.R -> fmt(dr); Field.SEC -> clock((dsec ?: 0.0).toLong()) },
            unit = if (f == Field.W) unit else "",
            onStep = { bump(f, it) },
            onClose = { editing = null },
        )
        return
    }
    val focus = remember { FocusRequester() }
    LaunchedEffect(ei, si, side) { try { focus.requestFocus() } catch (_: Exception) {} }
    val total = e.sets.count { !it.warmup }
    val n = e.sets.take(si + 1).count { !it.warmup }
    Column(
        Modifier.fillMaxSize().crown(focus) { d -> sel?.let { bump(it, d) } }.padding(horizontal = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            when {
                row.warmup -> Tag(stringResource(R.string.warmup), Og.Warm)
                side == "L" -> Tag(stringResource(R.string.left), Og.Lime)
                side == "R" -> Tag(stringResource(R.string.right), Og.Lime)
                e.group != null -> Tag(stringResource(R.string.superset), Og.Lime)
            }
            if (!row.warmup && total > 0) Quiet(stringResource(R.string.set_of, n, total), 11.sp, lines = 1)
        }
        Text(
            e.name, modifier = Modifier.padding(top = 2.dp).combinedClickable(role = Role.Button, onClick = onOverview),
            fontWeight = FontWeight.Bold, fontSize = 15.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (s.settings.show?.showLast != false && e.last != null) Quiet(stringResource(R.string.last_time, e.last), 10.sp, lines = 1)
        Spacer(Modifier.height(6.dp))
        if (e.isCardio) {
            Quiet(stringResource(R.string.log_on_phone), 13.sp, lines = 3)
            Spacer(Modifier.height(10.dp))
            Pill(stringResource(R.string.skip_set)) { WearStore.skip(ei, si) }
            return@Column
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            for (f in fields) {
                val big = f != Field.W || !e.isBodyweight
                ValueTile(
                    value = when (f) { Field.W -> fmt(dw); Field.R -> fmt(dr); Field.SEC -> clock((dsec ?: 0.0).toLong()) },
                    unit = when (f) { Field.W -> unit; else -> "" },
                    label = stringResource(when (f) { Field.W -> if (e.isBodyweight) R.string.added_weight else R.string.weight; Field.R -> R.string.reps; Field.SEC -> R.string.time }),
                    selected = sel == f, big = big,
                ) { if (sel == f) editing = f else sel = f }
            }
        }
        val showHr = s.settings.show?.showHr != false
        Box(Modifier.height(18.dp), contentAlignment = Alignment.Center) {
            if (showHr && hr != null) Text("♥ $hr", color = Og.Red, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { contentDescription = "$hr" })
        }
        // Done: the one lime thing on the screen. A long press skips the set instead.
        Pill(
            stringResource(R.string.done), Modifier.widthIn(min = 96.dp), primary = true,
            onLongClick = { WearStore.skip(ei, si) },
        ) {
            WearStore.tick(ei, si, side, if (Field.W in fields) dw else null, if (Field.R in fields) dr else null, if (e.isTimed) dsec else null)
        }
        Spacer(Modifier.height(14.dp))
    }
}

/** A number you can tap: big, on a soft tile, outlined in lime while the crown turns it. */
@Composable
fun ValueTile(value: String, unit: String, label: String, selected: Boolean, big: Boolean, onClick: () -> Unit) {
    Column(
        Modifier
            .clip(RoundedCornerShape(18.dp))
            .background(if (selected) Og.TileHi else Og.Tile)
            .border(2.dp, if (selected) Og.Lime else Color.Transparent, RoundedCornerShape(18.dp))
            .combinedClickable(role = Role.Button, onClick = onClick)
            .widthIn(min = 64.dp)
            .padding(horizontal = 10.dp, vertical = 4.dp)
            .semantics { contentDescription = "$label, $value $unit" },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, style = Og.Number, fontSize = if (big) 32.sp else 22.sp, color = Og.Text, maxLines = 1)
            if (unit.isNotEmpty()) Text(" $unit", color = Og.Quiet, fontSize = 11.sp, modifier = Modifier.padding(bottom = 5.dp))
        }
        Text(label, color = if (selected) Og.Lime else Og.Quiet, fontSize = 10.sp, maxLines = 1)
    }
}

/** One number full screen: the crown, or − and + for a watch without one. */
@Composable
fun ValueEditor(label: String, value: String, unit: String, onStep: (Int) -> Unit, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { try { focus.requestFocus() } catch (_: Exception) {} }
    Column(
        Modifier.fillMaxSize().crown(focus, onStep).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Text(label, color = Og.Lime, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            RoundKey("−", stringResource(R.string.less)) { onStep(-1) }
            Row(verticalAlignment = Alignment.Bottom) {
                Text(value, style = Og.Number, fontSize = 44.sp, maxLines = 1)
                if (unit.isNotEmpty()) Text(" $unit", color = Og.Quiet, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
            }
            RoundKey("+", stringResource(R.string.more)) { onStep(1) }
        }
        Quiet(stringResource(R.string.crown_hint), 11.sp)
        Spacer(Modifier.height(10.dp))
        Pill(stringResource(R.string.done), primary = true, onClick = onClose)
    }
}

@Composable
fun RoundKey(glyph: String, said: String, onClick: () -> Unit) {
    Box(
        Modifier.size(Og.Tap).clip(CircleShape).background(Og.Tile)
            .combinedClickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = said },
        contentAlignment = Alignment.Center,
    ) { Text(glyph, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Og.Text) }
}

/* ---------- the rest: a ring that empties, the buzz at the end ---------- */

@Composable
fun RestScreen(s: SessionState, rest: Rest, hr: Int?) {
    val now by produceState(System.currentTimeMillis(), rest) {
        while (true) { value = System.currentTimeMillis(); delay(200) }
    }
    val left = ((rest.endsAt - now) / 1000.0).coerceAtLeast(0.0)
    val frac = (left / rest.total.coerceAtLeast(1)).toFloat()
    val w = s.workout
    val ne = w?.entries?.getOrNull(s.entryIndex)
    val nsi = ne?.let { SessionCore.setIndex(s, s.entryIndex) }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Ring(frac, Modifier.fillMaxSize().padding(4.dp), stroke = 10.dp)
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Quiet(stringResource(R.string.rest), 13.sp)
            Text(clock(kotlin.math.ceil(left).toLong()), style = Og.Number, fontSize = 48.sp)
            if (s.settings.show?.showNext != false && ne != null && nsi != null) {
                Quiet(stringResource(R.string.next_set, ne.name, ne.sets.take(nsi + 1).count { !it.warmup }.coerceAtLeast(1)), 11.sp,
                    Modifier.padding(horizontal = 28.dp))
            }
            if (hr != null) Text("♥ $hr", color = Og.Red, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pill("+15") { WearStore.addRest(15) }
                Pill(stringResource(R.string.skip)) { WearStore.stopRest() }
            }
        }
    }
}

/* ---------- the exercises at a glance, and the way out ---------- */

@Composable
fun OverviewScreen(s: SessionState, onPick: (Int) -> Unit, onBack: () -> Unit) {
    val w = s.workout ?: return
    val list = rememberScalingLazyListState()
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(confirm) { if (confirm) { delay(3000); confirm = false } }
    ScalingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 30.dp, bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item { Text(w.name, fontWeight = FontWeight.Bold, fontSize = 15.sp, textAlign = TextAlign.Center, maxLines = 2) }
        items(w.entries.size) { i -> ExerciseRow(w.entries[i], i == s.entryIndex) { onPick(i) } }
        item { Pill(stringResource(R.string.finish_workout), Modifier.fillMaxWidth(), primary = true) { onPick(w.entries.size) } }
        item {
            Pill(stringResource(R.string.discard_workout), Modifier.fillMaxWidth(), danger = true, armed = confirm) {
                if (confirm) { WearStore.finish(discard = true); onBack() } else confirm = true
            }
        }
        item { Pill(stringResource(R.string.continue_workout), Modifier.fillMaxWidth(), onClick = onBack) }
    }
}

@Composable
fun ExerciseRow(e: Entry, current: Boolean, onClick: () -> Unit) {
    val work = e.sets.filter { !it.warmup }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(26.dp))
            .background(if (current) Og.TileHi else Og.Tile)
            .combinedClickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(e.name, Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
            color = if (current) Og.Lime else Og.Text)
        Text("${work.count { it.done }}/${work.size}", style = Og.Number, fontSize = 13.sp, color = Og.Quiet)
    }
}

@Composable
fun FinishScreen(s: SessionState, near: Boolean) {
    val (done, total) = SessionCore.progress(s)
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(confirm) { if (confirm) { delay(3000); confirm = false } }
    val list = rememberScalingLazyListState(initialCenterItemIndex = 1)
    ScalingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 30.dp, bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item { Text(stringResource(R.string.finish_workout_q), fontWeight = FontWeight.Bold, fontSize = 16.sp, textAlign = TextAlign.Center) }
        item { Quiet(stringResource(R.string.sets_of, done, total), 12.sp) }
        item { Pill(stringResource(R.string.finish_and_save), Modifier.fillMaxWidth(), primary = true) { WearStore.finish() } }
        item {
            Pill(stringResource(R.string.continue_workout), Modifier.fillMaxWidth()) {
                val first = s.workout?.entries?.indices?.firstOrNull { SessionCore.setIndex(s, it) != null } ?: 0
                WearStore.setEntryIndex(first)
            }
        }
        item {
            Pill(stringResource(R.string.discard_workout), Modifier.fillMaxWidth(), danger = true, armed = confirm) {
                if (confirm) WearStore.finish(discard = true) else confirm = true
            }
        }
        item { PhoneAway(near) }
    }
}

/* ---------- the end ---------- */

@Composable
fun SummaryScreen(sum: WorkoutSummary, near: Boolean, onDone: () -> Unit) {
    val list = rememberScalingLazyListState()
    ScalingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 30.dp, bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item { Text(stringResource(if (sum.endedOnPhone) R.string.ended_on_phone else R.string.workout_saved), color = Og.Lime, fontWeight = FontWeight.Bold, fontSize = 14.sp, textAlign = TextAlign.Center) }
        item { Text(sum.name, fontWeight = FontWeight.Bold, fontSize = 17.sp, textAlign = TextAlign.Center, maxLines = 2) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                sum.duration?.let { Stat(stringResource(R.string.time), clock(it.toLong())) }
                Stat(stringResource(R.string.sets), sum.sets.toString())
            }
        }
        item { Stat(stringResource(R.string.volume), fmt(Math.round(sum.volume).toDouble()) + " " + sum.unit) }
        if (sum.hrAvg != null && sum.hrMax != null) item { Stat(stringResource(R.string.heart_rate), "${sum.hrAvg} / ${sum.hrMax}") }
        if (sum.prs.isNotEmpty()) {
            item { Quiet(stringResource(R.string.prs), 12.sp, Modifier.padding(top = 4.dp)) }
            items(sum.prs) { Text(it, color = Og.Lime, fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2) }
        }
        item { PhoneAway(near) }
        item { Pill(stringResource(R.string.done), Modifier.fillMaxWidth().padding(top = 6.dp), primary = true, onClick = onDone) }
    }
}

@Composable
fun Stat(label: String, value: String) {
    Column(
        Modifier.clip(RoundedCornerShape(16.dp)).background(Og.Tile).padding(horizontal = 14.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, style = Og.Number, fontSize = 20.sp, maxLines = 1)
        Quiet(label, 10.sp, lines = 1)
    }
}
