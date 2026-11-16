// Undulating days (v1.4.5): medium, heavy, light in turn. The plan's reps on a medium day, about
// 60 % of them on a heavy one and 150 % on a light one; the day a session was is stamped on its
// exposure (`dup`, 0..2), so the next one is simply the one after it, across every routine that
// trains the lift. The load is never stored: it is the best Epley max of the last three loaded
// sessions (on the weakest set), at about two reps in reserve for the day's reps, on the load grid.
// Ported from v1 progression.js (idea and first version by giulioleuci, #823 to #825).
import { snapWeight } from './exercises.js'

export const DUP_DAYS = ['medium', 'heavy', 'light']
const DUP_RIR = 2
const DUP_LOOKBACK = 3
// v1 epley1RM: on the reps one side did, to a tenth.
const epley = (w, r) => (w > 0 && r >= 1 ? Math.round(w * (1 + r / 30) * 10) / 10 : null)

/** The reps of one undulating day from the plan's reps; per-side work stays even. */
export function dupReps(reps, day, perSide = false) {
  const stride = perSide ? 2 : 1
  const base = Math.max(stride, Math.round(Number(reps)) || 8)
  const f = day === 'heavy' ? 0.6 : day === 'light' ? 1.5 : 1
  return Math.max(stride, Math.round((base * f) / stride) * stride)
}

/** Which day comes next: the one after the last stamped session, else the medium day. */
export function dupDayIndex(sessions) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const d = sessions[i]?.dup
    if (Number.isInteger(d) && d >= 0 && d < DUP_DAYS.length) return (d + 1) % DUP_DAYS.length
  }
  return 0
}

/** The best estimated max of the last few loaded sessions ({ weight, low }), or null. */
export function recentEstimatedMax(sessions, perSide = false, lookback = DUP_LOOKBACK) {
  const est = sessions.filter(s => s.weight > 0 && s.low > 0).slice(-lookback).map(s => epley(s.weight, perSide ? s.low / 2 : s.low)).filter(v => v > 0)
  return est.length ? Math.max(...est) : null
}

const obs = (row, metric) => row.observations?.find(o => o.metric === metric)?.value
/** A lift's counted rep sessions, oldest first: { dup, weight (top load), low (weakest set's reps) }. */
export function dupSessions(workouts, exId) {
  const out = []
  for (const w of workouts || []) {
    for (const x of w.exposures || []) {
      if (x.exerciseId !== exId || x.excludedFromProgression || (x.mode && x.mode !== 'reps')) continue
      const rows = (x.performance?.sets || []).filter(r => r.status === 'completed' && r.role !== 'warmup')
      if (!rows.length) continue
      const weight = Math.max(0, ...rows.map(r => (r.resistance?.kind === 'external-load' ? Number(r.resistance.value) || 0 : 0)))
      const low = Math.min(...rows.map(r => Number(obs(r, 'repetitions')) || 0))
      out.push({ dup: x.dup, weight, low })
    }
  }
  return out
}

/**
 * Today's day: { day, reps, weight, kind, why }, or null to leave the rule's own numbers (a lift
 * never loaded, which climbs like any bodyweight one). `weight` is null on a first session.
 */
export function undulatingDay(sessions, { reps: planReps, perSide = false, step, unit }) {
  const day = dupDayIndex(sessions)
  const reps = dupReps(planReps, DUP_DAYS[day], perSide)
  const max = recentEstimatedMax(sessions, perSide)
  if (!(max > 0)) {
    if (sessions.length && !(sessions.at(-1).weight > 0)) return null
    return { day, reps, weight: null, kind: 'first', why: ['Nothing logged yet, so this session sets the baseline.'] }
  }
  const ideal = max / (1 + ((perSide ? reps / 2 : reps) + DUP_RIR) / 30)
  const weight = Math.max(step, snapWeight(ideal, step))
  // Compared with the last session of the same kind of day: that is what "up" means here.
  const prev = [...sessions].reverse().find(s => s.dup === day && s.weight > 0)
  const kind = prev && weight > prev.weight + 1e-9 ? 'up' : 'hold'
  const r1 = Math.round(max * 10) / 10
  const why = [day === 1 ? 'Heavy day: {0} reps at {1} {2}, from your estimated max of {3} {2}.' : day === 2 ? 'Light day: {0} reps at {1} {2}, from your estimated max of {3} {2}.' : 'Medium day: {0} reps at {1} {2}, from your estimated max of {3} {2}.', reps, weight, unit, r1]
  return { day, reps, weight, kind, why }
}
