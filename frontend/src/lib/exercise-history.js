import { bestSetOf } from './onerm.js'
import { volumeOf } from './history.js'

// One exercise's past, read back for the history sheet (issue #43): a chart series and the
// last few sessions, derived in a single pass over the log so the sheet can memoise the
// result and never rescan on a re-render.
//
// The chart plots ONE number per session, chosen the way Stats does it:
//   reps   — the heaviest completed work set (metric 'weight'); an exercise never loaded
//            (pull-ups, push-ups) plots its best rep count instead (metric 'reps'), because
//            that is the thing improving
//   time   — the longest completed hold, in seconds (metric 'sec')
//   cardio — the minutes logged that session (metric 'min')
// The mode is the one the exercise was logged in most recently; a session logged in another
// mode still appears in the list (its sets are labelled by their own target) but gets no point
// and no value, so the curve never mixes seconds with kilos.
//
// Warm-up rows are excluded from every number here, as everywhere else.

export const HISTORY_SESSIONS = 10

const startOf = w => (Number.isFinite(w.start) ? w.start : new Date(w.d + 'T12:00:00').getTime())

// Volume of the exercise in one session: main set plus its drops/bursts, reps mode only —
// there is no honest tonnage for a hold or a run.
const observation = (row, metric) => row.observations?.find(x => x.metric === metric)?.value
const modeOf = (exposure) => exposure.mode || 'reps'
const rowsFor = exposure => (exposure.performance?.sets || []).filter(row => row.status === 'completed' && row.role !== 'warmup')
const rowView = row => ({ done: true, ...(observation(row, 'repetitions') != null ? { r: observation(row, 'repetitions') } : {}), ...(observation(row, 'duration') != null ? { sec: observation(row, 'duration') } : {}), ...(row.resistance?.value != null ? { w: row.resistance.value } : {}) })
const plannedTarget = p => (p ? { sets: p.rows.length, reps: p.prefill.reps, ...(p.prefill.durationSeconds != null ? { sec: p.prefill.durationSeconds } : {}), ...(p.rows[0]?.load ? { weight: p.rows[0].load.value } : {}) } : { sets: 0 })

export function exerciseHistory(S, exId, { limit = HISTORY_SESSIONS } = {}) {
  const workouts = S?.workouts || []
  // Chronological pairs of (workout, entry); the sort covers backfilled sessions, which are
  // inserted by date rather than appended.
  const logged = []
  workouts.forEach(w => {
    const exposure = (w.exposures || []).find(x => x.exerciseId === exId)
    if (!exposure) return
    const mode = modeOf(exposure)
    const rows = rowsFor(exposure)
    if (rows.length) logged.push({ w, exposure, mode, rows })
  })
  logged.sort((a, b) => startOf(a.w) - startOf(b.w))

  const empty = { mode: 'reps', metric: 'weight', best: 0, prId: null, total: 0, sessions: [], points: [], e1rmPoints: [] }
  if (!logged.length) return empty

  const mode = logged[logged.length - 1].mode
  const repsOnly = mode === 'reps' && !logged.some(l => l.mode === 'reps' && l.rows.some(row => row.resistance?.value > 0))
  const metric = mode === 'cardio' ? 'min' : mode === 'time' ? 'sec' : repsOnly ? 'reps' : 'weight'
  const valueOf = ({ rows }) => {
    if (metric === 'min') return rows.reduce((a, row) => a + (Number(observation(row, 'duration')) || 0) / 60, 0)
    if (metric === 'sec') return Math.max(0, ...rows.map(row => Number(observation(row, 'duration')) || 0))
    if (metric === 'reps') return Math.max(0, ...rows.map(row => Number(observation(row, 'repetitions')) || 0))
    return Math.max(0, ...rows.map(row => Number(row.resistance?.value) || 0))
  }

  let best = 0, prId = null
  const sessions = [], points = [], e1rmPoints = []
  logged.forEach(({ w, exposure, mode: m, rows }) => {
    const same = m === mode
    const value = same ? valueOf({ rows }) : null
    const e1rm = m === 'reps' ? (bestSetOf(exposure)?.est ?? null) : null
    const t = startOf(w)
    // "PR" goes on the session that first reached the all-time best, not on every session
    // that later matched it — one marker says where the record was set.
    if (value != null && value > best) { best = value; prId = w.id }
    if (value != null && value > 0) points.push({ t, d: w.d, y: value, e1rm })
    if (e1rm != null) e1rmPoints.push({ t, d: w.d, y: e1rm })
    sessions.push({
      id: w.id, d: w.d, t, mode: m, target: plannedTarget(S.prescriptions?.[exposure.prescriptionId]), sets: rows.map(rowView), value, e1rm,
      volume: m === 'reps' ? volumeOf({ sets: rows }) : null,
    })
  })
  // The "first reached" rule only holds for records above zero: a bodyweight session with
  // no weight logged is not a PR of anything.
  if (best <= 0) prId = null

  return {
    mode, metric, best, prId, total: sessions.length,
    sessions: sessions.slice(-limit).reverse().map(s => ({ ...s, pr: s.id === prId })),
    points, e1rmPoints,
  }
}
