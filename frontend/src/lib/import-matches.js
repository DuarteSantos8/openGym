// Checking an import's exercise matches before anything is written: each name in the file, what
// it became, and the user's own pick for it. A pick is remembered as one of the exercise's other
// names (#624), so the next import of the same name lands on it too, and Edit → Other names shows
// it and can take it back. Every importer reads the same `matches` (import-csv.js
// parseWorkoutRows, import-apps.js routineResolver, import-hevy.js makeResolver).
import { EXIDX, canonicalExId } from './exercises.js'
import { exerciseAliases, normalizeAliases } from './exercise-aliases.js'

/** A pick that keeps the name as the user's own exercise, even where the library has a match. */
export const OWN = 'custom'

/** How a name is looked up among the picks: case and spacing do not count. */
export const matchKey = name => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * What the user's other names already say: a Map of matchKey → exercise id, from the library
 * exercises' (S.exAliases) and the custom ones' (customEx[].aliases). A name two exercises both
 * carry says nothing, and the import matches it as before.
 */
export function aliasMatches(S) {
  const out = new Map(), twice = new Set()
  const add = (id, list) => {
    for (const a of normalizeAliases(list)) {
      const k = matchKey(a)
      if (out.has(k) && out.get(k) !== id) twice.add(k)
      else out.set(k, id)
    }
  }
  for (const [id, list] of Object.entries(isMap(S?.exAliases) ? S.exAliases : {})) if (EXIDX[id]) add(id, list)
  for (const c of Array.isArray(S?.customEx) ? S.customEx : []) if (c?.id) add(c.id, c.aliases)
  for (const k of twice) out.delete(k)
  return out
}

/** The matches an import reads: the remembered ones, then this import's picks (`null` undoes one). */
export function importMatches(S, picks = {}) {
  const out = aliasMatches(S)
  for (const [k, v] of Object.entries(picks)) {
    if (v == null) out.delete(k)
    else out.set(k, v)
  }
  return out
}

/**
 * The id a pick stands for, for a resolver: a library id, one of `customEx`, or OWN. Anything
 * else (an exercise since deleted) is no pick at all, and the name is matched as before.
 */
export function pickFor(matches, name, customEx = []) {
  const v = matches?.get?.(matchKey(name))
  if (!v) return null
  if (v === OWN) return OWN
  const id = canonicalExId(v)
  if (EXIDX[id] && !EXIDX[id].custom) return id
  return (Array.isArray(customEx) ? customEx : []).some(c => c?.id === v) ? v : null
}

/**
 * The names a parse resolved, once each, for the review: [{ key, name, id, own }], `own` true
 * where it is added as the user's own exercise. `names` is the parse's Map of matchKey →
 * { name, id }; `created` holds the ids the parse made up.
 */
export function namesOf(names, created) {
  return [...names.entries()].map(([key, { name, id }]) => ({ key, name, id, own: created.has(id) }))
}

/** The names of every part of an import, once each: a workout file's and its plans'. */
export function reviewList(...parts) {
  const out = new Map()
  for (const p of parts) for (const n of p?.names || []) if (!out.has(n.key)) out.set(n.key, n)
  // What would be added as the user's own first: those are the ones worth a look.
  return [...out.values()].sort((a, b) => (a.own !== b.own ? (a.own ? -1 : 1) : a.name.localeCompare(b.name)))
}

/**
 * Keeps this import's picks (matchKey → id, OWN or null) for the next one. Mutates the store
 * draft `S`. A name picked for an exercise becomes one of its other names and leaves any other
 * exercise's list; OWN or null takes it off every list. `names` maps each key to the name as the
 * file wrote it.
 */
export function rememberPicks(S, picks, names) {
  const keys = Object.keys(picks || {})
  if (!keys.length) return
  const drop = new Set(keys)
  const al = isMap(S.exAliases) ? { ...S.exAliases } : {}
  for (const [id, list] of Object.entries(al)) {
    const kept = normalizeAliases(list).filter(a => !drop.has(matchKey(a)))
    if (kept.length !== normalizeAliases(list).length) al[id] = kept
  }
  for (const c of Array.isArray(S.customEx) ? S.customEx : []) {
    if (!Array.isArray(c?.aliases)) continue
    const kept = c.aliases.filter(a => !drop.has(matchKey(a)))
    if (kept.length !== c.aliases.length) c.aliases = kept
  }
  for (const k of keys) {
    const id = picks[k], name = names.get(k) || k
    if (!id || id === OWN) continue
    const own = (S.customEx || []).find(c => c?.id === id)
    if (own) own.aliases = normalizeAliases([...(own.aliases || []), name])
    else if (EXIDX[id]) al[id] = normalizeAliases([...exerciseAliases(EXIDX[id], al), name])
  }
  S.exAliases = al
}
