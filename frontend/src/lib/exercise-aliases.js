const MAX_ALIASES = 20
const MAX_LENGTH = 80
let overrides = {}

export function normalizeAliases(value) {
  const values = typeof value === 'string' ? value.split(/[,\n]/) : Array.isArray(value) ? value : []
  const seen = new Set()
  return values.filter(v => typeof v === 'string').map(v => v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_LENGTH))
    .filter(v => { const key = v.toLocaleLowerCase(); if (!v || seen.has(key)) return false; seen.add(key); return true })
    .slice(0, MAX_ALIASES)
}

let shown = {}
const asMap = m => (m && typeof m === 'object' && !Array.isArray(m) ? m : {})

// Register every adopted/restored state, including an empty map when switching profiles. The
// second map is S.exShownName (#903): the other name an exercise is shown by.
export const registerExerciseAliases = (map, shownMap) => { overrides = asMap(map); shown = asMap(shownMap) }
export const aliasSnapshot = () => overrides
export const exerciseAliases = (ex, map = overrides) => normalizeAliases(
  map && Object.hasOwn(map, ex?.id) ? map[ex.id] : ex?.aliases)

/**
 * The other name this exercise is shown by everywhere (#903), as it was typed, or null for its own
 * name. S.exShownName[exId] holds the pick; it only counts while that name is still one of the
 * exercise's other names, so taking the name off the list brings the catalogue title back.
 */
export function shownNameOf(ex, map = shown, aliasMap = overrides) {
  const pick = ex && asMap(map)[ex.id]
  if (typeof pick !== 'string' || !pick.trim()) return null
  const key = pick.trim().toLocaleLowerCase()
  return exerciseAliases(ex, aliasMap).find(a => a.toLocaleLowerCase() === key) || null
}
export const shownNameSnapshot = () => shown
