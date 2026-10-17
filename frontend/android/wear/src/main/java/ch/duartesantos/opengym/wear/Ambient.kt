package ch.duartesantos.opengym.wear

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Whether the watch is in ambient mode (screen dimmed, always-on), and a counter that moves each
 * time the system lets the app redraw in it, about once a minute. MainActivity feeds it; the
 * screens read it. An app that does not take part in ambient mode is covered by a blurred clock
 * and stops being updated, which for a rest timer is the one thing it must not do.
 */
object Ambient {
    val on = MutableStateFlow(false)
    val tick = MutableStateFlow(0L)
}
