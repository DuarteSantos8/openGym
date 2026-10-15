import { phaseForSet, normalizeMode, modeForSet, modeForEntry, isWarmupRow, hasCompletedWork, completedSetsForRow } from './set-semantics.js'

export function weekOf(date, weekStart = 1) {
  const day = new Date(date + 'T12:00:00Z')
  if (!Number.isFinite(day.getTime())) return null
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() - weekStart + 7) % 7)
  return day.toISOString().slice(0, 10)
}

export function weekStreak(dates, today, weekStart = 1) {
  const weeks = new Set(dates.map(date => weekOf(date, weekStart)))
  const current = new Date(today + 'T12:00:00Z')
  let streak = 0
  for (let i = 0; i < 520; i++) {
    if (weeks.has(weekOf(current.toISOString().slice(0, 10), weekStart))) streak++
    else if (i > 0) break
    current.setUTCDate(current.getUTCDate() - 7)
  }
  return streak
}

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
// Completed-state-independent work rows whose authoritative mode matches the requested mode.
const workRowsForMode = (entry = {}, mode = 'reps') => {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const expectedMode = normalizeMode(mode, 'reps')
  return (Array.isArray(source.sets) ? source.sets : [])
    .filter(set => phaseForSet(set) === 'work' && modeForSet(set, target) === expectedMode)
}
const METRIC_MODES = ['reps', 'time', 'cardio']
const completedRowsForMode = (entry, mode) => workRowsForMode(entry, mode).filter(s => hasCompletedWork(s) && !isWarmupRow(s))

export function metricRowsForEntry(entry, mode) {
  const requested = typeof mode === 'string' ? mode.trim().toLowerCase() : ''
  const resolved = METRIC_MODES.includes(requested) ? requested : metricModeForEntry(entry)
  return resolved ? completedRowsForMode(entry, resolved) : []
}

/** The authoritative metric for an entry; reps rows take precedence over timed/cardio rows. */

export function metricModeForEntry(entry, fallback = null) {
  for (const mode of METRIC_MODES) {
    if (completedRowsForMode(entry, mode).length) return mode
  }
  return modeForEntry(entry, fallback)
}

/** Best load from completed work rows, with a guarded reps-only legacy topW fallback. */

export function bestWeightForEntry(entry = {}, assisted = false) {
  const target = entry.target || entry
  const workRows = Array.isArray(entry.sets)
    ? entry.sets.filter(s => phaseForSet(s) === 'work')
    : []
  const repsRows = metricRowsForEntry(entry, 'reps')
  // Reps rows are the authoritative load metric for a mixed entry. Otherwise use every
  // completed work row (timed holds can carry an added load too).
  const completedRows = repsRows.length
    ? repsRows
    : workRows.filter(set => hasCompletedWork(set) && !isWarmupRow(set))
  // On an assistance machine the smallest load is the best set, so "best" folds the other way
  // (issue #232). Everything below still returns a plain number — the caller does not branch.
  let best = 0
  let hasUsableWeight = false
  completedRows.forEach(set => {
    const completedSets = completedSetsForRow(set)
    completedSets.forEach(completedSet => {
      const weight = Number(completedSet?.w)
      if (!Number.isFinite(weight)) return
      // A 0 on an assistance machine is a row with no load entered, not a set done with no help
      // at all — folding it in as "the least assistance ever" would invent a record nobody did
      // and then ask for negative help next time. Anyone truly needing none has left the machine
      // behind and should log the unassisted exercise instead.
      if (assisted && !(weight > 0)) return
      best = hasUsableWeight ? (assisted ? Math.min(best, weight) : Math.max(best, weight)) : weight
      hasUsableWeight = true
    })
  })

  // A real completed row, including an explicit zero for an unloaded bodyweight set, always
  // wins. A manual topW is only useful for old records whose rows did not carry a usable load.
  if (hasUsableWeight) return best

  const parentMode = modeForSet({}, target)
  const hasNonRepsWorkRow = workRows.some(set => modeForSet(set, target) !== 'reps')
  const hasWarmupRow = Array.isArray(entry.sets) && entry.sets.some(isWarmupRow)
  const topWeight = Number(entry.topW)
  // topW predates phase-tagged warm-ups. It remains a fallback for legacy all-work records,
  // but cannot override resolved work rows once any warm-up marker exists.
  if (parentMode === 'reps' && !hasNonRepsWorkRow && !hasWarmupRow && Number.isFinite(topWeight)
    && (best <= 0 || (assisted ? topWeight > 0 && topWeight < best : topWeight > best))) best = topWeight
  return best
}

export const completedRepsOf = set => completedSetsForRow(set)
  .reduce((total, row) => total + Math.max(0, Number(row.r) || 0), 0)
