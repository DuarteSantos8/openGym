// Choosing what to import (the import sheet's exercise list). A history export carries every
// exercise someone ever logged, and not all of it is wanted here: the walks a watch recorded, a
// lift from another gym's machine. The sheet lists the file's exercises with a tick each and
// imports only the ticked ones, so these two helpers work on parseWorkoutCSV's result: one lists
// what the file holds per exercise, the other narrows the result to a selection without parsing
// the file again.

import { importId } from './import-csv.js'
import { isWarmupRow, completedVolumeOf } from './workout-model.js'

/**
 * Every exercise the parsed file brings, once by id: how many sets and workouts it has and
 * whether it would be added as the user's own. Most sets first, the order the sheet lists them in.
 */
export function importExercises(parsed) {
  const custom = new Set((parsed?.customEx || []).map(c => c.id))
  const by = new Map()
  for (const w of parsed?.workouts || []) {
    for (const e of w.entries) {
      const x = by.get(e.id) || { id: e.id, sets: 0, workouts: 0, custom: custom.has(e.id), last: null }
      // An exercise twice in one workout (Strong writes a superset that way) is one workout.
      if (x.last !== w) { x.workouts++; x.last = w }
      x.sets += e.sets.length
      by.set(e.id, x)
    }
  }
  return [...by.values()]
    .map(({ last, ...x }) => x)
    .sort((a, b) => b.sets - a.sets || b.workouts - a.workouts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// What a stored set counts for in the parser's row counters: a set logged per side was a row per
// side, and each drop of a drop set a row of its own (lib/import-csv.js, our own CSV).
const rowsOf = s => s.sides
  ? ['L', 'R'].reduce((n, k) => n + (s.sides[k]?.done ? 1 : 0) + (s.sides[k]?.drops?.length || 0), 0) || 1
  : 1 + (s.drops?.length || 0)
const effortOf = s => s.sides ? [s.sides.L, s.sides.R] : [s]

/**
 * parseWorkoutCSV's result with only the exercises in `keepIds`: their entries leave the
 * workouts, a workout left empty is dropped, and an exercise the file would have created is only
 * created while something still uses it. Every count the sheet shows is worked out again, so the
 * tiles and the "added as your own" list follow the ticks. The same shape comes back, ready for
 * mergeImport; with everything kept it is the result that went in.
 */
export function filterImport(parsed, keepIds) {
  const keep = keepIds instanceof Set ? keepIds : new Set(keepIds)
  const removed = []
  const workouts = []
  for (const w of parsed.workouts) {
    const entries = w.entries.filter(e => keep.has(e.id))
    removed.push(...w.entries.filter(e => !keep.has(e.id)))
    if (!entries.length) continue
    if (entries.length === w.entries.length) { workouts.push(w); continue }
    // A superset is neighbours sharing a tag; one whose partner was left out is not one any more
    // (the parser's own rule, and history.js's cleanupSg).
    const kept = entries.map(e => ({ ...e }))
    kept.forEach((e, i) => { if (e.sg && kept[i - 1]?.sg !== e.sg && kept[i + 1]?.sg !== e.sg) delete e.sg })
    workouts.push({
      ...w,
      // Ids come from what is imported (import-csv.twice.test.js), so a narrower import is
      // another workout to the sync merge, not the same one with entries missing.
      id: importId('iw', JSON.stringify([parsed.source, w.d, w.start, w.name || '', kept.map(e => [e.id, e.sets])])),
      entries: kept,
      vol: kept.reduce((a, e) => a + e.sets.reduce((b, s) => b + (isWarmupRow(s) ? 0 : completedVolumeOf(s)), 0), 0),
    })
  }
  if (!removed.length) return parsed

  const used = new Set(workouts.flatMap(w => w.entries.map(e => e.id)))
  const customIds = new Set(parsed.customEx.map(c => c.id))
  const customEx = parsed.customEx.filter(c => used.has(c.id))
  const keptNames = new Set(customEx.map(c => String(c.n).toLowerCase()))
  const dates = workouts.map(w => w.d)
  const lessBy = (n, f) => Math.max(0, n - f)
  const removedSets = removed.flatMap(e => e.sets)
  const removedMatched = removed.filter(e => !customIds.has(e.id)).flatMap(e => e.sets)
  return {
    ...parsed,
    workouts, customEx,
    matched: [...used].filter(id => !customIds.has(id)).length,
    // The row counters are the parser's, less what the left-out sets counted for in them.
    matchedSets: lessBy(parsed.matchedSets, removedMatched.reduce((n, s) => n + rowsOf(s), 0)),
    created: customEx.length,
    unmatchedNames: parsed.unmatchedNames.filter(n => keptNames.has(n.toLowerCase())),
    sets: lessBy(parsed.sets, removedSets.length),
    warmups: lessBy(parsed.warmups, removedSets.filter(s => s.phase === 'warmup').reduce((n, s) => n + rowsOf(s), 0)),
    rpeSets: lessBy(parsed.rpeSets, removedSets.flatMap(effortOf).filter(s => s?.rpe != null).length),
    rirSets: lessBy(parsed.rirSets, removedSets.flatMap(effortOf).filter(s => s?.rir != null).length),
    from: dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null,
    to: dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null,
  }
}
