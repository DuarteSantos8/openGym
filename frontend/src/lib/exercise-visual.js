// A picture for a custom exercise that has none of its own.
//
// An import (Hevy, Strong, a CSV) turns every name the catalogue did not recognise into a custom
// exercise, and a custom exercise only shows what its owner attached to it: nothing, so every
// list and every exercise page wore the grey dumbbell. Often the catalogue does know the lift, by
// the same rules the import uses (an alias, an exact name, or one unambiguous near match: never a
// guess between two). This finds that catalogue exercise so its drawing can stand in. It changes
// nothing that is stored: the exercise keeps its own id and every set logged against it.
//
// A custom exercise with its own photo, video or link keeps it, and one the catalogue does not
// know stays as it is (the dumbbell, which is the fallback for an exercise with no picture at all).
import { EXIDX } from './exercises.js'
import { matchExercise, matchHevyTitle } from './import-csv.js'
import { mediaOf, cleanUrl } from './media-refs.js'

const memo = new Map()   // name -> catalogue exercise | null

/** The catalogue exercise whose drawing a custom exercise borrows, or null. */
export function catalogueTwin(ex) {
  if (!ex || typeof ex.n !== 'string' || !ex.n.trim()) return null
  if (mediaOf(ex) || cleanUrl(ex.url)) return null
  const key = ex.n.trim().toLowerCase()
  if (memo.has(key)) return memo.get(key)
  const id = matchHevyTitle(ex.n) || matchExercise(ex.n)
  const twin = id ? EXIDX[id] : null
  const out = twin && !twin.custom && twin.img ? twin : null
  memo.set(key, out)
  return out
}
