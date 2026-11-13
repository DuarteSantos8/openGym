package ch.duartesantos.opengym.wear.ui

import androidx.compose.animation.AnimatedContent
import ch.duartesantos.opengym.wear.Stills
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.Image
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.wear.compose.foundation.pager.VerticalPager
import androidx.wear.compose.material3.VerticalPageIndicator
import androidx.wear.compose.material3.VerticalPagerScaffold
import ch.duartesantos.opengym.wear.Metrics
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.view.HapticFeedbackConstants
import androidx.wear.compose.foundation.curvedComposable
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.foundation.pager.HorizontalPager
import androidx.wear.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material3.HorizontalPageIndicator
import androidx.wear.compose.material3.HorizontalPagerScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.material3.curvedText
import androidx.wear.compose.material3.timeTextCurvedText
import androidx.wear.compose.material3.timeTextSeparator
import ch.duartesantos.opengym.wear.BuildConfig
import ch.duartesantos.opengym.wear.Effort
import ch.duartesantos.opengym.wear.Entry
import ch.duartesantos.opengym.wear.Fix
import ch.duartesantos.opengym.wear.Keypad
import ch.duartesantos.opengym.wear.Overview
import ch.duartesantos.opengym.wear.Page
import ch.duartesantos.opengym.wear.MediaControls
import ch.duartesantos.opengym.wear.PhoneLink
import ch.duartesantos.opengym.wear.Plan
import ch.duartesantos.opengym.wear.R
import ch.duartesantos.opengym.wear.ReadySession
import ch.duartesantos.opengym.wear.Rest
import ch.duartesantos.opengym.wear.SessionCore
import ch.duartesantos.opengym.wear.SetNav
import ch.duartesantos.opengym.wear.SetRef
import ch.duartesantos.opengym.wear.SyncState
import ch.duartesantos.opengym.wear.TopLine
import ch.duartesantos.opengym.wear.WearStore
import ch.duartesantos.opengym.wear.WeighIn
import ch.duartesantos.opengym.wear.WorkoutSummary
import ch.duartesantos.opengym.wear.nextSetNumbers
import ch.duartesantos.opengym.wear.nudge

/* ---------- the app: one screen at a time, fading into each other ---------- */

private enum class Screen { COUNT, WEIGH, SUMMARY, START, IDLE, SESSION }

/** On a round screen the clock and heart rate curve down the sides: a title at the top keeps this far in. */
private val TitleInset = 20.dp
/** Where a list's first line starts on a round screen: under the curved clock, not beside it. */
private val ListTop = 40.dp

@Composable
fun WearApp(onWorkoutShown: () -> Unit = {}) {
    val s by WearStore.state.collectAsState()
    val summary by WearStore.summary.collectAsState()
    val countIn by WearStore.countIn.collectAsState()
    val weighIn by WearStore.weighInFor.collectAsState()
    val askDone by WearStore.askDone.collectAsState()
    val goAt by WearStore.goAt.collectAsState()
    val ambient = LocalAmbient.current
    val reduce = LocalReduceMotion.current
    val w = s.workout
    LaunchedEffect(w?.id) { if (w != null) onWorkoutShown() }
    // Wrist down on the Overview or the music: the set is what the next glance is for.
    LaunchedEffect(ambient) {
        if (ambient && WearStore.page.value.let { it == Page.OVERVIEW || it == Page.MEDIA }) WearStore.page.value = Page.SET
    }
    val screen = when {
        countIn != null -> Screen.COUNT
        weighIn != null -> Screen.WEIGH
        summary != null -> Screen.SUMMARY
        w == null -> Screen.START
        askDone -> Screen.IDLE
        else -> Screen.SESSION
    }
    Box(Modifier.fillMaxSize().background(Og.Bg)) {
        AnimatedContent(screen, transitionSpec = { Motion.fade(reduce, ambient) }, label = "screen") { sc ->
            when (sc) {
                Screen.COUNT -> countIn?.let { c ->
                    CountdownView(c.from, stringResource(R.string.start_workout), onTap = { WearStore.startNow() }, onCancel = { WearStore.cancelCountIn() })
                }
                Screen.WEIGH -> WeighInScreen()
                Screen.SUMMARY -> summary?.let { SummaryScreen(it) }
                Screen.START -> StartScreen(s)
                Screen.IDLE -> IdlePrompt()
                Screen.SESSION -> SessionScreen()
            }
        }
        if (goAt != null) GoView()
    }
}

/** The clock at the top, with what belongs beside it: "Today", "Quick check-in", the sync pill and the heart rate. */
@Composable
fun OgTimeText() {
    val s by WearStore.state.collectAsState()
    val weighIn by WearStore.weighInFor.collectAsState()
    val summary by WearStore.summary.collectAsState()
    val hr by WearStore.heartRate.collectAsState()
    val sync = rememberSync()
    val today = stringResource(R.string.today)
    val checkIn = stringResource(R.string.quick_checkin)
    // "Still training?" has a title of two lines right under the clock: the clock alone there.
    val asking by WearStore.askDone.collectAsState()
    val running = s.workout != null && summary == null && weighIn == null && !asking
    // A 40/41 mm watch at a large text size has no arc left for a word before the clock.
    val tight = LocalConfiguration.current.screenWidthDp < 210 && LocalDensity.current.fontScale > 1.15f
    val lead = when {
        tight -> null
        weighIn != null -> checkIn
        s.workout == null && summary == null && s.ready?.today != null -> today
        else -> null
    }?.takeIf { TopLine.leadFits(it, LocalConfiguration.current.screenWidthDp) }
    val showHr = running && hr != null && s.settings.show?.showHr != false
    // The 3-2-1 and Go! fill the round screen with their ring: no clock over it.
    val countIn by WearStore.countIn.collectAsState()
    val holdCount by WearStore.holdCountIn.collectAsState()
    val go by WearStore.goAt.collectAsState()
    val pg by WearStore.page.collectAsState()
    if (countIn != null || go != null || (holdCount != null && pg == Page.SET)) return
    // At the largest text sizes the curved line ran off its arc into the title below: it grows at most 10 %.
    val d = LocalDensity.current
    androidx.compose.runtime.CompositionLocalProvider(LocalDensity provides androidx.compose.ui.unit.Density(d.density, d.fontScale.coerceAtMost(1.1f))) {
    TimeText { time ->
        if (lead != null) { curvedText(lead, color = Og.Label2); timeTextSeparator() }
        timeTextCurvedText(time)
        val pill = running && sync.count > 0
        if (pill) { timeTextSeparator(); curvedComposable { SyncPill(sync) } }
        // Not both: time, pill and heart rate together ran down the arc into a long title ("45° Side
        // Bend" lost its last letter on a 1.4" watch). The pill stays, the Metrics page has the heart rate.
        if (showHr && !pill) {
            timeTextSeparator()
            curvedComposable {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Glyph(G.HEART, Og.Red, 9.dp); Spacer(Modifier.width(2.dp))
                    Text("$hr", color = Og.Red, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, style = Og.Number)
                }
            }
        }
    }
    }
}

@Composable
fun rememberSync(): SyncState {
    val n by PhoneLink.waitingSets.collectAsState()
    val near by WearStore.phoneNear.collectAsState()
    return SyncState.of(n, near)
}

/* ---------- the start screen ---------- */

@Composable
fun StartScreen(s: ch.duartesantos.opengym.wear.SessionState) {
    val list = rememberTransformingLazyColumnState()
    val ready = s.ready
    val today = ready?.today
    val others = ready?.others.orEmpty()
    val sync = rememberSync()
    // The first snapshot swaps "Not synced yet" for the routines: start at the top, not mid-list.
    val empty = today == null && others.isEmpty()
    LaunchedEffect(empty) { if (!empty) list.scrollToItem(0) }
    TransformingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 30.dp + 16.dp * (LocalDensity.current.fontScale - 1f).coerceIn(0f, 0.5f), bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (today == null && others.isEmpty()) {
            item { LogoMark() }
            item {
                Text(stringResource(if (!s.synced) R.string.not_synced else R.string.no_workout), fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp, textAlign = TextAlign.Center)
            }
            item { Quiet(stringResource(if (!s.synced) R.string.open_phone_once else R.string.start_on_phone), 12.sp, lines = 4) }
            item { VersionLine() }
            return@TransformingLazyColumn
        }
        if (today != null) {
            item { TodayCard(today) }
        } else {
            item { Quiet(stringResource(R.string.rest_day), 13.sp) }
            others.firstOrNull()?.let { first ->
                item { PrimaryButton(stringResource(R.string.quick_start), Modifier.fillMaxWidth(), icon = G.PLAY) { WearStore.start(first) } }
            }
        }
        items(others) { r ->
            RowButton(r.name, Modifier.fillMaxWidth(), center = false, icon = G.PLAY, tint = Og.Text) { WearStore.start(r) }
        }
        // A workout finished here with the phone away: its sets are still on their way.
        item { SyncLine(sync, showSynced = false) }
        item { VersionLine() }
    }
}

/** Today's routine: its name big, how big it is, and one wide Start. */
@Composable
fun TodayCard(session: ReadySession) {
    val (exercises, sets) = Plan.size(session.entries)
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(session.name, fontSize = 19.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2,
            overflow = TextOverflow.Ellipsis, letterSpacing = (-0.3).sp)
        if (exercises > 0) {
            Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Stat(exercises, stringResource(R.string.exercises))
                Stat(sets, stringResource(R.string.sets))
            }
        }
        PrimaryButton(stringResource(R.string.start_workout), Modifier.fillMaxWidth().padding(top = 6.dp), icon = G.PLAY) { WearStore.start(session) }
    }
}

@Composable
private fun Stat(n: Int, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.semantics(mergeDescendants = true) {}) {
        Text("$n", style = Og.Number, fontSize = 19.sp)
        Quiet(label, 10.sp, lines = 1)
    }
}

/** The logo mark (assets/logo/opengym-mark.svg) in brand green, for a screen with nothing else to show. */
@Composable
fun LogoMark() {
    androidx.compose.foundation.Canvas(Modifier.size(60.dp, (60f * 174f / 352f).dp)) {
        val s = size.width / 352f
        val green = androidx.compose.ui.graphics.Color(0xFFA3E635)
        // x, y, width, height on the mark's own 352 x 174 grid: square corners, these exact proportions.
        for (r in arrayOf(floatArrayOf(0f, 73f, 352f, 28f), floatArrayOf(0f, 30f, 36f, 114f), floatArrayOf(51f, 0f, 47f, 174f),
                floatArrayOf(254f, 0f, 47f, 174f), floatArrayOf(316f, 30f, 36f, 114f))) {
            drawRect(green, androidx.compose.ui.geometry.Offset(r[0] * s, r[1] * s), androidx.compose.ui.geometry.Size(r[2] * s, r[3] * s))
        }
    }
}

/** "openGym 1.4.5 (10032)", small at the end of the start screen: which build is on the watch. */
@Composable
fun VersionLine() {
    Text("openGym ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", color = Og.Label3, fontSize = 10.sp,
        modifier = Modifier.padding(top = 6.dp).semantics { contentDescription = "" })
}

/* ---------- the weigh-in ---------- */

@Composable
fun WeighInScreen() {
    val bw by WearStore.bodyWeight.collectAsState()
    val s by WearStore.state.collectAsState()
    val dim = LocalAmbient.current
    val unit = s.unit
    var tenthOn by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val view = LocalView.current
    LaunchedEffect(Unit) { try { focus.requestFocus() } catch (_: Exception) {} }
    val (whole, tenth) = WeighIn.parts(bw)
    val list = rememberTransformingLazyColumnState()
    TransformingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize().crown(focus) { d ->
            val (wh, te) = WeighIn.parts(WearStore.bodyWeight.value)
            WearStore.bodyWeight.value = if (tenthOn) WeighIn.join(wh, (te + d).coerceIn(0, 9))
            else WeighIn.join((wh + d).coerceIn(20, if (unit == "lb") 700 else 320), te)
            view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        },
        rotaryScrollableBehavior = null,
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 40.dp, bottom = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        item {
            val said = stringResource(R.string.body_weight)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 60.dp).clip(RoundedCornerShape(Og.Radius))
                    .background(if (dim) Color.Transparent else Og.Surface)
                    .border(if (dim) 1.dp else 0.dp, Og.Surface2, RoundedCornerShape(Og.Radius))
                    .semantics { contentDescription = "$said, ${"%.1f".format(bw)} $unit" },
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.Bottom,
            ) {
                Digits("$whole", !tenthOn, 36) { tenthOn = false }
                Text(".", style = Og.Number, fontSize = 36.sp, color = Og.Label2)
                Digits("$tenth", tenthOn, 29) { tenthOn = true }
                Text(" $unit", color = Og.Label2, fontSize = 13.sp, modifier = Modifier.padding(bottom = 10.dp))
            }
        }
        item { PrimaryButton(stringResource(R.string.save_and_start), Modifier.fillMaxWidth()) { WearStore.finishWeighIn(true) } }
        item { RowButton(stringResource(R.string.start_without_weighin), Modifier.fillMaxWidth()) { WearStore.finishWeighIn(false) } }
        item {
            Text(stringResource(R.string.cancel), color = Og.Label2, fontSize = 13.sp,
                modifier = Modifier.heightIn(min = 40.dp).padding(top = 10.dp).combinedClickable(role = Role.Button) { WearStore.cancelWeighIn() })
        }
    }
}

@Composable
private fun Digits(text: String, on: Boolean, size: Int, onClick: () -> Unit) {
    val a = LocalAccent.current
    val dim = LocalAmbient.current
    Box(
        Modifier.heightIn(min = Og.Tap).clip(RoundedCornerShape(10.dp))
            .background(if (on && !dim) Og.Surface2 else Color.Transparent)
            .combinedClickable(role = Role.Button, onClick = onClick).padding(horizontal = 4.dp),
        contentAlignment = Alignment.BottomCenter,
    ) { Text(text, style = Og.Number, fontSize = size.sp, color = if (on) a.accent else Og.Text) }
}

/* ---------- the session: Overview ← Set → Metrics → Music ---------- */

@Composable
fun SessionScreen() {
    val page by WearStore.page.collectAsState()
    val ambient = LocalAmbient.current
    val reduce = LocalReduceMotion.current
    val pager = rememberPagerState(initialPage = page.ordinal) { Page.entries.size }
    LaunchedEffect(page) {
        if (pager.currentPage != page.ordinal) {
            if (ambient || reduce) pager.scrollToPage(page.ordinal) else pager.animateScrollToPage(page.ordinal)
        }
    }
    LaunchedEffect(pager) {
        snapshotFlow { pager.settledPage }.collect { WearStore.page.value = Page.entries[it] }
    }
    // A page reached by code (a tap on the Overview) left the dots on the old page: drawn afresh once it settles.
    HorizontalPagerScaffold(pagerState = pager, pageIndicator = { key(pager.settledPage) { HorizontalPageIndicator(pagerState = pager) } }) {
        HorizontalPager(state = pager, userScrollEnabled = !ambient, rotaryScrollableBehavior = null) { i ->
            when (Page.entries[i]) {
                Page.OVERVIEW -> OverviewPage(pager.currentPage == i)
                Page.SET -> LivePage(pager.currentPage == i)
                Page.METRICS -> MetricsStack(pager.currentPage == i)
                Page.MEDIA -> MediaPage()
            }
        }
    }
}

/** The set page: the set up next, the rest after it, a hold while it runs; each fades in, never a cut. */
@Composable
fun LivePage(onScreen: Boolean) {
    val s by WearStore.state.collectAsState()
    val rest by WearStore.rest.collectAsState()
    val hold by WearStore.hold.collectAsState()
    val holdCount by WearStore.holdCountIn.collectAsState()
    val fix by WearStore.fix.collectAsState()
    val ambient = LocalAmbient.current
    val reduce = LocalReduceMotion.current
    val panel = when {
        holdCount != null -> "count"
        hold != null -> "hold"
        fix != null -> "set"
        rest != null -> "rest"
        WearStore.shownRef() != null -> "set"
        else -> "done"
    }
    CapText {
        AnimatedContent(panel, transitionSpec = { Motion.fade(reduce, ambient) }, label = "panel") { p ->
            when (p) {
                "count" -> holdCount?.let { from ->
                    CountdownView(from, stringResource(R.string.start_hold), onTap = { WearStore.stopHoldCount(); WearStore.startHold(auto = true) },
                        onCancel = { WearStore.stopHoldCount() })
                }
                "hold" -> hold?.let { HoldView(it.startedAt, it.endsAt) }
                "rest" -> rest?.let { RestView(it) }
                "set" -> SetPanel(onScreen)
                else -> DonePanel(s)
            }
        }
    }
}

/* ---------- the set ---------- */

private enum class Field { W, R, SEC }

@Composable
fun SetPanel(onScreen: Boolean) {
    val s by WearStore.state.collectAsState()
    val draft by WearStore.draft.collectAsState()
    val fix by WearStore.fix.collectAsState()
    val rest by WearStore.rest.collectAsState()
    val lastStep by WearStore.lastStep.collectAsState()
    val ambient = LocalAmbient.current
    val reduce = LocalReduceMotion.current
    val view = LocalView.current
    val w = s.workout ?: return
    val ref = fix?.ref ?: WearStore.shownRef() ?: return
    val e = w.entries.getOrNull(ref.entry) ?: return
    val row = e.sets.getOrNull(ref.set) ?: return
    val fixing = fix != null
    val unit = e.weightUnit(w.unit)
    val fields = when {
        e.isCardio -> emptyList()
        e.isTimed -> if ((row.w ?: 0.0) > 0) listOf(Field.SEC, Field.W) else listOf(Field.SEC)
        e.isBodyweight -> listOf(Field.R, Field.W)
        else -> listOf(Field.W, Field.R)
    }
    val first = when {
        e.isCardio -> null
        e.isTimed -> Field.SEC
        s.settings.crown == "weight" && !e.isBodyweight -> Field.W
        else -> Field.R
    }
    var sel by remember(ref, fixing) { mutableStateOf(first) }
    var keypad by remember(ref, fixing) { mutableStateOf<Field?>(null) }
    var confirmSkip by remember(ref) { mutableStateOf(false) }
    fun value(f: Field): Double = when (f) {
        Field.W -> fix?.w ?: draft.w
        Field.R -> fix?.r ?: draft.r
        Field.SEC -> fix?.sec ?: draft.sec
    }
    val hi = if (unit == "lb") 1500.0 else 700.0
    fun set(f: Field, v: Double) {
        val fx = WearStore.fix.value
        if (fx != null) WearStore.editFix(when (f) { Field.W -> fx.copy(w = v); Field.R -> fx.copy(r = v); Field.SEC -> fx.copy(sec = v) })
        else WearStore.draft.value.let { d -> WearStore.setDraft(when (f) { Field.W -> d.copy(w = v); Field.R -> d.copy(r = v); Field.SEC -> d.copy(sec = v) }) }
    }
    fun bump(f: Field, d: Int) {
        val v = value(f)
        set(f, when (f) {
            Field.W -> nudge(v, d, e.stepOr(w.unit), 0.0, hi)
            Field.R -> nudge(v, d, 1.0, 0.0, 200.0)
            Field.SEC -> nudge(v, d, 5.0, 1.0, 3600.0)
        })
        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
    }
    keypad?.let { f ->
        KeypadView(
            decimals = if (f == Field.W) 2 else 0, unit = when (f) { Field.W -> unit; Field.SEC -> "s"; Field.R -> null },
            range = when (f) { Field.W -> 0.0..hi; Field.R -> 0.0..200.0; Field.SEC -> 1.0..3600.0 },
            start = value(f), onSave = { set(f, it); keypad = null }, onClose = { keypad = null },
        )
        return
    }
    if (confirmSkip) {
        Confirm(stringResource(R.string.skip_set_q), stringResource(R.string.skip_set), danger = false,
            onYes = { confirmSkip = false; WearStore.skipSet() }, onNo = { confirmSkip = false })
        return
    }
    val focus = remember { FocusRequester() }
    LaunchedEffect(ref, fixing, onScreen, ambient) { if (onScreen && !ambient) try { focus.requestFocus() } catch (_: Exception) {} }
    val partners = Overview.partners(w.entries, ref.entry).joinToString(", ").ifEmpty { null }
    val round = LocalRound.current
    BoxWithConstraints(Modifier.fillMaxSize().crown(focus) { d -> sel?.let { bump(it, d) } }) {
        // What fits: on a small watch the name takes one line and the extra lines go.
        // Measured: one-line name, the place line, the boxes and ‹ Done › take 196 dp on a round watch, 176 on a square one,
        // at the normal text size; ~80 dp of that is text, which grows with the watch's font size (capped at 1.12×).
        var spare = maxHeight.value - (if (round) 196 else 176) - (LocalDensity.current.fontScale - 1f) * 80
        val effortKind = if (fixing && !row.warmup && !e.isCardio) s.settings.effort else null
        val effortLine = effortKind != null && spare >= 28
        if (effortLine) spare -= 28
        // No room for its own line: the effort takes the place of the "Done" tag, 8 dp taller.
        if (effortKind != null && !effortLine) spare -= 8
        val partnerLine = partners != null && spare >= 15
        if (partnerLine) spare -= 15
        val hasLast = !fixing && !row.warmup && s.settings.show?.showLast != false && !e.last.isNullOrEmpty()
        val lastLine = hasLast && spare >= 14
        if (lastLine) spare -= 14
        val twoLines = spare >= 20
        val bigNumbers = spare >= 0
        // Still short (a fix with its effort on a small watch): the boxes' names go; "kg" and the spoken label stay.
        val boxLabels = spare >= -8
        Column(
            Modifier.fillMaxSize().padding(start = if (round) 22.dp else 8.dp, end = if (round) 22.dp else 8.dp, top = 26.dp, bottom = if (round) 24.dp else 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // The set's lines move with ‹ › (Motion.nudge); the arrows and the button stay still.
            AnimatedContent(ref to fixing, transitionSpec = { Motion.nudge(lastStep, reduce, ambient) }, label = "set",
                modifier = Modifier.weight(1f)) { _ ->
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(e.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                        maxLines = if (twoLines) 2 else 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = if (round) TitleInset else 0.dp))
                    PlaceLine(e, ref, fixing, fix?.side ?: row.sideUp, if (partnerLine) null else partners, rest,
                        effortKind.takeIf { !effortLine }, fix)
                    if (partnerLine && partners != null) PartnerLine(partners)
                    if (fixing && row.sides != null) SideSwitch(fix?.side)
                    Spacer(Modifier.weight(1f))
                    if (e.isCardio) Quiet(stringResource(R.string.log_on_phone), 12.sp, lines = 3)
                    else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        val tint = if (row.warmup) Og.Warmup else Og.Text
                        for (f in fields) {
                            val v = value(f)
                            NumberBox(
                                value = (if (f == Field.W && e.isBodyweight && v > 0) "+" else "") + fmt(v),
                                unit = when (f) { Field.W -> unit; Field.SEC -> "s"; Field.R -> null },
                                label = stringResource(when (f) {
                                    Field.W -> if (e.isBodyweight) R.string.added_weight else R.string.weight
                                    Field.R -> R.string.reps
                                    Field.SEC -> R.string.hold
                                }),
                                selected = sel == f, tint = tint, big = bigNumbers, showLabel = boxLabels, modifier = Modifier.weight(1f),
                            ) { if (sel == f) keypad = f else sel = f }
                        }
                    }
                    if (effortLine && effortKind != null) FixEffort(effortKind, fix)
                    if (lastLine) Quiet(stringResource(R.string.last_time, e.last ?: ""), 10.sp, lines = 1)
                }
            }
            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                ArrowButton(left = true, enabled = WearStore.canStep(-1)) { WearStore.step(-1) }
                when {
                    fixing -> PrimaryButton(stringResource(R.string.save), Modifier.weight(1f), icon = G.CHECK, iconWhenTight = true, enabled = fix?.changed == true) { WearStore.saveFix() }
                    e.isTimed -> PrimaryButton(stringResource(R.string.start_hold), Modifier.weight(1f), icon = G.PLAY, iconWhenTight = true) { WearStore.startHold() }
                    e.isCardio -> RowButton(stringResource(R.string.skip_set), Modifier.weight(1f), lines = 1) { WearStore.skipSet() }
                    else -> PrimaryButton(stringResource(R.string.done), Modifier.weight(1f), icon = G.CHECK, iconWhenTight = true, onLongClick = { confirmSkip = true }) {
                        WearStore.completeSet()
                    }
                }
                ArrowButton(left = false, enabled = WearStore.canStep(1)) { WearStore.step(1) }
            }
        }
    }
}

/** "Set 2 of 4" and what kind of set: warm-up, the side up, done (when it is a fix). */
@Composable
private fun PlaceLine(e: Entry, ref: SetRef, fixing: Boolean, side: String?, partner: String?, rest: Rest?,
                      effortInline: String? = null, fix: Fix? = null) {
    val a = LocalAccent.current
    val (n, of) = SetNav.place(e, ref.set)
    val row = e.sets[ref.set]
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Quiet(stringResource(R.string.set_of, n, of), 11.sp, lines = 1)
        if (row.warmup) Tag(stringResource(R.string.warmup), Og.Warmup)
        if (!fixing && side == "L") Tag(stringResource(R.string.left), Og.Teal)
        if (!fixing && side == "R") Tag(stringResource(R.string.right), Og.Teal)
        if (fixing && effortInline != null) FixEffort(effortInline, fix)
        else if (fixing) Tag(stringResource(R.string.done), a.accent)
        if (partner != null && !fixing) PartnerLine(partner, small = true)
        if (fixing && rest != null) {
            // The rest runs on while a set is fixed: its time stays in sight.
            val now = rememberNow()
            Text(clock(kotlin.math.ceil((rest.endsAt - now) / 1000.0).toLong()), color = a.accent, fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold, style = Og.Number)
        }
    }
}

@Composable
private fun PartnerLine(names: String, small: Boolean = false) {
    val said = stringResource(R.string.superset) + ", " + names
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = said }) {
        Glyph(G.LINK, Og.Purple, 10.dp); Spacer(Modifier.width(3.dp))
        Text(names, color = Og.Purple, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = if (small) Modifier.width(70.dp) else Modifier)
    }
}

/** The two sides of a per-side set being fixed: which one the numbers are. */
@Composable
private fun SideSwitch(side: String?) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (sd in listOf("L", "R")) {
            val on = side == sd
            Box(
                Modifier.heightIn(min = 26.dp).clip(CircleShape).background(if (on) Og.Teal else Og.Teal.copy(alpha = 0.18f))
                    .combinedClickable(role = Role.Button) { WearStore.setFixSide(sd) }.padding(horizontal = 9.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(if (sd == "L") R.string.left else R.string.right).uppercase(), color = if (on) Color.Black else Og.Teal,
                    fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** The effort on a set being fixed: a tap goes through the quick ratings and back to as it was. */
@Composable
private fun FixEffort(kind: String, fix: Fix?) {
    val a = LocalAccent.current
    val v = fix?.effort
    val color = v?.let { Og.effortColor(Effort.band(kind, it), a.accent) } ?: Og.Label2
    Box(
        Modifier.heightIn(min = 26.dp).clip(CircleShape).background(color.copy(alpha = 0.18f))
            .combinedClickable(role = Role.Button) {
                val chips = Effort.chips(kind)
                val i = v?.let { chips.indexOf(it) } ?: -1
                fix?.let { WearStore.editFix(it.copy(effort = if (i < 0) chips.first() else chips.getOrNull(i + 1))) }
            }.padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text("${Effort.name(kind)} ${v?.let { Effort.chipLabel(kind, it) } ?: "–"}", color = color, fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold, style = Og.Number)
    }
}

/** Past the last set, or an exercise with nothing left (picked on the Overview after it was done). */
@Composable
fun DonePanel(s: ch.duartesantos.opengym.wear.SessionState) {
    val a = LocalAccent.current
    val e = WearStore.entry()
    val atEnd = Overview.atEnd(s)
    val left = e?.sets?.any { !it.done } ?: false
    Column(Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center) {
        if (!atEnd && e != null) Text(e.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, maxLines = 2)
        Box(Modifier.size(40.dp).clip(CircleShape).background(if (left && !atEnd) Og.Surface2 else a.accent), contentAlignment = Alignment.Center) {
            Glyph(if (left && !atEnd) G.NEXT else G.CHECK, if (left && !atEnd) Og.Label2 else a.on, 20.dp)
        }
        Spacer(Modifier.height(6.dp))
        Text(stringResource(if (left && !atEnd) R.string.skipped_waiting else R.string.all_sets_done), fontSize = 14.sp,
            textAlign = TextAlign.Center, color = if (atEnd) Og.Text else Og.Label2, fontWeight = if (atEnd) FontWeight.SemiBold else FontWeight.Normal)
        Spacer(Modifier.height(8.dp))
        if (atEnd) {
            PrimaryButton(stringResource(R.string.finish_workout), Modifier.fillMaxWidth(), icon = G.FLAG) { WearStore.page.value = Page.OVERVIEW }
        } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            ArrowButton(true, WearStore.canStep(-1)) { WearStore.step(-1) }
            RowButton(stringResource(R.string.overview), Modifier.weight(1f), lines = 1) { WearStore.page.value = Page.OVERVIEW }
            ArrowButton(false, WearStore.canStep(1)) { WearStore.step(1) }
        }
    }
}

/* ---------- the keypad: a value the crown's steps don't land on (62.25 kg) ---------- */

@Composable
fun KeypadView(decimals: Int, unit: String?, range: ClosedFloatingPointRange<Double>, start: Double, onSave: (Double) -> Unit, onClose: () -> Unit) {
    var pad by remember { mutableStateOf(Keypad(decimals)) }
    val a = LocalAccent.current
    val view = LocalView.current
    val typed = pad.text.isNotEmpty()
    val bad = typed && !pad.fits(range)
    val round = LocalRound.current
    BoxWithConstraints(Modifier.fillMaxSize().background(Og.Bg)) {
        val keyH = ((maxHeight.value - (if (round) 92 else 56)) / 4 - 3).coerceAtLeast(22f).dp
        Column(Modifier.fillMaxSize().padding(horizontal = if (round) 26.dp else 6.dp, vertical = if (round) 18.dp else 4.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.height(34.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                EdgeButton(stringResource(R.string.cancel), glyph = G.LEFT, size = 30.dp, onClick = onClose)
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.Bottom) {
                    Text(if (typed) pad.text else fmt(start), style = Og.Number, fontSize = 22.sp, maxLines = 1,
                        color = if (bad) Og.Red else if (typed) Og.Text else Og.Label3)
                    if (unit != null) Text(" $unit", color = Og.Label2, fontSize = 11.sp, modifier = Modifier.padding(bottom = 3.dp))
                }
                val ok = pad.fits(range)
                Box(
                    Modifier.size(40.dp, 30.dp).clip(CircleShape).background(if (ok) a.accent else a.accent.copy(alpha = 0.35f))
                        .combinedClickable(enabled = ok, role = Role.Button) { pad.value?.let(onSave) }
                        .semantics { contentDescription = "" },
                    contentAlignment = Alignment.Center,
                ) { Glyph(G.CHECK, a.on, 15.dp) }
            }
            for (keys in listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf(".", "0", "⌫"))) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    for (k in keys) {
                        val off = k == "." && decimals == 0
                        Box(
                            Modifier.weight(1f).height(keyH).clip(RoundedCornerShape(9.dp)).background(if (off) Color.Transparent else Og.Surface2)
                                .combinedClickable(enabled = !off, role = Role.Button) {
                                    pad = if (k == "⌫") pad.back() else pad.press(k)
                                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (k == "⌫") Glyph(G.BACK, Og.Text, 18.dp)
                            else if (!off) Text(k, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Og.Text)
                        }
                    }
                }
            }
        }
    }
}

/* ---------- the rest ---------- */

@Composable
fun RestView(rest: Rest) {
    val s by WearStore.state.collectAsState()
    val last by WearStore.lastLogged.collectAsState()
    val rated by WearStore.lastRated.collectAsState()
    val a = LocalAccent.current
    val dim = LocalAmbient.current
    val now = rememberNow()
    val left = ((rest.endsAt - now) / 1000.0).coerceAtLeast(0.0)
    val round = LocalRound.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        // Round watches lose their corners: the bottom row sits higher, the extra lines go first.
        val roomy = maxHeight.value >= (if (round) 260 else 200)
        // Measured: up next and the effort chips together need 222 dp at the normal text size (and ~60 dp of it is text).
        // Without that (a 40/41 mm watch) the question comes first, then what's next.
        val both = roomy || maxHeight.value >= 222 + (LocalDensity.current.fontScale - 1f) * 60
        Column(Modifier.fillMaxSize().padding(start = if (round) 20.dp else 6.dp, end = if (round) 20.dp else 6.dp, top = 22.dp, bottom = if (round) 26.dp else 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (last != null && !dim) ArrowButton(true, true) { WearStore.fixLast() } else Spacer(Modifier.width(32.dp))
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Quiet(stringResource(R.string.rest), 11.sp, lines = 1)
                    Text(clock(kotlin.math.ceil(left).toLong()), style = Og.Number, fontSize = if (roomy) 42.sp else 36.sp, maxLines = 1,
                        color = Og.Text.copy(alpha = if (dim) 0.75f else 1f))
                }
                Spacer(Modifier.width(32.dp))
            }
            if (s.settings.show?.rest != "plain") TimeBar(rest.startedAt, rest.endsAt, a.accent, Modifier.padding(horizontal = 8.dp))
            val rate = WearStore.canRateLast() && !dim && (both || rated == null)
            if (s.settings.show?.showNext != false && (both || !rate)) UpNext(roomy)
            Spacer(Modifier.weight(1f))
            if (rate) EffortChips(roomy)
            // Round: the row sits low, where the circle narrows, so −15 and +15 step in from the edge.
            if (!dim) Row(Modifier.fillMaxWidth().padding(horizontal = if (LocalRound.current) 8.dp else 0.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                EdgeButton("−15 s", text = "−15", size = 40.dp) { WearStore.minusRest() }
                RowButton(stringResource(R.string.skip), Modifier.weight(1f).height(40.dp), icon = G.NEXT, iconWhenTight = true) { WearStore.skipRest() }
                EdgeButton("+15 s", text = "+15", size = 40.dp) { WearStore.addRest(15) }
            } else Spacer(Modifier.height(40.dp))
        }
    }
}

/** "Up next: Bench Press, set 3 · Left", and under it what to load (#911). */
@Composable
private fun UpNext(roomy: Boolean) {
    val s by WearStore.state.collectAsState()
    val w = s.workout ?: return
    val e = WearStore.entry() ?: return
    val si = WearStore.setIndex() ?: return
    val side = e.sets[si].sideUp
    val line = stringResource(R.string.up_next) + ": " + stringResource(R.string.up_next_set, e.name, SetNav.place(e, si).first) +
        (side?.let { " · " + stringResource(if (it == "L") R.string.left else R.string.right) } ?: "")
    Quiet(line, 11.sp, lines = if (roomy) 2 else 1)
    nextSetNumbers(e, si, w.unit)?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, style = Og.Number) }
}

/** "RIR · How hard was that set?" and four chips; once rated, the rating in a small capsule that opens the chips again. */
@Composable
private fun EffortChips(roomy: Boolean) {
    val s by WearStore.state.collectAsState()
    val rated by WearStore.lastRated.collectAsState()
    val last by WearStore.lastLogged.collectAsState()
    val a = LocalAccent.current
    val kind = s.settings.effort ?: "rir"
    var again by remember(last) { mutableStateOf(false) }
    val r = rated
    if (r != null && !again) {
        val c = Og.effortColor(Effort.band(kind, r), a.accent)
        Row(
            Modifier.heightIn(min = 28.dp).clip(CircleShape).background(c.copy(alpha = 0.18f))
                .combinedClickable(role = Role.Button) { again = true }.padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${Effort.name(kind)} ${Effort.chipLabel(kind, r)}", color = c, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, style = Og.Number)
            Spacer(Modifier.width(4.dp)); Glyph(G.CHECK, c, 10.dp)
        }
    } else Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (roomy) Quiet("${Effort.name(kind)} · " + stringResource(R.string.how_hard), 10.sp, lines = 1)
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (v in Effort.chips(kind)) {
                val c = Og.effortColor(Effort.band(kind, v), a.accent)
                Box(
                    Modifier.weight(1f).height(28.dp).clip(CircleShape).background(c.copy(alpha = 0.18f))
                        .combinedClickable(role = Role.Button) { WearStore.rateLast(v); again = false }
                        .semantics { contentDescription = "${Effort.name(kind)} ${Effort.chipLabel(kind, v)}" },
                    contentAlignment = Alignment.Center,
                ) { Text(Effort.chipLabel(kind, v), color = c, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, style = Og.Number) }
            }
        }
    }
}

/* ---------- a hold ---------- */

/** A timed set running: the seconds left big, the bar in teal (orange for the last five), and Stop. */
@Composable
fun HoldView(start: Long, end: Long) {
    val dim = LocalAmbient.current
    val now = rememberNow()
    val left = ((end - now) / 1000.0).coerceAtLeast(0.0)
    val close = end - now <= 5000
    val color = if (close) Og.Orange else Og.Teal
    val e = WearStore.entry()
    val side = WearStore.setIndex()?.let { e?.sets?.getOrNull(it)?.sideUp }
    val round = LocalRound.current
    Column(Modifier.fillMaxSize().padding(start = if (round) 22.dp else 6.dp, end = if (round) 22.dp else 6.dp, top = 28.dp, bottom = if (round) 26.dp else 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(e?.name ?: "", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false).padding(start = if (round) TitleInset else 0.dp))
            if (side == "L") Tag(stringResource(R.string.left), Og.Teal)
            if (side == "R") Tag(stringResource(R.string.right), Og.Teal)
        }
        Spacer(Modifier.weight(1f))
        Text(clock(kotlin.math.ceil(left).toLong()), style = Og.Number, fontSize = 46.sp, maxLines = 1,
            color = (if (close) Og.Orange else Og.Text).copy(alpha = if (dim) 0.75f else 1f))
        TimeBar(start, end, color, Modifier.padding(horizontal = 8.dp))
        Quiet(stringResource(R.string.hold), 11.sp, Modifier.padding(top = 3.dp))
        Spacer(Modifier.weight(1f))
        if (!dim) RowButton(stringResource(R.string.stop), Modifier.fillMaxWidth().padding(horizontal = if (round) 14.dp else 0.dp), icon = G.STOP) { WearStore.endHold(early = true) }
        else Spacer(Modifier.height(Og.Tap))
    }
}

/* ---------- the Overview ---------- */

@Composable
fun OverviewPage(onScreen: Boolean) {
    val s by WearStore.state.collectAsState()
    val hold by WearStore.hold.collectAsState()
    val w = s.workout ?: return
    val sync = rememberSync()
    var confirmDiscard by remember { mutableStateOf(false) }
    if (confirmDiscard) {
        Confirm(stringResource(R.string.discard_workout_q), stringResource(R.string.discard_workout), danger = true,
            onYes = { confirmDiscard = false; WearStore.discard() }, onNo = { confirmDiscard = false })
        return
    }
    val list = rememberTransformingLazyColumnState()
    val (done, total) = SessionCore.progress(s)
    val rows = Overview.rows(w, s.entryIndex)
    TransformingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = if (LocalRound.current) ListTop else 30.dp, bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        item { Text(w.name, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center, maxLines = 2) }
        if (total > 0) item { Quiet(stringResource(R.string.sets_of, done, total), 11.sp) }
        items(rows) { row ->
            Column(Modifier.fillMaxWidth()) {
                if (row.supersetStart) Row(Modifier.padding(start = 6.dp, top = 4.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Glyph(G.LINK, Og.Purple, 10.dp); Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.superset), color = Og.Purple, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                OverviewRowView(row, enabled = hold == null, wid = w.id, showClip = s.settings.show?.clip)
            }
        }
        item { SyncLine(sync, heard = s.synced, modifier = Modifier.padding(top = 6.dp)) }
        item { HoldToFinish(Modifier.padding(top = 4.dp)) { WearStore.finish() } }
        item { RowButton(stringResource(R.string.discard_workout), Modifier.fillMaxWidth(), tint = Og.Red) { confirmDiscard = true } }
    }
}

/** One exercise on the Overview: its mark (on now, done, still to do), its name and its sets. */
@Composable
private fun OverviewRowView(row: ch.duartesantos.opengym.wear.OverviewRow, enabled: Boolean, wid: String?, showClip: Boolean?) {
    val a = LocalAccent.current
    val dim = LocalAmbient.current
    val version by WearStore.stillsVersion.collectAsState()
    // The still the phone sent for this workout (5 KB, decoded once per arrival).
    val still = remember(wid, row.id, version) {
        WearStore.stillFile(wid, row.id)?.takeIf { it.isFile }?.let { f ->
            try { android.graphics.BitmapFactory.decodeFile(f.path)?.asImageBitmap() } catch (_: Exception) { null }
        }
    }
    val shape = RoundedCornerShape(12.dp)
    val said = stringResource(R.string.sets_of, row.done, row.total)
    Row(
        Modifier.fillMaxWidth().heightIn(min = Og.Tap).clip(shape)
            .background(if (dim) Color.Transparent else if (row.current) Og.Surface2 else Og.Surface)
            .border(if (row.current) 1.5.dp else if (dim) 1.dp else 0.dp, if (row.current) a.accent else Og.Surface2, shape)
            .combinedClickable(enabled = enabled, role = Role.Button) { WearStore.jump(row.index) }
            .semantics(mergeDescendants = true) { contentDescription = "${row.name}, $said" }
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val picture = still?.takeIf { Stills.shows(true, showClip, dim) }
        if (picture != null) Box(Modifier.size(30.dp)) {
            // The Apple Watch's mark: the still a little darker (greyed when done), its state on the corner.
            Image(picture, contentDescription = null, contentScale = ContentScale.Fit,
                colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(if (row.finished) 0f else 1f); timesAssign(ColorMatrix(floatArrayOf(
                    0.85f, 0f, 0f, 0f, 0f, 0f, 0.85f, 0f, 0f, 0f, 0f, 0f, 0.85f, 0f, 0f, 0f, 0f, 0f, 1f, 0f))) }),
                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(7.dp)).alpha(if (row.finished) 0.6f else 1f))
            if (row.current || row.finished) Box(
                Modifier.align(Alignment.BottomEnd).offset(3.dp, 3.dp).size(14.dp).clip(CircleShape).background(Color.Black),
                contentAlignment = Alignment.Center,
            ) { if (row.current) Glyph(G.PLAY, a.accent, 7.dp) else Glyph(G.CHECK, Og.Label2, 8.dp) }
        } else Box(Modifier.size(30.dp).clip(RoundedCornerShape(7.dp)).background(if (dim) Color.Transparent else Og.Surface2), contentAlignment = Alignment.Center) {
            if (row.current) Glyph(G.PLAY, a.accent, 11.dp) else if (row.finished) Glyph(G.CHECK, Og.Label2, 12.dp)
        }
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(row.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                color = if (row.finished) Og.Label2 else Og.Text)
            Text("${row.done}/${row.total}", color = Og.Label2, fontSize = 11.sp, style = Og.Number)
        }
    }
}

/** A question with two answers, as a card instead of a system dialog. */
@Composable
private fun Confirm(question: String, yes: String, danger: Boolean, onYes: () -> Unit, onNo: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 30.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically)) {
        Text(question, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        if (danger) RowButton(yes, Modifier.fillMaxWidth(), tint = Og.Red, onClick = onYes)
        else PrimaryButton(yes, Modifier.fillMaxWidth(), onClick = onYes)
        RowButton(stringResource(R.string.cancel), Modifier.fillMaxWidth(), onClick = onNo)
    }
}

/* ---------- Metrics and the music ---------- */

/**
 * Metrics is a vertical stack, as on the Apple Watch: the numbers, Pulse, Effort, Zones. The crown or a
 * swipe up and down moves it; sideways still goes to the next pages. Always On: back to the numbers.
 */
@Composable
fun MetricsStack(onScreen: Boolean) {
    val s by WearStore.state.collectAsState()
    // Only whether there is a heart rate, not each reading: the stack is not drawn again every second.
    val hasHr by remember { WearStore.heartRate.map { it != null }.distinctUntilChanged() }.collectAsState(WearStore.heartRate.value != null)
    val ambient = LocalAmbient.current
    // No heart rate (no permission, or none yet) or the phone's switch off: nothing to chart.
    val hasPulse = hasHr && s.settings.show?.showHr != false
    val hasZones = hasPulse && s.settings.show?.showZones != false
    val parts = if (!hasPulse) 2 else if (hasZones) 4 else 3
    val pager = rememberPagerState { parts }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    LaunchedEffect(onScreen, ambient) { if (onScreen && !ambient) try { focus.requestFocus() } catch (_: Exception) {} }
    LaunchedEffect(ambient) { if (ambient) pager.scrollToPage(0) }
    // Pulse comes or goes under you: back to the numbers, as on the Apple Watch, not onto another page.
    LaunchedEffect(hasPulse, hasZones) { if (pager.currentPage != 0) pager.scrollToPage(0) }
    VerticalPagerScaffold(pagerState = pager, pageIndicator = { VerticalPageIndicator(pagerState = pager) }) {
        VerticalPager(state = pager, userScrollEnabled = !ambient, rotaryScrollableBehavior = null,
            modifier = Modifier.crown(focus) { d -> scope.launch { pager.animateScrollToPage((pager.targetPage + d).coerceIn(0, parts - 1)) } },
        ) { i ->
            when {
                i == 0 -> MetricsPage()
                hasPulse && i == 1 -> PulsePage()
                hasZones && i == 3 -> ZonesPage()
                else -> EffortPage()
            }
        }
    }
}

/** The whole workout's heart rate: its average as the big number, and the line of every reading. */
@Composable
private fun PulsePage() {
    val readings by WearStore.readingCount.collectAsState()   // every reading draws it again, even an equal bpm
    val dim = LocalAmbient.current
    val samples = remember(readings) { WearStore.heartSamples() }
    val round = LocalRound.current
    CapText { BoxWithConstraints(Modifier.fillMaxSize()) {
        val hero = ((maxHeight.value - 30f - (if (round) 26f else 12f)) * 0.3f).coerceIn(40f, 68f)  // below the 30 dp top padding, above the page dots, which a round screen's curve makes 26 dp
        val range = Metrics.range(samples)
        val avail = maxWidth.value - (if (round) maxWidth.value * TopLine.ROUND_INSET else 10f) - 16f  // the column's inner width
        Column(Modifier.fillMaxSize().padding(start = if (round) (maxWidth.value * TopLine.ROUND_INSET).dp else 10.dp, end = 16.dp, top = 30.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MetricRow(Metrics.average(samples)?.toString() ?: "‒‒‒", stringResource(R.string.avg).uppercase(), G.HEART, hero, Og.Red)
            if (range != null) {
                val hi = "${range.last}"; val lo = "${range.first}"
                val maxL = stringResource(R.string.max).uppercase(); val minL = stringResource(R.string.min).uppercase()
                val meter = rememberRowMeter()
                fun pair(sz: Float) = meter.width(hi, maxL, false, sz) + 8f + meter.width(lo, minL, false, sz)
                // Side by side as on the Apple Watch, down to 3/4 size; past that (a 40 mm watch, "TỐI THIỂU") max over min.
                val full = hero * 0.6f
                val k = minOf(1f, avail / pair(full))
                val sz = full * k * 0.97f
                if (k >= 0.75f && pair(sz) <= avail) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MetricRow(hi, maxL, null, sz, Og.Text); MetricRow(lo, minL, null, sz, Og.Text)
                } else { MetricRow(hi, maxL, null, full, Og.Text); MetricRow(lo, minL, null, full, Og.Text) }
            }
            Sparkline(Metrics.downsample(samples, 60), Og.Red.copy(alpha = if (dim) 0.75f else 1f), dot = !dim,
                Modifier.fillMaxWidth().weight(1f).padding(bottom = 14.dp))
        }
    } }
}

/** A line through readings in time order, scaled to its own range. Still: nothing animates, no end dot in Always On. */
@Composable
private fun Sparkline(points: List<Pair<Double, Double>>, color: Color, dot: Boolean, modifier: Modifier) {
    Canvas(modifier.clearAndSetSemantics {}) {
        if (points.size < 2) return@Canvas
        val t0 = points.first().first
        val span = maxOf(points.last().first - t0, 1.0)
        val lo = points.minOf { it.second }
        val range = maxOf(points.maxOf { it.second } - lo, 10.0)
        val pad = 4.dp.toPx()
        fun xy(p: Pair<Double, Double>) = Offset(
            (pad + (size.width - 2 * pad) * ((p.first - t0) / span)).toFloat(),
            (pad + (size.height - 2 * pad) * (1 - (p.second - lo) / range)).toFloat(),
        )
        val line = Path().apply { moveTo(xy(points.first()).x, xy(points.first()).y); points.drop(1).forEach { val o = xy(it); lineTo(o.x, o.y) } }
        drawPath(line, color, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        if (dot) drawCircle(color, radius = 3.5.dp.toPx(), center = xy(points.last()))
    }
}

/** Today's effort: one row per exercise rated here, its mean in the phone's colour for it. */
@Composable
private fun EffortPage() {
    val s by WearStore.state.collectAsState()
    val a = LocalAccent.current
    val dim = LocalAmbient.current
    val round = LocalRound.current
    val kind = s.settings.effort?.takeIf { Effort.notches(it) != null }
    val rows = Metrics.effort(s)
    // The latest few: a page that scrolled would fight the crown, which moves the stack.
    // shortcut: 3 rows on a round screen, 2 at a large font, estimated; measure on a 40 mm watch with uiautomator.
    val shown = if (LocalDensity.current.fontScale > 1.3f) 2 else if (round) 3 else 4
    CapText {
        // Round: the first row sits where the circle is still narrow, so lower and further in (45 mm emulator: its ends were cut).
        Column(Modifier.fillMaxSize().padding(start = if (round) 30.dp else 8.dp, end = if (round) 30.dp else 16.dp, top = if (round) 42.dp else 34.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (kind == null || rows.isEmpty()) Text(stringResource(R.string.no_effort_yet), color = Og.Label2, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            else for (r in rows.takeLast(shown)) {
                val c = Og.effortColor(Effort.band(kind, r.value), a.accent)
                val v = "%.1f".format(java.util.Locale.ROOT, r.value)
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (dim) Color.Transparent else Og.Surface)
                        .border(if (dim) 1.dp else 0.dp, Og.Surface2, RoundedCornerShape(16.dp))
                        .clearAndSetSemantics { contentDescription = "${r.name}, ${Effort.name(kind)} $v" }
                        .padding(start = 8.dp, end = 3.dp, top = 3.dp, bottom = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(r.name, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Og.Text.copy(alpha = if (dim) 0.75f else 1f),
                        maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(6.dp))
                    Box(Modifier.heightIn(min = 24.dp).widthIn(min = 38.dp).clip(CircleShape).background(if (dim) Color.Transparent else c)
                        .border(if (dim) 1.5.dp else 0.dp, c, CircleShape).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
                        Text(v, style = Og.Number, fontSize = 15.sp, fontWeight = FontWeight.Black, color = if (dim) c else Color.Black, maxLines = 1)
                    }
                }
            }
        }
    }
}

/** The numbers of the whole workout, like Apple Workout's: the time as the hero, then heart rate, volume, sets. */
@Composable
fun MetricsPage() {
    val s by WearStore.state.collectAsState()
    val hr by WearStore.heartRate.collectAsState()
    val dim = LocalAmbient.current
    val w = s.workout ?: return
    val now = rememberNow()
    val start = WearStore.workoutStart() ?: now
    // Paused on the phone (#976): the clock stands at the pause.
    val at = w.pausedAt?.takeIf { it > 0 }?.toLong() ?: now
    val (done, total) = SessionCore.progress(s)
    val sum = SessionCore.summary(w, now.toDouble())
    val locale = LocalConfiguration.current.locales[0]
    val round = LocalRound.current
    CapText { BoxWithConstraints(Modifier.fillMaxSize()) {
        val showHr = s.settings.show?.showHr != false
        val rows = (if (showHr) 1 else 0) + (if (sum.volume > 0) 1 else 0) + 1
        // The time is the hero (1.7 rows); the rows share what is left of the height, like the Apple Watch's page.
        val unit = (maxHeight.value - 30f - (if (round) 26f else 12f)) / (2.04f + 0.95f * rows)
        val time = clock(((at - start) / 1000).coerceAtLeast(0))
        val fs = LocalDensity.current.fontScale
        // dp sizes, so the font scale is taken back out; the time also has to fit the width.
        val hero = minOf(68f, 1.7f * unit, (maxWidth.value * (if (round) 1 - TopLine.ROUND_INSET else 1f) - (if (round) 10f else 20f)) / (time.length * 0.62f))
        val rowSize = minOf(40f, unit)
        // Left-aligned rows on a round screen: the last one sits where the circle has closed in again,
        // so the inset follows the width ("2/14" lost a corner of its 2 on a 40 mm watch).
        Column(Modifier.fillMaxSize().padding(start = if (round) (maxWidth.value * TopLine.ROUND_INSET).dp else 10.dp, end = 10.dp, top = 30.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            // Always On: grey like the rest's time, not a big lit yellow.
            Text(time, style = Og.Number, fontSize = (hero / fs).sp, maxLines = 1,
                color = if (dim) Og.Text.copy(alpha = 0.75f) else Og.Yellow, modifier = Modifier.semantics { contentDescription = "" })
            if (showHr) MetricRow(hr?.toString() ?: "‒‒", null, G.HEART, rowSize, Og.Red)
            if (sum.volume > 0) MetricRow(java.text.NumberFormat.getIntegerInstance(locale).format(Math.round(sum.volume)), w.unit.uppercase(), null, rowSize, Og.Text)
            MetricRow("$done/$total", stringResource(R.string.sets).uppercase(), null, rowSize, Og.Text)
        }
    } }
}

/** Measures metric rows with the screen's own text style. */
private class RowMeter(val m: androidx.compose.ui.text.TextMeasurer, val d: androidx.compose.ui.unit.Density, val base: androidx.compose.ui.text.TextStyle)

@Composable
private fun rememberRowMeter() = RowMeter(androidx.compose.ui.text.rememberTextMeasurer(), LocalDensity.current, androidx.wear.compose.material3.LocalTextStyle.current)

/** A metric row's width in dp at [size]: the number, the 4 dp gap, the glyph, the label (never under 12 sp). */
private fun RowMeter.width(value: String, unit: String?, glyph: Boolean, size: Float): Float {
    fun w(t: String, st: androidx.compose.ui.text.TextStyle) = with(d) { m.measure(t, st, maxLines = 1, softWrap = false).size.width.toDp().value }
    return w(value, base.merge(Og.Number).copy(fontSize = (size / d.fontScale).sp)) + 4f + (if (glyph) size * 0.45f else 0f) +
        (if (unit != null) w(unit, base.copy(fontSize = unitSp(size, d.fontScale).sp, fontWeight = FontWeight.SemiBold)) else 0f)
}

private fun unitSp(size: Float, fontScale: Float) = (size * 0.42f).coerceAtLeast(12f) / fontScale

@Composable
private fun MetricRow(value: String, unit: String?, glyph: G?, size: Float, color: Color) {
    val dim = LocalAmbient.current
    val fs = LocalDensity.current.fontScale
    BoxWithConstraints {
        // Measured: a row wider than its column (a long time, a long label) shrinks instead of wrapping.
        val need = rememberRowMeter().width(value, unit, glyph != null, size)
        val s = if (need > maxWidth.value) size * maxWidth.value / need * 0.95f else size
        Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.semantics(mergeDescendants = true) {}) {
            Text(value, style = Og.Number, fontSize = (s / fs).sp, color = color.copy(alpha = if (dim) 0.75f else 1f), maxLines = 1, softWrap = false)
            Spacer(Modifier.width(4.dp))
            if (glyph != null) Glyph(glyph, color, (s * 0.45f).dp, Modifier.padding(bottom = (s * 0.18f).dp))
            if (unit != null) Text(unit, color = color, fontSize = unitSp(s, fs).sp, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false,
                modifier = Modifier.padding(bottom = (s * 0.12f).dp))
        }
    }
}

/**
 * Now playing: a small remote for music on the watch (previous, play or pause, next, the volume:
 * media keys to the watch's media session, the same as a headset's buttons), and one tap to the
 * system's Media Controls app, which is where music playing on the phone is controlled from the
 * wrist. Reading which song another app plays would take notification access, a lot to ask of a
 * gym app, so the page says where the music is instead: on the watch, or (if nothing plays here)
 * probably on the phone.
 */
@Composable
fun MediaPage() {
    val ctx = LocalContext.current
    val audio = remember { ctx.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager }
    val controls = remember { MediaControls.intent(ctx) }
    var here by remember { mutableStateOf(audio.isMusicActive) }
    // Whether something plays on the watch, looked at again every 2 s while the page is up.
    LaunchedEffect(Unit) { while (true) { here = audio.isMusicActive; kotlinx.coroutines.delay(2_000) } }
    fun key(code: Int) {
        try {
            audio.dispatchMediaKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, code))
            audio.dispatchMediaKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, code))
        } catch (_: Exception) {}
    }
    fun vol(d: Int) {
        try {
            audio.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC,
                if (d > 0) android.media.AudioManager.ADJUST_RAISE else android.media.AudioManager.ADJUST_LOWER, android.media.AudioManager.FLAG_SHOW_UI)
        } catch (_: Exception) {}
    }
    val a = LocalAccent.current
    val dim = LocalAmbient.current
    val list = rememberTransformingLazyColumnState()
    // Nothing on the watch: the phone's music is the likely one, so Media Controls comes first.
    val openFirst = controls != null && !here && !dim
    @Composable fun OpenControls() {
        RowButton(stringResource(R.string.media_open), Modifier.fillMaxWidth()) { try { ctx.startActivity(controls) } catch (_: Exception) {} }
    }
    TransformingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 30.dp, bottom = 34.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { Text(stringResource(R.string.media_now_playing), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
        item { Quiet(stringResource(if (here) R.string.media_on_watch else R.string.media_phone_hint), 11.sp, lines = 3) }
        if (openFirst) item { OpenControls() }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                EdgeButton(stringResource(R.string.media_prev), glyph = G.PREV) { key(android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS) }
                val said = stringResource(R.string.media_play)
                Box(
                    Modifier.size(56.dp).clip(CircleShape).background(if (dim) Color.Transparent else a.accent).border(if (dim) 1.5.dp else 0.dp, a.accent, CircleShape)
                        .combinedClickable(role = Role.Button) { key(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) }
                        .semantics { contentDescription = said },
                    contentAlignment = Alignment.Center,
                ) { Glyph(G.PLAY_PAUSE, if (dim) a.accent else a.on, 24.dp) }
                EdgeButton(stringResource(R.string.media_next), glyph = G.NEXT) { key(android.view.KeyEvent.KEYCODE_MEDIA_NEXT) }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                EdgeButton(stringResource(R.string.media_quieter), glyph = G.MINUS, size = 40.dp) { vol(-1) }
                EdgeButton(stringResource(R.string.media_louder), glyph = G.PLUS, size = 40.dp) { vol(1) }
            }
        }
        if (controls != null && !openFirst && !dim) item { OpenControls() }
    }
}

/* ---------- "Still training?" / "Looks like you left the gym" ---------- */

/**
 * A card instead of a system alert (forgotten workouts, WatchLogic Idle). Finish goes to the
 * Overview's hold, so nothing ends in one tap. Nobody answers: the workout ends by itself at the
 * time it says (with a phone from 1.4.5 on), saved at its last set plus the rest.
 */
@Composable
fun IdlePrompt() {
    val minutes by WearStore.idleMinutes.collectAsState()
    val left by WearStore.idleLeft.collectAsState()
    val endsAt by WearStore.idleEndsAt.collectAsState()
    val clock = endsAt?.let { java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(it)) }
    val list = rememberTransformingLazyColumnState()
    TransformingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = if (LocalRound.current) ListTop else 34.dp, bottom = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        item {
            // The top of a round screen is its narrowest part: a smaller title with a round-safe inset.
            Text(stringResource(if (left) R.string.left_gym else R.string.still_training), fontSize = 16.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center, maxLines = 3,
                // "Looks like you left" reached the bezel on a 40 mm watch and lost the corner of its L.
                modifier = Modifier.padding(horizontal = if (LocalRound.current) 28.dp else 14.dp))
        }
        when {
            clock != null -> item { Quiet(stringResource(if (left) R.string.left_ends_at else R.string.idle_ends_at, clock), 12.sp, lines = 6) }
            minutes > 0 -> item { Quiet(stringResource(R.string.no_set_for, minutes), 12.sp, lines = 3) }
        }
        if (left) {
            item {
                PrimaryButton(stringResource(R.string.finish_now), Modifier.fillMaxWidth().padding(top = 4.dp)) {
                    WearStore.keepGoing(); WearStore.page.value = Page.OVERVIEW
                }
            }
            item { RowButton(stringResource(R.string.keep_going), Modifier.fillMaxWidth()) { WearStore.keepGoing() } }
        } else {
            item { PrimaryButton(stringResource(R.string.keep_going), Modifier.fillMaxWidth().padding(top = 4.dp)) { WearStore.keepGoing() } }
            item {
                RowButton(stringResource(R.string.finish_workout), Modifier.fillMaxWidth()) {
                    WearStore.keepGoing(); WearStore.page.value = Page.OVERVIEW
                }
            }
        }
    }
}

/* ---------- the summary ---------- */

/** "Workout saved", the time big, sets and volume, the records, then the heart rate. Done ignores its first second. */
@Composable
fun SummaryScreen(sum: WorkoutSummary) {
    val a = LocalAccent.current
    val sync = rememberSync()
    val heard = WearStore.state.collectAsState().value.synced
    val shownAt = remember { System.currentTimeMillis() }
    val locale = LocalConfiguration.current.locales[0]
    val list = rememberTransformingLazyColumnState()
    TransformingLazyColumn(
        state = list, modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = if (LocalRound.current) ListTop else 32.dp, bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(18.dp).clip(CircleShape).background(a.accent), contentAlignment = Alignment.Center) { Glyph(G.CHECK, a.on, 11.dp) }
                Spacer(Modifier.width(6.dp))
                Text(stringResource(if (sum.endedOnPhone) R.string.ended_on_phone else R.string.workout_saved), fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold, maxLines = 2)
            }
        }
        item { Quiet(sum.name, 12.sp) }
        sum.duration?.let { d ->
            item {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Quiet(stringResource(R.string.time), 10.sp)
                    Text(duration(d, locale), style = Og.Number, fontSize = 30.sp, color = Og.Yellow, maxLines = 1)
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                SumStat(stringResource(R.string.sets), "${sum.sets}")
                if (sum.volume > 0) SumStat(stringResource(R.string.volume), java.text.NumberFormat.getIntegerInstance(locale).format(Math.round(sum.volume)) + " " + sum.unit)
            }
        }
        if (sum.prs.isNotEmpty()) {
            item { Quiet(stringResource(R.string.personal_records), 11.sp, color = Og.Yellow, modifier = Modifier.padding(top = 2.dp)) }
            items(sum.prs) { Text(it, fontSize = 13.sp, textAlign = TextAlign.Center, maxLines = 2) }
        }
        if (sum.hrAvg != null && sum.hrMax != null) item { HrStat(stringResource(R.string.heart_rate), stringResource(R.string.hr_avg_max, sum.hrAvg, sum.hrMax)) }
        item { SyncLine(sync, heard = heard) }
        item {
            PrimaryButton(stringResource(R.string.done), Modifier.fillMaxWidth().padding(top = 4.dp)) {
                if (System.currentTimeMillis() - shownAt >= 1000) WearStore.dismissSummary()
            }
        }
    }
}

@Composable
private fun SumStat(label: String, value: String, color: Color = Og.Text) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.semantics(mergeDescendants = true) {}) {
        Quiet(label, 10.sp, lines = 1)
        Text(value, style = Og.Number, fontSize = 18.sp, color = color, maxLines = 1)
    }
}

/**
 * The heart rate near the foot of the summary, where a round screen is at its narrowest: "128 avg ·
 * 164 max" in one 18 sp line ran into the edge ("164 max" cut off). The average stays big, the max
 * goes on a smaller line under it, both inside a round-safe inset, and each line shrinks to fit at
 * the largest font scale instead of clipping.
 */
@Composable
private fun HrStat(label: String, value: String) {
    val parts = splitStat(value)
    val inset = if (LocalConfiguration.current.isScreenRound) 0.12f else 0.04f
    val width = LocalConfiguration.current.screenWidthDp.dp * (1 - 2 * inset)
    Column(horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.widthIn(max = width).semantics(mergeDescendants = true) {}) {
        Quiet(label, 10.sp, lines = 1)
        FitText(parts.first, 18.sp, Og.Red, style = Og.Number)
        parts.second?.let { FitText(it, 13.sp, Og.Label2, style = Og.Number) }
    }
}

/** "128 avg · 164 max" → ("128 avg", "164 max"); a line without the dot stays whole. */
fun splitStat(s: String): Pair<String, String?> {
    val i = s.indexOf(" · ")
    return if (i < 0) s to null else s.substring(0, i).trim() to s.substring(i + 3).trim()
}

/** One line that shrinks (down to 70 %) rather than clip or wrap. */
@Composable
fun FitText(text: String, size: androidx.compose.ui.unit.TextUnit, color: Color, style: androidx.compose.ui.text.TextStyle = androidx.compose.ui.text.TextStyle.Default) {
    var scale by remember(text) { mutableStateOf(1f) }
    Text(text, style = style, fontSize = size * scale, color = color, maxLines = 1, softWrap = false, textAlign = TextAlign.Center,
        onTextLayout = { r -> if (r.hasVisualOverflow && scale > 0.7f) scale -= 0.08f })
}

/** "52 min", "1 hr 5 min", in the app's language. */
fun duration(seconds: Double, locale: java.util.Locale): String {
    val mins = kotlin.math.max(1L, Math.round(seconds / 60))
    val f = android.icu.text.MeasureFormat.getInstance(locale, android.icu.text.MeasureFormat.FormatWidth.SHORT)
    return if (mins >= 60) f.formatMeasures(android.icu.util.Measure(mins / 60, android.icu.util.MeasureUnit.HOUR),
        android.icu.util.Measure(mins % 60, android.icu.util.MeasureUnit.MINUTE))
    else f.format(android.icu.util.Measure(mins, android.icu.util.MeasureUnit.MINUTE))
}
