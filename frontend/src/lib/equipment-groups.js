// Equipment in a few big groups. The catalogue names 33 kinds of equipment, from body weight
// (2,246 exercises) to a stepmill (1), and a strip of 20-odd kinds is long to scroll through.
// A filter shows the groups instead, each opening on its kinds, and filters by a whole group or
// by one kind. A kind no group names (a catalogue update) falls into Other, so nothing is ever
// unreachable.

// Labels are i18n keys (lib/i18n.js).
export const EQUIP_GROUPS = [
  { id: 'bw', label: 'Body weight', kinds: ['body weight', 'weighted', 'suspension trainer'] },
  { id: 'free', label: 'Free weights', kinds: ['dumbbell', 'kettlebell', 'weight plate', 'medicine ball', 'sandbag', 'clubbell', 'macebell'] },
  { id: 'bar', label: 'Barbells', kinds: ['barbell', 'olympic barbell', 'ez barbell', 'trap bar', 'landmine'] },
  { id: 'machine', label: 'Machines', kinds: ['leverage machine', 'smith machine', 'sled machine', 'assisted'] },
  { id: 'cable', label: 'Cables', kinds: ['cable'] },
  { id: 'band', label: 'Bands', kinds: ['band', 'resistance band'] },
  { id: 'ball', label: 'Balls & rollers', kinds: ['stability ball', 'bosu ball', 'roller', 'wheel roller', 'massage ball'] },
  { id: 'cardio', label: 'Cardio machines', kinds: ['stationary bike', 'elliptical machine', 'skierg machine', 'stepmill machine', 'upper body ergometer'] },
  // The accessories an equipment profile ticks (ACCESSORIES in lib/equipment.js): no exercise
  // names them as its equipment, so they only ever show on a profile's checklist.
  { id: 'acc', label: 'Bench & bar', kinds: ['bench', 'pull-up bar'] },
  { id: 'other', label: 'Other', kinds: ['rope', 'tire', 'hammer'] },
]

const NAMED = new Map(EQUIP_GROUPS.flatMap(g => g.kinds.map(k => [k, g.id])))
export const groupOf = kind => NAMED.get(kind) || 'other'

/**
 * `kinds` sorted into the groups, in the groups' order: [{ id, label, kinds }], a group with
 * none of them left out. A group's kinds keep the order they were given in.
 */
export function groupKinds(kinds) {
  const by = new Map(EQUIP_GROUPS.map(g => [g.id, []]))
  for (const k of kinds || []) by.get(groupOf(k)).push(k)
  return EQUIP_GROUPS.map(g => ({ id: g.id, label: g.label, kinds: by.get(g.id) })).filter(g => g.kinds.length)
}

// A filter value for a whole group, beside a kind's own name. No kind starts with it.
const GROUP = 'group:'
export const groupValue = id => GROUP + id
export const groupIdOf = v => (typeof v === 'string' && v.startsWith(GROUP) ? v.slice(GROUP.length) : null)

/** Whether exercise `ex` falls under the filter value `v` ('' any, a kind, or a group's value). */
export function eqMatches(v, ex) {
  if (!v) return true
  const g = groupIdOf(v)
  return g ? !!ex?.eq && groupOf(ex.eq) === g : ex?.eq === v
}

/**
 * The filter value `v` while the list holds `kinds`: kept when something falls under it, else ''
 * (issue #71's rule: a filter the list has nothing under is dropped for this view, not forgotten).
 */
export function eqOnAmong(v, kinds) {
  const g = groupIdOf(v)
  if (g) return (kinds || []).some(k => groupOf(k) === g) ? v : ''
  return (kinds || []).includes(v) ? v : ''
}
