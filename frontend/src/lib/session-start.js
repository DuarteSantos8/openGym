// How a session's exercise entries are built from a routine. Shared by the live start and by
// "log a past workout", which is the same screen pointed at another day — both must walk up
// to identical entries, or the two paths drift apart the first time a prescription rule changes.
// Imports both history.js and progression.js (which itself imports history.js); nothing in
// either imports this file, so there is no cycle.
import { buildSets, applyIntensifierPlan, modeOf, barFloor } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { nextPrescription, applyPrescription, defaultIncrement, weightIncrement, plannedOf } from './progression.js'
import { dropGrid } from './plates.js'
import { backoffStepOf, applyBackoff } from './backoff.js'
import { dbLoadFor, historyAs, ownedWeightsFor } from './dumbbells.js'

/**
 * Where a planned session's reps come from (Settings → During a workout). 'plan', the default:
 * the routine's own sets × reps, with history and the progression policy deciding the weight —
 * and a policy that moves reps (double progression, bodyweight, a timed hold) still moving them
 * from there. 'last': the reps you logged last time, the way every planned session opened before
 * this setting existed. A profile saved before it, or one that never chose, reads as 'plan'.
 */
export const startsFromLast = st => st?.startFrom === 'last'

/**
 * One planned exercise, built the way a session builds it: the prescription, the rows it opens
 * with and the target it is judged against. The session start, a mid-session edit of the
 * exercise, and an exercise added to or swapped into a planned session all build through here,
 * so an entry cannot come out differently depending on where it was made. `routine` is the one
 * the exercise is planned in: its own history comes first (#216) and its policy applies.
 * `noProg` builds the routine's own numbers with no prescription, as an excluded routine does.
 */
export function buildPlannedEntry(stored, cfg, routine, { noProg = false } = {}) {
  // What a dumbbell weight means for this exercise today (lib/dumbbells.js): the history it
  // progresses from is read in that meaning, so a switch from "40 total" to per bell opens at
  // 20, not at 40 a hand. Only a switch between the two explicit meanings converts anything.
  const meaning = dbLoadFor(stored, cfg)
  const st = historyAs(stored, cfg.id, meaning)
  // `plan` is kept on the entry purely so the workout can explain the number it chose.
  const plan = noProg ? { policy: 'off', kind: 'off' } : nextPrescription(st, cfg, routine)
  // The warm-up ramp and the prescription snap to the exercise's own increment (1.25 kg
  // plates exist), not the unit default; a timed exercise's `inc` is seconds, so it keeps the
  // default for its optional load.
  const step = modeOf(cfg) === 'reps' ? weightIncrement(cfg, st.unit) : defaultIncrement(cfg.id, st.unit)
  const planReps = !startsFromLast(st)
  // Warm-ups ramp over the dumbbells you own when the profile lists them (issue #376): a rung
  // lands on the heaviest bell under it, never on a weight in between that no rack holds.
  const ramp = (modeOf(cfg) === 'reps' && ownedWeightsFor(st, cfg)) || step
  // Back-off sets step down from the top set by the exercise's own step (lib/backoff.js).
  const backoffStep = modeOf(cfg) === 'reps' && backoffStepOf(cfg, st.unit) ? step : 0
  const built = applyPrescription(buildSets(st, cfg, { step: ramp, rid: routine?.id, useTarget: plan.kind === 'off', planReps }), plan, ramp, barFloor(st, cfg.id))
  const rows = backoffStep ? applyBackoff(built, backoffStep) : built
  const sets = applyIntensifierPlan(rows, cfg, dropGrid(st, cfg))
  const target = { ...cfg }
  // Stamped on the session, so the meaning it was logged with stays with it (dumbbells.js).
  if (meaning !== 'as') target.dbLoad = meaning
  if (plan.weight != null) target.weight = plan.weight
  if (plan.reps != null) target.reps = plan.reps
  if (plan.sec != null) target.sec = plan.sec
  if (plan.sets != null) target.sets = plan.sets
  // Triple progression's per-set aim (progression.js readSession grades by it). Only a session
  // whose prescription set it carries one: a config that picked one up from a copied target
  // must not have a later session graded against an old day's aims.
  if (Array.isArray(plan.rowReps)) target.rowReps = plan.rowReps
  else delete target.rowReps
  // The step the back-off sets were built with, kept on the session so reading it back
  // (progression.js readSession) holds each set to its own weight even after the plan changes.
  if (backoffStep) target.backoffStep = backoffStep
  else delete target.backoffStep
  // Rows that opened at last session's reps rather than the plan's ("Your last session", and no
  // policy that decided reps), so the workout card can say where the number came from. Written
  // only when true, and never saved with the finished workout.
  const carried = !planReps && plan.kind !== 'off' && plan.reps == null && modeOf(cfg) === 'reps'
    && rows.some(s => !isWarmupRow(s) && s.r !== cfg.reps)
  // `planned` is what the routine asked for, kept apart from the target the prescription moved,
  // so the next session can tell an edited plan from a progressed one (nextPrescription).
  return { target, plan, sets, planned: plannedOf(cfg), ...(carried ? { carried: true } : {}) }
}

/**
 * What an exercise's settings sheet opens with in a running session: the entry's target with the
 * sets and reps (the range, the seconds) its routine planned put back in place of today's.
 *
 * The sheet edits the plan. Today's target is the prescription, and a double-progression aim, a
 * bodyweight climb or a set the rep ceiling added has moved it off the plan. Opened at those
 * numbers, a save that changed nothing stamped them as the plan, and the next build read that as
 * an edit: "Plan changed", the raise undone within the session, the climb started again the next
 * time (#275). The weight stays today's, the one on the bar. An entry built before plans were
 * stamped has only its target.
 */
export function plannedConfigOf(entry) {
  const out = { ...(entry?.target || {}) }
  const planned = entry?.planned
  if (!planned) return out
  for (const key of ['sets', 'reps', 'repsMin', 'sec']) {
    if (planned[key] != null) out[key] = planned[key]
    // A plan with no range has no bottom to keep.
    else if (key === 'repsMin') delete out.repsMin
  }
  return out
}

/**
 * Whether an entry is rebuilt the way an excluded routine builds its exercises: at the routine's
 * own numbers, with no prescription (buildPlannedEntry's `noProg`).
 *
 * `entry.noProg` comes from two places. A deload or rehab routine freezes it onto every exercise
 * it starts, and those are built without a prescription. An exercise's ⋯ menu sets it by hand for
 * one session, and that only stops the session from counting: its rows stay at the prescription.
 * Read as the first kind, a hand-set flag made a rebuild (Progression settings saved, a swap) drop
 * today's 102.5 to the routine's own 60, and its Undo then let those 60 count as progress. So only
 * an entry whose routine is itself kept out is built that way.
 */
export const builtOutOfProgression = (entry, routine) => entry?.noProg === true && routine?.excludeFromProgression === true

// Returns a bare array of session entries. "Excluded from progression" is per-entry now
// (`entry.noProg`, written only when true) rather than a wrapper flag — a rehab routine merged
// into real work must exclude only its own exercises. The merge helper (lib/session-merge.js)
// stamps `entry.rid`, so the single-routine and combined paths share this builder unchanged; it
// only reads the routine's id, to start each exercise from that routine's own history (#216).
export function buildSessionEntries(st, r) {
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards.
  const noProg = r?.excludeFromProgression === true
  return (r ? r.ex : []).map(cfg => {
    const built = buildPlannedEntry(st, cfg, r, { noProg })
    return { id: cfg.id, sg: cfg.sg, ...built, ...(noProg ? { noProg: true } : {}) }
  })
}
