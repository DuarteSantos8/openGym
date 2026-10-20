import { e1rmSeries, formulaOf } from './onerm.js'
import { entriesForExercise, metricRowsForEntry, workoutAt } from './history.js'
import { currentDbLoad, workoutAs } from './dumbbells.js'
import { isAssisted } from './exercises.js'
import { isSideSet, clustersOf } from './workout-model.js'
import { strengthFromAge } from './strength-exercises.js'

export const GOAL_TYPES = { e1rm: 'Estimated 1RM', weight: 'Weight for reps', reps: 'Reps at a weight', time: 'Hold duration' }
const factor = unit => unit === 'lb' ? 2.2046226218 : 1
export const goalWeight = (kg, unit) => kg * factor(unit)
export const goalKg = (weight, unit) => weight / factor(unit)
export const goalUnit = (g, unit) => g.type === 'reps' ? 'reps' : g.type === 'time' ? 'sec' : unit
export const goalValue = (g, value, unit) => value == null ? null : ['e1rm', 'weight'].includes(g.type) ? goalWeight(value, unit) : value
export function validGoal(g) {
  return !!g && typeof g === 'object' && typeof g.exerciseId === 'string' && g.exerciseId.length > 0
    && Object.hasOwn(GOAL_TYPES, g.type) && Number.isFinite(g.target) && g.target > 0
    && Number.isFinite(g.createdAt) && g.createdAt > 0
    && (g.type !== 'weight' || Number.isInteger(g.reps) && g.reps > 0)
    && (!['reps', 'time'].includes(g.type) || Number.isFinite(g.weightKg) && g.weightKg >= 0)
    && (g.type !== 'reps' || Number.isInteger(g.target))
}
export const goalsOf = S => Object.entries(S.exerciseGoals || {}).filter(([, g]) => validGoal(g)).map(([id, g]) => ({ ...g, id }))

// Goal loads stay in kg and retain their dumbbell convention and estimate formula across settings changes.
export function goalSeries(S, g) {
  if (!validGoal(g)) return []
  if (g.type === 'e1rm') return e1rmSeries(S, g.exerciseId, g.formula || formulaOf(S), g.dbLoad || currentDbLoad(S, g.exerciseId))
    .map(p => ({ ...p, y: goalKg(p.y, S.unit) }))
  if (isAssisted(g.exerciseId) && g.type === 'weight') return []
  const points = []
  for (const workout of S.workouts || []) {
    const t = workoutAt(workout)
    if (!Number.isFinite(t)) continue
    const w = workoutAs(workout, g.exerciseId, g.dbLoad || currentDbLoad(S, g.exerciseId))
    let best = null
    for (const entry of entriesForExercise(w, g.exerciseId)) {
      for (const row of metricRowsForEntry(entry, g.type === 'time' ? 'time' : 'reps')) {
        const sides = isSideSet(row) ? [row.sides.L, row.sides.R] : [row]
        if (sides.some(s => !s?.done || clustersOf(s).length)) continue
        const values = sides.map(s => {
          if ((s.unit || entry.unit || w.unit || S.unit) !== S.unit) return null
          const kg = goalKg(Number(s.w) || 0, S.unit)
          if (g.type === 'weight') return Number(s.r) >= g.reps && kg > 0 ? kg : null
          // Reps and holds compare like-for-like loads, including zero added load for bodyweight.
          if (Math.abs(kg - g.weightKg) > 0.05) return null
          const value = Number(g.type === 'time' ? s.sec : s.r)
          return Number.isFinite(value) && value > 0 ? value : null
        })
        if (values.some(v => v === null)) continue
        const y = Math.min(...values)
        if (!best || y > best.y) best = { t, d: workout.d, y }
      }
    }
    if (best) points.push(best)
  }
  return points.sort((a, b) => a.t - b.t)
}
export function goalProgress(S, g, now = Date.now()) {
  const history = goalSeries(S, g).filter(p => p.t <= now)
  const repeating = Number.isFinite(g.attemptStartedAt)
  const attempt = repeating ? history.filter(p => p.t > g.attemptStartedAt) : history
  const baseline = (repeating ? history.filter(p => p.t <= g.attemptStartedAt).at(-1) : history[0]) || attempt[0] || null
  const best = attempt.length ? attempt.reduce((a, b) => a.y >= b.y ? a : b) : baseline
  const completion = attempt.find(p => p.y >= g.target) || null
  const achieved = !!completion
  const percent = achieved ? 100 : baseline && g.target > baseline.y ? Math.max(0, Math.min(100, (best.y - baseline.y) / (g.target - baseline.y) * 100)) : 0
  const current = g.type === 'e1rm' && history.length ? Math.max(...history.map(p => p.y * strengthFromAge(now - p.t))) : null
  return { baseline, best, latest: history.at(-1) || null, points: history, achieved, completion, current, repeating,
    waiting: repeating && !attempt.length, percent, remaining: best ? Math.max(0, g.target - best.y) : null }
}

export function repeatGoal(S, g, now = Date.now()) {
  const progress = goalProgress(S, g, now)
  if (!progress.achieved || !Number.isFinite(now) || now <= progress.completion.t) return null
  const achievements = Array.isArray(g.achievements) ? g.achievements : []
  return { ...g, attemptStartedAt: now, deadline: '', archived: false, _ts: now,
    achievements: [...achievements, { completedAt: progress.completion.t, date: progress.completion.d,
      name: typeof g.name === 'string' ? g.name : '', value: progress.completion.y, target: g.target, startedAt: g.attemptStartedAt || null }] }
}
export function visibleGoals(rows, { status = 'active', type = 'all', sort = 'added' } = {}) {
  return rows.filter(({ goal, progress }) => {
    if (type !== 'all' && goal.type !== type) return false
    if (status === 'all') return true
    if (status === 'archived') return !!goal.archived
    return !goal.archived && (status === 'achieved' ? progress.achieved : !progress.achieved)
  })
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'progress' ? b.progress.percent - a.progress.percent
      : sort === 'deadline' ? (a.goal.deadline || '9999').localeCompare(b.goal.deadline || '9999') : b.goal.createdAt - a.goal.createdAt)
}
