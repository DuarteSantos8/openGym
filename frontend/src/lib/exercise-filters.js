// The two filters of the exercise library, a muscle and the equipment, each picked in a sheet
// (components/FilterSheets.jsx) instead of laid out as rows of chips on the page.
//
// MUSCLES are the app's own (lib/muscles.js), so the figure drawn on a tile, the muscle map and
// this filter all agree. An exercise matches a muscle when it works it as a primary (weight 1); a
// secondary (0.4) does not, so "Triceps" does not list every bench press. Cardio is not a muscle
// and has a tile of its own.
//
// EQUIPMENT: the catalogue names thirty-odd kinds ("leverage machine", "ez barbell", "sled
// machine"...). A sheet of thirty tiles is the wall of chips again, so they are folded into the
// ten a lifter thinks in. Anything not listed (a custom exercise, a new catalogue kind) is Other.
import { muscleWeightsOf } from './muscles.js'

export const MUSCLE_GROUPS = [
  { title: 'Upper body', ids: ['chest', 'upper-back', 'deltoids', 'biceps', 'triceps', 'forearm', 'trapezius', 'abs', 'obliques', 'lower-back', 'serratus'] },
  { title: 'Lower body', ids: ['quadriceps', 'hamstring', 'gluteal', 'adductors', 'hip-flexors', 'calves', 'tibialis'] },
  { title: 'Other', ids: ['cardio'] },
]

// Drawn from behind on its tile; every other muscle from the front.
export const BACK_MUSCLES = new Set(['upper-back', 'trapezius', 'lower-back', 'triceps', 'gluteal', 'hamstring', 'calves'])

/** Cardio is a kind of exercise, not a muscle: the catalogue marks it on the body part and the category. */
export const isCardioEx = ex => ex?.bp === 'cardio' || ex?.cat === 'cardio'

// The catalogue never makes these three a primary (the most it says is secondary, 0.4), so asking
// for a primary would leave their tiles empty: any work on them counts.
const NEVER_PRIMARY = new Set(['obliques', 'hip-flexors', 'tibialis'])

/** Whether `ex` works any of the chosen muscles as a primary. Nothing chosen matches everything. */
export function matchesMuscles(ex, ids) {
  if (!ids?.length) return true
  const w = ids.some(id => id !== 'cardio') ? muscleWeightsOf(ex) : null
  return ids.some(id => {
    if (id === 'cardio') return isCardioEx(ex)
    const v = w[id] || 0
    return NEVER_PRIMARY.has(id) ? v > 0 : v >= 1
  })
}

export const EQUIP_GROUPS = [
  { id: 'none', name: 'No equipment', icon: 'person', values: ['body weight'] },
  { id: 'barbell', name: 'Barbell', icon: 'barbell', values: ['barbell', 'ez barbell', 'olympic barbell', 'trap bar', 'landmine'] },
  { id: 'dumbbell', name: 'Dumbbell', icon: 'dumbbell', values: ['dumbbell'] },
  { id: 'kettlebell', name: 'Kettlebell', icon: 'kettlebell', values: ['kettlebell'] },
  { id: 'machine', name: 'Machine', icon: 'machine', values: ['leverage machine', 'smith machine', 'sled machine', 'assisted', 'elliptical machine', 'stepmill machine', 'skierg machine', 'upper body ergometer', 'stationary bike'] },
  { id: 'cable', name: 'Cable', icon: 'grip', values: ['cable', 'rope'] },
  { id: 'band', name: 'Band', icon: 'repeat', values: ['band', 'resistance band'] },
  { id: 'plate', name: 'Plate', icon: 'plate', values: ['weight plate'] },
  { id: 'suspension', name: 'Suspension', icon: 'pullup', values: ['suspension trainer'] },
  { id: 'other', name: 'Other', icon: 'more', values: [] },
]

const GROUP_OF = new Map(EQUIP_GROUPS.flatMap(g => g.values.map(v => [v, g.id])))

/** The group id an equipment value belongs to; anything unlisted is 'other'. */
export const equipGroupOf = eq => GROUP_OF.get(String(eq || '').toLowerCase()) || 'other'

/** Whether `ex` uses any of the chosen equipment groups. Nothing chosen matches everything. */
export const matchesEquip = (ex, ids) => !ids?.length || ids.includes(equipGroupOf(ex?.eq))
