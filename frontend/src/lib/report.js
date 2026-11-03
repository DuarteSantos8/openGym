// The performance report: everything a stretch of training adds up to, as plain data. The PDF
// (lib/report-print.js) draws it; this file only counts, so every number on the paper is tested
// here without a browser.
//
// The rules are the app's own, read through the same helpers the Stats screen uses:
//  - volume is sessionVolume (work sets only unless warm-ups are switched in, #719; both sides of a per-side set, both dumbbells when
//    logged per bell); sets are ticked work sets, a per-side set counting once per side, like the
//    share card (lib/workout-card.js);
//  - muscles are loadOfWorkouts, the Muscle balance card's effective sets;
//  - the 1RM trend is e1rmSeries, the Exercise progress card's "Est. 1RM";
//  - new bests are the ones each workout recorded when it was finished (w.prs).
// Nothing here writes to the state.
import { sessionVolume, workoutDuration, workoutDay, workoutAt, doneUnits, streakWeeks } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { loadOfWorkouts, rankOf, MUSCLE_NAME } from './muscles.js'
import { e1rmSeries, bestSetOf, formulaOf } from './onerm.js'
import { isAssisted } from './exercises.js'
import { weighInAt } from './bodyweight.js'
import { isoOf, todayISO, weekKey, weekStartOf } from './format.js'

const DAY = 86400000

const dateOf = iso => new Date(iso + 'T12:00:00')
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d) }
const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / DAY)
const validIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(dateOf(s)) === s

/**
 * The days a report covers, both ends included. '7d' is the last seven days with today, '4w' the
 * last 28, '3m' back to the same date three months ago (the day after it, so 15 Jul – 15 Oct is
 * not one day too long). 'custom' takes `from`/`to`; swapped ends are put the right way round,
 * and an end in the future is cut to today.
 */
export function reportRange(range, { from, to, today = todayISO() } = {}) {
  let start, end = today
  if (range === '7d') start = addDays(today, -6)
  else if (range === '4w') start = addDays(today, -27)
  else if (range === '3m') {
    const d = dateOf(today); const day = d.getDate()
    d.setDate(1); d.setMonth(d.getMonth() - 3)
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
    start = addDays(isoOf(d), 1)
  } else {
    start = validIso(from) ? from : addDays(today, -27)
    end = validIso(to) ? to : today
    if (start > end) [start, end] = [end, start]
    if (end > today) end = today
    if (start > end) start = end
  }
  return { from: start, to: end, days: daysBetween(start, end) + 1 }
}

// Ticked work sets: warm-ups left out, a per-side set counted once per side.
export const workSetsOf = w => (w.entries || []).reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + (isWarmupRow(s) ? 0 : doneUnits(s)), 0), 0)

// sessionVolume: counted from the sets, warm-ups in only when the profile says so (#719); legacy
// records without entries carry the cached volume. `S` is the profile, absent in older callers.

export const inRange = (S, { from, to }) => (S.workouts || [])
  .filter(w => { const d = workoutDay(w); return d && d >= from && d <= to })
  .sort((a, b) => (workoutAt(a) || 0) - (workoutAt(b) || 0))

/** Headline numbers for a list of workouts (and the weigh-ins over the same days). */
export function totalsOf(workouts, bodyweight = [], S) {
  const t = { workouts: workouts.length, volume: 0, sets: 0, ms: 0, prs: 0, days: 0 }
  const days = new Set()
  for (const w of workouts) {
    t.volume += sessionVolume(w, S)
    t.sets += workSetsOf(w)
    t.ms += workoutDuration(w)
    t.prs += new Set(w.prs || []).size
    days.add(workoutDay(w))
  }
  t.days = days.size
  t.volume = Math.round(t.volume * 10) / 10
  const bw = bodyweight.filter(b => b && b.w > 0)
  t.bwStart = bw.length ? bw[0].w : null
  t.bwEnd = bw.length ? bw[bw.length - 1].w : null
  t.bwChange = bw.length > 1 ? Math.round((bw[bw.length - 1].w - bw[0].w) * 10) / 10 : null
  return t
}

const weighInsIn = (S, { from, to }) => (S.bodyweight || [])
  .filter(b => b && validIso(b.d) && b.d >= from && b.d <= to && b.w > 0)
  .sort((a, b) => weighInAt(a) - weighInAt(b))

/**
 * Volume, sets and workouts in buckets for the bar chart: one bar per day for a range of two
 * weeks or less, per week (the profile's first weekday) up to about four months, per month beyond.
 * Every bucket in the range is there, the empty ones too, so the gaps show.
 */
export function bucketsOf(workouts, { from, to, days }, ws, S) {
  const unit = days <= 14 ? 'day' : days <= 124 ? 'week' : 'month'
  const keyOf = iso => unit === 'day' ? iso : unit === 'week' ? weekKey(iso, ws) : iso.slice(0, 7) + '-01'
  const buckets = []
  const byKey = {}
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = keyOf(d)
    if (!byKey[k]) { byKey[k] = { key: k, from: d, volume: 0, sets: 0, workouts: 0 }; buckets.push(byKey[k]) }
  }
  for (const w of workouts) {
    const b = byKey[keyOf(workoutDay(w))]
    if (!b) continue
    b.volume += sessionVolume(w, S); b.sets += workSetsOf(w); b.workouts++
  }
  buckets.forEach(b => { b.volume = Math.round(b.volume * 10) / 10 })
  return { unit, buckets }
}

/** Every day of the range for the consistency calendar, shaded 0–4 by volume like the heatmap. */
export function calendarOf(workouts, { from, to }, S) {
  const agg = {}
  for (const w of workouts) {
    const d = workoutDay(w)
    const a = agg[d] = agg[d] || { n: 0, volume: 0 }
    a.n++; a.volume += sessionVolume(w, S)
  }
  const values = Object.values(agg).map(a => a.volume).filter(v => v > 0).sort((a, b) => a - b)
  const q = p => (values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))] : 0)
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75)
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const a = agg[d]
    const level = !a ? 0 : !a.volume ? 1 : a.volume >= t3 ? 4 : a.volume >= t2 ? 3 : a.volume >= t1 ? 2 : 1
    out.push({ d, n: a ? a.n : 0, volume: a ? Math.round(a.volume * 10) / 10 : 0, level })
  }
  return out
}

/**
 * The lifts worth a trend line: the exercises with the most sessions in the range that produced
 * an estimated 1RM (ties: the heavier estimate first), at most `max`. Each with its points in the
 * range, its best, and the change from its first to its last session in the range.
 */
export function topLiftsOf(S, workouts, { from, to }, max = 4) {
  const formula = formulaOf(S)
  const seen = {}
  for (const w of workouts) {
    for (const e of w.entries || []) {
      if (!e?.id || isAssisted({ id: e.id })) continue
      const best = bestSetOf(e, formula)
      if (!best) continue
      const s = seen[e.id] = seen[e.id] || { id: e.id, sessions: new Set(), top: 0 }
      s.sessions.add(w.id || workoutAt(w))
      s.top = Math.max(s.top, best.est)
    }
  }
  return Object.values(seen)
    .sort((a, b) => b.sessions.size - a.sessions.size || b.top - a.top)
    .slice(0, max)
    .map(({ id }) => {
      const points = e1rmSeries(S, id, formula).filter(p => p.d >= from && p.d <= to).map(p => ({ d: p.d, t: p.t, y: p.y, w: p.w, r: p.r }))
      const first = points[0], last = points[points.length - 1]
      const best = points.reduce((b, p) => (!b || p.y > b.y ? p : b), null)
      return { id, points, best, change: points.length > 1 ? Math.round((last.y - first.y) * 10) / 10 : null }
    })
}

/** Each new best a workout in the range recorded, newest first, with the set behind it. */
export function prsOf(S, workouts) {
  const formula = formulaOf(S)
  const out = []
  for (const w of workouts) {
    const ids = [...new Set(w.prs || [])]
    for (const id of ids) {
      const entry = (w.entries || []).find(e => e.id === id)
      out.push({ id, d: workoutDay(w), workout: w.name || '', entry: entry || null, best: entry ? bestSetOf(entry, formula) : null })
    }
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
}

/** Muscles by effective sets in the range (Muscle balance), and the ones the range never reached. */
export function musclesOfRange(workouts) {
  const load = loadOfWorkouts(workouts)
  const { worked, missed } = rankOf(load)
  return {
    worked: worked.map(slug => ({ slug, name: MUSCLE_NAME[slug] || slug, sets: Math.round(load[slug] * 10) / 10 })),
    missed: missed.map(slug => ({ slug, name: MUSCLE_NAME[slug] || slug })),
  }
}

// Longest run of weeks in a row with at least one workout, within the range.
function longestWeekRun(workouts, ws) {
  const weeks = [...new Set(workouts.map(w => weekKey(workoutDay(w), ws)))].sort()
  let best = 0, run = 0, prev = null
  for (const k of weeks) {
    run = prev && daysBetween(prev, k) === 7 ? run + 1 : 1
    best = Math.max(best, run)
    prev = k
  }
  return best
}

// Longest run of days in a row with a workout, within the range.
function longestDayRun(workouts) {
  const days = [...new Set(workouts.map(workoutDay))].sort()
  let best = 0, run = 0, prev = null
  for (const d of days) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return best
}

/**
 * The whole report for `range` (reportRange's '7d' | '4w' | '3m' | 'custom' with from/to).
 * `prev` holds the same totals for the stretch of equal length just before, for the "vs before"
 * line under each number.
 */
export function reportData(S, { range = '4w', from, to, today = todayISO() } = {}) {
  const r = reportRange(range, { from, to, today })
  const ws = weekStartOf(S)
  const workouts = inRange(S, r)
  const weighIns = weighInsIn(S, r)
  const before = { from: addDays(r.from, -r.days), to: addDays(r.from, -1), days: r.days }
  const prevWorkouts = inRange(S, before)
  const totals = totalsOf(workouts, weighIns, S)
  return {
    range: { ...r, kind: range },
    workouts,
    totals,
    prev: totalsOf(prevWorkouts, weighInsIn(S, before), S),
    perWeek: Math.round(workouts.length / (r.days / 7) * 10) / 10,
    buckets: bucketsOf(workouts, r, ws, S),
    calendar: calendarOf(workouts, r, S),
    muscles: musclesOfRange(workouts),
    lifts: topLiftsOf(S, workouts, r),
    prs: prsOf(S, workouts),
    bodyweight: weighIns.map(b => ({ d: b.d, t: weighInAt(b), w: b.w })),
    streak: {
      weeks: r.to === today ? streakWeeks(S) : null,
      longestWeeks: longestWeekRun(workouts, ws),
      longestDays: longestDayRun(workouts),
      activeDays: totals.days,
      restDays: r.days - totals.days,
    },
    weekStart: ws,
  }
}
