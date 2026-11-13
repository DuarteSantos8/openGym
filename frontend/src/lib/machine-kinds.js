// Which machines a gym has (#923, the idea and the research by hamidrezahanafi).
//
// "Leverage machine" is one equipment value for 279 exercises: leg press, leg extension, pec deck,
// lat pulldown and the rest. A profile that ticks it gets all of them, one that does not gets none,
// and real gyms are somewhere in between. So every catalogue row on a machine carries the machine
// it needs (`mk`, catalogue "machineKind", one per exercise, checked by scripts/catalogue/validate.mjs
// and by machine-kinds.test.js), and a profile may list the kinds it has:
//
//   equipProfiles: [{ id, name, equipment, machines: ['leg-press', 'lat-pulldown'], … }]
//
// An empty or missing list means "no refinement": the four machine equipment values decide, as
// they always did, so nothing changes for a profile saved before this. Once the list has kinds,
// the kinds are what decides for every catalogue machine exercise, across equipment values: ticking
// "Leg press" brings the lever, the 45° sled and the vertical one alike, with no need to know that
// the 45° one is filed under "sled machine". The profile's machine equipment values are kept in
// step (machineFields), so an older app that only knows them still filters about right.
//
// A kind spans equipment values but never kit: a Smith leg press is done in a Smith machine, so it
// is "smith". "none" is an "assisted" row that needs no machine at all (a partner, a band, a towel);
// it stays available under a refined profile, the way body weight does.
import { t, tn } from './i18n-core.js'
import { EXDB } from './exercises-data.js'

export const MACHINE_EQ = ['leverage machine', 'sled machine', 'smith machine', 'assisted']
export const NO_MACHINE = 'none'

// The groups the picker shows, in order. Labels are functions so the string check sees each t().
export const MACHINE_GROUPS = [
  { id: 'legs', label: () => t('Legs') },
  { id: 'push', label: () => t('Push') },
  { id: 'pull', label: () => t('Pull') },
  { id: 'racks', label: () => t('Smith and assisted') },
  { id: 'more', label: () => t('Everything else') },
]

// One card per kind: its group, an equipment icon (no exercise pictures, on purpose) and the words
// people type for it. Aliases are matched as typed, in English and lowercase; the translated label
// is searched too.
export const MACHINE_KINDS = [
  { id: 'leg-press', group: 'legs', icon: 'legs', label: () => t('Leg press'), aliases: ['lp', '45', '45 degree', 'sled', 'horizontal', 'vertical'] },
  { id: 'hack-squat', group: 'legs', icon: 'legs', label: () => t('Hack squat'), aliases: ['hack', 'reverse hack'] },
  { id: 'squat-machine', group: 'legs', icon: 'legs', label: () => t('Squat machine'), aliases: ['pendulum', 'v-squat', 'v squat', 'power squat', 'seated squat'] },
  { id: 'belt-squat', group: 'legs', icon: 'legs', label: () => t('Belt squat'), aliases: ['belt'] },
  { id: 'leg-extension', group: 'legs', icon: 'legs', label: () => t('Leg extension'), aliases: ['quad', 'knee extension'] },
  { id: 'leg-curl', group: 'legs', icon: 'legs', label: () => t('Leg curl'), aliases: ['hamstring', 'lying curl', 'seated curl'] },
  { id: 'calf-raise', group: 'legs', icon: 'steps', label: () => t('Calf machine'), aliases: ['calf', 'calves', 'donkey', 'toe raise'] },
  { id: 'hip-thrust', group: 'legs', icon: 'legs', label: () => t('Hip thrust machine'), aliases: ['glute bridge', 'thrust'] },
  { id: 'hip-abduction', group: 'legs', icon: 'legs', label: () => t('Hip abductor and adductor'), aliases: ['abduction', 'adduction', 'inner thigh', 'outer thigh', 'abductor', 'adductor'] },
  { id: 'glute-machine', group: 'legs', icon: 'figureStrength', label: () => t('Glute kickback'), aliases: ['kickback', 'glute', 'hip extension', 'reverse hyper'] },
  { id: 'chest-press', group: 'push', icon: 'machine', label: () => t('Chest press'), aliases: ['bench press machine', 'incline press', 'chest'] },
  { id: 'pec-deck', group: 'push', icon: 'machine', label: () => t('Pec deck and rear delt fly'), aliases: ['fly', 'butterfly', 'reverse fly', 'rear delt'] },
  { id: 'shoulder-press', group: 'push', icon: 'machine', label: () => t('Shoulder press'), aliases: ['military', 'overhead press', 'ohp'] },
  { id: 'lateral-raise', group: 'push', icon: 'machine', label: () => t('Lateral raise machine'), aliases: ['lateral', 'side raise', 'delts'] },
  { id: 'triceps-machine', group: 'push', icon: 'arm', label: () => t('Triceps and dip machine'), aliases: ['triceps', 'dip', 'extension'] },
  { id: 'lat-pulldown', group: 'pull', icon: 'pullup', label: () => t('Lat pulldown'), aliases: ['pulldown', 'lats', 'high row'] },
  { id: 'seated-row', group: 'pull', icon: 'machine', label: () => t('Row machine'), aliases: ['seated row', 'low row', 'chest supported row', 'row'] },
  { id: 't-bar-row', group: 'pull', icon: 'barbell', label: () => t('T-bar row'), aliases: ['t bar', 'tbar', 'chest supported t-bar'] },
  { id: 'biceps-curl', group: 'pull', icon: 'arm', label: () => t('Biceps curl machine'), aliases: ['preacher', 'biceps', 'curl'] },
  { id: 'back-extension', group: 'pull', icon: 'figureStrength', label: () => t('Back extension and GHD'), aliases: ['hyperextension', 'ghd', 'glute ham', 'roman chair'] },
  { id: 'smith', group: 'racks', icon: 'barbell', label: () => t('Smith machine'), aliases: ['smith'] },
  { id: 'assisted-pullup', group: 'racks', icon: 'pullup', label: () => t('Assisted pull-up and dip'), aliases: ['gravitron', 'assisted', 'pull-up', 'chin-up', 'dip'] },
  { id: 'ab-machine', group: 'more', icon: 'abs', label: () => t('Ab and twist machines'), aliases: ['crunch', 'abs', 'torso rotation', 'twist'] },
  { id: 'push-sled', group: 'more', icon: 'figureRun', label: () => t('Push and pull sled'), aliases: ['prowler', 'power sled', 'drag'] },
  { id: 'cardio', group: 'more', icon: 'bike', label: () => t('Cardio machines'), aliases: ['treadmill', 'bike', 'rower', 'stepper', 'cross trainer'] },
  { id: 'pilates', group: 'more', icon: 'stretch', label: () => t('Pilates reformer'), aliases: ['reformer', 'pilates'] },
  { id: 'other', group: 'more', icon: 'machine', label: () => t('All other machines'), aliases: ['neck', 'shrug', 'pullover', 'gripper', 'other'] },
]
export const KIND_IDS = MACHINE_KINDS.map(k => k.id)
export const KIND_BY_ID = Object.fromEntries(MACHINE_KINDS.map(k => [k.id, k]))
const KNOWN = new Set(KIND_IDS)

/** The machine a catalogue exercise needs: a kind id, NO_MACHINE, or null (not a machine, or a custom one). */
export function machineKindOf(ex) {
  if (!ex || !MACHINE_EQ.includes(ex.eq)) return null
  return ex.mk === NO_MACHINE || KNOWN.has(ex.mk) ? ex.mk : null
}

/** A profile's machine kinds, cleaned (a backup or another device may hold anything): known ids, each once. */
export function profileMachines(p) {
  const list = Array.isArray(p?.machines) ? p.machines : []
  return KIND_IDS.filter(id => list.includes(id))
}

// How many catalogue exercises each kind has, and which equipment values it spans.
export const KIND_COUNT = {}
const KIND_EQ = {}
for (const e of EXDB) {
  const k = machineKindOf(e)
  if (!k || k === NO_MACHINE) continue
  KIND_COUNT[k] = (KIND_COUNT[k] || 0) + 1
  ;(KIND_EQ[k] = KIND_EQ[k] || new Set()).add(e.eq)
}

/** The kinds an equipment list already reaches, before any refinement: a kind with a row on ticked kit. */
export function kindsForEquipment(equipment) {
  const have = new Set(equipment || [])
  return KIND_IDS.filter(k => [...(KIND_EQ[k] || [])].some(eq => have.has(eq)))
}

/** The machines a profile counts as having: its own list, or what its equipment reaches. */
export function machinesOf(p) {
  const own = profileMachines(p)
  return own.length ? own : kindsForEquipment(p?.equipment)
}

/**
 * The profile fields for a chosen set of kinds: `machines` as chosen, and the machine equipment
 * values in step with it (ticked where a chosen kind has exercises), so an app that knows only
 * equipment values still filters about right. No kinds at all means no machines: the list is
 * emptied (an empty list is "no refinement") and the machine values are unticked instead.
 */
export function machineFields(equipment, kinds) {
  const chosen = KIND_IDS.filter(id => (kinds || []).includes(id))
  const rest = (equipment || []).filter(e => !MACHINE_EQ.includes(e))
  const eqs = MACHINE_EQ.filter(eq => chosen.some(k => KIND_EQ[k]?.has(eq)))
  return { equipment: [...rest, ...eqs], machines: chosen }
}

/** A short line for the profile: "All machines", "No machines", "14 machines". */
export function machinesSummary(p) {
  const n = machinesOf(p).length
  if (n === KIND_IDS.length) return t('All machines')
  if (!n) return t('No machines')
  return tn('{0} machine', '{0} machines', n)
}

/** Kinds matching a search: the translated name, the English one, or an alias. */
export function searchKinds(q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return MACHINE_KINDS
  return MACHINE_KINDS.filter(k => k.label().toLowerCase().includes(s) || k.id.replace(/-/g, ' ').includes(s)
    || k.aliases.some(a => a.includes(s) || (s.length > 2 && s.includes(a) && a.length > 2)))
}

/**
 * "Not at my gym": the profile fields with one kind taken out. A profile with no list yet starts
 * from what its equipment reaches, so taking out the leg extension keeps every other machine it
 * had. Taking out the last one leaves no machines (see machineFields). Null when the kind was not
 * there to take out.
 */
export function withoutKind(p, kind) {
  const have = machinesOf(p)
  if (!have.includes(kind)) return null
  return machineFields(p?.equipment, have.filter(k => k !== kind))
}

/** The kind a "Not at my gym" button would take out of profile `p` for exercise `ex`, or null. */
export function removableKind(p, ex) {
  if (!p || !p.id) return null
  const k = machineKindOf(ex)
  return k && k !== NO_MACHINE && machinesOf(p).includes(k) ? k : null
}
