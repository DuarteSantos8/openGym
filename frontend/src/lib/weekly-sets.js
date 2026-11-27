import { DEFAULT_TARGETS, personalTargetOf, roundSets, statusOf } from './muscle-targets.js'
import { circuitOf } from './circuit.js'
import { modeOf, supersetUnits } from './history.js'
import { loadOf, loadOfWeeklyPlan, MUSCLES } from './muscles.js'

export function plannedSetTarget(S, slug) {
  const personal = personalTargetOf(S, slug)
  if (personal) return { range: personal, source: 'personal' }
  const range = DEFAULT_TARGETS[slug]
  const goal = S?.quiz?.goal ?? S?.coach?.profile?.goal
  return goal === 'muscle' && range ? { range: [...range], source: 'default' } : null
}

function strengthLoadOfRoutine(routine, exercises) {
  const slots = routine.ex || []
  return loadOf(supersetUnits(slots).flatMap(unit => {
    const circuit = circuitOf(slots, unit)
    return unit.map((index, station) => {
      const slot = slots[index]
      // The saved EMOM row count is capacity. The player visits each station once per
      // rotation in order, stopping at the minute limit even partway through a rotation.
      const sets = circuit?.mode === 'emom' ? Math.ceil((circuit.count - station) / unit.length) : (slot.sets || 1)
      return { id: slot.id, ex: exercises[slot.id] || slot, sets: modeOf(slot) === 'cardio' ? 0 : sets }
    })
  }))
}

/** Whole recurring plan, sharing the muscle weights and recurrence with the Stats map. */
export function plannedWeeklySets(S) {
  const load = loadOfWeeklyPlan(S, strengthLoadOfRoutine)
  if (!Object.keys(load).length) return []
  return MUSCLES.flatMap(slug => {
    const sets = roundSets(load[slug] || 0)
    const target = plannedSetTarget(S, slug)
    if (!load[slug] && !target) return []
    return [{ slug, sets, target, status: target ? statusOf(sets, target.range) : null }]
  })
}
