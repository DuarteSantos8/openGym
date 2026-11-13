// What the person chose on the import summary before anything is written (#931, #849): which
// exercise a name in the file becomes, which exercises and which dates come along, and whether
// the notes and effort ratings do. Every parser reads the same options, so a file from another
// app and the Hevy API import behave alike:
//
//   matches  Map nameKey → exercise id (a library one, or one of your own) | null (keep it as your
//            own exercise). Checked before the curated aliases and the word match.
//   skip     Set of nameKeys left out of the history (their sets stay in the file, not in the app).
//   from/to  ISO days; sessions outside them are left out.
//   notes    false leaves the notes behind. effort: false leaves RPE and RIR behind.
//
// A pick is remembered as one of the exercise's other names (#624: S.exAliases for a library
// exercise, customEx[].aliases for your own), so the next import of the same name lands on it
// again, and Edit → Other names shows it and can take it back. Nothing new is stored for it.

import { EXIDX, canonicalExId } from './exercises.js'
import { normalizeAliases } from './exercise-aliases.js'

export const nameKey = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim()
export const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to)

const isCatalogue = id => !!EXIDX[id] && !EXIDX[id].custom
const ownList = customEx => (Array.isArray(customEx) ? customEx.filter(c => c && c.id) : [])

/**
 * The pick for a name: undefined (no pick, match as usual), null (keep it as your own exercise),
 * or the id it goes to. An id that names nothing any more (a deleted exercise) is no pick.
 */
export function pickFor(matches, name, customEx) {
  if (!matches || typeof matches.get !== 'function') return undefined
  const k = nameKey(name)
  if (!k || !matches.has(k)) return undefined
  const id = matches.get(k)
  if (id === null) return null
  if (typeof id !== 'string') return undefined
  const canon = canonicalExId(id)
  if (isCatalogue(canon)) return canon
  return ownList(customEx).some(c => c.id === id) ? id : undefined
}

/** The names you gave exercises, as picks: every other name points at its exercise. */
export function aliasMatches(S) {
  const out = new Map()
  const map = S?.exAliases && typeof S.exAliases === 'object' && !Array.isArray(S.exAliases) ? S.exAliases : {}
  for (const id of Object.keys(map)) {
    if (!isCatalogue(canonicalExId(id))) continue
    for (const n of normalizeAliases(map[id])) if (!out.has(nameKey(n))) out.set(nameKey(n), canonicalExId(id))
  }
  for (const c of ownList(S?.customEx)) {
    for (const n of normalizeAliases(c.aliases)) if (!out.has(nameKey(n))) out.set(nameKey(n), c.id)
  }
  return out
}

/**
 * The parse options for what was chosen. `picks`: Map nameKey → { name, id } where id is an
 * exercise id, null (keep as your own) or 'auto' (the automatic match, even over a remembered pick).
 */
export function choiceOpts(S, { picks, skip, from, to, notes = true, effort = true } = {}) {
  const matches = aliasMatches(S)
  for (const [k, p] of picks || []) {
    if (p?.id === 'auto') matches.delete(k)
    else if (p && (p.id === null || typeof p.id === 'string')) matches.set(k, p.id)
  }
  return {
    unit: S?.unit || 'kg', customEx: S?.customEx || [], matches, bands: S?.bands || [],
    ...(skip?.size ? { skip } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}),
    ...(notes === false ? { notes: false } : {}), ...(effort === false ? { effort: false } : {}),
  }
}

/** Take a name out of every list of other names it is on. */
function forget(S, k) {
  if (S.exAliases && typeof S.exAliases === 'object') {
    let next = null
    for (const id of Object.keys(S.exAliases)) {
      const list = normalizeAliases(S.exAliases[id])
      const kept = list.filter(n => nameKey(n) !== k)
      if (kept.length !== list.length) (next ||= { ...S.exAliases })[id] = kept
    }
    if (next) S.exAliases = next
  }
  for (const c of ownList(S.customEx)) {
    const list = normalizeAliases(c.aliases)
    const kept = list.filter(n => nameKey(n) !== k)
    if (kept.length !== list.length) c.aliases = kept
  }
}

/**
 * Remember the picks made on the summary, after the import has merged (so an exercise of your own
 * the import made exists). A pick of an exercise adds the file's name to its other names; keeping
 * a name as your own, or going back to the automatic match, takes it off whatever it was on.
 * Returns how many names it remembered.
 */
export function rememberPicks(S, picks) {
  let n = 0
  for (const [k, p] of picks || []) {
    if (!p || !k) continue
    forget(S, k)
    const name = String(p.name || '').trim()
    if (typeof p.id !== 'string' || p.id === 'auto' || !name) continue
    const id = canonicalExId(p.id)
    if (isCatalogue(id)) {
      S.exAliases = { ...(S.exAliases || {}), [id]: normalizeAliases([...normalizeAliases(S.exAliases?.[id]), name]) }
      n++
    } else {
      const c = ownList(S.customEx).find(x => x.id === p.id)
      if (c) { c.aliases = normalizeAliases([...normalizeAliases(c.aliases), name]); n++ }
    }
  }
  return n
}

/**
 * One list of the exercise names a parse saw, for the summary: the history's and the plans'
 * together, the same name once, most sets first. Each: { key, name, id, auto, sets, workouts }.
 */
export function combineNames(...lists) {
  const by = new Map()
  for (const list of lists) for (const x of list || []) {
    if (!x?.key) continue
    const have = by.get(x.key)
    if (!have) { by.set(x.key, { ...x }); continue }
    have.sets += x.sets || 0
    have.workouts += x.workouts || 0
    if (!have.id && x.id) have.id = x.id
  }
  return [...by.values()].sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name))
}
