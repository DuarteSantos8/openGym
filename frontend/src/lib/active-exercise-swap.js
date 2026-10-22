import { supersetUnits, unitOf } from './history.js'
import { plannedConfigOf } from './session-start.js'
import { replaceSlotExercise } from './routines.js'
import { cleanBackups } from './routine-backups.js'
import { EXIDX } from './exercises.js'
import { exerciseNameText } from './format.js'
import { t } from './i18n.js'

function hasLoggedSet(entry) {
  return Array.isArray(entry?.sets) && entry.sets.some(set => set?.done === true)
}

/**
 * Swap one exact active-workout occurrence.
 *
 * Unlogged occurrences are replaced in place. Logged results are never relabelled: after explicit
 * confirmation, the replacement is inserted beside the original. A logged group member also
 * requires an explicit choice to keep the replacement in the group or detach it after the group.
 */
export function swapActiveExercise(active, index, replacement, {
  loggedConfirmed = false,
  groupDisposition
} = {}) {
  if (!active || !Array.isArray(active.entries) || !replacement || index < 0 || index >= active.entries.length) return null

  const current = active.entries[index]
  if (!hasLoggedSet(current)) {
    const metadata = Object.fromEntries(Object.entries(current).filter(([key]) => (
      !['id', 'target', 'plan', 'planned', 'carried', 'sets', 'sg'].includes(key)
    )))
    active.entries[index] = { ...metadata, ...replacement, ...(current.sg ? { sg: current.sg } : {}) }
    active.cur = index
    return { inserted: false, index }
  }

  if (!loggedConfirmed) return { needsConfirmation: true, grouped: !!current.sg, index }
  if (current.sg && !['keep', 'detach'].includes(groupDisposition)) {
    return { needsConfirmation: true, grouped: true, index }
  }

  const unit = unitOf(supersetUnits(active.entries), index)
  const keepGroup = current.sg && groupDisposition === 'keep'
  const insertAt = keepGroup ? index + 1 : (unit.length > 1 ? unit.at(-1) + 1 : index + 1)
  active.entries.splice(insertAt, 0, {
    ...replacement,
    // A swap does not change which routine the slot belongs to — carry its `rid` the same
    // way `sg` is carried, so a combined session's WorkoutDetail groups stay contiguous.
    ...(current.rid ? { rid: current.rid } : {}),
    ...(keepGroup ? { sg: current.sg } : {})
  })
  active.cur = insertAt
  return { inserted: true, index: insertAt }
}

/**
 * What a slot's planned backup opens with when it takes the slot mid-session (#649): the slot's
 * own plan — sets, reps or seconds, the rest, the warm-ups, the progression settings — carried
 * the way the routine editor's Replace carries it (lib/routines.js replaceSlotExercise), so the
 * weight is the backup's own where it has been logged in this routine, and the bodyweight and
 * assisted rules apply. Today's target is not the plan: a double-progression aim or a back-off
 * step moved it off, and the stamps that describe this session of the exercise being left (the
 * dumbbell meaning, the per-set aims, the back-off step) are not carried (plannedConfigOf).
 *
 * The exercise leaving the slot becomes the first backup of the one taking it, so the bench is
 * one tap away again once it frees up; the list stays within MAX_BACKUPS, and never names the
 * exercise now in the slot.
 */
export function backupSessionConfig(entry, backupId, S) {
  const { dbLoad: _meaning, rowReps: _aims, backoffStep: _step, ...planned } = plannedConfigOf(entry)
  const cfg = replaceSlotExercise(planned, backupId, S, entry?.rid)
  const subs = cleanBackups([entry?.id, ...(Array.isArray(planned.subs) ? planned.subs : [])], backupId)
  if (subs.length) cfg.subs = subs
  else delete cfg.subs
  return cfg
}

/**
 * The slot's planned backups as items for the exercise's ⋯ menu, one tap each (#649), shared
 * by the Cards/List menu (views/Workout.jsx) and the Focus one (views/FocusView.jsx). Only
 * catalogue exercises, the way the backups sheet lists them; `onSwapToBackup(id)` does the swap
 * (sheets.jsx swapActiveWorkoutExerciseToBackup). No handler, no items.
 */
export const backupMenuItems = (entry, onSwapToBackup, { icon = 'swap', disabled = false } = {}) =>
  onSwapToBackup ? cleanBackups(entry?.target?.subs, entry?.id, id => !!EXIDX[id]).map(id => ({
    icon, label: t('Do {0} instead', exerciseNameText(EXIDX[id])), sub: t('Planned backup'), onClick: () => onSwapToBackup(id), disabled,
  })) : []
