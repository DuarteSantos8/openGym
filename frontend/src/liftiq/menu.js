// LIFTIQ-FORK: the one set-menu item of the integration (new file). Workout.jsx spreads
// liftiqSetItems(...) into the first section of openSetMenu; with the feature off it is an empty list,
// so the menu is exactly upstream's. The sheet (and with it the vendored package) loads on demand.
import { liftiqEnabled } from './feature.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'

/**
 * @param {object} c
 * @param {object} c.entry   the exercise entry of the active workout
 * @param {object} c.set     the set row
 * @param {number} c.i       its index in entry.sets
 * @param {string} c.mode    'reps' | 'time' | 'cardio'
 * @param {string} c.unit    S.unit ('kg' | 'lb'): the unit `set.w` is stored in
 * @param {boolean} c.editing a finished workout being edited (no sensor then)
 * @param {Function} c.onField (i, field, value) the workout screen's own field handler
 * @param {Function} c.onToggle (i) its done-toggle
 * @param {string} [c.setTitle]
 */
export function liftiqSetItems(c) {
  if (!liftiqEnabled() || c.editing || c.mode !== 'reps' || c.set?.sides) return []
  return [{
    icon: 'bolt', accent: true, label: 'Record with sensor', sub: 'LiftIQ: counts reps and bar speed',
    onClick: () => {
      void import('./RecordSheet.jsx').then(m => m.openRecordSheet({
        i: c.i, set: c.set, unit: c.unit, onField: c.onField, onToggle: c.onToggle,
        title: exerciseNameText(exOr(c.entry.id)), subtitle: c.setTitle,
      }))
    },
  }]
}
