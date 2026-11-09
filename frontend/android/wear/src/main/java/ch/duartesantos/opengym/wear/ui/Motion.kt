package ch.duartesantos.opengym.wear.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import ch.duartesantos.opengym.wear.Countdown
import ch.duartesantos.opengym.wear.R
import ch.duartesantos.opengym.wear.RestMath

/*
 * Motion on the wrist, calm and with a reason (a glance mid-set is a second long), as on the Apple
 * Watch (ios/App/Watch/Motion.swift):
 *
 *   screens   whole screens and the set page's set, rest and hold fade into each other, ease-out
 *             0.2 s, instead of cutting
 *   ‹ ›       the set's lines come in 12 dp from the side you went to while they fade in; the
 *             arrows and the button stay still under the thumb
 *   3-2-1     a ring that drains smoothly, each number springs in and the last one swells away,
 *             then Go! in the full ring for a moment while the workout starts under it
 *
 * Remove animations (Android's reduce motion): no slides, no springs, no scaling, only short
 * fades. Always On: nothing moves.
 */
object Motion {
    fun fade(reduce: Boolean, ambient: Boolean): ContentTransform {
        if (ambient) return EnterTransition.None togetherWith ExitTransition.None
        val ms = if (reduce) 150 else 200
        return fadeIn(tween(ms, easing = FastOutSlowInEasing)) togetherWith fadeOut(tween(ms))
    }

    /** The set's lines after ‹ (-1) or › (+1): in from that side, or just a fade. */
    fun nudge(direction: Int, reduce: Boolean, ambient: Boolean): ContentTransform {
        if (ambient) return EnterTransition.None togetherWith ExitTransition.None
        if (reduce) return fadeIn(tween(150)) togetherWith fadeOut(tween(100))
        return (slideInHorizontally(tween(200)) { full -> (full * 0.06f * direction).toInt() } + fadeIn(tween(200))) togetherWith ExitTransition.None
    }
}

/**
 * The 3-2-1 before a workout started here (or before a hold that starts by itself). A tap starts
 * at once; the small button cancels (nothing starts, nothing is logged).
 */
@Composable
fun CountdownView(from: Long, label: String, onTap: () -> Unit, onCancel: () -> Unit) {
    val a = LocalAccent.current
    val dim = LocalAmbient.current
    val reduce = LocalReduceMotion.current
    // Frame by frame for three seconds (a smooth drain), once a second with the wrist down.
    val now = rememberNow(fast = true)
    val left = RestMath.left(from, from + Countdown.SECONDS * 1000L, now)
    val n = maxOf(1, Countdown.number(now - from))
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(
            Modifier.fillMaxSize().padding(6.dp).combinedClickable(role = Role.Button, onClick = onTap)
                .semantics { contentDescription = "$label, $n" },
            contentAlignment = Alignment.Center,
        ) {
            Ring(left, a.accent.copy(alpha = if (dim) 0.6f else 1f), Modifier.fillMaxSize())
            AnimatedContent(n, transitionSpec = {
                if (dim) EnterTransition.None togetherWith ExitTransition.None
                else if (reduce) fadeIn(tween(150)) togetherWith fadeOut(tween(150))
                else (scaleIn(spring(dampingRatio = 0.75f, stiffness = Spring.StiffnessMediumLow), initialScale = 0.6f) + fadeIn()) togetherWith
                    (scaleOut(tween(250), targetScale = 1.35f) + fadeOut(tween(250)))
            }, label = "count") { k ->
                Text("$k", style = Og.Number, fontSize = 64.sp, fontWeight = FontWeight.Bold, color = a.accent)
            }
        }
        Box(Modifier.fillMaxSize().padding(bottom = 14.dp), contentAlignment = Alignment.BottomCenter) {
            EdgeButton(stringResource(R.string.cancel), glyph = G.CLOSE, size = 36.dp, onClick = onCancel)
        }
    }
}

/** Go! in the full ring, for a moment as the workout (or a hold) starts under it. */
@Composable
fun GoView() {
    val a = LocalAccent.current
    val reduce = LocalReduceMotion.current
    val dim = LocalAmbient.current
    val grow = remember { Animatable(if (reduce || dim) 1f else 0.7f) }
    LaunchedEffect(Unit) { if (!reduce && !dim) grow.animateTo(1f, spring(dampingRatio = 0.65f, stiffness = Spring.StiffnessMedium)) }
    Box(Modifier.fillMaxSize().background(Og.Bg).semantics { contentDescription = "" }, contentAlignment = Alignment.Center) {
        Ring(1f, a.accent, Modifier.fillMaxSize().padding(10.dp))
        Text(stringResource(R.string.go), fontSize = 50.sp, fontWeight = FontWeight.Black, color = a.accent, textAlign = TextAlign.Center,
            maxLines = 1, modifier = Modifier.padding(horizontal = 26.dp).scale(grow.value))
    }
}
