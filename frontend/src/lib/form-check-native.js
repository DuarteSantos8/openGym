// The page's side of Form check (FormCheckPlugin.swift, lib/form-drills/). The iPhone app shows
// the camera full screen with the skeleton over it and sends the pose about 15 times a second;
// this feeds the poses to the drill's tracker, puts the tracker's hint on the native status line,
// says each rep's number aloud, and hands back the tracker's result once the view closes.
// A hold (kind 'hold', a plank) counts seconds: the number on screen moves every second but only
// the drill's milestones (every 10 seconds held) are said, as "20 seconds", and VoiceOver hears
// those and nothing in between.
// A rep that did not meet the lifter's standard is said too (the drill's `misses`), flashed red
// with a buzz, and its line stays on the status line for MISS_SHOW_MS; the count does not move.
// Nothing here knows a movement. Nothing is filmed or kept: the frames never leave the native
// side, only joint positions do.
//
// iPhone only. Anywhere else (the web, Android, a build without the plugin, the simulator, which
// has no camera) formCheckAvailable() resolves false and nothing offers it.
import { MOBILE } from './mobile.js'
import { t, tn } from './i18n-core.js'
import { speak } from './speech.js'
import { drillById } from './form-drills/index.js'

/** How long the status line shows why a rep did not count, in ms of the pose clock. */
export const MISS_SHOW_MS = 2000

// Registered once and handed out inside an object: a Capacitor plugin proxy answers `then` with a
// native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pluginP = null
const formPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin, Capacitor } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  if (typeof Capacitor.isPluginAvailable === 'function' && !Capacitor.isPluginAvailable('FormCheck')) return null
  return { FormCheck: registerPlugin('FormCheck') }
})().catch(() => null))

let availableP = null
/** Whether this phone can run a form check: the iPhone app with the plugin and a camera. */
export function formCheckAvailable() {
  return availableP || (availableP = formPlugin()
    .then(p => (p ? p.FormCheck.available() : null))
    .then(res => !!(res && res.available === true))
    .catch(() => false))
}

/** The status line for a rep that did not count: the drill's line for its reason. */
export function missedHint(drill, reason) {
  const m = drill && drill.misses && drill.misses[reason]
  return m ? t(m.line) : t('Not counted')
}
// What is said aloud for it: as short as a rep's number.
const missedSay = (drill, reason) => {
  const m = drill && drill.misses && drill.misses[reason]
  return m ? t(m.say) : t('Not counted')
}

/**
 * Starts the camera view for a drill (lib/form-drills/) and resolves with its tracker's result
 * when the lifter taps Done. `voice`: lib/speech.js voiceOpts(S). Each rep is said even with
 * Spoken cues off: the phone is propped up out of reach. `standard`: the drill's standard a rep
 * must meet to count (its default when left out). Rejects when the drill is unknown or the view
 * cannot open (no camera access, no plugin).
 */
export async function runFormCheck({ drill: drillId, camera = 'back', onUpdate, voice = {}, standard } = {}) {
  const drill = drillById(drillId)
  if (!drill) throw new Error('unknown drill: ' + drillId)
  const p = await formPlugin()
  if (!p) throw new Error('unavailable')
  const { FormCheck } = p
  const tracker = drill.create({ standard: drill.standards.some(s => s.id === standard) ? standard : drill.defaultStandard })
  const hold = drill.kind === 'hold'
  let shown = null
  let missUntil = -1, missText = ''
  const subs = []
  const drop = () => { for (const s of subs) Promise.resolve(s).then(h => h && h.remove && h.remove()).catch(() => {}) }

  const onPose = frame => {
    const now = tracker.push(frame)
    const at = Number(frame && frame.t) || 0
    if (now.justMissed) { missUntil = at + MISS_SHOW_MS; missText = missedHint(drill, now.reason) }
    // A framing problem says so first; otherwise a no-rep's line for a moment, else the drill's hint.
    const text = now.inFrame && at < missUntil ? missText : now.hint || ''
    const highlight = Array.isArray(now.highlight) ? now.highlight : []
    // The bridge is only crossed when the line, the count or the joints lit change, not 15 times
    // a second. `highlight`: the joints drawn large once the rep under way meets the standard.
    const key = text + '|' + now.count + '|' + highlight.join(',')
    if (key !== shown) {
      shown = key
      // `quiet`: the native view does not read every second of a hold out to VoiceOver.
      FormCheck.setStatus({ text, reps: now.count, highlight, quiet: hold }).catch(() => {})
    }
    // A number cuts off whatever is still being said, so it is never late; a no-rep is queued
    // behind it instead, so it never talks over one. feedback() is the flash and the buzz; a
    // build without it just rejects.
    if (now.justCounted) {
      const said = hold ? tn('{0} second', '{0} seconds', now.count) : String(now.count)
      speak(said, { ...voice, onSilent: true, queue: false }).catch?.(() => {})
      FormCheck.feedback?.(hold ? { kind: 'counted', text: said } : { kind: 'counted' })?.catch?.(() => {})
    }
    if (now.justMissed) {
      speak(missedSay(drill, now.reason), { ...voice, onSilent: true, queue: true }).catch?.(() => {})
      FormCheck.feedback?.({ kind: 'missed', text: missText })?.catch?.(() => {})
    }
    if (onUpdate) onUpdate({ ...now, hint: text })
  }

  return new Promise((resolve, reject) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      drop()
      resolve({ ...tracker.result(), drill: drill.id, kind: drill.kind })
    }
    subs.push(FormCheck.addListener('pose', onPose))
    subs.push(FormCheck.addListener('closed', finish))
    // The native view's own words come from here, in the app's language.
    const labels = { done: t('Done'), flip: t('Switch camera') }
    FormCheck.start({ camera: camera === 'front' ? 'front' : 'back', labels }).catch(e => {
      if (done) return
      done = true
      drop()
      reject(e)
    })
  })
}

/** Closes the camera view from the page (the result still arrives through runFormCheck). */
export function stopFormCheck() {
  return formPlugin().then(p => (p ? p.FormCheck.stop() : null)).catch(() => null)
}

// Test seam: a fresh launch.
export function _resetFormCheck() { pluginP = null; availableP = null }
