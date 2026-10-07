// Benjamin's coaching layer. Pure functions only: it reads the existing workout log and never
// mutates history. The point is to turn completed sets into a small, auditable next-step signal.
import { metricEntriesForExercise, bestWeightForEntry, completedRepsOf } from './history.js'
import { betterWeight, EXIDX } from './exercises.js'
import { weeklyWeights } from './bodyweight.js'
import { weekStartOf, exerciseNameText } from './format.js'
import { avgRir } from './effort.js'

const startOf = w => Number.isFinite(w?.start) ? w.start : new Date((w?.d || '') + 'T12:00:00').getTime()

function lastExerciseResult(S, exId) {
  const rows = []
  for (const w of S?.workouts || []) {
    const items = metricEntriesForExercise(w, exId)
    if (!items.length) continue
    const mode = items.at(-1)?.mode
    if (!mode) continue
    const same = items.filter(x => x.mode === mode)
    const sets = same.flatMap(x => x.rows).filter(Boolean)
    if (!sets.length) continue
    const reps = mode === 'reps' ? Math.max(0, ...sets.map(completedRepsOf)) : 0
    const weight = mode === 'reps' ? bestWeightForEntry(same.at(-1).entry) : 0
    rows.push({ w, mode, sets, reps, weight })
  }
  rows.sort((a, b) => startOf(a.w) - startOf(b.w))
  return rows.at(-1) || null
}

function targetFor(routine, exId) {
  const x = routine?.ex?.find(e => e?.id === exId)
  return x || null
}

export function recommendationFor(S, routine, exId) {
  const target = targetFor(routine, exId)
  const last = lastExerciseResult(S, exId)
  if (!target || !last) return { status: 'baseline', label: 'Build a baseline', reason: 'Log this exercise once before changing the target.' }

  const planned = Number(target.reps)
  if (!(planned > 0) || last.mode !== 'reps') return { status: 'repeat', label: 'Repeat the target', reason: 'Keep the current prescription and collect another clean result.' }

  const hits = last.sets.filter(s => s?.done === true && completedRepsOf(s) >= planned).length
  const done = last.sets.filter(s => s?.done === true).length
  const misses = Math.max(0, last.sets.length - hits)
  const plannedSets = Number(target.sets) || last.sets.length
  const complete = done >= plannedSets && hits >= plannedSets

  if (complete) {
    const effort = avgRir(last.sets.filter(s => s?.done === true))
    if (effort != null && effort < 2) {
      return { status: 'repeat', label: 'Repeat the target', reason: 'The target was completed, but the sets were very close to failure; repeat before increasing the demand.' }
    }
    return {
      status: 'progress',
      label: last.weight > 0 ? 'Increase slightly' : 'Make it harder',
      reason: last.weight > 0 ? 'All planned sets reached the rep target last time.' : 'All planned sets reached the target; bodyweight progress now needs load or a harder variation.',
    }
  }
  if (misses >= 2 || done < plannedSets) {
    return { status: 'regress', label: 'Repeat or reduce', reason: 'The last session missed several planned sets; earn the target before progressing.' }
  }
  return { status: 'repeat', label: 'Repeat the target', reason: 'Close, but not enough evidence to progress yet.' }
}

export function routineCoaching(S, routine, limit = 3) {
  return (routine?.ex || [])
    .map(e => ({ id: e.id, name: EXIDX[e.id] ? exerciseNameText(EXIDX[e.id]) : (e.name || e.id), target: e, recommendation: recommendationFor(S, routine, e.id) }))
    .slice(0, limit)
}

export function bodyweightTrend(S) {
  const weeks = weeklyWeights(S?.bodyweight || [], weekStartOf(S))
  if (weeks.length < 2) return { status: 'baseline', delta: null, weeks }
  const delta = weeks[0].avg - weeks[1].avg
  return {
    status: delta < -0.15 ? 'down' : delta > 0.15 ? 'up' : 'steady',
    delta,
    weeks,
  }
}

// Strength retention is deliberately conservative. It compares exercise-level bests between
// two windows, but only exercises present in both windows count. A small drop is treated as
// noise rather than declaring strength loss.
export function strengthRetention(S, days = 30) {
  const now = Date.now()
  const recent = new Map()
  const previous = new Map()

  const record = (map, id, value, metric) => {
    if (!(value > 0)) return
    const old = map.get(id)
    if (!old || (metric === 'load' ? betterWeight(id, old.value, value) : value > old.value)) {
      map.set(id, { value, metric })
    }
  }

  for (const w of S?.workouts || []) {
    const age = (now - startOf(w)) / 86400000
    if (age < 0 || age > days * 2) continue

    for (const e of w.entries || []) {
      const items = metricEntriesForExercise(w, e.id).filter(x => x.mode === 'reps')
      if (!items.length) continue

      const weighted = items.some(x => bestWeightForEntry(x.entry) > 0)
      const map = age <= days ? recent : previous

      if (weighted) {
        const value = items.reduce((best, item) => {
          const candidate = bestWeightForEntry(item.entry)
          return candidate > 0 && (best === 0 || betterWeight(e.id, best, candidate)) ? candidate : best
        }, 0)
        record(map, e.id, value, 'load')
      } else {
        const value = Math.max(0, ...items.flatMap(x => x.rows).map(completedRepsOf))
        record(map, e.id, value, 'reps')
      }
    }
  }

  const comparisons = []
  for (const [id, current] of recent) {
    const old = previous.get(id)
    if (!old || old.metric !== current.metric || !(old.value > 0)) continue

    // Assisted movements are unusual: less assistance is better, so invert the ratio.
    const assisted = EXIDX[id]?.assisted === true
    const ratio = assisted ? old.value / current.value : current.value / old.value
    comparisons.push({ id, ratio, metric: current.metric })
  }

  if (comparisons.length < 2) {
    return { status: 'baseline', compared: comparisons.length, holding: null, comparisons }
  }

  const holding = comparisons.filter(x => x.ratio >= 0.95).length / comparisons.length
  return {
    status: holding >= 0.7 ? 'holding' : holding >= 0.5 ? 'mixed' : 'attention',
    compared: comparisons.length,
    holding,
    comparisons,
  }
}