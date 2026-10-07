// Building one session's entries from more than one routine (the "combine routines" feature).
//
// A combined session is just the concatenation of the entries each routine would have built on
// its own, with `entry.rid` stamped so a saved workout can be read back per routine. There is
// no composite-routine object: nothing is stored that a single-routine session did not already
// store, only widened. Every start path routes through here, including a single-routine start
// (a one-element list) and freestyle (an empty list → no entries, no rid).
//
// Imported only by sheets.jsx and views/Workout.jsx; imports session-start.js (which pulls in
// history.js + progression.js). Nothing in that chain imports this file, so there is no cycle.
import { buildSessionEntries } from './session-start.js'

/**
 * Build a session's entries from an ordered list of routine ids.
 * - resolves + filters to still-existing routines, de-duplicates by id (first wins)
 * - concatenates each routine's entries in list order
 * - stamps `entry.rid` = that routine's id on every entry
 *
 * Returns `{ entries, routineIds, routines }` — `routineIds` / `routines` are the resolved,
 * de-duplicated list, so a caller stores exactly what was built.
 */
export function buildCombinedEntries(st, routineIds) {
  const seen = new Set()
  const routines = [].concat(routineIds ?? [])
    .filter(id => id && !seen.has(id) && seen.add(id))
    .map(id => (st.routines || []).find(r => r.id === id))
    .filter(Boolean)
  const entries = routines.flatMap(r =>
    buildSessionEntries(st, r).map(e => ({ ...e, rid: r.id }))
  )
  return { entries, routineIds: routines.map(r => r.id), routines }
}

/**
 * A shortened session: one routine's entries for a subset of its exercises, in routine order.
 * Everything a full build stamps is kept — the prescription, the plan, `rid` — because it
 * builds through the same per-exercise path with the routine's own id, so progression, history
 * and the detail sheet read a short session exactly like a full one with fewer entries. Only
 * the live start offers it; logging a past workout keeps whole routines.
 */
export function buildSubsetEntries(st, routineId, exIds) {
  const r = (st.routines || []).find(x => x?.id === routineId)
  const wanted = new Set([].concat(exIds ?? []).filter(Boolean))
  if (!r || !wanted.size) return { entries: [], routineIds: [], routines: [] }
  const sub = { ...r, ex: (r.ex || []).filter(e => wanted.has(e?.id)) }
  if (!sub.ex.length) return { entries: [], routineIds: [], routines: [] }
  const entries = buildSessionEntries(st, sub).map(e => ({ ...e, rid: r.id }))
  return { entries, routineIds: [r.id], routines: [r] }
}

/**
 * The session name for a combined workout, from routine names in merge order (ENG-12 rule):
 *   1–3 routines → join with " + "          → "Rehab + Core"
 *   4+ routines  → first two, then "+ N more" → "Rehab + Core + 2 more"
 * An empty list returns null — not a reachable state for a saved or active session.
 */
export function deriveSessionName(names) {
  if (!names.length) return null
  if (names.length <= 3) return names.join(' + ')
  return `${names[0]} + ${names[1]} + ${names.length - 2} more`
}
