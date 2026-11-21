// "Today's workout": which muscles to train when no plan says so. Pure. It reads what is still
// recovering (lib/recovery.js, through session-builder's fatigueNow) and hands back muscle-group
// terms for buildSession, so the session itself still comes from the active gym's equipment.
//
//   suggestTerms(S, { now }) -> { terms: ['group:legs', ...], fullBody: boolean }
//
// With nothing logged yet it is a full-body session (chest, back, legs). Otherwise the groups
// are ranked by how rested they are (the least fatigued first); ties go in PRIORITY order. Legs
// are a big session on their own, so a session led by legs is legs alone; any other lead gets
// the next rested group beside it.
import { MUSCLE_GROUPS, groupTerm } from './muscle-filter.js'
import { fatigueNow } from './session-builder.js'
import { FATIGUE_RECOVERING_BELOW } from './recovery-view.js'

// Ties (a long break, or everything equally rested) are broken in this order.
const PRIORITY = ['legs', 'back', 'chest', 'shoulders', 'arms', 'core']
// Muscles that do not decide whether a group is rested: small helpers the builder skips too.
const MINOR = new Set(['hip-flexors', 'tibialis', 'adductors', 'serratus', 'forearm'])

const hasLogged = S => (Array.isArray(S?.workouts) ? S.workouts : []).some(w => (w?.entries || []).some(e => (e?.sets || []).some(s => s?.done)))

/** How tired a group is: the mean fatigue (0 to 1) of its main muscles. */
export function groupFatigue (group, fatigue = {}) {
  const ms = group.muscles.filter(m => !MINOR.has(m))
  return ms.length ? ms.reduce((a, m) => a + (fatigue[m] || 0), 0) / ms.length : 0
}

export function suggestTerms (S, { now = Date.now() } = {}) {
  if (!hasLogged(S)) return { terms: ['chest', 'back', 'legs'].map(groupTerm), fullBody: true }
  const fatigue = fatigueNow(S, now)
  const ranked = MUSCLE_GROUPS
    .map(g => ({ id: g.id, f: groupFatigue(g, fatigue) }))
    .sort((a, b) => (a.f - b.f) || (PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id)))
  const lead = ranked[0]
  const ids = [lead.id]
  if (lead.id !== 'legs') {
    // A second group only when it is rested too, and never legs on top of another lead.
    const second = ranked.slice(1).find(g => g.id !== 'legs' && g.f < FATIGUE_RECOVERING_BELOW)
    if (second) ids.push(second.id)
  }
  return { terms: ids.map(groupTerm), fullBody: false }
}
