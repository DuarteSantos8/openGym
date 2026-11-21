// Backups suggested without any AI (#1003): the routine editor's Backups sheet offers a few in one
// tap, for anyone, Coach or not. The same substitutes the swap picker suggests (lib/exercise-
// substitutes.js: the same movement first, then the same muscle and type), from what the active
// gym has, and on other kit first: a backup is for when this machine or rack is taken, so another
// one of the same is the least useful thing to offer.
import { suggestedSubstitutes, relatedSubstitutes } from './exercise-substitutes.js'

export const SUGGEST_BACKUPS = 3

/**
 * Up to `n` catalogue exercises to offer as backups for `ex`. `list` is the library to pick from
 * (allExercises), `available` says whether the gym has what one needs (lib/equipment.js
 * exAvailable), `taken` the ids already on the list.
 */
export function backupSuggestions(list, ex, { taken = [], available = () => true, n = SUGGEST_BACKUPS } = {}) {
  if (!ex || !Array.isArray(list)) return []
  const skip = new Set([ex.id, ...taken])
  const pool = list.filter(e => e && !e.custom && !skip.has(e.id) && available(e))
  // Other kit first, the list's own order kept within each half (Array#sort is stable).
  const eq = ex.eq || ''
  const ordered = eq ? [...pool].sort((a, b) => Number(a.eq === eq) - Number(b.eq === eq)) : pool
  const out = []
  for (const e of [...suggestedSubstitutes(ordered, ex), ...relatedSubstitutes(ordered, ex)]) {
    if (!out.includes(e)) out.push(e)
    if (out.length >= n) break
  }
  return out
}
