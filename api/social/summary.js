import { metricModeForEntry, metricRowsForEntry, bestWeightForEntry, weekOf, weekStreak } from '../training/history-metrics.js'

const array = value => Array.isArray(value) ? value : []
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const scalar = (value, fields) => Object.fromEntries(fields
  .filter(key => ['string', 'number', 'boolean'].includes(typeof value?.[key]))
  .map(key => [key, typeof value[key] === 'string' ? value[key].slice(0, 160) : value[key]]))

// Only these derived values leave the server; workout notes and weigh-in history stay private
export function socialSummary(state, today, { recordLimit = 12 } = {}) {
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
    records: records.slice(0, recordLimit)
  }
}

// The accepted-friend profile is deliberately derived here instead of returning account state:
// callers get useful training facts, while workout notes and the weigh-in history never cross
// the social seam. The latest weight crosses it only when that profile's privacy choice allows it.
export function socialProfile(state, today, { shareBodyWeight = true } = {}) {
  const S = state || {}
  const summary = socialSummary(S, today, { recordLimit: Infinity })
  const weighIns = array(S.bodyweight)
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row?.d) && number(row.w) > 0)
    .map(row => ({ date: row.d, value: number(row.w) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const latest = weighIns.at(-1) || null
  const cutoffDate = new Date(today + 'T12:00:00Z')
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 30)
  const cutoff = cutoffDate.toISOString().slice(0, 10)
  const recentWeights = weighIns.filter(row => row.date >= cutoff && row.date <= today)
  const bodyWeight = latest ? {
    ...latest,
    change30d: recentWeights.length > 1 ? latest.value - recentWeights[0].value : null
  } : null

  const routines = array(S.routines).filter(r => typeof r?.id === 'string' && typeof r.name === 'string')
    .slice(0, 100).map(r => ({
      ...scalar(r, ['id', 'name', 'emoji']),
      ex: array(r.ex).filter(e => typeof e?.id === 'string').slice(0, 100).map(e => scalar(e,
        ['id', 'sets', 'min', 'speed', 'mode', 'sec', 'weight', 'reps', 'bodyweight', 'side',
          'repsMin', 'repsMax', 'restSec', 'sg', 'warmupSets']))
    }))
  const routineIds = new Set(routines.map(r => r.id))
  const week = {}
  for (let day = 0; day < 7; day++) {
    const ids = [].concat(S.week?.[day] || []).filter(id => routineIds.has(id))
    if (ids.length) week[day] = ids
  }
  const usedExercises = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const customExercises = array(S.customEx).filter(e => usedExercises.has(e?.id) && typeof e.n === 'string')
    .map(e => scalar(e, ['id', 'n']))

  return {
    ...summary,
    weekStart: S.weekStart === 0 ? 0 : 1,
    thisMonth: array(S.workouts).filter(w => String(w?.d || '').slice(0, 7) === today.slice(0, 7)).length,
    bodyWeightShared: shareBodyWeight,
    bodyWeight: shareBodyWeight ? bodyWeight : null,
    plan: { routines, week, customExercises }
  }
}
