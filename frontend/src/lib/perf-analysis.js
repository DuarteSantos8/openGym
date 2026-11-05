// "Analyser mes dernières perfs": the local half. Everything here is computed on the phone from the
// logged workouts, with no network and no AI; lib/perf-gemini.js only ever sees the small summary
// this returns, never the raw history.
//
// THE RULE THAT SHAPES IT: an exercise is only ever compared with itself on the same machine. A
// press on the Basic-Fit stack and one on a Technogym do not load alike, so every series is keyed
// by exercise id + machine (entry.gym, lib/gyms.js; "no machine" is a machine of its own).
//
// What it reads, over the last PERF_WEEKS weeks:
//   - per exercise + machine: the estimated 1RM of each session (Epley, w * (1 + r / 30), on the
//     best completed work set), its change over the window, and a verdict:
//       'progress'    the estimate rose by at least PROGRESS_PCT over the window and is not stalled
//       'stagnation'  STALL_SESSIONS or more sessions in a row without beating the best before them
//       'regression'  the latest session is more than REGRESS_PCT under the best of the window
//       'stable'      none of the above
//       'new'         fewer than two sessions in the window: nothing to compare yet
//   - records: a best estimate set in the last RECORD_DAYS days that beats everything logged before
//   - volume: completed work sets per muscle group per week, and the push/pull and upper/lower split
//   - regularity: sessions per week against the days the week plans, and the planned days that went
//     by with no workout and no note ("sick", "travelling"...) excusing them
//
// An exercise logged only in reps (pull-ups, push-ups) is tracked by its best reps instead, and an
// assisted machine (the load is the help you got) is left out of the estimates entirely, as
// everywhere else in the app (lib/onerm.js).
import { MONDAY, isoOf, todayISO, weekKey, weekOrder, weekStartOf } from './format.js'
import { exerciseOf, isAssisted, isCardio } from './exercises.js'
import { metricRowsForEntry, effectiveRoutineIds } from './history.js'
import { currentDbLoad, workoutAs } from './dumbbells.js'
import { isSideSet } from './workout-model.js'
import { muscleWeightsOf } from './muscles.js'
import { entryGym, gymNameOf } from './gyms.js'
import { excusedOn } from './day-notes.js'

export const PERF_WEEKS = 6
export const PROGRESS_PCT = 2.5
export const REGRESS_PCT = 5
export const STALL_SESSIONS = 3
export const RECORD_DAYS = 14
export const EPLEY_MAX_REPS = 20   // beyond this a set says more about endurance than strength

/** Epley's estimate of a one-rep max: w * (1 + r / 30). Null when the set cannot support one. */
export function epley(w, r) {
  const weight = Number(w), reps = Number(r)
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps < 1 || reps > EPLEY_MAX_REPS) return null
  return Math.round(weight * (reps === 1 ? 1 : 1 + reps / 30) * 10) / 10
}

// Muscle groups for the volume table and the balance. A set counts for a group when the exercise
// works one of its muscles as a primary (weight 1 in lib/muscles.js); a secondary (0.4) does not.
export const GROUPS = [
  { id: 'chest', name: 'Pectoraux', muscles: ['chest'], push: true, upper: true },
  { id: 'back', name: 'Dos', muscles: ['upper-back', 'trapezius', 'lower-back'], pull: true, upper: true },
  { id: 'shoulders', name: 'Épaules', muscles: ['deltoids'], push: true, upper: true },
  { id: 'biceps', name: 'Biceps et avant-bras', muscles: ['biceps', 'forearm'], pull: true, upper: true },
  { id: 'triceps', name: 'Triceps', muscles: ['triceps'], push: true, upper: true },
  { id: 'quads', name: 'Quadriceps', muscles: ['quadriceps'], lower: true },
  { id: 'hamstrings', name: 'Ischio-jambiers', muscles: ['hamstring'], lower: true },
  { id: 'glutes', name: 'Fessiers et adducteurs', muscles: ['gluteal', 'adductors'], lower: true },
  { id: 'calves', name: 'Mollets', muscles: ['calves', 'tibialis'], lower: true },
  { id: 'core', name: 'Abdos', muscles: ['abs', 'obliques'] },
]

const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const round1 = n => Math.round(n * 10) / 10
const pct = (a, b) => (b > 0 ? Math.round((a / b - 1) * 1000) / 10 : 0)

// Completed work rows of an entry as plain { w, r } sets; a per-side set counts each side done.
function setsOf(entry) {
  const out = []
  for (const row of metricRowsForEntry(entry, 'reps')) {
    const sides = isSideSet(row) ? [row.sides?.L, row.sides?.R].filter(s => s?.done === true) : [row]
    for (const s of sides) out.push({ w: Number(s.w) || 0, r: Number(s.r) || 0 })
  }
  return out
}

/** The best of one session's sets for one exercise on one machine: { e1rm, w, r, reps } or null. */
export function sessionBest(sets, assisted = false) {
  let best = null
  for (const s of sets) {
    const est = assisted ? null : epley(s.w, s.r)
    if (est !== null && (!best || est > best.e1rm)) best = { e1rm: est, w: s.w, r: s.r, reps: best?.reps ?? 0 }
  }
  const reps = sets.reduce((m, s) => Math.max(m, s.r), 0)
  if (best) return { ...best, reps: Math.max(best.reps, reps) }
  return reps > 0 ? { e1rm: null, w: 0, r: reps, reps } : null
}

/**
 * One series' verdict from its sessions' values, oldest first (the best of each session).
 * `valuesBefore` is the best ever logged before the window, for records: 0 when there is none.
 */
export function judge(values) {
  const n = values.length
  if (n < 2) return { status: 'new', changePct: 0, stalledFor: 0 }
  const first = values[0], last = values[n - 1]
  // Sessions in a row, counting back from the latest, that did not beat the best before them.
  let stalledFor = 0
  for (let i = n - 1; i >= 1; i--) {
    const before = Math.max(...values.slice(0, i))
    if (values[i] > before * 1.005) break
    stalledFor++
  }
  const peak = Math.max(...values)
  const changePct = pct(last, first)
  let status = 'stable'
  if (peak > 0 && last < peak * (1 - REGRESS_PCT / 100)) status = 'regression'
  else if (stalledFor >= STALL_SESSIONS) status = 'stagnation'
  else if (changePct >= PROGRESS_PCT) status = 'progress'
  return { status, changePct, stalledFor }
}

/**
 * The whole analysis. `S` is the app state; `today` and `weeks` are parameters so tests agree on
 * the clock. Pure: reads S, returns a new object, writes nothing.
 */
export function analyzePerf(S, { today = todayISO(), weeks = PERF_WEEKS, nameOf = id => exerciseOf(id)?.n || id } = {}) {
  // a state from another device or an old backup may lack any of these: read them as empty
  S = { ...S, week: S?.week || {}, dayPlan: S?.dayPlan || {}, routines: Array.isArray(S?.routines) ? S.routines : [], customEx: S?.customEx || [] }
  const ws = weekStartOf(S) ?? MONDAY
  const from = addDays(today, -(weeks * 7 - 1))
  const recordFrom = addDays(today, -(RECORD_DAYS - 1))
  const workouts = (Array.isArray(S?.workouts) ? S.workouts : []).filter(w => w && typeof w.d === 'string' && w.d <= today)
    .slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)))
  const inWindow = w => w.d >= from

  // --- per exercise + machine --------------------------------------------------------------
  const series = new Map()   // key -> { id, gym, sessions: [{ d, best }], before: best e1rm/reps before the window }
  const groupSets = Object.fromEntries(GROUPS.map(g => [g.id, 0]))
  let pushSets = 0, pullSets = 0, upperSets = 0, lowerSets = 0, totalSets = 0

  for (const w of workouts) {
    const ids = [...new Set((w.entries || []).filter(e => e && e.id).map(e => e.id))]
    for (const id of ids) {
      const ex = exerciseOf(id) || (S.customEx || []).find(c => c.id === id)
      if (!ex || isCardio(ex)) continue
      const assisted = isAssisted(id)
      const view = workoutAs(w, id, currentDbLoad(S, id))
      // one session may hold the exercise twice (a combined session): each machine on its own
      const byGym = new Map()
      for (const e of (view.entries || []).filter(x => x && x.id === id)) {
        const g = entryGym(w, e) || ''
        byGym.set(g, [...(byGym.get(g) || []), ...setsOf(e)])
      }
      for (const [gym, sets] of byGym) {
        if (!sets.length) continue
        const key = id + '|' + gym
        const s = series.get(key) || { id, gym, sessions: [], beforeE1rm: 0, beforeReps: 0, allE1rm: 0 }
        const best = sessionBest(sets, assisted)
        if (best) {
          if (inWindow(w)) s.sessions.push({ d: w.d, ...best })
          else { s.beforeE1rm = Math.max(s.beforeE1rm, best.e1rm || 0); s.beforeReps = Math.max(s.beforeReps, best.reps) }
        }
        series.set(key, s)
        if (inWindow(w)) {
          // volume: completed work sets by muscle group
          const weights = muscleWeightsOf(ex)
          totalSets += sets.length
          let push = false, pull = false, upper = false, lower = false
          for (const g of GROUPS) {
            if (!g.muscles.some(m => (weights[m] || 0) >= 1)) continue
            groupSets[g.id] += sets.length
            push ||= !!g.push; pull ||= !!g.pull; upper ||= !!g.upper; lower ||= !!g.lower
          }
          if (push) pushSets += sets.length
          if (pull) pullSets += sets.length
          if (upper) upperSets += sets.length
          if (lower) lowerSets += sets.length
        }
      }
    }
  }

  const exercises = []
  const records = []
  for (const s of series.values()) {
    if (!s.sessions.length) continue
    const useE1rm = s.sessions.filter(x => x.e1rm !== null).length * 2 >= s.sessions.length
    const metric = useE1rm ? 'e1rm' : 'reps'
    const points = s.sessions.filter(x => (useE1rm ? x.e1rm !== null : x.reps > 0))
      .map(x => ({ d: x.d, value: useE1rm ? x.e1rm : x.reps, w: x.w, r: x.r }))
    if (!points.length) continue
    // two sessions the same day (a redo) count as one point: the better one
    const byDay = new Map()
    for (const p of points) if (!byDay.has(p.d) || p.value > byDay.get(p.d).value) byDay.set(p.d, p)
    const pts = [...byDay.values()]
    const verdict = judge(pts.map(p => p.value))
    const first = pts[0], last = pts[pts.length - 1]
    const peak = pts.reduce((m, p) => (p.value > m.value ? p : m), pts[0])
    const before = useE1rm ? s.beforeE1rm : s.beforeReps
    const record = pts.length > 0 && before > 0 && peak.value > before * 1.001 && peak.d >= recordFrom
    const row = {
      id: s.id, name: nameOf(s.id), gym: s.gym || null, machine: s.gym ? gymNameOf(S, s.gym) : null,
      metric, sessions: pts.length, status: verdict.status, changePct: verdict.changePct, stalledFor: verdict.stalledFor,
      first: { d: first.d, value: first.value }, last: { d: last.d, value: last.value, w: last.w, r: last.r },
      best: { d: peak.d, value: peak.value, w: peak.w, r: peak.r },
      record,
      // a lighter or shorter latest session than the one before it (the raw drop the verdict rounds up)
      dropped: pts.length >= 2 && (last.w < pts[pts.length - 2].w || (last.w === pts[pts.length - 2].w && last.r < pts[pts.length - 2].r)),
    }
    exercises.push(row)
    if (record) records.push({ id: s.id, name: row.name, machine: row.machine, metric, value: peak.value, d: peak.d, w: peak.w, r: peak.r, before })
  }
  // most sessions first: the lifts that matter lead
  exercises.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))

  // --- volume -------------------------------------------------------------------------------
  const perWeek = n => round1(n / weeks)
  const volume = {
    byGroup: GROUPS.map(g => ({ id: g.id, name: g.name, sets: groupSets[g.id], perWeek: perWeek(groupSets[g.id]) })),
    totalPerWeek: perWeek(totalSets),
    push: perWeek(pushSets), pull: perWeek(pullSets), upper: perWeek(upperSets), lower: perWeek(lowerSets),
  }
  volume.pushPull = pullSets > 0 ? round1(pushSets / pullSets) : (pushSets > 0 ? null : 0)
  volume.upperLower = lowerSets > 0 ? round1(upperSets / lowerSets) : (upperSets > 0 ? null : 0)
  const flags = []
  if (pushSets + pullSets >= 12) {
    if (pullSets === 0 || pushSets / pullSets > 1.4) flags.push('push-heavy')
    else if (pushSets === 0 || pullSets / pushSets > 1.4) flags.push('pull-heavy')
  }
  if (upperSets + lowerSets >= 12) {
    if (lowerSets === 0 || upperSets / lowerSets > 2) flags.push('upper-heavy')
    else if (upperSets === 0 || lowerSets / upperSets > 2) flags.push('lower-heavy')
  }
  const lowGroups = volume.byGroup.filter(g => g.perWeek < 4 && totalSets > 0).map(g => g.id)

  // --- regularity ---------------------------------------------------------------------------
  const perWeekCount = new Map()
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const k = weekKey(d, ws)
    if (!perWeekCount.has(k)) perWeekCount.set(k, { week: k, sessions: 0, planned: 0, skipped: 0 })
  }
  const trained = new Set()
  for (const w of workouts) {
    if (!inWindow(w)) continue
    trained.add(w.d)
    const row = perWeekCount.get(weekKey(w.d, ws))
    if (row) row.sessions++
  }
  const skipped = []
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const ids = effectiveRoutineIds(S, d, today)
    if (!ids.length) continue
    const row = perWeekCount.get(weekKey(d, ws))
    // today is not missed yet; the plan of a day that has passed is what it is now
    if (d < today) {
      if (row) row.planned++
      if (!trained.has(d) && !excusedOn(S, d)) {
        skipped.push({ d, names: ids.map(id => S.routines.find(r => r.id === id)?.name).filter(Boolean) })
        if (row) row.skipped++
      }
    } else if (row) row.planned++
  }
  const weekRows = [...perWeekCount.values()]
  const sessionsTotal = weekRows.reduce((n, r) => n + r.sessions, 0)
  const plannedDays = weekOrder(ws).filter(d => [].concat(S.week?.[d] || []).some(id => (S.routines || []).some(r => r.id === id))).length

  return {
    period: { from, to: today, weeks },
    unit: S.unit === 'lb' ? 'lb' : 'kg',
    sessions: { total: sessionsTotal, perWeek: round1(sessionsTotal / weeks), plannedPerWeek: plannedDays, weeks: weekRows, skipped },
    exercises,
    records,
    volume, flags, lowGroups,
    counts: {
      progress: exercises.filter(e => e.status === 'progress').length,
      stagnation: exercises.filter(e => e.status === 'stagnation').length,
      regression: exercises.filter(e => e.status === 'regression').length,
    },
    hasData: sessionsTotal > 0 && exercises.length > 0,
  }
}
