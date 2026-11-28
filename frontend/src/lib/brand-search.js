// Search finds an exercise by the machine brand you gave it at a gym (#1082, thanks @lodepav,
// whose #1211 had the idea). Brands live on exercises kept per gym (lib/gym-split.js, S.exGym) and
// on the entries logged on them. "Life Fitness", "lifefitness" and "life fit" all reach it; words
// of the search that are not part of the brand narrow by name, so "life fitness press" keeps the
// presses. A brand word needs two letters, so "a" does not reach every brand. Nothing is stored.
import { cleanBrand } from './gym-split.js'
import { searchExercises } from './exercises.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
/** A brand or a search word as compared: lower case, no accents, no spaces or punctuation. */
export const brandKey = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')

// Built once per S.exGym and workouts list: the search asks on every keystroke.
let memo = null

/** Map(exId -> [brand, ...]) for the exercises kept per gym: the brands set now and the ones logged. */
export function brandIndex(S) {
  const exGym = isMap(S?.exGym) ? S.exGym : null
  const workouts = Array.isArray(S?.workouts) ? S.workouts : null
  if (memo && memo.exGym === exGym && memo.workouts === workouts) return memo.index
  const index = new Map()
  const split = id => isMap(exGym?.[id]) && exGym[id].split === true
  const add = (id, raw) => {
    const b = cleanBrand(raw)
    if (!brandKey(b)) return
    const list = index.get(id) || []
    if (!list.some(x => brandKey(x) === brandKey(b))) list.push(b)
    index.set(id, list)
  }
  for (const id of Object.keys(exGym || {})) if (split(id) && isMap(exGym[id].brands)) for (const b of Object.values(exGym[id].brands)) add(id, b)
  if (index.size || Object.keys(exGym || {}).some(split)) {
    for (const w of workouts || []) for (const en of w?.entries || []) if (en && split(en.id)) add(en.id, en.brand)
  }
  memo = { exGym, workouts, index }
  return index
}

/** The exercises of `list` that `q` reaches through a brand: Set of ids. */
export function brandHits(list, S, q) {
  const out = new Set()
  const whole = brandKey(q)
  if (whole.length < 2) return out
  const index = brandIndex(S)
  if (!index.size) return out
  const words = String(q).trim().split(/\s+/).filter(Boolean)
  for (const ex of list || []) {
    const brands = index.get(ex?.id)
    if (!brands) continue
    for (const brand of brands) {
      const b = brandKey(brand)
      if (b.includes(whole)) { out.add(ex.id); break }
      // Some words name the brand, the others the exercise.
      const rest = words.filter(w => brandKey(w).length < 2 || !b.includes(brandKey(w)))
      if (rest.length === words.length) continue
      if (!rest.length || searchExercises([ex], rest.join(' ')).length) { out.add(ex.id); break }
    }
  }
  return out
}

/** What the search found, with the brand hits of `list` first and each exercise once. */
export function searchWithBrands(list, S, q) {
  const found = searchExercises(list, q)
  const hits = brandHits(list, S, q)
  if (!hits.size) return found
  return [...(list || []).filter(e => hits.has(e.id)), ...found.filter(e => !hits.has(e.id))]
}
