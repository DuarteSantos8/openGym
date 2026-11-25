// A hard shake of the phone (Christmas: the snow globe, in the theme's own chunk). Lives in the main
// bundle because Settings asks for the motion sensor from here; the globe itself stays in the
// theme's chunk. Nothing listens unless a theme asks (watchShake), and only while it does.
//
// What counts as a shake: SHAKE_PEAKS jolts of at least SHAKE_G m/s² beyond gravity within
// SHAKE_WINDOW_MS. One jolt is a phone put down on a table or a bump in the bus; three in under a
// second is someone shaking it on purpose. Keeping on shaking fires again every SHAKE_PEAKS jolts,
// so a globe already swirling gets stirred some more.
import { MOBILE } from './mobile.js'

export const SHAKE_G = 14
export const SHAKE_PEAKS = 3
export const SHAKE_WINDOW_MS = 900
// Two samples of one jolt are one jolt: the sensor reports at 60 Hz and more.
const PEAK_GAP_MS = 70
const EARTH = 9.81

/**
 * A feed for devicemotion events that calls `onShake({ x, y, strength })` at each shake. `x` and
 * `y` are the last jolt's direction in the phone's frame (x to the right, y up), `strength` 1 at
 * the threshold up to 3. Prefers `acceleration` (gravity taken out); a sensor without it gives
 * `accelerationIncludingGravity`, whose distance from 1 g is the jolt.
 */
export function shakeDetector(onShake, { threshold = SHAKE_G, peaks = SHAKE_PEAKS, windowMs = SHAKE_WINDOW_MS } = {}) {
  let times = []
  let lastPeak = -Infinity
  return (e, now = Date.now()) => {
    const a = e?.acceleration
    const g = e?.accelerationIncludingGravity
    let v = null
    let mag = 0
    if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) {
      v = a
      mag = Math.hypot(a.x, a.y, Number(a.z) || 0)
    } else if (g && Number.isFinite(g.x) && Number.isFinite(g.y)) {
      v = g
      mag = Math.abs(Math.hypot(g.x, g.y, Number(g.z) || 0) - EARTH)
    }
    if (!v || !(mag >= threshold) || now - lastPeak < PEAK_GAP_MS) return false
    lastPeak = now
    times = times.filter(t => now - t <= windowMs)
    times.push(now)
    if (times.length < peaks) return false
    times = []
    onShake({ x: v.x, y: v.y, strength: Math.min(3, mag / threshold) })
    return true
  }
}

/** Whether this device has a motion sensor the page can read at all. */
export const hasMotion = () => typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined'

/** iOS asks before a page may read the sensor, and only from a tap. Other systems just give it. */
export const motionNeedsAsk = () => hasMotion() && typeof window.DeviceMotionEvent.requestPermission === 'function'

let granted = false

/** Ask for the sensor (call it from a tap). True when it may be read now. */
export async function askMotion() {
  if (!motionNeedsAsk() || granted) return hasMotion()
  try { granted = (await window.DeviceMotionEvent.requestPermission()) === 'granted' } catch (e) { granted = false }
  return granted
}
export const _resetMotionForTests = () => { granted = false }

/**
 * Listen for shakes until the returned function is called. In the iPhone app the permission is
 * asked at the first tap: the app's web view grants it without a prompt (Capacitor's
 * WebViewDelegationHandler), but the page still has to ask from a tap. In Safari that would pop
 * a system dialog out of nowhere, so there only Settings asks (Christmas, Shake for a snow globe).
 */
export function watchShake(onShake) {
  if (!hasMotion()) return () => {}
  const feed = shakeDetector(onShake)
  const onMotion = e => { feed(e) }
  window.addEventListener('devicemotion', onMotion)
  let onTap = null
  if (motionNeedsAsk() && !granted && MOBILE) {
    onTap = () => { window.removeEventListener('touchend', onTap, true); onTap = null; askMotion() }
    window.addEventListener('touchend', onTap, true)
  }
  return () => {
    window.removeEventListener('devicemotion', onMotion)
    if (onTap) window.removeEventListener('touchend', onTap, true)
  }
}
