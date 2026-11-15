// The muscle filter of the explorer (#885, #900): groups people think in, opened into the
// muscles the body map draws, and several at once.
//
// A filter is a list of terms, each a muscle ('biceps') or a group ('group:legs'). A group term is
// any of its muscles, so "Legs" is every exercise that works a leg muscle. Terms are combined
// with AND by default ("works the quads and the hamstrings", #885) or OR.
import { MUSCLES } from './muscles.js'

/** The groups, head to toe, with the muscles each opens into. `name` is the i18n key: 'Back muscles',
 *  never plain 'Back', which every pack translates as the way back ("Zurück", "Назад"). */
export const MUSCLE_GROUPS = [
  { id: 'chest', name: 'Chest', muscles: ['chest', 'serratus'] },
  { id: 'back', name: 'Back muscles', muscles: ['lats', 'upper-back', 'lower-back', 'trapezius'] },
  { id: 'shoulders', name: 'Shoulders', muscles: ['front-delts', 'side-delts', 'rear-delts'] },
  { id: 'arms', name: 'Arms', muscles: ['biceps', 'triceps', 'forearm'] },
  { id: 'core', name: 'Core', muscles: ['abs', 'obliques'] },
  { id: 'legs', name: 'Legs', muscles: ['gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors', 'calves', 'tibialis'] },
]
const BY_ID = Object.fromEntries(MUSCLE_GROUPS.map(g => [g.id, g]))

export const groupTerm = id => 'group:' + id
export const groupOfTerm = term => (typeof term === 'string' && term.startsWith('group:') ? BY_ID[term.slice(6)] || null : null)

/** The group a muscle belongs to. */
export const groupOfMuscle = m => MUSCLE_GROUPS.find(g => g.muscles.includes(m)) || null

/** The muscles a term stands for: a group's, or the one muscle. Unknown terms stand for none. */
export function termMuscles(term) {
  const g = groupOfTerm(term)
  if (g) return g.muscles
  return MUSCLES.includes(term) ? [term] : []
}

/** Every muscle the filter shows on the body map, in head-to-toe order. */
export const shownMuscles = terms => MUSCLES.filter(m => (terms || []).some(t => termMuscles(t).includes(m)))

/**
 * Whether an exercise working `weights` ({ muscle: share }, lib/muscles.js musclesOf) passes the
 * filter. `mode` 'all' needs every term, 'any' one of them. No terms: nothing passes.
 */
export function matchesTerms(weights, terms, mode = 'all') {
  const list = (terms || []).filter(t => termMuscles(t).length)
  if (!list.length || !weights) return false
  const hit = t => termMuscles(t).some(m => weights[m] > 0)
  return mode === 'any' ? list.some(hit) : list.every(hit)
}

/** How hard an exercise works the filter's muscles: its most-worked one of them, for the order. */
export const termsWeight = (weights, terms) =>
  Math.max(0, ...shownMuscles(terms).map(m => Number(weights?.[m]) || 0))

/**
 * The filter with `term` tapped: added, or taken off when it is there. A group tapped takes its
 * own muscles off the list (the group covers them), and a muscle tapped inside a chosen group
 * stands for itself from then on, so the group gives way to it.
 */
export function toggleTerm(terms, term) {
  const cur = [...(terms || [])]
  if (cur.includes(term)) return cur.filter(t => t !== term)
  const g = groupOfTerm(term)
  if (g) return [...cur.filter(t => !g.muscles.includes(t)), term]
  const own = groupOfMuscle(term)
  return [...cur.filter(t => !(own && t === groupTerm(own.id))), term]
}
