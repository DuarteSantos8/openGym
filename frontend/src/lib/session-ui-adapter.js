// Rows the workout screen edits, built from a prescription; and the persisted performance built
// back from those rows. Every number comes from the engine's prescription — this file only
// changes its shape.
import { auditExecution, normalizeEffort, ruleOfPrescription } from './prescription/index.js'
import { isSideSet, isWarmupRow, makeSideSet, syncSideAggregate } from './workout-model.js'
import { applyIntensifierPlan, modeOf } from './history.js'

const weightOf = (p, i) => p.prefill.load?.value ?? p.rows[i]?.load?.value ?? null
// What a cardio row with no speed of its own opened at in v1 (history.js buildSets).
const CARDIO_SPEED = 8

// A cardio interval logs minutes and speed (the workout screen's columns), a hold logs seconds.
const cardioTarget = p => ({ mode: 'cardio', min: p.prefill.durationSeconds / 60, speed: p.prefill.speed ?? CARDIO_SPEED })

export const targetFor = (p, mode) => ({
  sets: p.rows.length,
  reps: p.prefill.reps,
  ...(p.parameters.durationSeconds ? (mode === 'cardio' ? cardioTarget(p) : { mode: 'time', sec: p.prefill.durationSeconds }) : {}),
  ...(weightOf(p, 0) != null ? { weight: weightOf(p, 0) } : {}),
  restSec: p.parameters.restSeconds
})

export const loadStepFor = (p, unit) => p?.rounding?.step ?? (unit === 'lb' ? 5 : 2.5)

// What the routine asked for, in the v1 entry shape the copy-routine and unit readers use: the
// rule's own sets and reps, never today's progressed prefill (session-routines.js).
export function plannedOf(p) {
  const { sets, reps, durationSeconds } = ruleOfPrescription(p).parameters
  if (durationSeconds) return { sets: sets.min, sec: durationSeconds.min }
  return { sets: sets.min, reps: reps.max, ...(reps.min !== reps.max ? { repsMin: reps.min } : {}) }
}

// 5/3/1 weeks and RPT pyramids give each row its own reps; everything else shares the prefill.
const perRowReps = p => p.preset === 'five_three_one' || !!p.special?.offsets?.some(o => o.reps)

const rowFor = (p, i, mode) => {
  if (mode === 'cardio' && p.parameters.durationSeconds) {
    const { min, speed } = cardioTarget(p)
    return { setId: 'r' + i, done: false, min, speed }
  }
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
  // A unilateral exercise logs each work row per limb (issue #60), reps split evenly.
  const work = p.rows.map((_, i) => (exposure.side ? makeSideSet(rowFor(p, i, exposure.mode)) : rowFor(p, i, exposure.mode)))
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
      target: { ...targetFor(p, exposure.mode), ...(exposure.side ? { side: true } : {}), ...(exposure.warmupRestSec > 0 ? { warmupRestSec: exposure.warmupRestSec } : {}), ...(exposure.bodyweight != null ? { bodyweight: exposure.bodyweight } : {}), ...(exposure.intensifier ? { intensifier: exposure.intensifier } : {}) },
      planned: plannedOf(p),
      ...(p.prefill.carried ? { carried: true } : {}),
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
  // A cardio row is minutes, a hold's is seconds: the engine reads both as a duration.
  durationSeconds: row.sec ?? (row.min != null ? row.min * 60 : null),
  speed: row.speed ?? null,
  rir: row.rir ?? null,
  rpeEntered: row.rpe ?? null
})

const performanceRow = (row, unit) => {
  const observations = []
  if (row.r != null) observations.push({ metric: 'repetitions', unit: 'reps', value: row.r })
  if (row.sec != null) observations.push({ metric: 'duration', unit: 's', value: row.sec })
  // Cardio logs minutes and speed; stored in seconds and km/h like the migration does.
  else if (row.min != null) observations.push({ metric: 'duration', unit: 's', value: row.min * 60 })
  if (row.speed != null) observations.push({ metric: 'speed', unit: 'kmh', value: row.speed })
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
    // A drop chain is the row's segments, each at its own load (api/migration/profile-migration.js does the same).
    segments: row.type === 'dropset' ? (row.drops || []).map(drop => performanceRow({ ...drop, done: row.done, phase: row.phase }, unit)) : [],
    // Bursts are how `r` breaks down, not volume on top of it: kept beside the row, never as segments.
    ...(row.type === 'restpause' && row.clusters?.length ? { clusters: row.clusters.map(c => ({ r: Number(c.r) || 0, restSec: Number(c.restSec) || 0 })) } : {})
  }
}

// A per-side row is saved as one row per limb, tagged with its side: every reader of saved rows
// (volume, set counts, best weight, 1RM) then counts each limb as the set it was, a half-done row
// included. Each limb carries its own drops and bursts.
const performanceRows = (row, unit) => (isSideSet(row)
  ? ['L', 'R'].map(side => ({ ...performanceRow({ ...row.sides[side], setId: row.setId, phase: row.phase, warmup: row.warmup }, unit), side }))
  : [performanceRow(row, unit)])

export function exposuresWithPerformance(exposures, entries, unit) {
  const byExposure = new Map(entries.map(entry => [entry.exposureId, entry]))
  return exposures.map(exposure => {
    const entry = byExposure.get(exposure.exposureId)
    return {
      ...exposure,
      mode: modeOf({ ...(entry?.target || {}), id: exposure.exerciseId }),
      performance: {
        sets: (entry?.sets || []).flatMap(row => performanceRows(row, unit)),
        ...(entry?.note?.trim() ? { note: entry.note.trim() } : {}),
        ...(entry?.note?.trim() && entry.notePin ? { notePin: true } : {})
      }
    }
  })
}

const observed = (row, metric) => row.observations?.find(o => o.metric === metric)?.value

// One saved row back as the row the workout screen edits: performanceRow read backwards.
function rowOfPerformance(row, mode) {
  const r = observed(row, 'repetitions'), duration = observed(row, 'duration'), speed = observed(row, 'speed')
  return {
    ...(row.setId ? { setId: row.setId } : {}),
    done: row.status === 'completed',
    ...(r != null ? { r } : {}),
    ...(duration != null ? (mode === 'cardio' ? { min: duration / 60 } : { sec: duration }) : {}),
    ...(speed != null ? { speed } : {}),
    w: row.resistance?.kind === 'external-load' ? row.resistance.value : 0,
    // An RPE was typed as one; a RIR is only kept when no RPE was (normalizeEffort derives one).
    ...(row.rpeEntered != null ? { rpe: row.rpeEntered } : row.rir != null ? { rir: row.rir } : {}),
    ...(row.role === 'warmup' ? { phase: 'warmup' } : {}),
    ...(row.segments?.length ? { type: 'dropset', drops: row.segments.map(seg => ({ w: seg.resistance?.value || 0, r: observed(seg, 'repetitions') || 0 })) } : {}),
    ...(row.clusters?.length ? { type: 'restpause', clusters: row.clusters.map(c => ({ ...c })) } : {})
  }
}

/** A saved exposure's rows as editable UI rows: limb rows (or a migrated `sides` row) rejoin into one per-side row. */
export function rowsOfPerformance(sets, mode) {
  const out = []
  for (let i = 0; i < (sets || []).length; i++) {
    const row = sets[i], next = sets[i + 1]
    const pair = row.sides ? [row.sides.L, row.sides.R] : row.side === 'L' && next?.side === 'R' ? [row, sets[++i]] : null
    if (!pair) { out.push(rowOfPerformance(row, mode)); continue }
    const [L, R] = pair.map(limb => rowOfPerformance(limb, mode))
    out.push(syncSideAggregate({ ...(row.setId ? { setId: row.setId } : {}), ...(row.role === 'warmup' ? { phase: 'warmup' } : {}), sides: { L, R } }))
  }
  return out
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
