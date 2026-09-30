// Session finalization: each exposure becomes its ExecutionLog (exact rows, the actual summary,
// the audit saved beside them), and each non-excluded track advances once.
import { advanceProgression, auditExecution, currentOneRm, summarizeActual } from './prescription/index.js'
import { actualOfRow, exposuresWithPerformance } from './session-ui-adapter.js'
import { isWarmupRow } from './workout-model.js'
import { isAssisted, betterWeight, beatsWeight } from './exercises.js'
import { estimate1RM, is1RMRecord } from './onerm.js'
import { workoutVolume, bestWeightFor } from './history.js'

export function buildCompletedSession(active, profile, { end, newId, unit }) {
  const completedAt = new Date(end).toISOString()
  const entries = new Map((active.entries || []).map(entry => [entry.exposureId, entry]))
  const oneRepMaxes = []
  const progression = {}
  const exposures = exposuresWithPerformance(active.exposures || [], active.entries || [], unit).map(exposure => {
    const p = profile.prescriptions?.[exposure.prescriptionId]
    if (!p) return exposure
    const state = profile.progression?.[exposure.trackId] || null
    const performed = (entries.get(exposure.exposureId)?.sets || []).filter(row => row.done && !isWarmupRow(row)).map(row => actualOfRow(row, unit))
    const actual = summarizeActual(p, performed)
    const audit = [...performed.flatMap(set => auditExecution(p, set, state)), ...auditExecution(p, { sets: actual.sets }, state)]
    if (!exposure.excludedFromProgression) {
      progression[exposure.trackId] = advanceProgression({ state, prescription: p, log: { id: exposure.exposureId, actual }, now: completedAt })
    }
    // An assistance machine has no 1RM: the load is the help you were given (issue #232).
    const best = isAssisted(exposure.exerciseId) ? 0 : Math.max(0, ...performed.map(s => estimate1RM(s.load?.value, s.reps) ?? 0))
    if (best > (currentOneRm(profile.oneRepMaxes, exposure.exerciseId)?.value || 0)) {
      oneRepMaxes.push({ id: newId(`one-rep-max:${exposure.exposureId}`), exerciseId: exposure.exerciseId, value: best, unit, source: 'estimated', capturedAt: completedAt, sourceRecordId: exposure.exposureId })
    }
    return { ...exposure, completedAt, actual, audit, sourceAudit: { ...p.provenance } }
  })
  const routineIds = [].concat(active.routineIds ?? (active.routineId ? [active.routineId] : []))
  return {
    session: {
      id: active.id, d: active.d, start: active.start, end, status: 'completed', routineIds,
      name: active.name, ...(active.bw != null ? { bw: active.bw } : {}), exposures,
      vol: workoutVolume(profile, { exposures }),
      ...(active.note?.trim() ? { note: active.note.trim() } : {})
    },
    oneRepMaxes,
    progression
  }
}

/** The best completed work load of an exposure — heaviest, or lightest on an assistance machine. */
export function workLoadOf(exposure) {
  const loads = (exposure.performance?.sets || [])
    .filter(row => row.status === 'completed' && row.role !== 'warmup' && row.resistance?.kind === 'external-load' && row.resistance.value > 0)
    .map(row => row.resistance.value)
  return loads.length ? loads.reduce((a, b) => betterWeight(exposure.exerciseId, a, b)) : 0
}

/**
 * Records a finished session sets against the history before it (`S` must not contain it yet).
 * A heavier estimate without a heavier top set is its own kind of progress — reported
 * separately so it can't be read as a load PR. A workout logged into the past cannot claim
 * records against the history that came after it.
 */
export function recordsOf(S, session, { backfill = false } = {}) {
  const prs = [], e1prs = []
  if (backfill) return { prs, e1prs }
  for (const x of session.exposures || []) {
    if (beatsWeight(x.exerciseId, workLoadOf(x), bestWeightFor(S, x.exerciseId))) { prs.push(x.exerciseId); continue }
    const rec = is1RMRecord(S, x.exerciseId, x)
    if (rec) e1prs.push({ id: x.exerciseId, ...rec })
  }
  return { prs, e1prs }
}
