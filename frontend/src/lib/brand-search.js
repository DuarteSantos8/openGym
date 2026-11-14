// Find an exercise by its machine brand (#1082). "Life Fitness", "lifefitness" and "life fit" all
// reach a split exercise labelled Life Fitness at any gym (lib/gym-split.js); the words that are
// not part of a brand then narrow by name with searchExercises, so "life fitness press" keeps the
// presses. Brands compare with spaces, punctuation and case left out, and a brand word needs two
// letters, so a stray "a" does not match every brand. Nothing is stored.
import { cleanBrand } from './gym-split.js'
import { searchExercises } from './exercises.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')

// One index per (workouts list, exGym map): the search asks on every keystroke.
const cache = new WeakMap()
const NO_WORKOUTS = []

/**
 * `Map(exId -> [brand, …])`: the brands of each split exercise, those set per gym in S.exGym and
 * those its logged entries kept. An exercise that is not split has none.
 */
export function brandIndex(S) {
  const exGym = isMap(S?.exGym) ? S.exGym : null
  if (!exGym) return new Map()
  const workouts = Array.isArray(S?.workouts) ? S.workouts : NO_WORKOUTS
  const got = cache.get(workouts)
  if (got && got.exGym === exGym) return got.index
  const index = new Map()
  const add = (id, raw) => {
    const b = cleanBrand(raw)
    if (!b || !norm(b)) return
    const list = index.get(id) || []
    if (!list.some(x => norm(x) === norm(b))) list.push(b)
    index.set(id, list)
  }
  const split = id => isMap(exGym[id]) && exGym[id].split === true
  for (const id of Object.keys(exGym)) {
    if (split(id) && isMap(exGym[id].brands)) for (const b of Object.values(exGym[id].brands)) add(id, b)
  }
  // Only split exercises carry a brand, so the history is read only when one exists.
  if (Object.keys(exGym).some(split)) {
    for (const w of workouts) for (const en of w?.entries || []) if (en && split(en.id)) add(en.id, en.brand)
  }
  cache.set(workouts, { exGym, index })
  return index
}

/**
 * The exercises of `list` query `q` reaches through a brand, in `list`'s order:
 * `Map(exId -> the brand that matched)`. Empty when no brand is stored or `q` names none.
 */
export function brandMatches(list, S, q) {
  const out = new Map()
  const whole = norm(q)
  if (whole.length < 2) return out
  const index = brandIndex(S)
  if (!index.size) return out
  const words = String(q || '').trim().split(/\s+/).map(norm).filter(Boolean)
  for (const ex of list || []) {
    for (const brand of index.get(ex?.id) || []) {
      const b = norm(brand)
      if (b.includes(whole)) { out.set(ex.id, brand); break }
      const rest = words.filter(w => w.length < 2 || !b.includes(w))
      if (rest.length === words.length) continue
      if (!rest.length || searchExercises([ex], rest.join(' ')).length) { out.set(ex.id, brand); break }
    }
  }
  return out
}

/** `found` with the brand hits of `list` (brandMatches) in front, each once; `found` itself when none. */
export function withBrandHits(list, found, byBrand) {
  if (!byBrand.size) return found
  return [...(list || []).filter(e => byBrand.has(e.id)), ...found.filter(e => !byBrand.has(e.id))]
}

/** `list` with the brand hits first, both parts in their own order; `list` itself when none. */
export function brandFirst(list, byBrand) {
  if (!byBrand.size) return list
  return [...list.filter(e => byBrand.has(e.id)), ...list.filter(e => !byBrand.has(e.id))]
}
