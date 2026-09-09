// Per-exercise bar weight (issue: plate math for barbell work). Logged weights stay the
// TOTAL on the bar — history, progression and 1RM keep meaning exactly what they always
// did. The bar weight is display metadata: it feeds the "X per side" plate math and
// nothing else.
//
// Unit: stored in the profile unit (S.unit), like every other weight in state — set
// weights, exWeights, bodyweight are all written in whatever unit the profile logs and a
// unit switch re-labels them without converting. A canonical-kg bar would be the one
// number that shifts under the user on a unit switch while the totals around it stay
// put, so the override follows the same rule. The equipment *defaults* therefore exist
// per unit too: a kg profile gets the 20 kg olympic bar, a lb profile the 45 lb bar its
// gym actually racks — not a 44.1 lb conversion no bar is stamped with.

import { EXIDX } from './exercises.js'

/** Equipment values (e.eq) that put a bar in your hands. */
export const BAR_EQ = new Set(['barbell', 'olympic barbell', 'ez barbell', 'smith machine', 'trap bar'])

/** Typical bar weights per equipment type, for a kg profile. */
export const DEFAULT_BAR_KG = { barbell: 20, 'olympic barbell': 20, 'ez barbell': 10, 'smith machine': 9, 'trap bar': 25 }
/** The same bars as a lb profile knows them — real markings, not converted kg. */
export const DEFAULT_BAR_LB = { barbell: 45, 'olympic barbell': 45, 'ez barbell': 25, 'smith machine': 20, 'trap bar': 55 }

const exOf = exOrId => (typeof exOrId === 'string' ? EXIDX[exOrId] : exOrId)

/** Whether this exercise (object or id) is done with a bar. */
export const usesBar = exOrId => BAR_EQ.has(exOf(exOrId)?.eq)

/** The default bar weight for an equipment type, in the given unit. null off the list. */
export const defaultBarWeight = (eq, unit) =>
  (unit === 'lb' ? DEFAULT_BAR_LB : DEFAULT_BAR_KG)[eq] ?? null

/** True when the user has set their own bar weight for this exercise. */
export const hasBarOverride = (S, exId) => ((S?.barWeights || {})[exId] || 0) > 0

/**
 * Effective bar weight for one exercise, in the profile unit: the explicit
 * S.barWeights[exId] if set, else the default for the bar type. null for anything
 * that is not a bar exercise.
 */
export function barWeightFor(S, exOrId) {
  const ex = exOf(exOrId)
  if (!BAR_EQ.has(ex?.eq)) return null
  const own = (S?.barWeights || {})[ex.id]
  if (own > 0) return own
  return defaultBarWeight(ex.eq, S?.unit)
}

/**
 * Plates per side: (total − bar) / 2, rounded to 2 decimals. null when there is nothing
 * sensible to show — a missing number, or a total at or below the bar itself.
 */
export function plateSplit(total, bar) {
  if (!(total > 0) || !(bar > 0) || total <= bar) return null
  return Math.round(((total - bar) / 2) * 100) / 100
}
