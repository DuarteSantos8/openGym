// The running workout on the iPhone's Lock Screen and in the Dynamic Island (a Live Activity), the
// page's side (native: ios/App/App/LiveActivityPlugin.swift and WorkoutActivity.swift, the views in
// ios/App/OpenGymWidgets). An Apple Watch shows the same activity in its Smart Stack.
//
// Page → activity: while a workout runs, its state as the Lock Screen shows it (the set to do now
// and the few after it, the rest's end, how far along the session is) whenever that changes. The
// rest counts down on the Lock Screen by itself (Text(timerInterval:)), so nothing is sent per
// second.
//
// Activity → page: its Done button ticks the set it shows. iOS runs that in the app (an App Intent)
// even with the page asleep, so the native side queues it as a small event ({ id, type: 'setDone',
// wid, exId, entryIdx, setIdx, at }), moves the activity on to the next set itself, and the page
// applies the event when it can: through the workout screen's own tick (bindLiveActions), the one
// a tap in the app runs (rest timer, the high-water mark, the end-of-workout sheet), never a second
// copy of it. Each event is applied once, by its id, and only then acknowledged, which takes it out
// of the native queue; until the workout screen is there to apply it, it waits there.
//
// Text only: no exercise animations or pictures (Gym visual licence). iPhone app only.
import { MOBILE, nativePlatform } from './mobile.js'
import { EXIDX } from './exercises.js'
import { exerciseNameFor, t } from './i18n.js'
import { setLabel, supersetUnits } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { restSecFor } from './supersetFlow.js'
import { speedUnitOf } from './speed.js'
import { accentPair, accentValue } from './accent.js'

export const LIVE_VERSION = 1
const APPLIED_KEY = 'gym_live_applied'
const APPLIED_MAX = 300
const SEND_DEBOUNCE_MS = 300
// The sets after the current one the activity carries, so its Done can move on without the page.
export const LIVE_AHEAD = 8

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/* ---------- what the activity shows ---------- */

/**
 * The sets still to do, in the order the workout screen leads through them: from the current
 * exercise's unit on, a superset round by round (a1, b1, a2, b2), then the units after it, then
 * the ones before it that still have sets open. Each with the rest that follows it.
 */
export function upcomingSets (S) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries) || !A.entries.length) return []
  const units = supersetUnits(A.entries)
  const cur = Math.max(0, Math.min(A.entries.length - 1, A.cur || 0))
  const start = Math.max(0, units.findIndex(u => u.includes(cur)))
  const order = [...units.slice(start), ...units.slice(0, start)]
  const out = []
  for (const unit of order) {
    const rounds = Math.max(0, ...unit.map(i => (A.entries[i]?.sets || []).length))
    let rest = 0
    try { rest = restSecFor(A.entries, unit, num(S.restSec) || 0) || 0 } catch { rest = num(S.restSec) || 0 }
    for (let r = 0; r < rounds; r++) {
      const inRound = unit.filter(i => { const s = A.entries[i]?.sets?.[r]; return s && !s.done })
      inRound.forEach((i, k) => out.push({ entryIdx: i, setIdx: r, restAfter: k === inRound.length - 1 ? rest : 0 }))
    }
  }
  return out
}

function setView (S, A, { entryIdx, setIdx, restAfter }) {
  const e = A.entries[entryIdx]
  const s = e.sets[setIdx]
  const target = e.target || {}
  const work = (e.sets || []).filter(x => !isWarmupRow(x))
  const warmup = !!isWarmupRow(s)
  const n = warmup ? (e.sets || []).filter(isWarmupRow).indexOf(s) + 1 : work.indexOf(s) + 1
  let label = ''
  try { label = setLabel(e.id, s, target, speedUnitOf(S)) } catch { label = '' }
  return {
    exId: String(e.id),
    entryIdx,
    setIdx,
    exName: EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : String(target.name || e.name || e.id),
    setLine: warmup ? t('Warm-up') + ' ' + n : t('Set {0} of {1}', n, work.length),
    target: label,
    restAfter: Math.max(0, Math.round(restAfter || 0)),
  }
}

/**
 * The activity's fixed part (`attributes`: what stays the same for the workout) and its state, or
 * null when no workout is running here. `timer` is the rest as useUI holds it.
 */
export function buildLiveActivity (S, timer = null) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries) || !A.entries.length || A.editingWorkoutId) return null
  const next = upcomingSets(S)
  let done = 0, total = 0
  for (const e of A.entries) for (const s of e?.sets || []) { total++; if (s?.done) done++ }
  const rest = timer && !timer.ready && timer.kind !== 'switch' ? timer : null
  const pair = accentPair(accentValue(S))
  return {
    attributes: {
      v: LIVE_VERSION,
      wid: String(A.id || ''),
      start: num(A.start),
      accent: pair.accent,
      ink: pair.ink,
      labels: {
        done: t('Done'),
        rest: t('Rest'),
        next: t('Up next'),
        allDone: t('All sets done'),
        restOver: t('Rest’s over. Next set!'),
      },
    },
    state: {
      name: A.name || '',
      cur: next.length ? setView(S, A, next[0]) : null,
      ahead: next.slice(1, 1 + LIVE_AHEAD).map(x => setView(S, A, x)),
      restEndsAt: rest && !rest.paused ? num(rest.endsAt) : null,
      restLeft: rest && rest.paused ? num(rest.left) : null,
      restTotal: rest ? num(rest.total) : null,
      done,
      total,
    },
  }
}

/* ---------- applying the activity's events ---------- */

let handlers = null   // the workout screen's: setDone
const readApplied = () => { try { return JSON.parse(localStorage.getItem(APPLIED_KEY)) || [] } catch { return [] } }
const writeApplied = ids => { try { localStorage.setItem(APPLIED_KEY, JSON.stringify(ids.slice(-APPLIED_MAX))) } catch { /* the queue's ack is what counts */ } }

function entryIndexOf (A, ev) {
  if (A.entries[ev.entryIdx] && String(A.entries[ev.entryIdx].id) === String(ev.exId)) return ev.entryIdx
  return A.entries.findIndex(e => String(e.id) === String(ev.exId))
}

/**
 * Applies the events not applied yet, in order, and returns the ids that are done with: applied
 * now, applied before, or about a workout that is not running any more. Without the workout
 * screen's actions the run stops, and that event and the ones after it stay queued.
 */
export function applyLiveEvents (events, getState) {
  if (!Array.isArray(events)) return []
  const applied = readApplied()
  const done = []
  for (const ev of events) {
    if (!ev || typeof ev.id !== 'string') continue
    if (applied.includes(ev.id)) { done.push(ev.id); continue }
    const A = getState()?.S?.active
    const ours = A && Array.isArray(A.entries) && !A.editingWorkoutId && (!ev.wid || ev.wid === String(A.id))
    if (ev.type === 'setDone' && ours) {
      if (!handlers) break
      const idx = entryIndexOf(A, ev)
      const set = idx >= 0 ? A.entries[idx].sets?.[ev.setIdx] : null
      if (set && !set.done) handlers.setDone(idx, ev.setIdx, { at: num(ev.at) })
    }
    // Applied, or meaningless now (another workout, a set that is gone or already ticked).
    applied.push(ev.id)
    done.push(ev.id)
  }
  writeApplied(applied)
  return done
}

/* ---------- the native plugin ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then` (lib/rest-alert.js, the Coach hang #42).
const livePlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || (await nativePlatform()) !== 'ios') return null
  const { registerPlugin } = await import('@capacitor/core')
  return { LiveActivity: registerPlugin('LiveActivity') }
})().catch(() => null))

let getStateRef = null
let draining = null
// As in lib/watch-sync.js: nothing is applied, acknowledged or sent before the store has its copy
// back (boot's finishBoot), so a tap is never dropped against an empty, not yet restored state.
const storeReady = () => getStateRef?.()?.ready !== false

/**
 * Takes the Done taps from the native queue, applies them, and acknowledges what is done once the
 * change is on disk (the store's saveNow): until then the queue is the tap's only copy.
 */
export function drainLiveEvents () {
  if (draining) return draining
  draining = (async () => {
    try {
      const p = await livePlugin()
      if (!p || !getStateRef || !storeReady()) return []
      const { events = [] } = (await p.LiveActivity.drain()) || {}
      const done = applyLiveEvents(events, getStateRef)
      if (done.length) await getStateRef()?.saveNow?.()
      if (done.length) await p.LiveActivity.ack({ ids: done })
      return done
    } catch { return [] } finally { draining = null }
  })()
  return draining
}

/** The workout screen hands over its own tick while it is mounted. Returns the unbind. */
export function bindLiveActions (h) {
  handlers = h
  drainLiveEvents()
  return () => { if (handlers === h) handlers = null }
}

/**
 * Started once by the app: shows, updates and ends the activity as the workout and its rest
 * change (debounced, only what differs from the last one sent), and drains the Done taps when the
 * app comes back or the native side says one came in. Resolves with the stop function.
 */
export async function startLiveActivitySync ({ useStore, useUI }) {
  const p = await livePlugin()
  if (!p) return () => {}
  getStateRef = () => useStore.getState()
  let supported = false
  try { supported = !!(await p.LiveActivity.status())?.supported } catch { supported = false }
  let last = null, tm = null
  const send = async () => {
    tm = null
    // An empty, not yet restored copy would end the activity of a workout that is still running.
    if (!storeReady()) return
    try {
      const live = buildLiveActivity(useStore.getState().S, useUI.getState().timer)
      const json = live ? JSON.stringify(live) : ''
      if (json === last) return
      if (live) await p.LiveActivity.update({ wid: live.attributes.wid, attributes: JSON.stringify(live.attributes), state: JSON.stringify(live.state) })
      else await p.LiveActivity.end()
      last = json
    } catch { /* not now: the next change tries again */ }
  }
  const schedule = () => { if (!supported) return; clearTimeout(tm); tm = setTimeout(send, SEND_DEBOUNCE_MS) }
  const offStore = useStore.subscribe((s, prev) => {
    if (s.ready && !prev.ready) { drainLiveEvents(); schedule() }
    else if (s.S !== prev.S) schedule()
  })
  const restOf = x => (x ? `${x.endsAt}|${!!x.paused}|${!!x.ready}|${x.left}|${x.kind || ''}` : '')
  const offUI = useUI.subscribe((s, prev) => {
    if (s.timer === prev.timer) return
    // A running rest changes `left` every second; only a start, a stop or a pause matters here.
    const a = s.timer, b = prev.timer
    const same = a && b && !a.paused && !b.paused && a.endsAt === b.endsAt && !!a.ready === !!b.ready
    if (!same && restOf(a) !== restOf(b)) schedule()
  })
  const sub = await p.LiveActivity.addListener('liveActivityEvent', () => { drainLiveEvents() }).catch(() => null)
  const onVisible = () => { if (document.visibilityState === 'visible') { drainLiveEvents(); schedule() } }
  document.addEventListener('visibilitychange', onVisible)
  // At launch: a workout that ended while the app was gone takes its activity with it.
  if (supported) send()
  drainLiveEvents()
  return () => { offStore(); offUI(); sub?.remove?.(); document.removeEventListener('visibilitychange', onVisible); clearTimeout(tm) }
}

// Test seams.
export function _setLivePluginForTest (plugin, getState) { pluginP = Promise.resolve(plugin ? { LiveActivity: plugin } : null); getStateRef = getState || null }
export function _resetLiveActivity () { handlers = null; pluginP = null; getStateRef = null; draining = null }
