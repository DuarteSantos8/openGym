import { DEFAULT_TARGETS, personalTargetOf, roundSets, statusOf } from './muscle-targets.js'
import { loadOfWeeklyPlan, MUSCLES } from './muscles.js'

export function plannedSetTarget(S, slug) {
  const personal = personalTargetOf(S, slug)
  if (personal) return { range: personal, source: 'personal' }
  const range = DEFAULT_TARGETS[slug]
  return S?.quiz?.goal === 'muscle' && range ? { range: [...range], source: 'default' } : null
}

/** Whole recurring plan, using the same effective sets as Plan's muscle map. */
export function plannedWeeklySets(S) {
  const load = loadOfWeeklyPlan(S)
  if (!Object.keys(load).length) return []
  return MUSCLES.flatMap(slug => {
    const sets = roundSets(load[slug] || 0)
    const target = plannedSetTarget(S, slug)
    if (!load[slug] && !target) return []
    return [{ slug, sets, target, status: target ? statusOf(sets, target.range) : null }]
  })
}
