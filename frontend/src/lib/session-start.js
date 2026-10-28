// How a session's exercise entries are built from a routine. Shared by the live start and by
// "log a past workout", which is the same screen pointed at another day — both must walk up
// to identical entries, or the two paths drift apart the first time a prescription rule changes.
// Imports both history.js and progression.js (which itself imports history.js); nothing in
// either imports this file, so there is no cycle.
import { buildSets, applyIntensifierPlan, modeOf, barFloor, isBw, lastEntryFor, insertWarmupRow } from './history.js'
import { isWarmupRow, isSideSet, syncSideAggregate } from './workout-model.js'
import { nextPrescription, applyPrescription, defaultIncrement, weightIncrement, plannedOf, deloadTo, DELOAD_FACTOR, policyFor } from './progression.js'
import { dropGrid } from './plates.js'
import { backoffStepOf, applyBackoff } from './backoff.js'
import { dbLoadFor, historyAs, ownedWeightsFor, withMeaning } from './dumbbells.js'
import { isAssisted } from './exercises.js'
import { sessionHistory } from './backfill.js'
import { programmeSlot, pctWeight } from './programmes.js'
import { todayISO } from './format.js'
import { exConverted, exView, viewTarget, storedTarget, storedRow } from './ex-unit.js'

/**
 * Where a planned session's reps come from (Settings → During a workout). 'plan', the default:
 * the routine's own sets × reps, with history and the progression policy deciding the weight —
 * and a policy that moves reps (double progression, bodyweight, a timed hold) still moving them
 * from there. 'last': the reps you logged last time, the way every planned session opened before
 * this setting existed. A profile saved before it, or one that never chose, reads as 'plan'.
 *
 * An exercise whose progression is off has no prescription, so its rows open at the routine's own
 * weight and reps. 'last' sends those to last time's weight and reps too (the weight as well as
 * the reps, since no policy is there to decide it). A deload or rehab routine (`noProg`) keeps the
 * routine's numbers.
 */
export const startsFromLast = st => st?.startFrom === 'last'

/**
 * One carried warm-up row: the load and reps (or duration) the last session logged, reset for
 * the new one. Nothing else survives — not done, not effort, not the tick time, not drops or
 * bursts. A per-side row keeps each side's own numbers and resyncs its aggregate. `edited`
 * stays, so a warm-up you set by hand is carried again next time.
 */
const carriedWarmupRow = (row, mode) => {
  if (isSideSet(row)) {
    const side = s => ({ w: Number(s?.w) || 0, r: Number(s?.r) || 0, done: false })
    return syncSideAggregate({ phase: 'warmup', warmup: true, edited: true, sides: { L: side(row.sides.L), R: side(row.sides.R) } })
  }
  if (mode === 'time') return { sec: row.sec, w: Number(row.w) || 0, done: false, phase: 'warmup', warmup: true, edited: true }
  return { w: Number(row.w) || 0, r: Number(row.r) || 0, done: false, phase: 'warmup', warmup: true, edited: true }
}

/**
 * Puts a carried warm-up block in front of the finished work rows. Only the rows you set by hand
 * (`edited`, lib/workout-model.js markWarmupEdited) keep last time's numbers; an automatic rung in
 * the block is built again with insertWarmupRow, so it still ramps toward today's work weight
 * instead of freezing at the one it was made for. The block's length is last time's.
 */
function withCarriedWarmups(rows, carry, mode, cfg, step, floor) {
  let out = rows
  for (const row of carry) {
    if (!row.edited) { out = insertWarmupRow(out, mode, cfg, step, floor); continue }
    const at = out.findIndex(x => !isWarmupRow(x))
    out = at === -1 ? [...out, carriedWarmupRow(row, mode)] : [...out.slice(0, at), carriedWarmupRow(row, mode), ...out.slice(at)]
  }
  return out
}

/**
 * The warm-up block "Your last session" carries into a planned build (#525), or null when
 * there is nothing to carry — no last entry, no warm-up rows in it, or rows that no longer fit
 * the exercise's mode (a rep count for an exercise that is timed now, or none for one that is
 * reps now). Null means the ramp is built from the routine's `warmupSets` exactly as before.
 * A block with no row set by hand is an automatic ramp, so that is null too: carrying it would
 * freeze the first session's 50/75% rungs while the work weight climbs, and the routine's own
 * warm-up count would stop mattering. Rows from before the `edited` mark read as automatic.
 */
function carriedWarmups(st, cfg, routine, noProg) {
  if (!startsFromLast(st) || noProg || cfg.intensifier?.type === 'restpause') return null
  const mode = modeOf(cfg)
  // Progression switched off (its own choice, or a pyramid's) builds warm-ups from the
  // routine as before. A timed exercise's only policy is 'off', so the gate is reps-only.
  if (mode !== 'time' && (mode === 'cardio' || policyFor(cfg, routine, mode) === 'off')) return null
  const rows = lastEntryFor(st, cfg.id, routine?.id)?.warmups || []
  if (!rows.some(row => row.edited)) return null
  const fits = row => (mode === 'time' ? row.sec > 0 : isSideSet(row) || row.r > 0)
  return rows.every(fits) ? rows : null
}

/**
 * One planned exercise, built the way a session builds it: the prescription, the rows it opens
 * with and the target it is judged against. The session start, a mid-session edit of the
 * exercise, and an exercise added to or swapped into a planned session all build through here,
 * so an entry cannot come out differently depending on where it was made. `routine` is the one
 * the exercise is planned in: its own history comes first (#216) and its policy applies.
 * `noProg` builds the routine's own numbers with no prescription, as an excluded routine does.
 */
export function buildPlannedEntry(stored, cfg, routine, opts) {
  return inExUnit(stored, cfg, (st, c) => planEntry(st, c, routine, opts))
}

function planEntry(stored, cfg, routine, { noProg = false } = {}) {
  // What a dumbbell weight means for this exercise today (lib/dumbbells.js): the history it
  // progresses from is read in that meaning, so a switch from "40 total" to per bell opens at
  // 20, not at 40 a hand. Only a switch between the two explicit meanings converts anything.
  const meaning = dbLoadFor(stored, cfg)
  const st = historyAs(stored, cfg.id, meaning)
  // `plan` is kept on the entry purely so the workout can explain the number it chose.
  let plan = noProg ? { policy: 'off', kind: 'off' } : nextPrescription(st, cfg, routine)
  // The warm-up ramp and the prescription snap to the exercise's own increment (1.25 kg
  // plates exist), not the unit default; a timed exercise's `inc` is seconds, so it keeps the
  // default for its optional load.
  const step = modeOf(cfg) === 'reps' ? weightIncrement(cfg, st.unit) : defaultIncrement(cfg.id, st.unit)
  // A running programme's target for this exercise this week (lib/programmes.js) replaces the
  // policy's prescription: the weight from the %1RM, the reps from the routine, so neither the
  // policy nor "Your last session" moves numbers the programme set.
  const slot = noProg ? null : programmeSlot(stored, routine?.id, cfg.id, stored?.active?.d || todayISO())
  const policyKind = plan.kind
  if (slot) plan = programmePlan(st, cfg, plan, slot, step)
  const planReps = !startsFromLast(st) || plan.kind === 'programme'
  const fromLast = !noProg && policyKind === 'off' && !slot && startsFromLast(st)
  // Warm-ups ramp over the dumbbells you own when the profile lists them (issue #376): a rung
  // lands on the heaviest bell under it, never on a weight in between that no rack holds.
  const ramp = (modeOf(cfg) === 'reps' && ownedWeightsFor(st, cfg)) || step
  // Back-off sets step down from the top set by the exercise's own step (lib/backoff.js).
  const backoffStep = modeOf(cfg) === 'reps' && backoffStepOf(cfg, st.unit) ? step : 0
  // Warm-ups carried from the last session ("Your last session") are final: they go in front
  // AFTER the prescription, back-off and intensifier steps, none of which may rewrite them.
  const warmCarry = carriedWarmups(st, cfg, routine, noProg)
  const built = applyPrescription(buildSets(st, warmCarry ? { ...cfg, warmupSets: 0 } : cfg, { step: ramp, rid: routine?.id, useTarget: policyKind === 'off' && !fromLast, planReps }), plan, ramp, barFloor(st, cfg.id), isAssisted(cfg))
  const rows = backoffStep ? applyBackoff(built, backoffStep) : built
  const shaped = applyIntensifierPlan(rows, cfg, dropGrid(st, cfg))
  const sets = warmCarry ? withCarriedWarmups(shaped, warmCarry, modeOf(cfg), cfg, ramp, barFloor(st, cfg.id)) : shaped
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
  // An exercise with progression off that opened at last time's numbers (fromLast) says so too.
  const carried = !planReps && (plan.kind !== 'off' || fromLast) && plan.reps == null && modeOf(cfg) === 'reps'
    && rows.some(s => !isWarmupRow(s) && s.r !== cfg.reps)
  // `planned` is what the routine asked for, kept apart from the target the prescription moved,
  // so the next session can tell an edited plan from a progressed one (nextPrescription).
  return { target, plan, sets, planned: plannedOf(cfg), ...(carried ? { carried: true } : {}), ...(slot?.deload ? { deload: true } : {}) }
}

// An exercise with a weight unit of its own (#657, lib/ex-unit.js) is built in that unit: on the
// state as it sees it, so the progression's step, the warm-up ramp, the plates and a programme's
// %1RM land on that unit's grid. What comes out is stored back in the profile's unit, the
// numbers of the config it was built from kept as they were.
function inExUnit(stored, cfg, build) {
  const id = cfg?.id
  if (!exConverted(stored, id)) return build(stored, cfg)
  const out = build(exView(stored, id), viewTarget(stored, id, cfg))
  return {
    ...out,
    target: storedTarget(stored, id, out.target, cfg),
    ...(out.planned ? { planned: storedTarget(stored, id, out.planned, plannedOf(cfg)) } : {}),
    sets: (out.sets || []).map(s => storedRow(stored, id, s)),
  }
}

/**
 * The prescription a programme's target makes of the policy's (buildPlannedEntry). A %1RM with an
 * estimate to take it from sets the weight; without one (a first session, a body-weight lift) the
 * policy's weight stands. A deload week without a %1RM takes the policy's weight down by the
 * deload factor. The reps and sets are left to the routine, the RPE rides along to be shown.
 */
export function programmePlan(st, cfg, plan, slot, step) {
  const reps = modeOf(cfg) === 'reps' && !isBw(cfg) && !isAssisted(cfg)
  const owned = reps ? ownedWeightsFor(st, cfg) : null
  let weight = reps && slot.pct != null ? pctWeight(st, cfg.id, slot.pct, { step, owned, floor: barFloor(st, cfg.id) }) : null
  if (weight == null && slot.deload && reps) {
    const base = plan.weight ?? cfg.weight
    if (base > 0) weight = deloadTo(base, step, DELOAD_FACTOR)
  }
  const why = [slot.pct != null && weight != null ? 'Week {0} of {1}: {2}% of your best 1RM' : slot.deload ? 'Week {0} of {1}: deload week' : 'Week {0} of {1}',
    slot.week, slot.weeks, slot.pct]
  return {
    policy: plan.policy, kind: 'programme', why,
    // Without a weight of its own the policy's stands, so the weight still moves as it would have.
    ...(weight != null ? { weight } : plan.weight != null ? { weight: plan.weight } : {}),
    prog: { week: slot.week, weeks: slot.weeks, ...(slot.pct != null ? { pct: slot.pct } : {}), ...(slot.rpe != null ? { rpe: slot.rpe } : {}), ...(slot.deload ? { deload: true } : {}) },
  }
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

/**
 * An exercise added to or swapped into a running session, beside `slot`. A planned slot builds
 * it the way its routine would; freestyle reproduces what you did last time, so swapping barbell
 * for dumbbell bench does not start you at an empty bar. Read from before the session's day when
 * it is logged into the past (sessionHistory).
 */
export function buildSessionEntry(st, id, cfg, routine, slot) {
  const full = { ...cfg, id }
  const past = sessionHistory(st)
  if (routine) return buildPlannedEntry(past, full, routine, { noProg: builtOutOfProgression(slot, routine) })
  return inExUnit(st, full, v => freestyleEntry(v, id, viewTarget(st, id, cfg)))
}

function freestyleEntry(st, id, cfg) {
  const full = { ...cfg, id }
  const past = sessionHistory(st)
  // Freestyle stamps the meaning of a dumbbell weight and reads last time in it, the way
  // buildPlannedEntry does for a planned exercise (lib/dumbbells.js).
  const step = modeOf(full) === 'reps' ? (ownedWeightsFor(st, full) || weightIncrement(full, st.unit)) : defaultIncrement(id, st.unit)
  return { target: withMeaning(st, cfg, id), plan: null, sets: applyIntensifierPlan(buildSets(historyAs(past, id, dbLoadFor(st, full)), full, { step, preferLast: true }), full, dropGrid(st, full)) }
}

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
    const { deload, ...built } = buildPlannedEntry(st, cfg, r, { noProg })
    // A programme's deload week stays out of progression, as a deload routine does.
    return { id: cfg.id, sg: cfg.sg, ...built, ...(noProg || deload ? { noProg: true } : {}) }
  })
}
