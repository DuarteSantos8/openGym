// A combined session is the concatenation of each routine's canonical exposures.
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'

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

/**
 * What starting `routineIds` would open with, without writing anything: the entries built on a
 * copy of the prescriptions (a preview, a check-in's choices). `{ entries, routineIds, routines }`.
 */
export function buildCombinedEntries(profile, routineIds, now = Date.now()) {
  const draft = { ...profile, prescriptions: { ...(profile?.prescriptions || {}) } }
  const out = buildCombinedExposures(draft, routineIds, { now, newId: x => 'preview:' + x, unit: profile?.unit })
  return { entries: entriesForExposures(out.exposures, draft.prescriptions, draft), routineIds: out.routineIds, routines: out.routines }
}
