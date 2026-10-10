import { metricModeForEntry, metricRowsForEntry, bestWeightForEntry, completedRepsOf, weekOf, weekStreak } from '../training/history-metrics.js'

import { completedSetsForRow, isAssistedShape } from '../training/set-semantics.js'
import { EXERCISES } from '../coach/core/library-data.js'

const catalogue = new Map(EXERCISES.map(ex => [ex.id, ex]))
const array = value => Array.isArray(value) ? value : []
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0

// Only these derived values leave the server; workout notes and weigh-in history stay private
export function socialSummary(state, today) {
  const S = state || {}
  const workouts = array(S.workouts).filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w?.d) && weekOf(w.d)
    && new Date(w.d + 'T12:00:00Z').toISOString().slice(0, 10) === w.d && w.d <= today)
    .slice().sort((a, b) => a.d.localeCompare(b.d) || number(a.start) - number(b.start))
  const weekStart = S.weekStart === 0 ? 0 : 1
  const groups = new Map()
  const custom = new Map(array(S.customEx).map(ex => [ex?.id, ex]))
  const assistedFor = id => isAssistedShape(custom.get(id) || catalogue.get(id))
  for (const w of workouts) {
    const occurrences = new Map()
    for (const entry of array(w.entries)) {
      if (typeof entry?.id !== 'string') continue
      const clean = { ...entry, sets: array(entry.sets).filter(row => row && typeof row === 'object' && !Array.isArray(row)) }
      const mode = metricModeForEntry(clean)
      const rows = metricRowsForEntry(clean, mode)
      if (!mode || (!rows.length && !bestWeightForEntry(clean, assistedFor(entry.id)))) continue
      const entries = occurrences.get(entry.id) || []
      entries.push({ entry: clean, mode, rows })
      occurrences.set(entry.id, entries)
    }
    for (const [id, entries] of occurrences) {
      const mode = entries.at(-1).mode
      const matching = entries.filter(item => item.mode === mode)
      const rows = matching.flatMap(item => item.rows)
      const clean = { ...matching.at(-1).entry, sets: rows }
      const logged = groups.get(id) || []
      const weight = bestWeightForEntry(clean, assistedFor(id))
      // Match the load to the completed limb that lifted it, never its aggregate row
      const weightReps = mode === 'reps' ? rows.flatMap(completedSetsForRow)
        .filter(row => Number(row.w) === weight && number(row.r) > 0)
        .reduce((n, row) => Math.max(n, number(row.r)), 0) : 0
      logged.push({ date: w.d, mode, weight, weightReps,
        reps: rows.reduce((n, row) => Math.max(n, completedRepsOf(row)), 0),
        sec: rows.reduce((n, row) => Math.max(n, number(row.sec)), 0),
        min: rows.reduce((n, row) => n + number(row.min), 0) })
      groups.set(id, logged)
    }
  }
  const records = []
  for (const [exerciseId, logged] of groups) {
    const mode = logged.at(-1).mode
    const metric = mode === 'cardio' ? 'min' : mode === 'time' ? 'sec'
      : logged.some(row => row.mode === 'reps' && row.weight > 0) ? 'weight' : 'reps'
    let best = null
    for (const row of logged) {
      if (row.mode !== mode || !(row[metric] > 0)) continue
      const improves = best == null || (metric === 'weight' && assistedFor(exerciseId)
        ? row[metric] < best[metric] : row[metric] > best[metric])
      if (improves) best = row
    }
    if (best) records.push({ exerciseId, metric, value: best[metric], date: best.date,
      ...(metric === 'weight' && best.weightReps > 0 ? { reps: best.weightReps } : {}) })
  }
  return {
    weekStreak: weekStreak(workouts.map(w => w.d), today, weekStart),
    thisWeek: workouts.filter(w => weekOf(w.d, weekStart) === weekOf(today, weekStart)).length,
    lastWorkout: workouts.at(-1)?.d || null,
    recordCount: records.length
  }
}
