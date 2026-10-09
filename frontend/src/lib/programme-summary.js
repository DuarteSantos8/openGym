import { metricRowsForEntry } from './history.js'
import { estimate1RM } from './onerm.js'
import { EXIDX } from './exercises.js'

// Completed-cycle analytics are isolated by cycle, exercise identity, week and explicit unit.
export function completedProgrammeSummary(state, cycle) {
  const workouts = (state.workouts || []).filter(workout =>
    (workout.programmeInstance?.cycleId || workout.programmeStep?.cycleId || workout.cycleId) === cycle.id
    && workout.complete !== false && workout.partial !== true && workout.owed !== true)
  const exercises = new Map()
  for (const workout of workouts) {
    const source = workout.programmeInstance || workout.programmeStep || workout
    const week = Number(source.weekIndex) || Math.floor((Date.parse(workout.d) - Date.parse(cycle.week1StartDate)) / 604800000) + 1
    if (!Number.isInteger(week) || week < 1 || week > cycle.lengthWeeks) continue
    for (const entry of workout.entries || []) {
      for (const row of metricRowsForEntry(entry, 'reps')) {
        const units = [workout, entry, entry.target, row].flatMap(value => ['unit','weightUnit','loadUnit'].map(key => value?.[key]).filter(Boolean))
        if (!units.length || units.some(unit => unit !== units[0]) || !['kg','lb'].includes(units[0])) continue
        const weight = Number(row.w), reps = Number(row.r)
        if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) continue
        const key = entry.id + ':' + units[0]
        if (!exercises.has(key)) exercises.set(key, { key, name: entry.name || state.customEx?.find(ex => ex.id === entry.id)?.n || EXIDX[entry.id]?.n || entry.id, unit: units[0], weeks: new Map() })
        const exercise = exercises.get(key)
        if (!exercise.weeks.has(week)) exercise.weeks.set(week, { weight:0, rm1:0, volume:0 })
        const values = exercise.weeks.get(week)
        values.weight = Math.max(values.weight, weight)
        values.rm1 = Math.max(values.rm1, estimate1RM(weight, reps) || 0)
        values.volume += weight * reps
      }
    }
  }
  const progress = [...exercises.values()].map(exercise => {
    const weeks = [...exercise.weeks.keys()].sort((a,b) => a-b)
    const first = exercise.weeks.get(weeks[0]), last = exercise.weeks.get(weeks.at(-1))
    return { key:exercise.key, name:exercise.name, unit:exercise.unit, firstWeek:weeks[0], lastWeek:weeks.at(-1),
      ...Object.fromEntries(['weight','rm1','volume'].map(metric => [metric, { first:first[metric] || null, last:last[metric] || null }])) }
  }).sort((a,b) => String(a.name).localeCompare(String(b.name)))
  const planned = (cycle.snapshot?.weeks || cycle.programmeSnapshot?.weeks || []).reduce((total, week) => total + (week.mode === 'rest' ? 0 : (week.days || []).reduce((count, day) => count + (day.sessions || []).length, 0)), 0)
  return { planned, sessions: new Set(workouts.map(w => w.programmeInstance?.instanceId || w.programmeInstanceId || w.id)).size, progress }
}
