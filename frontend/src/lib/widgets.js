// The phone app's Home Screen and Lock Screen widgets, the page's side. Native: on the iPhone
// ios/App/App/WidgetBridgePlugin.swift writes what this builds to the App Group, and the widget
// extension in ios/App/OpenGymWidgets reads it; on Android WidgetBridgePlugin.java keeps it in
// SharedPreferences and redraws the widgets (OpenGymWidgetProvider.java).
//
// A widget runs without the app, so the page hands it a small snapshot whenever something it shows
// changes: the plan for today and the coming week (so the widget can turn the page at midnight on
// its own), this week's progress, the streak, the last PR, and a workout that is running. Every
// word in it is already in the app's language, and the accent is the app's, so the widgets look
// and talk like the app. Text only: no exercise animations or pictures (Gym visual licence).
//
// Since v1.4.4 (v 2) it also carries one block per thing a configurable widget can show
// ("What to show": streak, weight goal, this week, next workout, records, volume), each with its
// words ready to draw, and `level`, kept null until points and levels exist (a later version):
// a widget that finds it null shows nothing of it.
//
// Since the monthly challenges (lib/challenges.js) the snapshot also has `challenges`: the month's
// three with their progress, as words, and "challenges" is one more thing a widget can show. Null
// when they are switched off.
//
// Phone app only. Nothing here runs on the web.
import { MOBILE, nativePlatform } from './mobile.js'
import { EXIDX } from './exercises.js'
import { t, tn, dateLocale } from './i18n.js'
import { effectiveRoutines, exLine, bestWeightForEntry, sessionVolume, lastBW } from './history.js'
import { streakInfo } from './streak.js'
import { challengesOn, monthChallenges, progressOf } from './challenges.js'
import { challengeTitle, challengeCount, doneLine } from './challenge-copy.js'
import { deriveSessionName } from './session-merge.js'
import { queueOf, weekTally } from './queue.js'
import { workoutsLeft } from './week-left.js'
import { todayISO, isoOf, fmtNum, weekStartOf, startOfWeek, weekKey, exerciseNameText } from './format.js'
import { accentPair, accentValue } from './accent.js'
import { speedUnitOf } from './speed.js'
import { viewTarget, exUnitOf, shownWeight } from './ex-unit.js'

export const WIDGET_SNAPSHOT_VERSION = 2
// What the weight goal's little curve draws: the last weigh-ins.
export const WIDGET_TREND_POINTS = 7
// What a configurable widget can show, in the order its menu lists them.
export const WIDGET_KINDS = ['streak', 'weight', 'week', 'next', 'records', 'volume', 'challenges']
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
    ids: routines.map(r => r.id).filter(Boolean),
    count: routines.reduce((n, r) => n + (r.ex || []).length, 0),
  }
  if (iso === today) {
    const speed = speedUnitOf(S)
    day.exercises = routines.flatMap(r => r.ex || []).slice(0, WIDGET_EXERCISES_MAX).map(cfg => {
      let line = ''
      // In the exercise's own weight unit when it has one (#657).
      try { line = exLine(viewTarget(S, cfg.id, cfg), exUnitOf(S, cfg.id), speed) } catch { line = '' }
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
  return { name, value: best > 0 ? `${fmtNum(shownWeight(S, id, best))} ${exUnitOf(S, id)}` : '', d: w.d || null }
}

function activeOf (S) {
  const A = S.active
  if (!A || !Array.isArray(A.entries) || A.editingWorkoutId) return null
  let done = 0, total = 0
  for (const e of A.entries) for (const s of e?.sets || []) { total++; if (s?.done) done++ }
  return { id: A.id || null, name: A.name || '', start: typeof A.start === 'number' ? A.start : null, done, total }
}

const round1 = n => Math.round(n * 10) / 10
// 12400 → "12.4k", 980 → "980": a widget has room for four or five characters.
const compact = n => (n >= 10000 ? fmtNum(round1(n / 1000)) + 'k' : fmtNum(Math.round(n)))

function streakOf (S, today) {
  let info
  try { info = streakInfo(S, today) } catch { info = streakInfo({ workouts: [] }, today) }
  return {
    current: info.current,
    best: info.best,
    freezes: info.freezes,
    weekDone: info.thisWeekDone,
    next: info.next,
    line: t('{0} week streak', info.current),
    bestLine: t('Best: {0}', info.best),
  }
}

// The weight goal: the last weigh-in, the goal, how far to go, the last few weigh-ins.
function weightOf (S) {
  const last = lastBW(S)
  if (!last || !Number.isFinite(last.w)) return null
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const goal = Number.isFinite(S.targetW) && S.targetW > 0 ? S.targetW : null
  const toGo = goal == null ? null : round1(Math.abs(last.w - goal))
  const trend = S.bodyweight.slice(-WIDGET_TREND_POINTS).map(b => b?.w).filter(Number.isFinite)
  return {
    current: last.w,
    goal,
    toGo,
    unit,
    trend,
    currentText: `${fmtNum(last.w)} ${unit}`,
    goalText: goal == null ? null : `${fmtNum(goal)} ${unit}`,
    // Within a tenth of the unit counts as there: a scale shows no finer.
    line: goal == null ? t('No goal set') : toGo < 0.1 ? t('Goal reached') : t('{0} to go', `${fmtNum(toGo)} ${unit}`),
  }
}

// The next workout: today's when it is not done yet, else the next day with a plan.
function nextOf (days, today) {
  const d = days.find(x => x.name && !(x.iso === today && x.done))
  if (!d) return null
  return { name: d.name, iso: d.iso, weekday: d.weekday, today: d.iso === today, ids: d.ids || [], count: d.count || 0 }
}

// PRs this calendar month, and the last one.
function recordsOf (S, today) {
  const month = today.slice(0, 7)
  let n = 0
  for (const w of S.workouts) if (w && typeof w.d === 'string' && w.d.startsWith(month) && Array.isArray(w.prs)) n += w.prs.length
  return { month: n, monthLine: tn('{0} PR this month', '{0} PRs this month', n), last: lastPrOf(S) }
}

// Volume this week against all of last week, in the profile's unit, counted as Stats counts it.
function volumeOf (S, today) {
  const ws = weekStartOf(S)
  const cur = weekKey(today, ws), prev = weekKey(shift(cur, -7), ws)
  let now = 0, before = 0
  for (const w of S.workouts) {
    if (!w || typeof w.d !== 'string') continue
    const k = weekKey(w.d, ws)
    if (k !== cur && k !== prev) continue
    let v = 0
    try { v = sessionVolume(w, S) } catch { v = 0 }
    if (k === cur) now += v; else before += v
  }
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const pct = before > 0 ? Math.round((now - before) / before * 100) : null
  return {
    now: Math.round(now),
    prev: Math.round(before),
    unit,
    pct,
    nowText: `${compact(now)} ${unit}`,
    prevText: `${compact(before)} ${unit}`,
    line: pct == null ? t('Last week: {0}', `${compact(before)} ${unit}`) : t('{0} vs last week', (pct > 0 ? '+' : '') + pct + '%'),
  }
}

// The month's challenges: how many are done, each with its words and how far, and the first one
// still open as the line a small widget has room for.
function challengesOfWidget (S, today) {
  if (!challengesOn(S) || !(S.workouts || []).length) return null
  try {
    const month = monthChallenges(S, today.slice(0, 7))
    const unit = S.unit === 'lb' ? 'lb' : 'kg'
    const items = progressOf(S, month).map(p => ({ id: p.id, title: challengeTitle(p, unit), count: challengeCount(p, unit), pct: Math.round(p.pct * 100), done: p.done }))
    if (!items.length) return null
    const done = items.filter(i => i.done).length
    const open = items.find(i => !i.done)
    return {
      month: month.key,
      done,
      total: items.length,
      items,
      line: doneLine(done, items.length),
      next: open ? `${open.title} · ${open.count}` : t('Gold month. Take a bow.'),
    }
  } catch { return null }
}

/** Everything the widgets show, as plain JSON (the `today` argument pins the clock for tests). */
export function buildWidgetSnapshot (S, { today = todayISO() } = {}) {
  const st = { ...S, routines: S?.routines || [], week: S?.week || {}, dayPlan: S?.dayPlan || {}, workouts: S?.workouts || [], bodyweight: Array.isArray(S?.bodyweight) ? S.bodyweight : [] }
  const days = []
  for (let i = 0; i < WIDGET_DAYS; i++) days.push(dayOf(st, shift(today, i), today))
  let week = { done: 0, planned: 0 }
  try { week = weekTally(st, today) } catch { /* the widget shows no fraction then */ }
  const streakX = streakOf(st, today)
  const streak = streakX.current
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
    // v1.4.5 (#753): what is left of the week's plan, { left, of }, or null with no plan (a
    // rotation without a weekly target). The native widgets do not read it yet.
    weekLeft: (() => { try { const l = workoutsLeft(st, today); return l ? { left: l.left, of: l.of } : null } catch { return null } })(),
    streak,
    lastPR: lastPrOf(st),
    active: activeOf(st),
    // v 2: the configurable widget's blocks.
    streakInfo: streakX,
    weight: weightOf(st),
    next: nextOf(days, today),
    records: recordsOf(st, today),
    volume: volumeOf(st, today),
    challenges: challengesOfWidget(st, today),
    // Points to the next level: not built yet. Stays null until it is; the widgets skip it then.
    level: null,
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
      weightGoal: t('Weight goal'),
      nextWorkout: t('Next workout'),
      records: t('Records'),
      volume: t('Volume'),
      challenges: t('Challenges'),
      freezes: t('Streak freezes'),
      nothingPlanned: t('Nothing planned'),
      noWeighIn: t('No weigh-ins yet'),
      startNow: t('Start'),
      // Android's "What to show" screen, in the app's language (OpenGymWidgetConfigure.java).
      whatToShow: t('What to show'),
      secondThing: t('And beside it'),
      kinds: { streak: t('Week streak'), weight: t('Weight goal'), week: t('This week'), next: t('Next workout'), records: t('Records'), volume: t('Volume'), challenges: t('Challenges') },
    },
  }
}

/* ---------- the native plugin ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then` (lib/rest-alert.js, the Coach hang #42).
const widgetPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const platform = await nativePlatform()
  if (platform !== 'ios' && platform !== 'android') return null
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
    if (useStore.getState().tourSandbox) return
    try {
      const json = JSON.stringify(buildWidgetSnapshot(useStore.getState().S))
      if (json === last) return
      await p.WidgetBridge.write({ json })
      last = json
    } catch { /* not now: the next change writes it */ }
  }
  // The tour's practice workout (useStore enterTourSandbox) is left off the widgets.
  const schedule = () => { if (useStore.getState().tourSandbox) return; clearTimeout(tm); tm = setTimeout(write, WRITE_DEBOUNCE_MS) }
  const off = useStore.subscribe((s, prev) => { if (s.S !== prev.S) schedule() })
  const onVisible = () => { if (document.visibilityState === 'visible') schedule() }
  document.addEventListener('visibilitychange', onVisible)
  write()
  return () => { off(); clearTimeout(tm); document.removeEventListener('visibilitychange', onVisible) }
}

// Test seams.
export function _setWidgetPluginForTest (plugin) { pluginP = Promise.resolve(plugin ? { WidgetBridge: plugin } : null) }
export function _resetWidgets () { pluginP = null }
