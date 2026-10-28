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

// Register every adopted/restored state, including an empty map when switching profiles.
export const registerExerciseAliases = map => { overrides = map && typeof map === 'object' && !Array.isArray(map) ? map : {} }
export const aliasSnapshot = () => overrides
export const exerciseAliases = (ex, map = overrides) => normalizeAliases(
  map && Object.hasOwn(map, ex?.id) ? map[ex.id] : ex?.aliases)
