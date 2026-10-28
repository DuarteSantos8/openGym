import { uid } from './format.js'
import { cleanupSg, defaultConfig, modeOf, supersetUnits, NOTE_MAX } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { swapActiveExercise } from './active-exercise-swap.js'
import { moveActiveWorkoutUnit } from './active-workout-order.js'
import { insertionIndexAfterCurrentUnit } from './supersetFlow.js'

const unfinished = entry => (entry?.sets || []).some(set => !set.done && !isWarmupRow(set))
const logged = entry => (entry?.sets || []).some(set => set.done)

export function ensureWorkoutEntryKeys(active) {
  if (!active?.entries) return active
  active.entries.forEach(entry => { if (!entry.key) entry.key = uid() })
  return active
}

/** The workout as a Coach job carries it. The payload builder (cleanActive) bounds what reaches the model. */
export function workoutCoachSession(active, anchorKey) {
  if (!active) return null
  ensureWorkoutEntryKeys(active)
  return {
    id: active.id, d: active.d, name: active.name, entries: active.entries, coachChat: active.coachChat || [],
    elapsedMin: active.start ? Math.max(0, Math.round((Date.now() - active.start) / 60000)) : null,
    anchorKey: anchorKey || active.entries[active.cur]?.key || null
  }
}

/** The proposal's actions against the workout as it is now: one whose entries have changed is stale. */
export function markWorkoutActions(proposal, active) {
  const entries = new Map((active?.entries || []).map(entry => [entry.key, entry]))
  return (proposal?.actions || []).map(action => {
    const entry = action.target ? entries.get(action.target.entryKey) : null
    const ref = action.after?.afterEntryKey
    const stale = (!!action.target && (entry?.id !== action.target.exerciseId || !unfinished(entry))) || (ref != null && !entries.has(ref))
    return { ...action, stale }
  })
}

/** What an exercise the Coach adds or swaps in starts from: the catalogue default, with its sets and reps, hold or minutes. */
export function coachExerciseConfig(id, after) {
  const mode = modeOf({ id }) === 'cardio' ? 'cardio' : after.sec && !after.reps ? 'time' : 'reps'
  const cfg = { ...defaultConfig(id, mode), mode }
  if (after.sets) cfg.sets = after.sets
  if (mode === 'reps' && after.reps) cfg.reps = after.reps
  if (mode === 'time' && after.sec) cfg.sec = after.sec
  if (mode === 'cardio' && after.min) cfg.min = after.min
  return cfg
}

/** A swap of a logged superset member needs the same keep-or-detach choice as a manual swap. */
export const needsGroupChoice = (actions, active) => actions.some(action => {
  const entry = action.type === 'swap-exercise' && active?.entries?.find(e => e.key === action.target?.entryKey)
  return !!entry?.sg && logged(entry)
})

// A remaining set only ever comes down: the lighter sets of a pyramid stay lighter, and a field
// the set does not have (reps on a timed hold) is not added to it.
const lower = (set, field, value) => { if (value != null && set[field] != null) set[field] = Math.min(Number(set[field]) || 0, value) }

/*
 * One handler per action type, as coach.js has one per plan change (CHANGE_APPLY). Each gets
 * the live workout, the validated action, and what the driver resolved for it: the entry it
 * targets and that entry's index, `ref` (the entry key an `afterEntryKey` names, or null for the
 * front or the end), `at` (index by key), `makeEntry`, and `current` — whether the entry is the
 * one on screen. A handler that moves the exercise on screen returns the key to show instead,
 * null when nothing follows it; the others return nothing.
 */
const WORKOUT_APPLY = {
  'swap-exercise': (active, action, { index, entry, makeEntry, groupDisposition, current }) => {
    const replacement = makeEntry(action.after.id, action.after, entry)
    // A slot kept out of progression stays out once swapped, as with a manual swap.
    if (entry.noProg === true) replacement.noProg = true
    // Logged sets keep their exercise and its unfinished work goes to the replacement. Fewer
    // sets than planned read as a short session, a step toward a deload, so the partial
    // exercise is kept out of progression, as a skip is.
    if (logged(entry)) {
      entry.sets = entry.sets.filter(set => set.done)
      entry.noProg = true
    }
    swapActiveExercise(active, index, replacement, { loggedConfirmed: true, groupDisposition })
    ensureWorkoutEntryKeys(active)
    if (current) return active.entries[active.cur].key
  },
  'move-exercise': (active, action, { index, ref, at, current }) => {
    // One unit at a time, as Move up/down does, so a superset travels whole.
    let from = index
    for (let guard = active.entries.length; guard > 0; guard--) {
      const units = supersetUnits(active.entries)
      const source = units.findIndex(unit => unit.includes(from))
      const dest = ref === null ? -1 : units.findIndex(unit => unit.includes(at(ref)))
      const goal = dest < source ? dest + 1 : dest
      if (goal === source) break
      const moved = moveActiveWorkoutUnit(active, from, goal < source ? -1 : 1)
      if (!moved) throw new Error('stale workout action')
      from = moved.indices.indexOf(from)
    }
    // Moved later, what slid into its place is next; moved first, it is.
    if (current) return active.entries[Math.min(index, from)].key
  },
  'add-exercise': (active, action, { ref, at, makeEntry }) => {
    // After the unit it names, the way a manual add lands after the current one; else at the end.
    const after = ref === null ? active.entries.length - 1 : at(ref)
    const insertAt = insertionIndexAfterCurrentUnit(supersetUnits(active.entries), after, active.entries.length)
    active.entries.splice(insertAt, 0, makeEntry(action.after.id, action.after, active.entries[after] || null))
  },
  'adjust-exercise': (active, action, { entry }) => {
    const { remainingSets, reps, weight, sec, restSec, excludeFromProgression } = action.after
    let kept = 0
    entry.sets = entry.sets.filter(set => {
      if (set.done || isWarmupRow(set)) return true
      if (remainingSets != null && kept >= remainingSets) return false
      kept++
      lower(set, 'r', reps)
      lower(set, 'w', weight)
      lower(set, 'sec', sec)
      return true
    })
    if (restSec != null) entry.target = { ...(entry.target || {}), restSec }
    if (excludeFromProgression) entry.noProg = true
  },
  'skip-exercise': (active, action, { index, entry, current }) => {
    entry.sets = entry.sets.filter(set => set.done)
    if (entry.sets.length) entry.noProg = true
    else active.entries.splice(index, 1)
    // Nothing is left to do on it, so the next exercise comes up.
    if (current) return active.entries[entry.sets.length ? index + 1 : index]?.key ?? null
  },
  // Under what the athlete wrote in the session note, which the next review and debrief read;
  // the athlete's own words are the ones kept whole when the note is full.
  'note': (active, action) => {
    active.note = [active.note, action.after.text].filter(Boolean).join('\n').slice(0, NOTE_MAX)
  }
}

/**
 * Apply validated, explicitly selected actions to the unfinished part of the workout through the
 * helpers the manual controls use. Throws as soon as one no longer fits, so the store's update()
 * keeps none of the batch. `makeEntry(id, after, slot)` builds an exercise as a manual add does.
 */
export function applyWorkoutActions(active, actions, makeEntry, { groupDisposition = 'detach' } = {}) {
  ensureWorkoutEntryKeys(active)
  const at = key => active.entries.findIndex(entry => entry.key === key)
  // Where the person is now stays on screen unless an action moves that very exercise.
  let focus = active.entries[active.cur]?.key
  // Skips last: one can remove an exercise another action places something after.
  const ordered = [...actions.filter(a => a.type !== 'skip-exercise'), ...actions.filter(a => a.type === 'skip-exercise')]
  for (const action of ordered) {
    const apply = WORKOUT_APPLY[action.type]
    if (!apply) throw new Error('unknown workout action')
    const index = action.target ? at(action.target.entryKey) : -1
    const entry = active.entries[index]
    if (action.target && (entry?.id !== action.target.exerciseId || !unfinished(entry))) throw new Error('stale workout action')
    const ref = action.after?.afterEntryKey ?? null
    if (ref !== null && at(ref) < 0) throw new Error('stale workout action')
    const next = apply(active, action, { index, entry, ref, at, makeEntry, groupDisposition, current: !!entry && entry.key === focus })
    if (next !== undefined) focus = next
  }
  cleanupSg(active.entries)
  ensureWorkoutEntryKeys(active)
  const shown = at(focus)
  active.cur = shown >= 0 ? shown : Math.max(0, Math.min(active.cur || 0, active.entries.length - 1))
}
