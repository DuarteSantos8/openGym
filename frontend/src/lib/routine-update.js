// "Update routine" (v1.3.10): warm-ups added in a session, and the rest or note edited on an
// exercise's settings sheet from inside it, belong to that session only — the routine is the plan,
// and finishing never edits it. This is the explicit way to keep them. Sets, reps and weight are
// not part of it: the rule moves those, and the routine is the plan it reads them against.
import { planPhase, supports, warmupMaxCount, withRest } from './prescription/index.js'
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'

const MAX_WARMUPS = 5   // the longest ramp a recipe can hold (validateWarmup)

// The rest the slot asks for: 0 is "the profile's rest" (a slot that never set its own).
const slotRest = slot => (slot.restFromProfile ? 0 : planPhase(slot.rule).parameters.restSeconds)
const sessionRest = entry => (entry.target?.restSec > 0 ? entry.target.restSec : 0)

/** The routine slot a running session's exercise was made from, or null (freestyle, another routine's, swapped away). */
export function routineSlotFor(routine, exposure) {
  if (!routine || !exposure?.occurrenceId || !Array.isArray(routine.ex)) return null
  return routine.ex.find(o => o.occurrenceId === exposure.occurrenceId && o.exerciseId === exposure.exerciseId) || null
}

/**
 * What a running session's exercise would change in its routine slot, or null when there is nothing
 * to change. `changes` are `{ key, from, to }` for `warmupSets`, `restSec` and `note`.
 */
export function routineChangesFromEntry(routine, exposure, entry, profileRest) {
  const slot = routineSlotFor(routine, exposure)
  if (!slot || !entry || entry.rid !== routine.id) return null
  const changes = []
  const ex = EXIDX[slot.exerciseId]
  // A ramp needs a load to scale, and rest-pause builds its own warm-up row. A session started
  // before the plan's count was kept has nothing to compare with.
  if (entry.routineWarmups != null && supports(slot.rule).warmup && entry.target?.intensifier?.type !== 'restpause') {
    const to = Math.min(entry.sets.filter(isWarmupRow).length, MAX_WARMUPS, warmupMaxCount(ex?.eq))
    if (to !== entry.routineWarmups) changes.push({ key: 'warmupSets', from: entry.routineWarmups, to })
  }
  // Compared as the rest each would run at: a slot or session with none of its own runs at the profile's.
  const rest = n => (n > 0 ? n : profileRest)
  if (rest(sessionRest(entry)) !== rest(slotRest(slot))) changes.push({ key: 'restSec', from: slotRest(slot), to: sessionRest(entry) })
  // The note on the exercise's settings sheet, not the one added for today (entry.note).
  const note = (entry.target?.note || '').trim()
  if (note !== (slot.note || '')) changes.push({ key: 'note', from: slot.note || '', to: note })
  return changes.length ? { occurrenceId: slot.occurrenceId, changes } : null
}

/** Writes the changes into the slot, on a store draft. Returns the changes applied, or null when the slot is gone. */
export function updateRoutineFromEntry(routine, found) {
  const slot = routine?.ex?.find(o => o.occurrenceId === found?.occurrenceId)
  if (!slot) return null
  for (const { key, to } of found.changes) {
    if (key === 'warmupSets') {
      if (to > 0) slot.warmup = { mode: 'smart', count: to }
      else delete slot.warmup
    } else if (key === 'restSec') {
      // 0 hands the slot back to the profile's rest; a number is its own.
      // Every phase's rest; a group's own rest and a progressed rest stay as they are.
      if (to > 0) { slot.rule = withRest(slot.rule, to); delete slot.restFromProfile } else slot.restFromProfile = true
    } else if (key === 'note') {
      if (to) slot.note = to
      else delete slot.note
    }
  }
  return found.changes
}
