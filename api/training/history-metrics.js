import { phaseForSet, isWarmupRow, normalizeMode, modeForSet, modeForEntry } from './set-semantics.js'

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
const completedRowsForMode = (entry, mode) => workRowsForMode(entry, mode).filter(s => s.done === true && !isWarmupRow(s))

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

export function bestWeightForEntry(entry = {}) {
  const target = entry.target || entry
  const workRows = Array.isArray(entry.sets)
    ? entry.sets.filter(s => phaseForSet(s) === 'work')
    : []
  const repsRows = metricRowsForEntry(entry, 'reps')
  // Reps rows are the authoritative load metric for a mixed entry. Otherwise use every
  // completed work row (timed holds can carry an added load too).
  const completedRows = repsRows.length
    ? repsRows
    : workRows.filter(set => set?.done === true && !isWarmupRow(set))
  let best = 0
  let hasUsableWeight = false
  completedRows.forEach(set => {
    const weight = Number(set?.w)
    if (!Number.isFinite(weight)) return
    hasUsableWeight = true
    if (weight > best) best = weight
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
  if (parentMode === 'reps' && !hasNonRepsWorkRow && !hasWarmupRow
    && Number.isFinite(topWeight) && topWeight > best) best = topWeight
  return best
}
