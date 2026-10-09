// Automatic progression (issue #17).
//
// Everything here is a pure function of the workout history. Nothing writes back into a
// finished workout: the log is what happened, and the next prescription is *derived* from
// it every time it is needed. That means changing a policy — or fixing a mistyped set —
// immediately produces the right next target, with no stored counters to drift out of sync.
//
// It replaces a single hard-coded rule ("all reps done → add 2.5") with a small set of named
// policies. The rule that applies is always visible in the app, together with the reason it
// picked this weight, because a suggestion you can't audit is one you stop trusting.
//
// Reading a session honestly is the whole game:
//   · a set checked off with at least its target reps  → hit
//   · a set checked off with fewer reps                → miss (you logged what you got)
//   · a set never checked off                          → miss (it was not performed)
//   · fewer sets than prescribed                       → miss
// So a session that fell apart can never advance the load as though it had succeeded.

import { modeOf, repStep, rerampWarmups, isBw, isPerSide, entryExcluded, entryRoutineId } from './history.js'
import { EXIDX, isAssisted, isLoadedEq, defaultIncrement } from './exercises.js'
import { isWarmupRow, isSideSet, syncSideAggregate, makeSideSet } from './workout-model.js'
import { normalizeRepRange } from './rep-range.js'
import { isPyramid } from './pyramid.js'
import { backoffAt } from './backoff.js'
import { ownedWeightsFor, ownedUp, ownedDeload, ownedAround } from './dumbbells.js'

export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'triple', 'time']

// Which policies can sensibly drive which logging mode.
export const POLICIES_FOR = {
  reps: ['off', 'linear', 'greyskull', 'double', 'triple'],
  time: ['off', 'time'],
  cardio: ['off']
}

export const POLICY_NAME = {
  off: 'No automatic progression',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  triple: 'Triple progression',
  time: 'Add time'
}
export const POLICY_DESC = {
  off: 'Targets stay where you set them.',
  linear: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
  greyskull: 'Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up (twice as much if you double the reps). One failure resets 10 %.',
  double: 'Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.',
  triple: 'Reps climb to the top of the range, then a set is added, up to your most sets. All of them at the top and the weight goes up, back to your first sets and reps.',
  time: 'Hold every set for the full duration and the target goes up.'
}

// The Epley target is a soft objective mapped onto the exercise's real load grid. Keep the
// default out of saved configs so plans written before this policy stays byte-for-byte compatible.
export const DELOAD_FACTOR = 0.9
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, triple: 3, time: 3 }
export const DELOAD_FACTOR_MIN = 0.5
export const DELOAD_FACTOR_MAX = 0.95

export function isValidDeloadFactor(value) {
  const factor = Number(value)
  return Number.isFinite(factor) && factor >= DELOAD_FACTOR_MIN && factor <= DELOAD_FACTOR_MAX
}
export function deloadFactorOf(cfg) {
  return isValidDeloadFactor(cfg?.deloadFactor) ? Number(cfg.deloadFactor) : DELOAD_FACTOR
}

// Epley uses the reps performed by one side for unilateral work. Callers pass the stored total
// reps and this helper makes the split explicit rather than allowing a total to inflate the 1RM.
export function epley1RM(weight, reps) {
  const w = Number(weight)
  const r = Number(reps)
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r < 1) return null
  const result = w * (1 + r / 30)
  return Number.isFinite(result) && result > 0 ? round1(result) : null
}
export function deloadTarget1RM(weight, reps, factor = DELOAD_FACTOR, perSide = false) {
  const base = epley1RM(weight, perSide ? Number(reps) / 2 : reps)
  const f = isValidDeloadFactor(factor) ? Number(factor) : DELOAD_FACTOR
  return base == null ? null : round1(base * f)
}

// The default load step lives in exercises.js (it reads only the catalogue), so history.js can
// use it too without importing this module; re-exported here, where every caller looks for it.
export { defaultIncrement }
// Resolve the load step for reps-mode weight controls and progression. Timed exercises use
// `inc` for seconds, so their optional weight column must not call this helper.
export function weightIncrement(cfg, unit) {
  return cfg && cfg.inc > 0 ? cfg.inc : defaultIncrement(cfg?.id, unit)
}
export const DEFAULT_SEC_INCREMENT = 5
// Where adding another set of push-ups stops being progress and starts being a way to spend
// an evening. Past this the honest advice is load or a harder variation (issue #33).
export const MAX_BW_SETS = 6

// The policy in force for one exercise: its own override, else the routine's default, else
// the mode's default. Reps keeps behaving the way the app always did (all reps → add a step).
export function policyFor(cfg, routine, mode) {
  // Pyramid sets are never progressed: the lifter picks every set's weight (CONTEXT.md).
  if (isPyramid(cfg)) return 'off'
  const m = mode || modeOf(cfg || {})
  const allowed = POLICIES_FOR[m] || ['off']
  const pick = (cfg && cfg.prog) || (routine && routine.prog) || (m === 'reps' ? 'linear' : 'off')
  return allowed.includes(pick) ? pick : 'off'
}

const round1 = v => Math.round(v * 10) / 10
// Snap to a loadable multiple of the step. Manual weight controls use this same normalization
// so fractional increments produce the same number as automatic progression.
export function snapWeight(v, step) {
  if (!(step > 0)) return round1(v)
  return round1(Math.round(v / step) * step)
}
// A tap moves by one step. Snapping to the grid keeps the number identical to what progression
// would prescribe (61.3 → 62.5 with a 1.25 step, not 62.55) — but only when the current value
// already sits on that grid; from 62.5 with a 5 kg step a tap gives 67.5, not 70.
// Add `step` to a weight the way a stepper tap does: from a weight that sits on the increment's
// grid the sum is snapped to it, from one off the grid the step is simply added. Progression
// uses the same rule (issue #175): a sled logged as 397 lb — its own weight plus plates — with
// a 10 lb step goes to 407, not to the grid's 410.
export function addStep(w, step, inc) {
  const v = +w || 0
  const onGrid = inc > 0 && Math.abs(v - Math.round(v / inc) * inc) <= 0.1
  const next = v + step
  return Math.max(0, onGrid ? snapWeight(next, inc) : round1(next))
}
export function stepWeight(value, step, direction) {
  const v = Number(value) || 0
  return addStep(v, direction * step, step)
}
// Back off by a factor, landing on something you can actually load. This remains the old policy
// used by Greyskull and timed progression; linear/double loaded reps use the Epley selector below.
export function deloadTo(cur, step, factor = DELOAD_FACTOR) {
  let next = snapWeight(cur * factor, step)
  if (next >= cur) next = snapWeight(cur - step, step)
  return Math.max(step, next)
}

const positiveGridAround = (ideal, step, maxWeight, strictLower) => {
  if (!(ideal > 0) || !(step > 0) || !(maxWeight > 0)) return []
  const low = Math.floor(ideal / step) * step
  const high = Math.ceil(ideal / step) * step
  const values = [...new Set([low, high].map(v => snapWeight(v, step)))]
  return values
    .filter(v => v > 0 && v <= maxWeight + 1e-9 && (!strictLower || v < maxWeight - 1e-9))
    .sort((a, b) => a - b)
}

/**
 * Pick a bounded load/reps pair for an Epley target. The search is deliberately lexicographic:
 * hard constraints first, then closest estimated 1RM, fewer rep changes, and greater load. That
 * makes a grid tie predictable without hiding a product decision in arbitrary score weights.
 */
// `owned`, when given, is the sorted list of weights the lifter can load (a dumbbell inventory,
// lib/dumbbells.js): candidates come from it instead of from the step's grid.
export function selectDeloadCandidate({ currentWeight, targetWeight, targetReps, step, factor = DELOAD_FACTOR, reps, repsMin, perSide = false, owned = null }) {
  const current = Number(currentWeight)
  const baseWeight = Number(targetWeight)
  const baseReps = Number(targetReps)
  const stride = perSide ? 2 : 1
  const upper = Math.max(stride, Math.ceil(baseReps / stride) * stride)
  const range = repsMin == null ? null : normalizeRepRange(reps, repsMin, stride)
  const top = range ? Math.min(range.reps, Math.max(range.repsMin, upper)) : upper
  const bottom = range ? range.repsMin : top
  const repValues = []
  for (let r = top; r >= bottom; r -= stride) repValues.push(r)
  const target1RM = deloadTarget1RM(baseWeight, upper, factor, perSide)
  if (!(current > 0) || target1RM == null || !repValues.length || !(step > 0)) return null

  const candidates = []
  repValues.forEach(candidateReps => {
    const ideal = target1RM / (1 + (perSide ? candidateReps / 2 : candidateReps) / 30)
    const allowCurrent = repsMin != null && candidateReps < upper
    const grid = owned ? ownedAround(ideal, owned, current, !allowCurrent) : positiveGridAround(ideal, step, current, !allowCurrent)
    if (allowCurrent && !grid.includes(current)) grid.push(current)
    grid.forEach(candidateWeight => {
      const epley = epley1RM(candidateWeight, perSide ? candidateReps / 2 : candidateReps)
      candidates.push({
        weight: candidateWeight,
        reps: candidateReps,
        epley,
        error: Math.abs(epley - target1RM),
        repChange: Math.abs(candidateReps - upper),
        fallback: false
      })
    })
  })

  // A tiny or below-step lift may have no positive lower grid point. Holding the actual attempted
  // load is safer than rounding it up to one step; it is an explicit, deterministic fallback.
  if (!candidates.length) {
    repValues.forEach(candidateReps => {
      const epley = epley1RM(current, perSide ? candidateReps / 2 : candidateReps)
      candidates.push({
        weight: current,
        reps: candidateReps,
        epley,
        error: Math.abs(epley - target1RM),
        repChange: Math.abs(candidateReps - upper),
        fallback: true
      })
    })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => a.error - b.error || a.repChange - b.repChange || b.weight - a.weight || b.reps - a.reps)
  return { ...candidates[0], target1RM, factor: deloadFactorOf({ deloadFactor: factor }), upper, bottom }
}

/**
 * What a routine's exercise asks for — its sets and reps (the range, under double progression;
 * the seconds, for a hold) — as stamped on every entry a session builds (`entry.planned`, issue
 * #275). A prescription moves the session's `target`; this keeps what the routine said, which
 * is the only way the next session can tell a plan that was edited from one that progressed.
 * The weight never starts one on its own — history decides it — but once the sets or reps were
 * edited, a weight edited with them is the one the new plan opens at (nextPrescription).
 */
export function plannedOf(cfg) {
  const c = cfg || {}
  const mode = modeOf(c)
  const out = { sets: Math.max(1, c.sets || 1) }
  if (mode === 'reps' && c.reps > 0) out.reps = c.reps
  if (mode === 'reps' && c.repsMin > 0) out.repsMin = c.repsMin
  if (mode === 'time' && c.sec > 0) out.sec = c.sec
  // Triple progression's set ceiling is part of the plan: raising it changes where a cycle ends.
  if (mode === 'reps' && c.setsMax > 0) out.setsMax = c.setsMax
  if (c.weight != null) out.weight = c.weight
  return out
}
// Work with no load to enter climbs in reps, then sets, when it is logged at 0: a bodyweight
// exercise, or one whose equipment is not a load of its own — an ab wheel, a stability ball, a
// bosu (isLoadedEq). Only a loaded implement logged at 0 is a weight nobody typed in. An
// assistance machine at 0 is the one exception on a stack: no help left is where its own
// progression leads (issue #232), and from there the work is a plain pull-up or dip.
const climbsReps = cfg => isBw(cfg) || !isLoadedEq(cfg.id) || isAssisted(cfg)

const PLAN_KEYS = ['sets', 'reps', 'repsMin', 'sec', 'setsMax']
const samePlan = (a, b) => PLAN_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null))
/** Did the routine's sets or reps change since the session that stamped `planned`? */
export function planChanged(planned, cfg) {
  return !!planned && !samePlan(planned, plannedOf(cfg))
}

/**
 * Reduce one finished workout entry to what a policy needs to judge it.
 *
 * Workouts only started recording their prescription in v1.2.2, so most existing history has
 * no `target` at all. Judging those against nothing would score every past session as a miss
 * — and then greet a long-standing user with "missed reps 11 sessions running, deload". So an
 * entry without its own target is judged against `fallback`, the exercise's current plan,
 * which is exactly what the app's old weight hint compared against.
 */
// The load the session is judged by. On an assistance machine less is harder, so the set that
// counts is the one with the least help — and a 0 there means "no load logged", not "best ever"
// (issue #232).
function loadOf(entry, sets) {
  const done = sets.filter(s => s.done).map(s => s.w || 0)
  if (!isAssisted(entry && entry.id ? { id: entry.id } : entry)) return Math.max(0, ...done)
  const loaded = done.filter(w => w > 0)
  return loaded.length ? Math.min(...loaded) : 0
}

export function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {}
  const mode = modeOf({ ...target, id: entry && entry.id })
  // Warm-up rows are prep, not the session: one filtered read beats guarding every consumer
  // below (an undone warm-up otherwise poisons `ok` forever and its reps drag `low`/`count`).
  const logged = ((entry && entry.sets) || []).filter(s => !isWarmupRow(s))
  // A timed per-side hold doubles its row count (buildWorkSets: one set on the plan becomes an
  // L row and an R row) — `target.sets` is still the plan's pre-doubling number, so it has to
  // double here too, or `sets` below stops after the first side's rows and the other side's
  // holds never reach `ok`/`held`/`best`.
  // Triple progression asks each set for its own reps (`target.rowReps`, issue #179): the base
  // sets climb together and an added set climbs on its own, so "12, 12, 12, 9" is one session's
  // plan. Only a session built under triple carries it; every other one reads exactly as before.
  const rowGoals = mode === 'reps' && entry && entry.target && Array.isArray(target.rowReps) && target.rowReps.length
    ? target.rowReps.map(r => Math.max(0, Number(r) || 0)) : null
  const plannedRows = rowGoals ? rowGoals.length : (target.sets || logged.length)
  const planned = mode === 'time' && isPerSide(target) ? plannedRows * 2 : plannedRows
  const enough = logged.length >= planned
  // Only the sets the plan asked for decide what happens next (issue #233). A set added on top
  // is extra work, and it used to be read as part of the prescription: one heavier bonus set
  // raised the weight for next time, and a hard one taken short of the target reps reported the
  // whole session as missed. Extra sets still count everywhere else — volume, PRs, history —
  // they just do not move the plan. The plan's own sets are the ones it laid out first, so the
  // read stops at that many; a session with fewer than planned is short either way (`enough`).
  // Only a plan the session itself carried may decide where that line falls. `target` above
  // falls back to the exercise's CURRENT config (sessionsFor hands it in), and a Hevy or CSV
  // import, or anything logged before v1.2.2, has no target of its own: slicing those to
  // today's set count reads the working weight off the warm-up end of a session nobody planned
  // that way, and the next prescription then starts again from there.
  const sets = entry && entry.target ? logged.slice(0, Math.max(1, planned)) : logged

  if (mode === 'time') {
    const goal = target.sec || 0
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0))
    return {
      mode, target, goal, held,
      weight: loadOf(entry, sets),
      best: Math.max(0, ...held),
      ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal)
    }
  }
  const goal = rowGoals ? Math.max(...rowGoals) : (target.reps || 0)
  // Back-off sets (lib/backoff.js): each planned set after the first is held to its own weight,
  // stepped down from the top set as logged. Taking a back-off set lighter to get its reps is
  // not the sequence done, so it reads like a set short of its reps. Only a session that was
  // built with back-off sets carries the step; every other session reads exactly as before.
  const step = entry && entry.target ? Number(entry.target.backoffStep) || 0 : 0
  const top = step > 0 && sets.length ? Number(sets[0].w) || 0 : 0
  const heavyEnough = (s, k) => !(top > 0) || k === 0 || (Number(s.w) || 0) >= backoffAt(top, k, step) - 0.05
  const reps = sets.map((s, k) => (s.done && heavyEnough(s, k) ? (s.r || 0) : 0))
  return {
    mode, target, goal, reps,
    weight: loadOf(entry, sets),
    count: reps.length,                                   // the dimension bodyweight work grows (#33)
    low: reps.length ? Math.min(...reps) : 0,
    amrap: reps.length ? reps[reps.length - 1] : 0,       // Greyskull's final set
    ok: goal > 0 && enough && reps.length > 0 && reps.every((r, k) => r >= (rowGoals ? rowGoals[k] ?? goal : goal))
  }
}

/**
 * Every past session for one exercise, oldest first. `fallback` — see readSession.
 *
 * With a routine id, the sessions that routine trained (issue #216): a heavy day and a light day
 * of the same lift each progress on their own line, and a combined day that holds the lift twice
 * is read by the entry that belongs to the routine, not by whichever comes first. A routine with
 * no session of its own reads the exercise's whole history instead, so a new or copied routine
 * continues from where you are. Each session carries the routine it came from (`rid`) and the
 * plan it was built from (`planned`), so the caller can tell a borrowed or outdated baseline.
 */
export function sessionsFor(S, exId, fallback, rid) {
  if (rid) {
    const own = sessionsIn(S, exId, fallback, rid)
    if (own.length) return own
  }
  return sessionsIn(S, exId, fallback, null)
}

function sessionsIn(S, exId, fallback, rid) {
  const out = []
  ;(S.workouts || []).forEach(w => {
    const entry = (w.entries || []).find(e => e && e.id === exId && (!rid || entryRoutineId(w, e) === rid))
    if (!entry) return
    // A session that does not count for this exercise cannot become the baseline for its next
    // prescription. Exclusion is per-entry now (ENG-11): a legacy whole-workout
    // `excludeFromProgression` flag still excludes every entry; a merged rehab block excludes
    // only its own. `noProg` is frozen onto the entry at build time, so later routine edits
    // never rewrite it. This is the only progression-exclusion path in the file.
    if (entryExcluded(w, entry)) return
    if (!entry.sets.some(s => s.done && !isWarmupRow(s))) return
    const slot = entryRoutineId(w, entry)
    out.push({ d: w.d, ...(slot ? { rid: slot } : {}), ...(entry.planned ? { planned: entry.planned } : {}), ...readSession(entry, fallback) })
  })
  return out
}

// --- triple progression (issue #179) ---------------------------------------------------------
//
// Reps, then sets, then load. `sets` is where a cycle starts (the base sets), `setsMax` where it
// tops out, and the rep range is double progression's (`repsMin`..`reps`). The base sets climb
// together from the bottom of the range to the top; then one set is added at the bottom and
// climbs alone to the top, then the next, until `setsMax` sets all sit at the top. Then the
// weight goes up and it starts over at the base sets and the bottom of the range:
//   3 × 8 → … → 3 × 12 → 12, 12, 12, 8 → … → 4 × 12 → … → 5 × 12 → +2.5 kg, 3 × 8
// Like everything here it is derived, never stored: each session carries the per-set aim it was
// built with (`target.rowReps`), and the next one is read off that and what was lifted.
// Without a `setsMax` above the base sets it is double progression with per-set aims.
export const MAX_TRIPLE_SETS = 10
export function tripleSetsOf(cfg) {
  const setsMin = Math.max(1, Math.round(Number(cfg?.sets)) || 1)
  const setsMax = Math.max(setsMin, Math.min(MAX_TRIPLE_SETS, Math.round(Number(cfg?.setsMax)) || setsMin))
  return { setsMin, setsMax }
}
// The per-set aim a session was asked for. A session from before triple (or a policy switch with
// no plan stamped to tell) has only its flat target: that many sets at those reps.
function tripleRowsOf(session, setsMin, setsMax, range) {
  const own = session?.target?.rowReps
  if (Array.isArray(own) && own.length) return own.map(r => Math.max(0, Number(r) || 0))
  const n = Math.min(setsMax, Math.max(setsMin, session?.target?.sets || setsMin))
  const reps = Math.min(range.reps, Math.max(range.repsMin, session?.target?.reps || session?.goal || range.repsMin))
  return Array(n).fill(reps)
}
// The number a session moves under triple progression: the weakest base set while the base sets
// climb together (all aims equal), else the set that was added last. More of it at the same
// weight is progress even when the session fell short of its aims.
function tripleActive(session) {
  const rows = session?.target?.rowReps
  const reps = session?.reps || []
  if (!Array.isArray(rows) || !rows.length) return session?.low || 0
  if (rows.every(r => r === rows[0])) return Math.min(...rows.map((_, k) => reps[k] || 0))
  return reps[rows.length - 1] || 0
}
const sameRows = (a, b) => JSON.stringify(a?.target?.rowReps || null) === JSON.stringify(b?.target?.rowReps || null)

// Checks how many sessions in a row ended in a miss, counting back from the most recent. 
// Now two things end a stall streak (besides a hit of course):
//   - A change of weight ends the streak (per pr !93). 
//     Rationale: deload should reflect the failures in sessions with weight that earned it. Not the lighter weight that follows;
//   - Under double progression, a session that beat its best at the current weight.
export function stallCount(sessions, policy) {
  let n = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].ok) break
      if (i < sessions.length -1 && sessions[i].weight !== sessions[i+1].weight) break
    // So does an edit of the plan (issue #275): misses against the old sets × reps say nothing
    // about the new ones. Only sessions that both carry their plan can show one.
    if (i < sessions.length - 1 && sessions[i].planned && sessions[i + 1].planned && !samePlan(sessions[i].planned, sessions[i + 1].planned)) break
    // Next part limits policy to double. Why? Double is the only policy that deliberately asks for less than it grades against
    // (Since it is geared towards climbing through a rep range). 
    // Specifically, `aim` (see `const aim`) climbs from the bottom of the range while `ok` needs the top. 
    // The following mechanism ensures that a beat of the best at this weight now counts as progress instead of a stall
    // Without this a wider range than two reps would lead to a deload, despite progress (since it could never reach the top within the DELOAD_AFTER))
    // Linear and greyskull remain unaffected, as they should. 
    if (policy === 'double') {
      // Following checks within scope of the current session's weight. Deliberately not every session ever done at this weight.
      // Rationale: Rebuilding after a deload must not be measured against the reps managed before the deload.
      const run = []
      for (let j = i - 1; j >= 0 && sessions[j].weight === sessions[i].weight; j--) run.push(sessions[j].low) // Checks the lowest rep count of each session in the run
      if (run.length && sessions[i].low > Math.max(...run)) break // Beating the best of the current run is progress
    }
    // Triple asks for less than the top as well, one set at a time once sets are being added, so
    // the same escape applies to the number it is moving (tripleActive), against the sessions
    // that asked for the same thing at this weight.
    if (policy === 'triple') {
      const run = []
      for (let j = i - 1; j >= 0 && sessions[j].weight === sessions[i].weight && sameRows(sessions[j], sessions[i]); j--) run.push(tripleActive(sessions[j]))
      if (run.length && tripleActive(sessions[i]) > Math.max(...run)) break
    }
    n++ // increment stall count when no escape conditions were met
  }
  return n
}

/**
 * The next prescription for one exercise.
 *
 * Returns `{ weight, reps, sec, why, kind }` — `kind` being one of
 * first | up | hold | deload | off, and `why` a translatable template + args so the app can
 * always answer "why this number?". A field the policy has no opinion on comes back
 * undefined and the caller keeps whatever the plan said — for reps, unless the profile starts
 * planned sessions from the last session, in which case the rows keep last time's (see
 * startsFromLast in session-start.js).
 */
export function nextPrescription(S, cfg, routine) {
  const mode = modeOf(cfg)
  const policy = policyFor(cfg, routine, mode)
  const unit = S.unit || 'kg'
  const inc = mode === 'time'
    ? (cfg.inc > 0 ? cfg.inc : DEFAULT_SEC_INCREMENT)
    : weightIncrement(cfg, unit)
  if (policy === 'off') return { policy, kind: 'off' }
  // An assistance machine progresses downwards: the stack carries part of your weight, so the
  // reward for a clean session is less help, and a stall means taking more (issue #232). Only
  // the direction changes — the step, the grid and the stall counting are the same.
  const assisted = isAssisted(cfg)
  // The dumbbells you own (issue #376, lib/dumbbells.js), when the profile has listed them and
  // this is a dumbbell lift: a raise goes to the next bell up (a double jump two up), a deload
  // to the owned bell nearest the deload target, and at the heaviest bell the weight holds.
  // Without a list, null, and the increment's grid decides as it always did.
  const owned = mode === 'reps' && !assisted ? ownedWeightsFor(S, cfg) : null
  const harder = (weight, step) => (assisted ? Math.max(0, addStep(weight, -step, inc))
    : owned ? ownedUp(owned, weight, step > inc ? 2 : 1) ?? weight
      : addStep(weight, step, inc))
  const easier = weight => (assisted ? addStep(weight, inc, inc) : owned ? ownedDeload(owned, weight, DELOAD_FACTOR) : deloadTo(weight, inc))
  // At the heaviest bell there is nothing to raise to: the weight holds and the line says why.
  const topped = weight => !!owned && ownedUp(owned, weight) == null
  const toppedOut = (weight, extra = {}) => ({ policy, kind: 'hold', weight, ...extra, why: ['You’ve outgrown the rack: {0} {1} is your heaviest dumbbell, so the weight stays.', weight, unit] })


  // The routine's own sessions of this exercise, or the exercise's whole history when the
  // routine has none yet (issue #216) — see sessionsFor.
  const sessions = sessionsFor(S, cfg.id, cfg, routine?.id).filter(s => s.mode === mode)
  const last = sessions[sessions.length - 1]
  // Triple progression starts a cycle at the base sets and the bottom of the range, so its first
  // session does too; the weight is still the plan's.
  const triple = policy === 'triple' && mode === 'reps'
  const range3 = triple ? normalizeRepRange(cfg.reps || 10, cfg.repsMin, repStep(cfg)) : null
  const sets3 = triple ? tripleSetsOf(cfg) : null
  const startRows = reps => Array(sets3.setsMin).fill(reps)
  if (!last) {
    if (triple) return { policy, kind: 'first', reps: range3.repsMin, sets: sets3.setsMin, rowReps: startRows(range3.repsMin), why: ['Nothing logged yet, so this session sets the baseline.'] }
    return { policy, kind: 'first', why: ['Nothing logged yet, so this session sets the baseline.'] }
  }

  // Start again from the plan (issue #275) when the last session was built from a different one:
  // the routine's sets or reps were edited since, or the session is borrowed from another routine
  // (this one has none of its own yet, see sessionsFor) whose plan was not this one's. Its
  // numbers were judged against the old target, so they cannot say where the new one stands —
  // a bodyweight goal climbing from the old count, or a deload aimed at reps and sets the
  // routine no longer asks for. The sets and reps are the routine's own (double progression aims
  // inside its new range, from what you managed).
  // A borrowed session saved before plans were stamped is taken as a different plan.
  const borrowed = !!routine?.id && last.rid !== routine.id
  if (last.planned ? planChanged(last.planned, cfg) : borrowed) {
    const why = borrowed ? ['First time in this routine, so starting from its own target.'] : ['Plan changed, so starting from your new target.']
    // The weight holds at what was last lifted, unless the plan's own weight is not the one the
    // session was built from: the same edit that turned 3 × 5 @ 100 into 3 × 10 @ 70 set 70,
    // and 102.5 × 10 is a load never lifted for those reps. A routine whose weight nobody
    // touched still carries the one it was created with, so there the history decides.
    const set = cfg.weight > 0 && last.planned && (last.planned.weight ?? null) !== cfg.weight ? { weight: cfg.weight } : null
    if (mode === 'time') return { policy, kind: 'hold', ...set, sec: cfg.sec || last.goal || undefined, why }
    if (!set && last.weight <= 0 && climbsReps(cfg)) return { policy, kind: 'hold', weight: 0, reps: cfg.reps || undefined, why }
    // A loaded lift logged at 0 had no weight typed in (see below): the plan's, if it has one.
    const held = set || (last.weight > 0 ? { weight: last.weight } : cfg.weight > 0 ? { weight: cfg.weight } : {})
    if (triple) {
      // The base sets, at the reps managed (as double progression aims), or the bottom with a
      // new weight. Sets added under the old plan say nothing about the new set range.
      const aim = set ? range3.repsMin : Math.min(range3.reps, Math.max(range3.repsMin, last.low + repStep(cfg)))
      return { policy, kind: 'hold', ...held, reps: aim, sets: sets3.setsMin, rowReps: startRows(aim), why }
    }
    if (policy === 'double') {
      const range = normalizeRepRange(cfg.reps || last.goal || 10, cfg.repsMin, repStep(cfg))
      // A new weight starts at the bottom of the range, the way a raise does: the reps managed
      // were managed at another load.
      const aim = set ? range.repsMin : Math.min(range.reps, Math.max(range.repsMin, last.low + repStep(cfg)))
      return { policy, kind: 'hold', ...held, reps: aim, why }
    }
    return { policy, kind: 'hold', ...held, reps: cfg.reps || undefined, why }
  }

  const stalls = stallCount(sessions, policy)
  const deloadAt = DELOAD_AFTER[policy] || 3

  if (mode === 'time') {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + inc
      return { policy, kind: 'up', sec, why: ['Held every set for the full time. Target goes up by {0}s.', inc] }
    }
    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5)
      return { policy, kind: 'deload', sec, why: ['Short {0} sessions in a row. Back off to {1}s and build up again.', stalls, sec] }
    }
    return { policy, kind: 'hold', sec: last.goal || cfg.sec, why: ['Came up short last time. Same target again.'] }
  }

  const w = last.weight
  // Bodyweight work carries no external load, so there is nothing to add or take away —
  // "deload your push-ups to 2.5 kg" is not advice. Progress in reps instead. This runs ahead
  // of the individual policies because it is true for all of them. The trigger is work with no
  // load to enter logged without one (climbsReps): a dip done with a belt has a load to progress
  // and belongs on the normal policies.
  if (w <= 0 && climbsReps(cfg)) {
    const goal = last.goal || cfg.reps || 0
    // The set count this has reached: the plan's, or more once the ceiling below added sets.
    // Read off the last session's target, or the added set lasted one session and the next
    // clean one dropped back to the plan's count (issue #33 means it to stay). Only a session
    // that stamped its plan can say so — this plan, or it would have restarted above. An older
    // one's target may hold a set count from a plan cut since, and it would be kept for good.
    const planSets = Math.max(1, cfg.sets || 1)
    const reached = last.planned ? Math.max(planSets, (last.target && last.target.sets) || 0) : planSets
    const keep = reached > planSets ? { sets: reached } : {}
    if (!last.ok || goal <= 0) return { policy, kind: 'hold', weight: 0, reps: goal || undefined, ...keep, why: ['Bodyweight: same target again until every set is clean.'] }
    // A ceiling turns "+1 rep forever" into a plan (issue #33). Past the top of the range the
    // reps go back to the bottom and a set is added instead, which is how bodyweight work
    // actually progresses once a set of 30 push-ups stops being a strength stimulus.
    const top = cfg.repsMax > 0 ? cfg.repsMax : 0
    if (top > 0 && goal >= top) {
      const sets = reached + 1
      const bottom = Math.max(1, Math.min(cfg.reps || top, top))
      if (sets <= MAX_BW_SETS) return { policy, kind: 'up', weight: 0, reps: bottom, sets, why: ['{0} reps in every set! Add a set and go back to {1}.', goal, bottom] }
      // Out of sets worth adding: more volume is no longer the answer, load or a harder
      // variation is — and that is a decision for a person, not a policy.
      return { policy, kind: 'hold', weight: 0, reps: goal, ...keep, why: ['{0} sets of {1}. Time to add weight or try a harder variation.', sets - 1, goal] }
    }
    // Unilateral work steps by two, so the total stays even and both sides get the rep.
    const next = goal + repStep(cfg)
    return { policy, kind: 'up', weight: 0, reps: next, ...keep, why: ['Bodyweight: every rep last time, so go for {0} this time.', next] }
  }
  // A loaded lift logged at 0 had its weight never typed in — a quick-added exercise starts at
  // 0 kg. Climbing its reps as though it were a push-up turned a 2 × 10 bench into 2 × 11, 12…
  // There is nothing to progress from, so it asks for the weight: the plan's, when it has one.
  // Only a bar, a bell, a stack or a sled gets here; an ab wheel at 0 climbed reps above.
  if (w <= 0) return { policy, kind: 'hold', ...(cfg.weight > 0 ? { weight: cfg.weight } : {}), why: ['No weight logged last time. Enter what you lift and progression takes it from there.'] }

  // Epley deloads apply only to externally loaded rep work. Keep the prescribed target from the
  // session that stalled (falling back field-by-field to the current config), while the logged
  // weight remains the hard upper bound for the selected candidate.
  const epleyDeload = () => {
    // Epley reads load as the work done; on an assistance machine it is the work taken away.
    if (assisted) return null
    if (mode !== 'reps' || (policy !== 'linear' && policy !== 'double')) return null
    const previous = last.target || {}
    const target = {
      ...cfg,
      ...previous,
      weight: previous.weight ?? cfg.weight,
      reps: previous.reps ?? cfg.reps,
      repsMin: previous.repsMin ?? cfg.repsMin,
      // The sets are always the plan's: a loaded lift never gets a set count from progression,
      // so an older one here can only be a plan since edited — and would grow the session back.
      sets: cfg.sets ?? previous.sets,
      bodyweight: previous.bodyweight ?? cfg.bodyweight,
      side: previous.side ?? cfg.side,
      intensifier: previous.intensifier ?? cfg.intensifier
    }
    // Rest-pause rows have burst reps rather than an independent rep prescription. Warm-up rows
    // are already removed by readSession; bodyweight (including added-weight bodyweight) stays
    // on the ordinary non-load progression path.
    if (isBw(target) || target.intensifier?.type === 'restpause') return null
    const candidate = selectDeloadCandidate({
      currentWeight: w,
      targetWeight: target.weight,
      targetReps: target.reps,
      step: inc,
      factor: deloadFactorOf(cfg),
      reps: target.reps,
      repsMin: policy === 'double' ? target.repsMin : undefined,
      perSide: isPerSide(target),
      owned
    })
    if (!candidate) return null
    const held = candidate.weight >= w
    return {
      policy,
      kind: 'deload',
      weight: candidate.weight,
      reps: candidate.reps,
      sets: target.sets,
      target1RM: candidate.target1RM,
      deloadFactor: candidate.factor,
      why: held
        ? ['Stuck for {0} sessions. Hold {1} {2} and use {3} reps.', stalls, candidate.weight, unit, candidate.reps]
        : ['Stuck for {0} sessions. Epley deload to {1} {2} for {3} reps.', stalls, candidate.weight, unit, candidate.reps]
    }
  }

  if (triple) {
    const top = range3.reps
    const bottom = range3.repsMin
    const { setsMin, setsMax } = sets3
    const step = repStep(cfg)
    const rows = tripleRowsOf(last, setsMin, setsMax, range3)
    const out = (kind, weight, next, why) => ({ policy, kind, weight, reps: next[0], sets: next.length, rowReps: next, why })
    if (stalls >= deloadAt) {
      // Back to the start of a cycle at a lighter load. Epley picks it: the estimated max from
      // the stalled session's top aim, less the deload factor, at the bottom of the range, on
      // the weight grid and below what was lifted. An assistance machine takes more help instead.
      let dw = null
      if (!assisted) {
        const perSide = isPerSide(cfg)
        const target1RM = deloadTarget1RM(w, Math.max(...rows), deloadFactorOf(cfg), perSide)
        const ideal = target1RM == null ? null : target1RM / (1 + (perSide ? bottom / 2 : bottom) / 30)
        const grid = ideal == null ? [] : positiveGridAround(ideal, inc, w, true)
        if (grid.length) dw = grid.reduce((a, b) => (Math.abs(b - ideal) < Math.abs(a - ideal) ? b : a))
      }
      if (dw == null) dw = easier(w)
      return out('deload', dw, startRows(bottom), assisted
        ? ['Stuck for {0} sessions. Back to {1} {2} of help, start again at {3} sets of {4}.', stalls, dw, unit, setsMin, bottom]
        : ['Stuck for {0} sessions. Deload to {1} {2} and start again at {3} sets of {4}.', stalls, dw, unit, setsMin, bottom])
    }
    // Short of the aims: the same sets and reps again. Unlike double progression nothing is cut,
    // and an added set is not taken away; more reps than before still counts (stallCount).
    if (!last.ok) return out('hold', w, rows, stalls === 0
      ? ['Short of the target, but more reps than before. Same sets and reps again.']
      : ['Missed reps last time. Same sets and reps again ({0} of {1} to go).', deloadAt - stalls, deloadAt])
    // Hit: read on from what was lifted, capped at the top, so reps beyond the aim count.
    const got = rows.map((r, k) => Math.min(top, Math.max(r, last.reps[k] || 0)))
    const climb = v => Math.min(top, Math.max(bottom, v + step))
    const n = got.length
    const baseLow = Math.min(...got.slice(0, Math.min(n, setsMin)))
    if (n <= setsMin && baseLow < top) {
      const aim = climb(baseLow)
      return out('hold', w, Array(Math.max(n, setsMin)).fill(aim), ['Same weight, aim for {0} reps in every set.', aim])
    }
    const active = got[n - 1]
    if (n > setsMin && active < top) {
      const aim = climb(active)
      return out('hold', w, [...got.slice(0, n - 1).map(() => top), aim], ['Same weight, aim for {0} reps on the last set.', aim])
    }
    if (n < setsMax) return out('up', w, [...got.map(() => top), bottom], ['{0} reps in every set! Add a set at {1} reps.', top, bottom])
    return out('up', harder(w, inc), startRows(bottom), assisted
      ? ['Top of the range on all {0} sets. {1} {2} less help, back to {3} sets of {4}.', n, inc, unit, setsMin, bottom]
      : ['Top of the range on all {0} sets. {1} {2} more, back to {3} sets of {4}.', n, inc, unit, setsMin, bottom])
  }

  if (policy === 'double') {
    const range = normalizeRepRange(cfg.reps || last.goal || 10, cfg.repsMin, repStep(cfg))
    const top = range.reps
    const bottom = range.repsMin
    // `last.ok` only means "matched whatever was recorded as this session's target" - and that
    // target can sit below the top of the range: the bottom stamped after a raise, or a count
    // from before the exercise moved to double progression. Hitting it is compliance with that
    // session, not "reached the top". Double progression must not add weight until every set
    // actually reaches the top of the range (issue #278).
    if (last.ok && last.low >= top) {
      if (topped(w)) return toppedOut(w, { reps: top })
      const up = harder(w, inc)
      // Over owned bells the step is whatever the next one is: 9 → 11 is 2 kg, 18 → 19 is 1.
      const by = owned ? Math.round((up - w) * 100) / 100 : inc
      return {
        policy, kind: 'up', weight: up, reps: bottom,
        why: assisted
          ? ['Top of the rep range in every set. {0} {1} less help, back to {2} reps.', inc, unit, bottom]
          : ['Top of the rep range in every set. {0} {1} more, back to {2} reps.', by, unit, bottom]
      }
    }
    if (stalls >= deloadAt) {
      const selected = epleyDeload()
      if (selected) return selected
      const dw = easier(w)
      return {
        policy, kind: 'deload', weight: dw, reps: bottom,
        why: assisted
          ? ['Stuck for {0} sessions. Back to {1} {2} of help, then build up again.', stalls, dw, unit]
          : ['Stuck for {0} sessions. Deload to {1} {2}.', stalls, dw, unit]
      }
    }
    const aim = Math.min(top, Math.max(bottom, last.low + repStep(cfg)))
    return { policy, kind: 'hold', weight: w, reps: aim, why: ['Same weight, aim for {0} reps this time.', aim] }
  }

  // linear + greyskull
  if (last.ok) {
    // Greyskull's final set is taken to failure: double the target reps there and you have
    // earned a double jump.
    const dbl = policy === 'greyskull' && last.goal > 0 && last.amrap >= last.goal * 2
    if (topped(w)) return toppedOut(w)
    const up = harder(w, dbl ? inc * 2 : inc)
    // Over owned bells the jump is the distance to the bell it lands on.
    const step = owned ? Math.round((up - w) * 100) / 100 : dbl ? inc * 2 : inc
    return {
      policy, kind: 'up', weight: up,
      why: dbl
        ? ['Last set hit {0} reps, twice the target! Take a double jump of {1} {2}.', last.amrap, step, unit]
        : assisted
          ? ['Every rep last time. {0} {1} less help.', step, unit]
          : ['Every rep last time. {0} {1} more.', step, unit]
    }
  }
  if (stalls >= deloadAt) {
    const selected = epleyDeload()
    if (selected) return selected
    const dw = easier(w)
    return {
      policy, kind: 'deload', weight: dw,
      why: assisted
        ? ['Missed reps. {0} {1} of help while you build back up.', dw, unit]
        : stalls > 1
          ? ['Missed reps {0} sessions running. Reset to {1} {2} and work back up.', stalls, dw, unit]
          : ['Missed reps. Reset to {0} {1} and work back up.', dw, unit]
    }
  }
  return { policy, kind: 'hold', weight: w, why: ['Missed reps last time. Same weight again ({0} of {1} to go).', deloadAt - stalls, deloadAt] }
}

/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet. `floor` is the lift's bar
 * (history.js barFloor), which the re-ramped warm-ups never go under.
 */
export function applyPrescription(sets, p, step = 2.5, floor = 0) {
  // A first session has nothing to prescribe from, except triple progression's start of a cycle.
  if (!p || p.kind === 'off' || (p.kind === 'first' && !p.rowReps)) return sets
  const out = sets.map(s => {
    // Never rewrite a logged set (a ticked warm-up falling through here would be the data-loss
    // the cascade fix removed, two files over). The prescription speaks to the work rows; an
    // open warm-up only follows the reps or the hold it settled on, because insertWarmupRow
    // copied those from the work row before the policy had spoken. Its weight is re-ramped last.
    if (s.done) return s
    if (isWarmupRow(s)) {
      if (p.reps != null && s.r != null) return { ...s, r: p.reps }
      if (p.sec != null && s.sec != null) return { ...s, sec: p.sec }
      return s
    }
    if (isSideSet(s)) {
      const sides = Object.fromEntries(['L', 'R'].map(side => {
        const row = s.sides[side]
        return [side, row.done ? row : { ...row,
          ...(p.weight != null ? { w: p.weight } : {}),
          ...(p.reps != null ? { r: p.reps / 2 } : {}),
        }]
      }))
      return syncSideAggregate({ ...s, sides })
    }
    const o = { ...s }
    if (p.weight != null) o.w = p.weight
    if (p.reps != null) o.r = p.reps
    if (p.sec != null) o.sec = p.sec
    return o
  })
  // A policy that decided on a set count gets to grow the list — bodyweight progression adds
  // a set where a barbell would have added a plate. Only ever upwards, and only by copying a
  // row that is already there: a session in progress must not lose a set it has logged.
  const workRows = out.filter(s => !isWarmupRow(s))
  if (p.sets > workRows.length) {
    // An all-warm-up entry has no work row to seed growth from - growing warm-up copies
    // would both invent work and never terminate the loop. Leave the entry untouched.
    if (!workRows.length) return rerampWarmups(out, step, floor)
    const seed = workRows[workRows.length - 1]
    // A freshly appended row hasn't been performed, so it never inherits a seed's already-
    // logged drops/clusters — that would invent extra work the row never actually did. Its
    // `type` is kept: that's the exercise's plan (every set is a drop-set/rest-pause), not
    // something this particular row logged.
    const { drops, clusters, ...plainSeed } = seed
    while (out.filter(s => !isWarmupRow(s)).length < p.sets) {
      out.push(isSideSet(seed) ? makeSideSet({
        w: p.weight ?? seed.w, r: p.reps ?? seed.r,
      }) : { ...plainSeed, done: false })
    }
  }
  // Triple progression's per-set aims, one per open work row in order (the rows grown above
  // included). A logged row keeps what it logged.
  if (Array.isArray(p.rowReps)) {
    let k = -1
    for (let i = 0; i < out.length; i++) {
      if (isWarmupRow(out[i])) continue
      k++
      const r = p.rowReps[k]
      if (out[i].done || !(r > 0)) continue
      out[i] = isSideSet(out[i])
        ? syncSideAggregate({ ...out[i], sides: Object.fromEntries(['L', 'R'].map(side => [side, out[i].sides[side].done ? out[i].sides[side] : { ...out[i].sides[side], r: r / 2 }])) })
        : { ...out[i], r }
    }
  }
  // Last, because the work rows now carry their final weight: the warm-up block ramps toward
  // what you are actually about to lift, not toward what you lifted last time.
  return rerampWarmups(out, step, floor)
}
