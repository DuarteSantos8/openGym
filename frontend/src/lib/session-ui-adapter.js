// Rows the workout screen edits, built from a prescription; and the persisted performance built
// back from those rows. Every number comes from the engine's prescription — this file only
// changes its shape.
import { auditExecution, normalizeEffort } from './prescription/index.js'
import { isWarmupRow } from './workout-model.js'
import { applyIntensifierPlan, modeOf } from './history.js'

const weightOf = (p, i) => p.prefill.load?.value ?? p.rows[i]?.load?.value ?? null

export const targetFor = p => ({
  sets: p.rows.length,
  reps: p.prefill.reps,
  ...(p.parameters.durationSeconds ? { mode: 'time', sec: p.prefill.durationSeconds } : {}),
  ...(weightOf(p, 0) != null ? { weight: weightOf(p, 0) } : {}),
  restSec: p.parameters.restSeconds
})

export const loadStepFor = (p, unit) => p?.rounding?.step ?? (unit === 'lb' ? 5 : 2.5)

// 5/3/1 weeks and RPT pyramids give each row its own reps; everything else shares the prefill.
const perRowReps = p => p.preset === 'five_three_one' || !!p.special?.offsets?.some(o => o.reps)

const rowFor = (p, i) => {
  const w = weightOf(p, i)
  const reps = perRowReps(p) ? p.rows[i].reps.min : p.prefill.reps
  return {
    setId: 'r' + i, done: false,
    ...(p.parameters.durationSeconds ? { sec: p.prefill.durationSeconds } : { r: reps }),
    ...(w != null ? { w } : {})
  }
}

// `autoWarmup` is session-only provenance: it marks a generated row that a work-weight edit may
// still re-aim. Any hand edit clears it (Workout.jsx setField).
const warmupRowFor = ({ load, reps }) => ({ w: load.value, r: reps, done: false, phase: 'warmup', warmup: true, autoWarmup: true })

// Drops and bursts are computed from each row's final prescribed load. Rest-pause collapses the
// work rows into one; it keeps the first row's setId so the log still reads back as prescribed,
// and leaves the ramp to the engine's own warm-up rows when there are any.
function intensified(p, exposure) {
  const work = p.rows.map((_, i) => rowFor(p, i))
  if (!exposure.intensifier) return work
  const out = applyIntensifierPlan(work, { intensifier: exposure.intensifier, reps: p.prefill.reps })
  if (exposure.intensifier.type !== 'restpause') return out
  const [warmup, row] = out
  return [...(p.warmupRows?.length ? [] : [warmup]), { ...row, setId: 'r0' }]
}

export function entriesForExposures(exposures, prescriptions) {
  return exposures.map(exposure => {
    const p = prescriptions[exposure.prescriptionId]
    return {
      id: exposure.exerciseId,
      exposureId: exposure.exposureId,
      ...(exposure.routineId ? { rid: exposure.routineId } : {}),
      ...(exposure.excludedFromProgression ? { noProg: true } : {}),
      ...(exposure.sg ? { sg: exposure.sg } : {}),
      target: { ...targetFor(p), ...(exposure.intensifier ? { intensifier: exposure.intensifier } : {}) },
      sets: [...(p.warmupRows || []).map(warmupRowFor), ...intensified(p, exposure)]
    }
  })
}

/** The prescribed-row index a UI row was made from, or null for a row added mid-session. */
export const rowIndexOf = row => (/^r\d+$/.test(row?.setId || '') ? Number(row.setId.slice(1)) : null)

/** One UI row as the engine's per-set actual. Exact values; nothing clamped or rounded. */
export const actualOfRow = (row, unit) => ({
  row: rowIndexOf(row) ?? Infinity,
  reps: row.sec != null ? null : row.r ?? null,
  load: row.w > 0 ? { value: row.w, unit } : null,
  durationSeconds: row.sec ?? null,
  rir: row.rir ?? null,
  rpeEntered: row.rpe ?? null
})

const performanceRow = (row, unit) => {
  const observations = []
  if (row.r != null) observations.push({ metric: 'repetitions', unit: 'reps', value: row.r })
  if (row.sec != null) observations.push({ metric: 'duration', unit: 's', value: row.sec })
  const effort = normalizeEffort({ rir: row.rir ?? null, rpeEntered: row.rpe ?? null })
  const prescribed = rowIndexOf(row) != null
  return {
    prescribed,
    ...(prescribed ? { setId: row.setId } : {}),
    role: isWarmupRow(row) ? 'warmup' : 'work',
    status: row.done ? 'completed' : 'skipped',
    observations,
    resistance: row.w > 0 ? { kind: 'external-load', value: row.w, unit } : { kind: 'bodyweight' },
    ...(effort.rir != null ? { rir: effort.rir } : {}),
    ...(effort.rpeEntered != null ? { rpeEntered: effort.rpeEntered } : {}),
    segments: []
  }
}

export function exposuresWithPerformance(exposures, entries, unit) {
  const byExposure = new Map(entries.map(entry => [entry.exposureId, entry]))
  return exposures.map(exposure => {
    const entry = byExposure.get(exposure.exposureId)
    return {
      ...exposure,
      mode: modeOf({ ...(entry?.target || {}), id: exposure.exerciseId }),
      performance: {
        sets: (entry?.sets || []).map(row => performanceRow(row, unit)),
        ...(entry?.note?.trim() ? { note: entry.note.trim() } : {}),
        ...(entry?.note?.trim() && entry.notePin ? { notePin: true } : {})
      }
    }
  })
}

/** Live warnings per UI row index, work rows only. The set count is audited once, at finish. */
export function rowFindings(prescription, entry, unit, state = null) {
  const out = new Map()
  entry.sets.forEach((row, i) => {
    if (isWarmupRow(row)) return
    const found = auditExecution(prescription, actualOfRow(row, unit), state)
    if (found.length) out.set(i, found)
  })
  return out
}

/** "3 × 5 @ 62.5 kg", "3 × 8–12 @ 60–80 kg" — the prescribed ranges, shown beside the editable actuals. */
export function planSummary(p, fmt = String) {
  const span = r => (r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`)
  const reps = p.parameters.durationSeconds ? `${span(p.parameters.durationSeconds)} s`
    : perRowReps(p) ? p.rows.map(r => fmt(r.reps.min)).join('/') : span(p.parameters.reps)
  const loads = [...new Set(p.rows.filter(r => r.load).map(r => span({ min: r.load.value, max: r.loadTo?.value ?? r.load.value })))]
  const unit = p.rows.find(r => r.load)?.load.unit
  return `${span(p.parameters.sets)} × ${reps}${loads.length ? ` @ ${loads.join('/')} ${unit}` : ''}`
}
