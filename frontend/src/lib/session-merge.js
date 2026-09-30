// A combined session is the concatenation of each routine's canonical exposures.
import { buildSessionExposures } from './session-start.js'

export function buildCombinedExposures(profile, routineIds, ctx) {
  const seen = new Set()
  const routines = [].concat(routineIds ?? [])
    .filter(id => id && !seen.has(id) && seen.add(id))
    .map(id => (profile.routines || []).find(r => r.id === id)).filter(Boolean)
  return { exposures: routines.flatMap(r => buildSessionExposures(profile, r, ctx)), routineIds: routines.map(r => r.id), routines }
}

export function deriveSessionName(names) {
  if (!names.length) return null
  if (names.length <= 3) return names.join(' + ')
  return `${names[0]} + ${names[1]} + ${names.length - 2} more`
}
