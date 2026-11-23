import { t } from './i18n-core.js'
import { EXDB } from './exercises-data.js'
import { ownsNoDumbbells } from './dumbbells.js'
import { machineKindOf, profileMachines, NO_MACHINE } from './machine-kinds.js'

// Pieces of kit the catalogue never names as an exercise's equipment — "dumbbell bench press" is
// tagged `dumbbell`, yet it needs a bench; "chin-up" is tagged `body weight`, yet it needs a bar.
// Mostly read off the exercise name instead of stored on 1,300 rows; the ones the name does not
// give away (a dumbbell fly lies on a bench, an inverted row hangs under a bar) carry `nd` from the
// catalogue's "needs". They sit in the profile checklist beside the real equipment values.
// "adjustable bench" (1.4.5): one that tilts, for the incline and decline work a flat bench can't do.
export const ACCESSORIES = ['bench', 'adjustable bench', 'pull-up bar']

// Machines that carry their own seat, bar or bench: "lever incline chest press" needs no bench.
const SELF_CONTAINED = new Set(['leverage machine', 'sled machine', 'assisted'])

// "Incline" and "decline" in a name that is not about lying or sitting on a bench: a push-up with
// the hands up on something (a box, a wall, a Smith bar, a chair), a plank, a pushdown, a push press,
// a jump. A flat bench or any step does those, or nothing at all does.
const NO_TILT_BENCH = /push[- ]?ups?\b|pushups?\b|plank|pushdown|push press|jump|against (the |a )?wall|on (a )?box|chair|smith bar|suspender|stability ball|step[- ]?up|treadmill|walk|run\b|sprint|bike|cycl/

// Which accessories an exercise needs, e.g. ['bench', 'adjustable bench'] for "dumbbell incline
// bench press" and ['bench'] for "dumbbell bench press". Incline and decline work on a bench needs
// one that tilts (#1.4.5 "flat vs adjustable"), so a flat-bench gym is not offered it.
export function accessoriesOf(ex) {
  if (!ex.n || SELF_CONTAINED.has(ex.eq)) return []
  const n = ex.n.toLowerCase()
  const need = []
  const tilt = /\bincline\b|\bdecline\b/.test(n) && !NO_TILT_BENCH.test(n)
  if (/\bbench\b/.test(n) || tilt) need.push('bench')
  if (tilt) need.push('adjustable bench')
  if (/pull-up|pull up|chin-up|\bchin\b|hanging|dead hang|muscle-up|muscle up/.test(n)) need.push('pull-up bar')
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

// Body weight is never gated by an equipment list — no gym or home setup can take it away from
// you. Only the accessory an exercise needs (a bar, a bench) can still gate it. A profile can
// still say "not here" with its own body-weight tick (#1159, bodyWeightOf below).
const ALWAYS_AVAILABLE = 'body weight'

// Body weight as a tick (#1159): a profile saved by the profile sheet carries `bwV: 1` and has body
// weight only if it is ticked. One saved before has no mark and had no say, so it has it.
export const BW_V = 1
export const bodyWeightOf = p => !p || p.bwV !== BW_V || (p.equipment || []).includes(ALWAYS_AVAILABLE)

// "I own no dumbbells" (Settings → Equipment → Dumbbells) filters without a profile of its own:
// everything but the dumbbell. It stands in as the active profile, so the library, the picker and
// a routine's missing-equipment flags all filter by it, and their Show all still shows all. No id,
// so nothing that picks a saved profile (the starter plan's fitting) mistakes it for one.
// The bench without a profile (Settings → Equipment → Bench, `S.bench`): 'adjustable' (the default,
// so nothing changes for anyone who never says), 'flat' or 'none'. Like the dumbbell switch it
// stands in as the active profile when no profile filters, everything but what it rules out.
export const BENCH_KINDS = ['adjustable', 'flat', 'none']
export const benchSetting = S => (S?.bench === 'flat' || S?.bench === 'none' ? S.bench : 'adjustable')
/** The bench an equipment list has: 'adjustable', 'flat' or 'none'. */
export function benchIn(equipment) {
  const have = equipment || []
  return !have.includes('bench') ? 'none' : have.includes('adjustable bench') ? 'adjustable' : 'flat'
}
/** An equipment list with its bench set to `kind`. */
export function withBench(equipment, kind) {
  const rest = (equipment || []).filter(e => e !== 'bench' && e !== 'adjustable bench')
  return kind === 'none' ? rest : kind === 'flat' ? [...rest, 'bench'] : [...rest, 'bench', 'adjustable bench']
}
/** What the Bench row shows and edits: the profile that filters, else the profile-free setting. */
export function benchKindOf(S) {
  const p = filteringProfile(S)
  return p ? benchIn(profileEquipment(p)) : benchSetting(S)
}

const filteringProfile = S => (S.equipFilterOn ? S.equipProfiles || [] : []).find(p => p.id === S.activeEquipId) || null

const homeKitProfile = S => {
  const noBells = ownsNoDumbbells(S)
  const bench = benchSetting(S)
  const name = noBells && bench === 'adjustable' ? t('Everything but dumbbells')
    : !noBells && bench === 'flat' ? t('Everything, flat bench only')
      : !noBells && bench === 'none' ? t('Everything but a bench')
        : t('Your equipment')
  const equipment = withBench(ALL_EQUIPMENT.filter(e => !(noBells && e === 'dumbbell')), bench)
  return { id: '', name, equipment, accV: ACC_V, ...(noBells ? { noDumbbells: true } : {}), ...(bench !== 'adjustable' ? { bench } : {}) }
}

export function activeProfile(S) {
  return filteringProfile(S) || (ownsNoDumbbells(S) || benchSetting(S) !== 'adjustable' ? homeKitProfile(S) : null)
}

// Whether an exercise is usable under the active profile. With filtering off, or no profile
// selected, everything is available — this is purely additive, never a trap that hides your
// whole library because you haven't set anything up yet. Owning no dumbbells holds under any
// profile, even one that has them ticked: the switch is the more direct thing to have said.
export function exAvailable(S, ex) {
  const p = activeProfile(S)
  if (!p) return true
  if (ownsNoDumbbells(S) && ex.eq === 'dumbbell') return false
  // Your own kit (1.4.5, #323): one of your exercises that needs a sandbag or rings shows only
  // where the gym's profile has it. Without a profile that filters, everything shows, as ever.
  if (p.id && !kitAvailable(p, ex)) return false
  // Unticked body weight hides only what needs nothing else: a chin-up follows the bar, a ring push-up its kit.
  if (ex.eq === ALWAYS_AVAILABLE && !bodyWeightOf(p) && !accessoriesOf(ex).length && !kitOf(ex).length) return false
  return eqAvailable(profileEquipment(p), ex, profileMachines(p))
}

/* ---------- your own kit ---------- */
// Kit the catalogue has no word for ("sandbag", "gymnastic rings", "the red band"), as tags:
//   equipProfile.kit = ['Sandbag', 'Rings']   what that gym or home has
//   customEx.kit     = ['Sandbag']            what one of your exercises needs
// Names match without case or extra spaces. Both fields sync with their entry, field by field
// (lib/sync-merge.js), and an older app keeps them as it keeps any key it does not know.
export const KIT_MAX = 24
export const KIT_NAME_MAX = 30
export const cleanKitName = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, KIT_NAME_MAX)
const kitKey = v => cleanKitName(v).toLowerCase()
/** A kit list cleaned: names, no repeats (by key), at most KIT_MAX. */
export function cleanKit(list) {
  const out = [], seen = new Set()
  for (const v of Array.isArray(list) ? list : []) {
    const n = cleanKitName(v), k = n.toLowerCase()
    if (!n || seen.has(k)) continue
    seen.add(k); out.push(n)
    if (out.length >= KIT_MAX) break
  }
  return out
}
export const kitOf = x => cleanKit(x?.kit)
/** Whether profile `p` has every piece of your own kit `ex` needs. */
export function kitAvailable(p, ex) {
  const need = kitOf(ex)
  if (!need.length) return true
  const have = new Set(kitOf(p).map(kitKey))
  return need.every(n => have.has(kitKey(n)))
}
/** Every kit name in use, on any profile or exercise, in the order first seen. */
export function knownKit(S) {
  return cleanKit([...(S?.equipProfiles || []).flatMap(kitOf), ...(S?.customEx || []).flatMap(kitOf)].slice(0, 200))
}

// A profile saved before the bench and the bar were on the checklist (#464) never had the chance
// to tick them; read as unticked, every bench press and pull-up would vanish from it overnight.
// It counts as having both until it is saved again, and the sheet shows them ticked.
// Version 2 split the massage ball off the foam roller: a profile that had the roller kept the
// ball exercises it always showed, again until it is saved.
// Version 3 split the adjustable bench off the bench (1.4.5): a profile that had a bench kept its
// incline and decline work, again until it is saved.
export const ACC_V = 3
export function profileEquipment(p) {
  const have = p?.equipment || []
  if (!p || p.accV === ACC_V) return have
  const add = (p.accV || 0) < 1 ? [...ACCESSORIES] : []
  if ((p.accV || 0) < 2 && have.includes('roller')) add.push('massage ball')
  if ((p.accV || 0) < 3 && (have.includes('bench') || add.includes('bench'))) add.push('adjustable bench')
  return [...new Set([...have, ...add])]
}

// The same test against a bare equipment list, for callers that hold a profile rather than S.
// `machines` is the profile's machine kinds (lib/machine-kinds.js): empty or left out, the four
// machine equipment values decide as they always did; with kinds, they decide every catalogue
// machine exercise instead, whatever its equipment value, and an "assisted" row that needs no
// machine at all (a partner, a band) stays like body weight.
export function eqAvailable(equipment, ex, machines) {
  const have = equipment || []
  const kind = Array.isArray(machines) && machines.length ? machineKindOf(ex) : null
  if (kind) {
    if (kind !== NO_MACHINE && !machines.includes(kind)) return false
  } else if (ex.eq && ex.eq !== ALWAYS_AVAILABLE) {
    // Equipment no profile can tick (an imported exercise's "custom") would hide the user's own
    // exercise under every profile, with no way to bring it back. It stays, like body weight.
    if (!ALL_EQUIPMENT.includes(ex.eq)) return true
    if (!have.includes(ex.eq)) return false
  }
  return accessoriesOf(ex).every(a => have.includes(a))
}

export function newProfile(name) {
  return { id: 'eq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, equipment: [ALWAYS_AVAILABLE], accV: ACC_V, bwV: BW_V }
}
