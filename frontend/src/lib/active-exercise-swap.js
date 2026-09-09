import { supersetUnits, unitOf } from './history.js'

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
      !['id', 'target', 'plan', 'sets', 'sg'].includes(key)
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
