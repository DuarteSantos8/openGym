import { t } from './i18n-core.js'
import { EXDB } from './exercises-data.js'
import { ownsNoDumbbells } from './dumbbells.js'

// Pieces of kit the catalogue never names as an exercise's equipment — "dumbbell bench press" is
// tagged `dumbbell`, yet it needs a bench; "chin-up" is tagged `body weight`, yet it needs a bar.
// Mostly read off the exercise name instead of stored on 1,300 rows; the ones the name does not
// give away (a dumbbell fly lies on a bench, an inverted row hangs under a bar) carry `nd` from the
// catalogue's "needs". They sit in the profile checklist beside the real equipment values.
export const ACCESSORIES = ['bench', 'pull-up bar']

// Machines that carry their own seat, bar or bench: "lever incline chest press" needs no bench.
const SELF_CONTAINED = new Set(['leverage machine', 'sled machine', 'assisted'])

// Which accessories an exercise needs, e.g. ['bench'] for "dumbbell incline bench press".
export function accessoriesOf(ex) {
  if (!ex.n || SELF_CONTAINED.has(ex.eq)) return []
  const n = ex.n.toLowerCase()
  const need = []
  if (/\bbench\b|\bincline\b|\bdecline\b/.test(n)) need.push('bench')
  if (/pull-up|pull up|chin-up|\bchin\b|hanging|muscle-up|muscle up/.test(n)) need.push('pull-up bar')
  for (const a of Array.isArray(ex.nd) ? ex.nd : []) if (ACCESSORIES.includes(a) && !need.includes(a)) need.push(a)
  return need
}

// Every equipment value present in the catalogue, most common first, then the accessories —
// this becomes the checklist Settings shows when you build a profile.
export const ALL_EQUIPMENT = (() => {
  const c = {}
  EXDB.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  const ranked = Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
  // Clubbell and macebell have no catalogue entries yet (issue #393). They still belong on the
  // profile checklist and the custom-exercise chips, after everything the catalogue already uses.
  for (const extra of ['clubbell', 'macebell']) if (!ranked.includes(extra)) ranked.push(extra)
  return ranked.concat(ACCESSORIES)
})()

// Body weight is never gated by a profile — no gym or home setup can take it away from you,
// and every profile should be able to see bodyweight exercises regardless of what's checked.
// Only the accessory an exercise needs (a bar, a bench) can still gate it.
const ALWAYS_AVAILABLE = 'body weight'

// "I own no dumbbells" (Settings → Equipment → Dumbbells) filters without a profile of its own:
// everything but the dumbbell. It stands in as the active profile, so the library, the picker and
// a routine's missing-equipment flags all filter by it, and their Show all still shows all. No id,
// so nothing that picks a saved profile (the starter plan's fitting) mistakes it for one.
const noDumbbellsProfile = () => ({
  id: '', name: t('Everything but dumbbells'), equipment: ALL_EQUIPMENT.filter(e => e !== 'dumbbell'), accV: ACC_V, noDumbbells: true,
})

export function activeProfile(S) {
  const profiles = S.equipFilterOn ? S.equipProfiles || [] : []
  return profiles.find(p => p.id === S.activeEquipId) || (ownsNoDumbbells(S) ? noDumbbellsProfile() : null)
}

// Whether an exercise is usable under the active profile. With filtering off, or no profile
// selected, everything is available — this is purely additive, never a trap that hides your
// whole library because you haven't set anything up yet. Owning no dumbbells holds under any
// profile, even one that has them ticked: the switch is the more direct thing to have said.
export function exAvailable(S, ex) {
  const p = activeProfile(S)
  if (!p) return true
  if (ownsNoDumbbells(S) && ex.eq === 'dumbbell') return false
  return eqAvailable(profileEquipment(p), ex)
}

// A profile saved before the bench and the bar were on the checklist (#464) never had the chance
// to tick them; read as unticked, every bench press and pull-up would vanish from it overnight.
// It counts as having both until it is saved again, and the sheet shows them ticked.
// Version 2 split the massage ball off the foam roller: a profile that had the roller kept the
// ball exercises it always showed, again until it is saved.
export const ACC_V = 2
export function profileEquipment(p) {
  const have = p?.equipment || []
  if (!p || p.accV === ACC_V) return have
  const add = (p.accV || 0) < 1 ? [...ACCESSORIES] : []
  if (have.includes('roller')) add.push('massage ball')
  return [...new Set([...have, ...add])]
}

// The same test against a bare equipment list, for callers that hold a profile rather than S.
export function eqAvailable(equipment, ex) {
  const have = equipment || []
  if (ex.eq && ex.eq !== ALWAYS_AVAILABLE) {
    // Equipment no profile can tick (an imported exercise's "custom") would hide the user's own
    // exercise under every profile, with no way to bring it back. It stays, like body weight.
    if (!ALL_EQUIPMENT.includes(ex.eq)) return true
    if (!have.includes(ex.eq)) return false
  }
  return accessoriesOf(ex).every(a => have.includes(a))
}

export function newProfile(name) {
  return { id: 'eq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, equipment: [], accV: ACC_V }
}
