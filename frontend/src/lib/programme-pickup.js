import { programmeTargetHistory, programmeAdaptiveEstimate } from './programme-strength.js'
import { nextPrescription } from './progression.js'
import { modeOf, isBw, bestWeightFor, lastEntryFor } from './history.js'
import { EXIDX } from './exercises.js'
import { createProgrammeDefinition, startProgrammeCycleInState } from './programmes.js'
const keyOf = (routineId, cfg, index) => routineId + ':' + cfg.id + ':' + index
export function pickupRows(state, definition, options = {}) {
  const rows = new Map()
  for (const week of definition.weeks || []) for (const day of week.days || []) for (const session of day.sessions || []) {
    const routine = session.routineSnapshot || session.routine || state.routines.find(r => r.id === session.routineId)
    for (const [index, cfg] of (routine?.ex || []).entries()) {
      const routineId = session.routineId || routine.id, key = keyOf(routineId, cfg, index), mode = modeOf(cfg)
      const bodyweight = mode === 'reps' && isBw(cfg) && !(Number(cfg.weight) > 0)
      const field = mode === 'time' ? 'sec' : mode === 'cardio' ? 'min' : bodyweight ? 'reps' : 'weight'
      const workouts = programmeTargetHistory(state,cfg), source = {...state,workouts,exWeights:{}}
      const estimate = field === 'weight' ? programmeAdaptiveEstimate(workouts,options.now ?? Date.now()) : null
      const baseline = estimate > 0 ? Math.round(estimate/(1+Math.min(20,Math.max(1,Number(cfg.reps)||10))/30)/2.5)*2.5
        : field === 'weight' ? Math.max(Number(cfg.weight)||0,bestWeightFor(source,cfg.id))
        : Number(lastEntryFor(source,cfg.id,mode)?.target?.[field]) || Number(cfg[field]) || 0
      const plan = nextPrescription(source,{...cfg,prog:options.progression || definition.progression},routine)
      const suggestion = Number(plan[field]) > 0 ? Number(plan[field]) : baseline
      if (!rows.has(key)) rows.set(key, { key, routineId, routineName:routine.name || routineId, field, name:cfg.name || cfg.n || EXIDX[cfg.id]?.n || cfg.id, mode,
        value:Number(cfg[field]) || 0, baseline, suggestion, estimate, best:bestWeightFor(source,cfg.id), targetReps:Number(cfg.reps)||10, unit:field === 'weight' ? state.unit || 'kg' : field === 'sec' ? 's' : field,
        step:field === 'weight' ? Number(cfg.inc) || 2.5 : field === 'sec' ? 5 : 1 })
    }
  }
  return [...rows.values()]
}
export function pickupTarget(row, {loadMode = 'configured', deloadPercent = 10, values = {}} = {}) {
  if (Object.hasOwn(values,row.key)) return values[row.key]
  if (loadMode === 'configured') return row.value
  const baseline = row.baseline ?? row.value
  if (loadMode !== 'deload' || row.mode === 'cardio') return baseline
  const adjusted = Math.max(0,baseline * (1-deloadPercent/100))
  if (row.field === 'reps') return Math.max(1,Math.floor(adjusted))
  const value = row.field === 'weight' ? Math.round(adjusted/row.step)*row.step : adjusted
  return Math.round(value*10)/10
}
export function startProgrammePickupInState(state, definition, options = {}) {
  const length = options.length ?? definition.weeks.length
  if (!Number.isInteger(length) || length < 1 || length > 52) throw new Error('Programme length must be between 1 and 52 weeks')
  const rows = new Map(pickupRows(state, definition,options).map(row => [row.key,row]))
  if (options.loadMode === 'deload' && (!Number.isFinite(options.deloadPercent ?? 10) || (options.deloadPercent ?? 10) < 1 || (options.deloadPercent ?? 10) > 50)) throw new Error('Reduction must be between 1 and 50 percent')
  const values = options.values || {}
  for (const [key,value] of Object.entries(values)) if (!rows.has(key) || !Number.isFinite(value) || value < 0 || (value === 0 && rows.get(key)?.field !== 'weight')) throw new Error('Invalid starting target')
  const weeks = Array.from({length}, (_,index) => {
    const week = structuredClone(definition.weeks[index] || definition.weeks.at(-1))
    week.mode = options.weekModes?.[index] || week.mode || 'normal'
    for (const day of week.days || []) for (const session of day.sessions || []) {
      // Copies receive fresh identities when normalized, including an extended last week.
      delete session.id; delete session.sessionTemplateId; delete session.instanceId; delete session.templateId
      const routine = session.routineSnapshot || session.routine || state.routines.find(r => r.id === session.routineId)
      session.routineSnapshot = structuredClone(routine)
      session.routineSnapshot.ex.forEach((cfg,index) => {
        const key = keyOf(session.routineId || routine.id,cfg,index), row = rows.get(key)
        if (Object.hasOwn(values,key) || ['deload','highest'].includes(options.loadMode)) cfg[row.field] = pickupTarget(row,options)
      })
    }
    return week
  })
  const prepared = createProgrammeDefinition({...definition,weeks,progression:options.progression || definition.progression},state,{id:definition.id,now:options.now})
  return startProgrammeCycleInState(state,prepared,options)
}

export function completedProgrammeDefinition(state, cycleId) {
  const cycle = state.programmes.cycles.find(cycle => cycle.id === cycleId && cycle.status === 'completed')
  if (!cycle) return null
  return {...structuredClone(cycle.programmeSnapshot || {}), id:cycle.programmeId, name:cycle.name,
    progression:cycle.progression, colour:cycle.colour, weeks:structuredClone(cycle.snapshot?.weeks || cycle.programmeSnapshot?.weeks || [])}
}
export function repeatProgrammePickupInState(state, cycleId, options = {}) {
  const definition = completedProgrammeDefinition(state,cycleId)
  if (!definition) throw new Error('Completed Programme cycle not found')
  const cycle = startProgrammePickupInState(state,definition,options)
  cycle.repeatedFromCycleId = cycleId
  return cycle
}
