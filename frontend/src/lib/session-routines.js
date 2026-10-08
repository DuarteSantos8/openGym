import { uid } from './format.js'
import { cardioParameters, defaultPlanRule } from './prescription/index.js'
import { isBodyweightEq, isCardio } from './exercises.js'
import { workLoadOf } from './finish-session.js'

// A saved workout is evidence of what was logged, not a live routine. Copy only its exercise
// setup on this explicit action; finishing a workout never calls this helper.
const observation = (row, metric) => row.observations?.find(o => o.metric === metric)?.value
const workRows = exposure => (exposure.performance?.sets || []).filter(row => row.status === 'completed' && row.role !== 'warmup')
const range = n => ({ min: n, max: n })

function groupIds(ex) {
  const next = ex.map(entry => ({ ...entry }))
  let i = 0
  while (i < next.length) {
    const raw = next[i].sg
    if (raw == null || raw === '') { delete next[i].sg; i++; continue }
    const start = i
    while (i + 1 < next.length && next[i + 1].sg === raw) i++
    const end = i
    if (end === start) delete next[start].sg
    else {
      const mapped = `sg-${uid()}`
      for (let j = start; j <= end; j++) next[j].sg = mapped
    }
    i++
  }
  return next
}

// One occurrence per exposure that logged work. A session started from a routine that still has
// the occurrence copies that plan (its rule, note, warm-up, intensifier) — the plan the session
// followed, not what its numbers drifted to — under new ids so the copy is its own progression
// line. Otherwise the rule is the exercise's default one shaped by what was done.
function copiedOccurrence(exposure, source, unit) {
  const rows = workRows(exposure)
  const occurrenceId = uid()
  const exerciseId = exposure.exerciseId
  const planned = source?.ex?.find(o => o.occurrenceId === exposure.occurrenceId)
  const sg = exposure.sg ?? planned?.sg
  if (planned) {
    return { ...structuredClone(planned), occurrenceId, rule: { ...structuredClone(planned.rule), id: occurrenceId, routineId: null, revision: 1 }, ...(sg ? { sg } : {}) }
  }
  const preset = isCardio(exerciseId) ? 'autoregulated' : exposure.mode === 'time' ? 'hold_seconds' : isBodyweightEq(exerciseId) ? 'bodyweight_ladder' : 'linear'
  const ruleOf = options => defaultPlanRule(preset, { id: occurrenceId, exerciseId, routineId: null, unit, ...options })
  const first = rows[0]
  if (isCardio(exerciseId)) {
    const minutes = rows.reduce((sum, row) => sum + (observation(row, 'duration') || 0), 0) / 60 / rows.length
    const speed = rows.reduce((sum, row) => sum + (observation(row, 'speed') || 0), 0) / rows.length
    const cardio = { sets: rows.length, min: Math.max(1, Math.round(minutes)), speed: speed || 8 }
    return { occurrenceId, exerciseId, mode: 'cardio', rule: ruleOf(cardioParameters(cardio)), cardio, ...(sg ? { sg } : {}) }
  }
  // Per side, each set was logged as a row per limb: the plan counts sets, and reps are the total of both limbs.
  const side = exposure.side === true
  const o = { sets: range(side ? Math.max(1, Math.ceil(rows.length / 2)) : rows.length) }
  if (preset === 'hold_seconds') {
    o.durationSeconds = range(Math.max(1, Math.round(observation(first, 'duration') || 30)))
  } else {
    const reps = Math.max(1, Math.round(side ? (observation(first, 'repetitions') || 0) + (observation(rows[1], 'repetitions') || 0) || 8 : observation(first, 'repetitions') || 8))
    o.reps = range(side ? Math.ceil(reps / 2) * 2 : reps)
    const load = workLoadOf(exposure)
    if (preset === 'linear' && load > 0) o.load = { mode: 'absolute', value: load, unit }
  }
  return { occurrenceId, exerciseId, rule: ruleOf(o), ...(side ? { side: true } : {}), ...(sg ? { sg } : {}) }
}

// `routines` are the ones the session was built from, when they still exist.
export function routineFromSession(session, name = session?.name, routines = [], unit = 'kg') {
  const byId = new Map((Array.isArray(routines) ? routines : []).filter(r => r?.id != null).map(r => [r.id, r]))
  const ex = groupIds((session?.exposures || []).filter(exposure => workRows(exposure).length)
    .map(exposure => copiedOccurrence(exposure, byId.get(exposure.routineId), unit)))
  if (!ex.length) throw new Error('no exercises')
  const id = uid()
  for (const occurrence of ex) occurrence.rule.routineId = id
  return { id, name: String(name || 'Workout').trim() || 'Workout', ex }
}

export function saveSessionAsRoutine(state, session, name) {
  const routine = routineFromSession(session, name, state.routines, state.unit === 'lb' ? 'lb' : 'kg')
  state.routines.push(routine)
  return routine.id
}
