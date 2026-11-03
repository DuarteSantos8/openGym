// The iPhone app's Home Screen and Lock Screen widgets, the page's side (native:
// ios/App/App/WidgetBridgePlugin.swift writes what this builds to the App Group, and the widget
// extension in ios/App/OpenGymWidgets reads it).
//
// A widget runs without the app, so the page hands it a small snapshot whenever something it shows
// changes: the plan for today and the coming week (so the widget can turn the page at midnight on
// its own), this week's progress, the streak, the last PR, and a workout that is running. Every
// word in it is already in the app's language, and the accent is the app's, so the widgets look
// and talk like the app. Text only: no exercise animations or pictures (Gym visual licence).
//
// iPhone app only. Nothing here runs on the web or on Android.
import { MOBILE, nativePlatform } from './mobile.js'
import { EXIDX } from './exercises.js'
import { t, dateLocale } from './i18n.js'
import { effectiveRoutines, streakWeeks, exLine, bestWeightForEntry } from './history.js'
import { deriveSessionName } from './session-merge.js'
import { queueOf, weekTally } from './queue.js'
import { todayISO, isoOf, fmtNum, weekStartOf, startOfWeek, exerciseNameText } from './format.js'
import { accentPair, accentValue } from './accent.js'
import { speedUnitOf } from './speed.js'

export const WIDGET_SNAPSHOT_VERSION = 1
// Today and the week after it: enough for "next workout" to still be right a few days on.
export const WIDGET_DAYS = 8
// What the large widget lists of today's plan.
export const WIDGET_EXERCISES_MAX = 8
const WRITE_DEBOUNCE_MS = 1000

// Title-cased as the app shows it; a widget has no CSS to do it (lib/format.js exerciseNameText).
const nameOfCfg = cfg => (EXIDX[cfg?.id] ? exerciseNameText(EXIDX[cfg.id]) : String(cfg?.name || cfg?.n || cfg?.id || ''))
const routineIdsOf = w => (Array.isArray(w?.routineIds) ? w.routineIds : w?.routineId ? [w.routineId] : [])
const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }

// One day of the plan as the widget shows it. The exercises only for today: the other days are a
// name and a count, which is all a widget has room for.
function dayOf (S, iso, today) {
  let routines = []
  try { routines = effectiveRoutines(S, iso).filter(r => (r.ex || []).length) } catch { routines = [] }
  const weekday = new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' })
  if (!routines.length) return { iso, weekday, name: null, count: 0 }
  const day = {
    iso,
    weekday,
    name: deriveSessionName(routines.map(r => r.name || '')) || '',
    count: routines.reduce((n, r) => n + (r.ex || []).length, 0),
  }
  if (iso === today) {
    const unit = S.unit === 'lb' ? 'lb' : 'kg'
    const speed = speedUnitOf(S)
    day.exercises = routines.flatMap(r => r.ex || []).slice(0, WIDGET_EXERCISES_MAX).map(cfg => {
      let line = ''
      try { line = exLine(cfg, unit, speed) } catch { line = '' }
      return { name: nameOfCfg(cfg), line }
    })
    // Logged already (as the Home screen's today row says it): every routine of the day covered
    // by a workout from today. A coach-queue session is never covered that way.
    const queueIds = queueOf(S)?.ids || []
    const logged = (S.workouts || []).filter(w => w && w.d === today)
    day.done = routines.every(r => !queueIds.includes(r.id) && logged.some(w => routineIdsOf(w).includes(r.id)))
  }
  return day
}

// The newest workout with a PR in it, and that lift's best weight there.
function lastPrOf (S) {
  const ws = (S.workouts || []).filter(w => w && Array.isArray(w.prs) && w.prs.length)
  if (!ws.length) return null
  const w = ws.reduce((a, b) => ((b.d || '') > (a.d || '') || ((b.d || '') === (a.d || '') && (b.end || 0) > (a.end || 0)) ? b : a))
  const id = w.prs[0]
  const entry = (w.entries || []).find(e => e && e.id === id)
  const name = EXIDX[id] ? exerciseNameText(EXIDX[id]) : String(entry?.target?.name || entry?.name || id)
  let best = 0
  try { best = entry ? bestWeightForEntry(entry) : 0 } catch { best = 0 }
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  return { name, value: best > 0 ? `${fmtNum(best)} ${unit}` : '', d: w.d || null }
}

function activeOf (S) {
  const A = S.active
  if (!A || !Array.isArray(A.entries) || A.editingWorkoutId) return null
  let done = 0, total = 0
  for (const e of A.entries) for (const s of e?.sets || []) { total++; if (s?.done) done++ }
  return { id: A.id || null, name: A.name || '', start: typeof A.start === 'number' ? A.start : null, done, total }
}

/** Everything the widgets show, as plain JSON (the `today` argument pins the clock for tests). */
export function buildWidgetSnapshot (S, { today = todayISO() } = {}) {
  const st = { ...S, routines: S?.routines || [], week: S?.week || {}, dayPlan: S?.dayPlan || {}, workouts: S?.workouts || [] }
  const days = []
  for (let i = 0; i < WIDGET_DAYS; i++) days.push(dayOf(st, shift(today, i), today))
  let week = { done: 0, planned: 0 }
  try { week = weekTally(st, today) } catch { /* the widget shows no fraction then */ }
  let streak = 0
  try { streak = streakWeeks(st) } catch { streak = 0 }
  const ws = weekStartOf(st)
  const weekFrom = isoOf(startOfWeek(today, ws))
  const pair = accentPair(accentValue(st))
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    today,
    weekFrom,
    weekUntil: shift(weekFrom, 7),
    unit: st.unit === 'lb' ? 'lb' : 'kg',
    accent: pair?.accent || '#30d158',
    ink: pair?.ink || '#000000',
    days,
    week: { done: week.done || 0, planned: week.planned || 0 },
    streak,
    lastPR: lastPrOf(st),
    active: activeOf(st),
    labels: {
      today: t('Today'),
      restDay: t('Rest day'),
      upNext: t('Up next'),
      thisWeek: t('This week'),
      weekStreak: t('Week streak'),
      streak: t('{0} week streak', streak),
      lastPR: t('Last PR'),
      done: t('Done'),
      running: t('Workout running'),
    },
  }
}

/* ---------- the native plugin ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then` (lib/rest-alert.js, the Coach hang #42).
const widgetPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || (await nativePlatform()) !== 'ios') return null
  const { registerPlugin } = await import('@capacitor/core')
  return { WidgetBridge: registerPlugin('WidgetBridge') }
})().catch(() => null))

/**
 * Started once by the app: writes the snapshot when what it shows changes (debounced, and only
 * when it differs from the last one written), and again when the app comes back, which may be on
 * another day. Resolves with the stop function.
 */
export async function startWidgetSync ({ useStore }) {
  const p = await widgetPlugin()
  if (!p) return () => {}
  let last = null, tm = null
  const write = async () => {
    tm = null
    try {
      const json = JSON.stringify(buildWidgetSnapshot(useStore.getState().S))
      if (json === last) return
      await p.WidgetBridge.write({ json })
      last = json
    } catch { /* not now: the next change writes it */ }
  }
  const schedule = () => { clearTimeout(tm); tm = setTimeout(write, WRITE_DEBOUNCE_MS) }
  const off = useStore.subscribe((s, prev) => { if (s.S !== prev.S) schedule() })
  const onVisible = () => { if (document.visibilityState === 'visible') schedule() }
  document.addEventListener('visibilitychange', onVisible)
  write()
  return () => { off(); clearTimeout(tm); document.removeEventListener('visibilitychange', onVisible) }
}

// Test seams.
export function _setWidgetPluginForTest (plugin) { pluginP = Promise.resolve(plugin ? { WidgetBridge: plugin } : null) }
export function _resetWidgets () { pluginP = null }
