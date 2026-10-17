package ch.duartesantos.opengym.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.focusable
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.HorizontalPageIndicator
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PageIndicatorState
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import java.text.DecimalFormat
import kotlinx.coroutines.delay

private val number = DecimalFormat("0.##")
private fun fmt(v: Double): String = number.format(v)
private fun round2(v: Double): Double = Math.round(v * 100.0) / 100.0
private fun clock(ms: Long): String {
    val s = ((ms + 999) / 1000).toInt()
    return "%d:%02d".format(s / 60, s % 60)
}

@Composable
fun EmptyScreen() {
    Box(Modifier.fillMaxSize())
}

// ------------------------------------------------------------------------------------------ home

@Composable
fun HomeScreen() {
    val index by Repository.index.collectAsStateWithLifecycle()
    val outbox by Repository.outbox.collectAsStateWithLifecycle()
    val fetch by Repository.fetch.collectAsStateWithLifecycle()
    val state = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = state) }) {
        ScalingLazyColumn(Modifier.fillMaxSize(), state = state) {
            item { ListHeader { Text(stringResource(R.string.home_title)) } }
            if (outbox.isNotEmpty()) {
                item {
                    Chip(
                        onClick = { Repository.resendOutbox() },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.home_waiting, outbox.size), maxLines = 2) },
                        secondaryLabel = { Text(stringResource(R.string.home_send_again)) },
                        colors = ChipDefaults.secondaryChipColors(),
                    )
                }
            }
            when (val f = fetch) {
                is Repository.Fetch.Waiting -> {
                    item { Text(stringResource(R.string.home_asking), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
                    item {
                        Chip(
                            onClick = { Repository.cancelFetch() }, modifier = Modifier.fillMaxWidth(),
                            label = { Text(stringResource(R.string.home_cancel)) }, colors = ChipDefaults.secondaryChipColors(),
                        )
                    }
                }
                is Repository.Fetch.Failed -> {
                    item {
                        Text(
                            stringResource(if (f.reason == Repository.Reason.MISSING) R.string.home_missing else R.string.home_unreachable),
                            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (f.hasCopy && f.routineId != null) {
                        item {
                            Chip(
                                onClick = { Repository.startFromCopy(f.routineId) }, modifier = Modifier.fillMaxWidth(),
                                label = { Text(stringResource(R.string.home_use_last)) },
                            )
                        }
                    }
                    item {
                        Chip(
                            onClick = { Repository.ask(f.routineId) }, modifier = Modifier.fillMaxWidth(),
                            label = { Text(stringResource(R.string.home_retry)) }, colors = ChipDefaults.secondaryChipColors(),
                        )
                    }
                    item {
                        Chip(
                            onClick = { Repository.cancelFetch() }, modifier = Modifier.fillMaxWidth(),
                            label = { Text(stringResource(R.string.home_cancel)) }, colors = ChipDefaults.secondaryChipColors(),
                        )
                    }
                }
                Repository.Fetch.Idle -> {
                    val routines = index?.routines.orEmpty()
                    if (routines.isEmpty()) {
                        item { Text(stringResource(R.string.home_empty), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
                    }
                    items(routines) { r ->
                        Chip(
                            onClick = { Repository.start(r.id) }, modifier = Modifier.fillMaxWidth(),
                            label = { Text(r.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            secondaryLabel = { Text(stringResource(R.string.home_exercises, r.exercises)) },
                        )
                    }
                    item {
                        Chip(
                            onClick = { Repository.ask(null) }, modifier = Modifier.fillMaxWidth(),
                            label = { Text(stringResource(R.string.home_refresh)) }, colors = ChipDefaults.secondaryChipColors(),
                        )
                    }
                }
            }
        }
    }
}

// Placed here so the file reads top to bottom; ScalingLazyListScope.items for a List.
private inline fun <T> androidx.wear.compose.foundation.lazy.ScalingLazyListScope.items(
    list: List<T>,
    crossinline content: @Composable (T) -> Unit,
) {
    list.forEach { x -> item { content(x) } }
}

// ------------------------------------------------------------------------------------------ the workout

private val sameBox = Modifier.fillMaxSize()

/**
 * The workout: one page per exercise, swiped through in any order. The page on screen is the
 * session's current exercise (Repository.goTo follows a swipe; a finished set or an undo moves the
 * page), the ring round the edge is how far through the routine you are, and a rest, when one is
 * running, shows on every page with its own ring inside that one.
 */
@Composable
fun WorkoutScreen(a: ActiveWorkout, onMenu: () -> Unit) {
    val snap = a.snapshot
    val s = a.session
    val ambient by Ambient.on.collectAsStateWithLifecycle()
    val pager = rememberPagerState(initialPage = s.ex.coerceIn(0, maxOf(0, snap.exercises.size - 1))) { snap.exercises.size }
    val context = LocalContext.current

    // The page follows the session, and the session follows the page.
    LaunchedEffect(pager) { snapshotFlow { pager.settledPage }.collect { Repository.goTo(it) } }
    LaunchedEffect(s.ex) { if (pager.settledPage != s.ex && s.ex in 0 until pager.pageCount) pager.animateScrollToPage(s.ex) }

    // The rest ends here, once, whichever page is showing. The service rings it when the screen is
    // off; with the screen on, whichever notices first does.
    LaunchedEffect(s.restEndsAt) {
        if (s.restEndsAt > 0) {
            delay(maxOf(0L, s.restEndsAt - System.currentTimeMillis()) + 1_500)
            if (Repository.restFinished(s.restEndsAt)) Haptics.restOver(context)
        }
    }

    // What was typed on a page and not confirmed, kept for when you come back to it.
    val drafts = remember { mutableMapOf<Triple<Int, Int, Int>, StepValue>() }

    if (ambient) {
        AmbientWorkout(a)
        return
    }
    Box(sameBox) {
        HorizontalPager(
            state = pager, modifier = sameBox,
            // Half a drop set or rest-pause is not left behind by a swipe.
            userScrollEnabled = s.partial.isEmpty(),
        ) { page ->
            ExercisePage(
                a = a, page = page, active = pager.currentPage == page,
                drafts = drafts, onMenu = onMenu,
            )
        }
        // How far through the routine, round the edge of the screen.
        CircularProgressIndicator(
            progress = Engine.progress(snap, s), modifier = sameBox.padding(1.dp), strokeWidth = 3.dp,
            indicatorColor = MaterialTheme.colors.secondary, trackColor = MaterialTheme.colors.onBackground.copy(alpha = 0.12f),
        )
        if (snap.exercises.size > 1) {
            HorizontalPageIndicator(
                pageIndicatorState = remember(pager) {
                    object : PageIndicatorState {
                        override val pageOffset: Float get() = pager.currentPageOffsetFraction
                        override val selectedPage: Int get() = pager.currentPage
                        override val pageCount: Int get() = pager.pageCount
                    }
                },
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp),
            )
        }
    }
}

@Composable
private fun ExercisePage(a: ActiveWorkout, page: Int, active: Boolean, drafts: MutableMap<Triple<Int, Int, Int>, StepValue>, onMenu: () -> Unit) {
    val s = a.session
    val where = Engine.pageFor(a.snapshot, s, page)
    if (where == null) {
        FinishedExercise(a, page, onMenu)
        return
    }
    // The page's own place in the exercise, which is the session's when this is the current one.
    val view = if (page == s.ex) s else s.copy(ex = page, set = where.second, step = 0, partial = emptyList())
    if (s.restEndsAt > 0) RestPanel(a, view, onMenu) else SetPanel(a, view, active, drafts, onMenu)
}

@Composable
private fun SetPanel(a: ActiveWorkout, s: Session, active: Boolean, drafts: MutableMap<Triple<Int, Int, Int>, StepValue>, onMenu: () -> Unit) {
    val snap = a.snapshot
    val ex = snap.exercises[s.ex]
    val set = ex.sets[s.set]
    val plan = Engine.planned(snap, s)
    val cursor = Repository.Cursor(s.ex, s.set, s.step)
    val context = LocalContext.current

    // The values being typed restart from the plan for every step, or from what was typed last time here.
    val key = Triple(s.ex, s.set, s.step)
    var vals by remember(key) { mutableStateOf(drafts[key] ?: plan) }
    val showWeight = !ex.timed || plan.w > 0 || set.w > 0
    // A rest-pause keeps one load through all its mini-sets.
    val weightLocked = set.type == "restpause" && s.step > 0
    var onWeight by remember(key) { mutableStateOf(false) }
    val weightEditable = showWeight && !weightLocked
    val crownOnWeight = onWeight && weightEditable

    val focus = remember { FocusRequester() }
    val haptic = LocalHapticFeedback.current
    var pixels by remember { mutableStateOf(0f) }
    val weightStep = if (ex.timed) 2.5 else ex.step
    val adjust = { clicks: Int ->
        vals = when {
            crownOnWeight -> vals.copy(w = round2(maxOf(0.0, vals.w + clicks * weightStep)))
            ex.timed -> vals.copy(sec = maxOf(0, vals.sec + clicks * ex.step.toInt()))
            else -> vals.copy(r = maxOf(0, vals.r + clicks))
        }
        drafts[key] = vals
    }
    // The crown goes to the page on screen.
    LaunchedEffect(key, active) { if (active) focus.requestFocus() }

    val title = when {
        set.type == "dropset" && s.step > 0 -> stringResource(R.string.step_drop, s.step)
        set.type == "restpause" && s.step == 0 && set.steps > 1 -> stringResource(R.string.step_activation)
        set.type == "restpause" -> stringResource(R.string.step_burst, s.step + 1, set.steps)
        else -> null
    }
    val (n, of) = Engine.numberAmong(snap, s.ex, s.set)
    val head = stringResource(if (set.warmup) R.string.set_warmup else R.string.set_of, n, of)

    Box(
        Modifier
            .fillMaxSize()
            .onRotaryScrollEvent { e ->
                pixels += e.verticalScrollPixels
                val clicks = (pixels / CROWN_PIXELS_PER_CLICK).toInt()
                if (clicks != 0) {
                    pixels -= clicks * CROWN_PIXELS_PER_CLICK
                    adjust(clicks)
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                }
                true
            }
            .focusRequester(focus)
            .focusable(),
    ) {
        Column(
            Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(ex.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.title3)
                Text(
                    listOfNotNull(head, title, stringResource(R.string.label_failure).takeIf { set.failure && s.step == 0 }).joinToString(" · "),
                    style = MaterialTheme.typography.caption1, color = MaterialTheme.colors.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (showWeight) {
                    ValueTile(
                        label = stringResource(R.string.label_weight) + " " + snap.unit,
                        value = fmt(vals.w), selected = crownOnWeight, enabled = weightEditable,
                        onClick = { onWeight = true },
                    )
                }
                ValueTile(
                    label = stringResource(if (ex.timed) R.string.label_seconds else R.string.label_reps) + if (set.max && s.step == 0) " · " + stringResource(R.string.label_max) else "",
                    value = if (ex.timed) vals.sec.toString() else vals.r.toString(), selected = !crownOnWeight, enabled = true,
                    onClick = { onWeight = false },
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = onMenu, modifier = Modifier.size(ButtonDefaults.SmallButtonSize),
                    colors = ButtonDefaults.secondaryButtonColors(),
                ) { Text("⋯") }
                Button(
                    onClick = {
                        Haptics.confirmed(context)
                        drafts.remove(key)
                        Repository.confirm(vals, cursor)
                    },
                    modifier = Modifier.size(ButtonDefaults.LargeButtonSize),
                ) { Text("✓", style = MaterialTheme.typography.title1) }
            }
        }
    }
}

private const val CROWN_PIXELS_PER_CLICK = 40f

@Composable
private fun ValueTile(label: String, value: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        Modifier
            .clip(shape)
            .background(if (selected) MaterialTheme.colors.primary.copy(alpha = 0.22f) else MaterialTheme.colors.surface)
            .border(if (selected) 2.dp else 0.dp, MaterialTheme.colors.primary, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(label, style = MaterialTheme.typography.caption3, color = MaterialTheme.colors.onSurfaceVariant, maxLines = 1)
        Text(value, style = MaterialTheme.typography.display2)
    }
}

/** An exercise with a result for every set: what it came to, and the way on. */
@Composable
private fun FinishedExercise(a: ActiveWorkout, page: Int, onMenu: () -> Unit) {
    val ex = a.snapshot.exercises[page]
    val (done, total) = Engine.exerciseCount(a.snapshot, a.session, page)
    Column(
        Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(ex.name, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, style = MaterialTheme.typography.title3)
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("✓", style = MaterialTheme.typography.display1, color = MaterialTheme.colors.secondary)
            Text(stringResource(R.string.exercise_done, done, total), style = MaterialTheme.typography.caption1, color = MaterialTheme.colors.onSurfaceVariant)
        }
        Button(onClick = onMenu, modifier = Modifier.size(ButtonDefaults.SmallButtonSize), colors = ButtonDefaults.secondaryButtonColors()) { Text("⋯") }
    }
}

// ------------------------------------------------------------------------------------------ rest

@Composable
private fun RestPanel(a: ActiveWorkout, view: Session, onMenu: () -> Unit) {
    val s = a.session
    val now by produceState(System.currentTimeMillis(), s.restEndsAt) {
        while (true) {
            value = System.currentTimeMillis()
            delay(250)
        }
    }
    val left = maxOf(0L, s.restEndsAt - now)
    val total = maxOf(1, s.restTotalSec) * 1000f
    val ex = a.snapshot.exercises[view.ex]
    val (n, of) = Engine.numberAmong(a.snapshot, view.ex, view.set)
    val up = stringResource(if (ex.sets[view.set].warmup) R.string.set_warmup else R.string.set_of, n, of)

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        // Inside the routine's ring, which is drawn once over the whole pager.
        CircularProgressIndicator(
            progress = (left / total).coerceIn(0f, 1f), modifier = Modifier.fillMaxSize().padding(9.dp), strokeWidth = 5.dp,
        )
        Column(
            Modifier.fillMaxSize().padding(start = 28.dp, end = 28.dp, top = 28.dp, bottom = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(stringResource(R.string.rest_title), style = MaterialTheme.typography.caption1, color = MaterialTheme.colors.onSurfaceVariant)
            Text(clock(left), style = MaterialTheme.typography.display1)
            Text(
                ex.name + " · " + up, maxLines = 2, overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center, style = MaterialTheme.typography.caption2,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Button(onClick = { Repository.adjustRest(-15) }, modifier = Modifier.size(ButtonDefaults.SmallButtonSize), colors = ButtonDefaults.secondaryButtonColors()) { Text("−15") }
                Button(onClick = { Repository.skipRest() }, modifier = Modifier.size(ButtonDefaults.DefaultButtonSize)) { Text(stringResource(R.string.rest_skip), maxLines = 1) }
                Button(onClick = { Repository.adjustRest(15) }, modifier = Modifier.size(ButtonDefaults.SmallButtonSize), colors = ButtonDefaults.secondaryButtonColors()) { Text("+15") }
            }
        }
    }
}

// ------------------------------------------------------------------------------------------ ambient

/**
 * The workout with the screen dimmed: black, plain, nothing to tap. The system redraws an ambient
 * screen about once a minute, so a second-by-second countdown would be wrong most of the time; the
 * rest shows the clock time it ends at instead (the buzz still comes on the second, from the
 * service). Raising the wrist brings the live screen back.
 */
@Composable
private fun AmbientWorkout(a: ActiveWorkout) {
    val tick by Ambient.tick.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val s = a.session
    val ex = a.snapshot.exercises[s.ex]
    val (n, of) = Engine.numberAmong(a.snapshot, s.ex, s.set)
    val head = stringResource(if (ex.sets[s.set].warmup) R.string.set_warmup else R.string.set_of, n, of)
    // The tick is read here so the screen is redrawn whenever the system lets it be.
    val ends = if (tick >= 0 && s.restEndsAt > System.currentTimeMillis()) android.text.format.DateFormat.getTimeFormat(context).format(java.util.Date(s.restEndsAt)) else null
    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black), contentAlignment = Alignment.Center) {
        Column(Modifier.padding(horizontal = 30.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(ex.name, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, style = MaterialTheme.typography.title3)
            Text(head, style = MaterialTheme.typography.caption1)
            if (ends != null) {
                Text(stringResource(R.string.rest_title), style = MaterialTheme.typography.caption1)
                Text(stringResource(R.string.rest_until, ends), style = MaterialTheme.typography.display3)
            }
        }
    }
}

// ------------------------------------------------------------------------------------------ menu, done

@Composable
fun MenuScreen(a: ActiveWorkout, onClose: () -> Unit) {
    val s = a.session
    val at = Repository.Cursor(s.ex, s.set, s.step)
    var confirmDiscard by remember { mutableStateOf(false) }
    val state = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = state) }) {
        ScalingLazyColumn(Modifier.fillMaxSize(), state = state) {
            if (!s.finished) {
                if (s.partial.isNotEmpty()) {
                    item { MenuChip(R.string.menu_stop_bursts) { Repository.stopHere(at); onClose() } }
                } else {
                    item { MenuChip(R.string.menu_skip) { Repository.skip(at); onClose() } }
                }
            }
            if (s.partial.isNotEmpty() || s.results.isNotEmpty()) {
                item { MenuChip(R.string.menu_undo) { Repository.undo(); onClose() } }
            }
            item { MenuChip(R.string.menu_finish) { Repository.finish(); onClose() } }
            item {
                Chip(
                    onClick = { if (confirmDiscard) { Repository.discard(); onClose() } else confirmDiscard = true },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.menu_discard)) },
                    secondaryLabel = if (confirmDiscard) ({ Text("?") }) else null,
                    colors = ChipDefaults.secondaryChipColors(),
                )
            }
            item { MenuChip(R.string.menu_back, onClose) }
        }
    }
}

@Composable
private fun MenuChip(label: Int, onClick: () -> Unit) {
    Chip(onClick = onClick, modifier = Modifier.fillMaxWidth(), label = { Text(stringResource(label)) }, colors = ChipDefaults.secondaryChipColors())
}

@Composable
fun DoneScreen(a: ActiveWorkout) {
    val s = a.session
    val minutes = maxOf(1, ((System.currentTimeMillis() - s.start) / 60000).toInt())
    val state = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = state) }) {
        ScalingLazyColumn(Modifier.fillMaxSize(), state = state) {
            item { ListHeader { Text(stringResource(R.string.done_title), textAlign = TextAlign.Center) } }
            item {
                Text(
                    stringResource(R.string.done_summary, Engine.setsDone(s), minutes),
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Chip(
                    onClick = { Repository.finish() }, modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.done_send)) },
                )
            }
            item { MenuChip(R.string.done_back) { Repository.undo() } }
        }
    }
}
