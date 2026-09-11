import { metricModeForEntry, metricRowsForEntry, bestWeightForEntry, weekOf, weekStreak } from '../training/history-metrics.js'

const array = value => Array.isArray(value) ? value : []
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0

// Only these derived values leave the server; workout notes and weigh-ins stay private
export function socialSummary(state, today) {
  const S = state || {}
  const workouts = array(S.workouts).filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w?.d) && weekOf(w.d))
    .slice().sort((a, b) => a.d.localeCompare(b.d) || number(a.start) - number(b.start))
  const weekStart = S.weekStart === 0 ? 0 : 1
  const groups = new Map()
  for (const w of workouts) {
    const seen = new Set()
    for (const entry of array(w.entries)) {
      if (typeof entry?.id !== 'string' || seen.has(entry.id)) continue
      seen.add(entry.id)
      const clean = { ...entry, sets: array(entry.sets).filter(row => row && typeof row === 'object' && !Array.isArray(row)) }
      const mode = metricModeForEntry(clean)
      const rows = metricRowsForEntry(clean, mode)
      if (!mode || !rows.length) continue
      const logged = groups.get(entry.id) || []
      logged.push({ date: w.d, mode, weight: bestWeightForEntry(clean),
        reps: rows.reduce((n, s) => Math.max(n, number(s.r)), 0),
        sec: rows.reduce((n, s) => Math.max(n, number(s.sec)), 0),
        min: rows.reduce((n, s) => n + number(s.min), 0) })
      groups.set(entry.id, logged)
    }
  }
  const names = new Map(array(S.customEx).filter(e => e?.id && typeof e.n === 'string').map(e => [e.id, e.n.slice(0, 160)]))
  const records = []
  for (const [exerciseId, logged] of groups) {
    const mode = logged.at(-1).mode
    const metric = mode === 'cardio' ? 'min' : mode === 'time' ? 'sec'
      : logged.some(row => row.mode === 'reps' && row.weight > 0) ? 'weight' : 'reps'
    let best = null
    for (const row of logged) {
      if (row.mode === mode && row[metric] > (best?.[metric] || 0)) best = row
    }
    if (best) records.push({ exerciseId, name: names.get(exerciseId) || null, metric, value: best[metric], date: best.date })
  }
  records.sort((a, b) => b.date.localeCompare(a.date) || a.exerciseId.localeCompare(b.exerciseId))
  return {
    unit: S.unit === 'lb' ? 'lb' : 'kg',
    weekStreak: weekStreak(workouts.map(w => w.d), today, weekStart),
    workouts: workouts.length,
    thisWeek: workouts.filter(w => weekOf(w.d, weekStart) === weekOf(today, weekStart)).length,
    lastWorkout: workouts.at(-1)?.d || null,
    recordCount: records.length,
    records: records.slice(0, 12)
  }
}
