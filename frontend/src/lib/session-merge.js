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
import { buildRoutineSession } from './session-start.js'
import { SECTION_PRESETS, syncSections } from './workout-sections.js'
import { uid } from './format.js'

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
  const result = { entries: [] }
  for (const r of routines) {
    const built = buildRoutineSession(st, r)
    const groupMeta = {}
    built.entries = built.entries.map(e => {
      const sg = e.sg ? JSON.stringify([r.id, e.sg]) : e.sg
      if (e.sg && r.groupMeta?.[e.sg]) groupMeta[sg] = structuredClone(r.groupMeta[e.sg])
      return { ...e, sg, rid: r.id }
    })
    built.groupMeta = groupMeta
    appendSessionEntries(result, built)
  }
  return { ...result, routineIds: routines.map(r => r.id), routines }

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

// Append phase snapshots too: a flat routine in a phased session still needs a visible
// training section. Imported routines may reuse section IDs; isolate only those collisions.
export function appendSessionEntries(active, source) {
  const phaseCount = value => value.sections?.length || (value.entries.length ? 1 : 0)
  if ((active.sections?.length || source.sections?.length) && phaseCount(active) + phaseCount(source) > 50) {
    throw new Error('A combined workout can have at most 50 phases.')
  }
  normalizeSessionRoutineSources(active)
  const incoming = structuredClone(source)
  const phased = active.sections?.length || incoming.sections?.length
  if (phased) {
    const ensurePhase = value => {
      if (!value.sections?.length) {
        value.sections = value.entries.length ? [{ ...SECTION_PRESETS[2], id: uid() }] : []
        if (value.sections.length) value.entries.forEach(e => { e.sectionId = value.sections[0].id })
      }
    }
    ensurePhase(active); ensurePhase(incoming)
    const used = new Set(active.sections.map(s => s.id))
    for (const section of incoming.sections) {
      if (used.has(section.id)) {
        const previous = section.id; section.id = uid()
        incoming.entries.forEach(e => { if (e.sectionId === previous) e.sectionId = section.id })
      }
      used.add(section.id)
    }
    active.sections.push(...incoming.sections)
  }
  active.entries.push(...incoming.entries)
  if (Object.keys(incoming.groupMeta || {}).length) active.groupMeta = { ...active.groupMeta, ...incoming.groupMeta }
  if (phased) syncSections(active)
}

// Upgrade only a legacy active session, before a new entry/routine introduces per-entry
// ownership. Existing modern freestyle entries deliberately remain without a routine.
export function normalizeSessionRoutineSources(active) {
  if (!Array.isArray(active.routineIds) && active.routineId) {
    active.routineIds = [active.routineId]
    active.entries.forEach(entry => { if (!entry.rid) entry.rid = active.routineId })
  }
}
