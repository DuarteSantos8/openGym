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

import { modeOf, repStep, rerampWarmups, isBw, isPerSide, entryExcluded } from './history.js'
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { normalizeRepRange } from './rep-range.js'
import { best1RM } from './onerm.js'

export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time', 'wave']

// Which policies can sensibly drive which logging mode.
export const POLICIES_FOR = {
  reps: ['off', 'linear', 'greyskull', 'double', 'wave'],
  time: ['off', 'time'],
  cardio: ['off']
}

export const POLICY_NAME = {
  off: 'No automatic progression',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  time: 'Add time',
  wave: 'Percentage wave'
}
export const POLICY_DESC = {
  off: 'Targets stay where you set them.',
  linear: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
  greyskull: 'Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up — double if you double the reps. One failure resets 10 %.',
  double: 'Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.',
  time: 'Hold every set for the full duration and the target goes up.',
  wave: 'Every set is a percentage of a training max you set yourself, run as a cycle of stages. Finish the last stage and the training max goes up; miss one and you run it again.'
}

// The Epley target is a soft objective mapped onto the exercise's real load grid. Keep the
// default out of saved configs so plans written before this policy stays byte-for-byte compatible.
export const DELOAD_FACTOR = 0.9
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, time: 3 }
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

// Body parts where a 5 kg jump is normal rather than brutal.
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes']

// Default load step. Lower-body lifts take the bigger jump — that is the "lift-specific
// increment" a linear program lives on; an exercise can override it with cfg.inc.
export function defaultIncrement(exId, unit) {
  const ex = EXIDX[exId]
  const heavy = ex && HEAVY_BP.includes(ex.bp)
  if (unit === 'lb') return heavy ? 10 : 5
  return heavy ? 5 : 2.5
}
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
export function stepWeight(value, step, direction) {
  const v = Number(value) || 0
  const onGrid = step > 0 && Math.abs(v - Math.round(v / step) * step) <= 0.1
  const next = v + direction * step
  return Math.max(0, onGrid ? snapWeight(next, step) : round1(next))
}
// Back off by a factor, landing on something you can actually load. This remains the old policy
// used by Greyskull and timed progression; linear/double loaded reps use the Epley selector below.
export function deloadTo(cur, step, factor = DELOAD_FACTOR) {
  let next = snapWeight(cur * factor, step)
  if (next >= cur) next = snapWeight(cur - step, step)
  return Math.max(step, next)
}

/* -------------------------------- percentage waves -------------------------------- */
// A "wave" is a stored list of stages; each stage is an ordered list of SetBlocks — a block is
// a prescriptive group of identical working sets given as `sets × reps @ pct` of a base (a
// training max, or the estimated 1RM). 5/3/1 is the template this ships with, but nothing below
// knows about Wendler: any scheme that is "a sequence of stages, a fixed base bump when the
// cycle closes, repeat the stage on a miss" is expressible as data — DUP, hold stages, block
// peaking — which is why this is one policy and not five.
//
// A block's `role` is never stored: it is derived every time a stage is normalised (the last
// non-warmup block is the stage's `anchor`, everything else is `required`). That keeps the
// stage-matching signal below explicit — an anchor, not an inferred "heaviest percentage" —
// without needing an editor UI for it yet; nothing currently writes any other role.
export const DEFAULT_WAVE = [
  { blocks: [{ pct: 65, reps: 5 }, { pct: 75, reps: 5 }, { pct: 85, reps: 5 }] },
  { blocks: [{ pct: 70, reps: 3 }, { pct: 80, reps: 3 }, { pct: 90, reps: 3 }] },
  { blocks: [{ pct: 75, reps: 5 }, { pct: 85, reps: 3 }, { pct: 95, reps: 1 }] },
  { deload: true, blocks: [{ pct: 40, reps: 5 }, { pct: 50, reps: 5 }, { pct: 60, reps: 5 }] }
]

// A percentage above the base is a typo, not a program; below zero is not a set at all.
const clampPct = v => Math.min(100, Math.max(0, Number(v) || 0))

// One stage, normalised: every block gets a stable id (kept if the source already had one — a
// block's id is written once, by whatever creates it, and never regenerated; this positional
// fallback only fires for a stage that predates ids, i.e. the built-in template), a set count, a
// rep count, a clamped percentage, a type, and exactly one `role: 'anchor'`.
function normalizeStage(w, si) {
  const blocks = (Array.isArray(w?.blocks) ? w.blocks : [])
    .map((b, bi) => ({
      id: b?.id || `s${si}b${bi}`,
      sets: Math.max(1, Math.round(Number(b?.sets)) || 1),
      reps: Math.max(1, Math.round(Number(b?.reps)) || 1),
      pct: clampPct(b?.pct),
      type: b?.type === 'warmup' || b?.type === 'backoff' ? b.type : 'work'
    }))
    .filter(b => b.pct > 0)
  if (!blocks.length) return null
  const workBlocks = blocks.filter(b => b.type !== 'warmup')
  const anchor = workBlocks.length ? workBlocks[workBlocks.length - 1] : blocks[blocks.length - 1]
  blocks.forEach(b => { b.role = b === anchor ? 'anchor' : 'required' })
  return {
    id: w?.id || `s${si}`,
    ...(w?.deload ? { deload: true } : {}),
    repeat: Math.max(1, Math.round(Number(w?.repeat)) || 1),
    blocks
  }
}

/**
 * The wave in force for one exercise, normalised. A config with no wave — or one a hand-edited
 * plan file left unusable — falls back to the template rather than prescribing an empty cycle,
 * so the policy selector never has to write the template out to make the engine work.
 */
export function waveOf(cfg) {
  const stages = (Array.isArray(cfg?.wave) ? cfg.wave : []).map(normalizeStage).filter(Boolean)
  if (stages.length) return stages
  return DEFAULT_WAVE.map(normalizeStage)
}

/**
 * One stage resolved against a base: every block expanded by its `sets` count, every load on
 * the exercise's grid, every row stamped with the block/stage it came from. applyPrescription
 * carries these four fields straight onto the session's own rows; readSession reads them back to
 * grade required/anchor rows without an (eventual) warm-up block dragging the whole stage down.
 */
export function stageRows(stage, base, step) {
  const rows = []
  ;(stage?.blocks || []).forEach(b => {
    const w = snapWeight(base * b.pct / 100, step)
    for (let i = 0; i < (b.sets || 1); i++) {
      rows.push({ w, r: b.reps, blockId: b.id, stageId: stage.id, role: b.role, blockType: b.type })
    }
  })
  return rows
}

/** The stage's anchor block — the one that decides which stage a logged session belongs to, and
 * whether the cycle moves on (see prescribeWave). Falls back to the stage's last block if none is
 * marked; normalizeStage always marks one, so this only guards a stage built by hand outside it. */
export const anchorBlockOf = stage => (stage?.blocks || []).find(b => b.role === 'anchor') || (stage?.blocks || [])[(stage?.blocks || []).length - 1]
export const anchorPctOf = stage => anchorBlockOf(stage)?.pct || 0

/**
 * Percentage / training-max programming.
 *
 * Where in the cycle you are is *derived*, exactly like every other number in this file: the
 * stage of the last session is the one whose top set lands closest to what was actually lifted.
 * No counter is stored, so fixing a mistyped set — or rewriting the wave itself — takes effect
 * on the next prescription instead of leaving a saved position behind to drift.
 *
 * The one thing that is stored is the training max, because it is a number the lifter owns
 * rather than one the log implies (pure Wendler: it is never re-anchored to a new PR). A
 * finished cycle returns the bumped value in `trainingMax`; lib/session-start.js writes it back
 * when the session that ran at it is *finished*, so a session you discard moves nothing.
 */
function prescribeWave(S, cfg, inc, unit) {
  const wave = waveOf(cfg)
  const stages = wave.length
  const pctBase = cfg.pctBase === '1rm' ? '1rm' : 'tm'
  const onMiss = cfg.onMiss === 'advance' ? 'advance' : 'repeat'
  const bump = cfg.bump === 'off' ? 'off' : 'step'

  // With `pctBase: '1rm'` the base is live — it moves with every new estimate. That is opt-in
  // for a reason: a cycle whose weights change under you is not what 5/3/1 asks for.
  const est = pctBase === '1rm' ? best1RM(S, cfg.id) : null
  const base = pctBase === '1rm' ? (est ? est.est : 0) : Number(cfg.trainingMax) || 0
  if (!(base > 0)) {
    return {
      policy: 'wave', kind: 'need-tm', stages,
      why: pctBase === '1rm'
        ? ['No estimated 1RM for this exercise yet — log a set of it, or base the percentages on a training max.']
        : ['Set a training max for this exercise to start the cycle.']
    }
  }

  const rowsAt = k => stageRows(wave[k], base, inc)
  const topAt = k => snapWeight(base * topPctOf(wave[k]) / 100, inc)
  const pctsAt = k => wave[k].sets.map(s => s.pct).join('/')

  // Only a session that actually carries the prescribed rows is a wave session: an unrelated
  // logged set for the same exercise (a 1RM test rep, or history from before this policy) must
  // not be mistaken for a completed cycle stage.
  const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === 'reps' && Array.isArray(s.target?.rows) && s.target.rows.length)
  const last = sessions[sessions.length - 1]
  // Unlike every other policy, the baseline session is itself a prescription: stage 1 of the
  // cycle is knowable before anything has been logged.
  if (!last) {
    return {
      policy: 'wave', kind: 'first', stage: 1, stages, rows: rowsAt(0),
      why: ['Cycle stage 1 of {0} — {1} % of a {2} {3} training max.', stages, pctsAt(0), base, unit]
    }
  }

  // Which stage was that? The nearest top set. A tie goes to the earlier stage (`<`, not `<=`),
  // which is the conservative read: repeat lighter work rather than skip ahead.
  let k = 0
  for (let i = 1; i < stages; i++) if (Math.abs(topAt(i) - last.weight) < Math.abs(topAt(k) - last.weight)) k = i
  // A stage with `repeat: 3` is three identical sessions. Consecutive sessions at the same top
  // weight are the same stage run again — the same nearest-match, counted.
  let ran = 0
  for (let i = sessions.length - 1; i >= 0 && sessions[i].weight === last.weight; i--) ran++

  let nextK
  let bumped = false
  if (last.ok) {
    if (ran < (wave[k].repeat || 1)) nextK = k                    // the stage asked to be run again
    else if (k === stages - 1) {
      // The cycle closed. Only a training-max base with the step bump on actually moves — a
      // live-1RM base has nothing of its own to bump.
      nextK = 0
      bumped = pctBase === 'tm' && bump === 'step'
    } else nextK = k + 1
  } else {
    // `advance` past the last stage wraps to stage 1 without a bump: the cycle was not finished,
    // it was abandoned, and abandoning it must not earn a heavier training max.
    nextK = onMiss === 'advance' ? (k + 1) % stages : k
  }

  const nextBase = bumped ? round1(base + inc) : base
  const rows = stageRows(wave[nextK], nextBase, inc)
  // 'deload' announces arriving at a lighter stage on a hit; a miss is always a 'hold' — even
  // re-running a deload stage, since nothing moved forward.
  const kind = !last.ok ? 'hold' : wave[nextK].deload ? 'deload' : 'up'
  const why = bumped
    ? ['Cycle done — training max up to {0} {1}. Back to stage 1 of {2}: {3} %.', nextBase, unit, stages, pctsAt(nextK)]
    : !last.ok && nextK === k
      ? ['Missed a set last time — stage {0} of {1} again: {2} %.', nextK + 1, stages, pctsAt(nextK)]
      : ['Stage {0} of {1} — {2} % of a {3} {4} training max.', nextK + 1, stages, pctsAt(nextK), nextBase, unit]

  return { policy: 'wave', kind, stage: nextK + 1, stages, rows, ...(bumped ? { trainingMax: nextBase } : {}), why }
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
export function selectDeloadCandidate({ currentWeight, targetWeight, targetReps, step, factor = DELOAD_FACTOR, reps, repsMin, perSide = false }) {
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
    const grid = positiveGridAround(ideal, step, current, !allowCurrent)
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
 * Reduce one finished workout entry to what a policy needs to judge it.
 *
 * Workouts only started recording their prescription in v1.2.2, so most existing history has
 * no `target` at all. Judging those against nothing would score every past session as a miss
 * — and then greet a long-standing user with "missed reps 11 sessions running, deload". So an
 * entry without its own target is judged against `fallback`, the exercise's current plan,
 * which is exactly what the app's old weight hint compared against.
 */
export function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {}
  const mode = modeOf({ ...target, id: entry && entry.id })
  // Warm-up rows are prep, not the session: one filtered read beats guarding every consumer
  // below (an undone warm-up otherwise poisons `ok` forever and its reps drag `low`/`count`).
  const sets = ((entry && entry.sets) || []).filter(s => !isWarmupRow(s))
  // A wave prescribes each row separately (5 @ 65 %, 3 @ 75 %, 1 @ 85 %), so its sessions are
  // graded row against row rather than everything against one rep target. An entry without
  // `target.rows` — every entry written before this policy existed — keeps the uniform path.
  const rows = Array.isArray(target.rows) && target.rows.length ? target.rows : null
  const planned = rows ? rows.length : (target.sets || sets.length)
  const enough = sets.length >= planned

  if (mode === 'time') {
    const goal = target.sec || 0
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0))
    return {
      mode, target, goal, held,
      weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
      best: Math.max(0, ...held),
      ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal)
    }
  }
  const goal = target.reps || 0
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0))
  return {
    mode, target, goal, reps,
    weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
    count: reps.length,                                   // the dimension bodyweight work grows (#33)
    low: reps.length ? Math.min(...reps) : 0,
    amrap: reps.length ? reps[reps.length - 1] : 0,       // Greyskull's final set
    ok: rows
      ? enough && reps.length > 0 && rows.every((row, i) => reps[i] >= (row.r || 0))
      : goal > 0 && enough && reps.length > 0 && reps.every(r => r >= goal)
  }
}

/** Every past session for one exercise, oldest first. `fallback` — see readSession. */
export function sessionsFor(S, exId, fallback) {
  const out = []
  ;(S.workouts || []).forEach(w => {
    const entry = w.entries.find(e => e.id === exId)
    if (!entry) return
    // A session that does not count for this exercise cannot become the baseline for its next
    // prescription. Exclusion is per-entry now (ENG-11): a legacy whole-workout
    // `excludeFromProgression` flag still excludes every entry; a merged rehab block excludes
    // only its own. `noProg` is frozen onto the entry at build time, so later routine edits
    // never rewrite it. This is the only progression-exclusion path in the file.
    if (entryExcluded(w, entry)) return
    if (entry.sets.some(s => s.done && !isWarmupRow(s))) out.push({ d: w.d, ...readSession(entry, fallback) })
  })
  return out
}

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
 * undefined and the caller keeps whatever the plan said.
 */
export function nextPrescription(S, cfg, routine) {
  const mode = modeOf(cfg)
  const policy = policyFor(cfg, routine, mode)
  const unit = S.unit || 'kg'
  const inc = mode === 'time'
    ? (cfg.inc > 0 ? cfg.inc : DEFAULT_SEC_INCREMENT)
    : weightIncrement(cfg, unit)
  if (policy === 'off') return { policy, kind: 'off' }
  // Self-contained: a wave derives its own history read and never consults stalls or deloads.
  if (policy === 'wave') return prescribeWave(S, cfg, inc, unit)

  const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === mode)
  const last = sessions[sessions.length - 1]
  if (!last) return { policy, kind: 'first', why: ['Nothing logged yet — this session sets the baseline.'] }

  const stalls = stallCount(sessions, policy)
  const deloadAt = DELOAD_AFTER[policy] || 3

  if (mode === 'time') {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + inc
      return { policy, kind: 'up', sec, why: ['Held every set for the full time — target up by {0}s.', inc] }
    }
    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5)
      return { policy, kind: 'deload', sec, why: ['Short {0} sessions in a row — back off to {1}s and build up again.', stalls, sec] }
    }
    return { policy, kind: 'hold', sec: last.goal || cfg.sec, why: ['Last time came up short — same target again.'] }
  }

  const w = last.weight
  // Bodyweight work carries no external load, so there is nothing to add or take away —
  // "deload your push-ups to 2.5 kg" is not advice. Progress in reps instead. This runs ahead
  // of the individual policies because it is true for all of them. Note the trigger is the
  // *logged* weight, not the `bw` flag: a dip done with a belt has a load to progress and
  // belongs on the normal policies, and a barbell lift logged at 0 has nothing to add to.
  if (w <= 0) {
    const goal = last.goal || cfg.reps || 0
    if (!last.ok || goal <= 0) return { policy, kind: 'hold', weight: 0, reps: goal || undefined, why: ['Bodyweight — same target again until every set is clean.'] }
    // A ceiling turns "+1 rep forever" into a plan (issue #33). Past the top of the range the
    // reps go back to the bottom and a set is added instead, which is how bodyweight work
    // actually progresses once a set of 30 push-ups stops being a strength stimulus.
    const top = cfg.repsMax > 0 ? cfg.repsMax : 0
    if (top > 0 && goal >= top) {
      const sets = Math.max(1, cfg.sets || last.count || 1) + 1
      const bottom = Math.max(1, Math.min(cfg.reps || top, top))
      if (sets <= MAX_BW_SETS) return { policy, kind: 'up', weight: 0, reps: bottom, sets, why: ['{0} reps in every set — add a set and go back to {1}.', goal, bottom] }
      // Out of sets worth adding: more volume is no longer the answer, load or a harder
      // variation is — and that is a decision for a person, not a policy.
      return { policy, kind: 'hold', weight: 0, reps: goal, why: ['{0} sets of {1} — time to add weight or move to a harder variation.', sets - 1, goal] }
    }
    // Unilateral work steps by two, so the total stays even and both sides get the rep.
    const next = goal + repStep(cfg)
    return { policy, kind: 'up', weight: 0, reps: next, why: ['Bodyweight — every rep last time, so go for {0} this time.', next] }
  }

  // Epley deloads apply only to externally loaded rep work. Keep the prescribed target from the
  // session that stalled (falling back field-by-field to the current config), while the logged
  // weight remains the hard upper bound for the selected candidate.
  const epleyDeload = () => {
    if (mode !== 'reps' || (policy !== 'linear' && policy !== 'double')) return null
    const previous = last.target || {}
    const target = {
      ...cfg,
      ...previous,
      weight: previous.weight ?? cfg.weight,
      reps: previous.reps ?? cfg.reps,
      repsMin: previous.repsMin ?? cfg.repsMin,
      sets: previous.sets ?? cfg.sets,
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
      perSide: isPerSide(target)
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
        ? ['Stalled {0} sessions — hold {1} {2} and use {3} reps.', stalls, candidate.weight, unit, candidate.reps]
        : ['Stalled {0} sessions — Epley deload to {1} {2} for {3} reps.', stalls, candidate.weight, unit, candidate.reps]
    }
  }

  if (policy === 'double') {
    const range = normalizeRepRange(cfg.reps || last.goal || 10, cfg.repsMin, repStep(cfg))
    const top = range.reps
    const bottom = range.repsMin
    if (last.ok) return { policy, kind: 'up', weight: snapWeight(w + inc, inc), reps: bottom, why: ['Top of the rep range in every set — {0} {1} more, back to {2} reps.', inc, unit, bottom] }
    if (stalls >= deloadAt) {
      const selected = epleyDeload()
      if (selected) return selected
      const dw = deloadTo(w, inc)
      return { policy, kind: 'deload', weight: dw, reps: bottom, why: ['Stalled {0} sessions — deload to {1} {2}.', stalls, dw, unit] }
    }
    const aim = Math.min(top, Math.max(bottom, last.low + repStep(cfg)))
    return { policy, kind: 'hold', weight: w, reps: aim, why: ['Same weight — aim for {0} reps this time.', aim] }
  }

  // linear + greyskull
  if (last.ok) {
    // Greyskull's final set is taken to failure: double the target reps there and you have
    // earned a double jump.
    const dbl = policy === 'greyskull' && last.goal > 0 && last.amrap >= last.goal * 2
    const step = dbl ? inc * 2 : inc
    return {
      policy, kind: 'up', weight: snapWeight(w + step, inc),
      why: dbl
        ? ['Last set hit {0} reps — twice the target, so take a double jump of {1} {2}.', last.amrap, step, unit]
        : ['Every rep last time — {0} {1} more.', step, unit]
    }
  }
  if (stalls >= deloadAt) {
    const selected = epleyDeload()
    if (selected) return selected
    const dw = deloadTo(w, inc)
    return {
      policy, kind: 'deload', weight: dw,
      why: stalls > 1
        ? ['Missed reps {0} sessions running — reset to {1} {2} and work back up.', stalls, dw, unit]
        : ['Missed reps — reset to {0} {1} and work back up.', dw, unit]
    }
  }
  return { policy, kind: 'hold', weight: w, why: ['Missed reps last time — same weight again ({0} of {1} to go).', deloadAt - stalls, deloadAt] }
}

/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet.
 */
export function applyPrescription(sets, p, step = 2.5) {
  if (!p || p.kind === 'off' || p.kind === 'need-tm') return sets
  // A baseline session usually has nothing to say. A wave's does: stage 1 of a cycle is a full
  // prescription before anything has been logged, so the rule is "no-op iff `first` and rowless".
  if (p.kind === 'first' && !(Array.isArray(p.rows) && p.rows.length)) return sets
  const rows = Array.isArray(p.rows) && p.rows.length ? p.rows : null
  // A wave decides its own set count; `p.sets` still wins where it asks for more.
  const want = rows ? Math.max(p.sets || 0, rows.length) : p.sets

  // A policy that decided on a set count gets to grow the list — bodyweight progression adds
  // a set where a barbell would have added a plate, and a wave's stage may prescribe more rows
  // than the plan holds. Only ever upwards, and only by copying a row that is already there:
  // a session in progress must not lose a set it has logged. Growth happens before the
  // assignment below so a freshly appended row gets its own weight rather than the seed's.
  let out = sets
  const workRows = out.filter(s => !isWarmupRow(s))
  if (want > workRows.length) {
    // An all-warm-up entry has no work row to seed growth from - growing warm-up copies
    // would both invent work and never terminate the loop. Leave the entry untouched.
    if (!workRows.length) return rerampWarmups(out, step)
    const seed = workRows[workRows.length - 1]
    // A freshly appended row hasn't been performed, so it never inherits a seed's already-
    // logged drops/clusters — that would invent extra work the row never actually did. Its
    // `type` is kept: that's the exercise's plan (every set is a drop-set/rest-pause), not
    // something this particular row logged.
    const { drops, clusters, ...plainSeed } = seed
    out = [...out]
    while (out.filter(s => !isWarmupRow(s)).length < want) out.push({ ...plainSeed, done: false })
  }

  // Rows are handed out by work-row ordinal, so a logged row consumes its own row and the
  // pending ones stay lined up with the stage they belong to.
  let ordinal = -1
  out = out.map(s => {
    if (isWarmupRow(s)) return s
    ordinal++
    // Never rewrite a logged set, and never rewrite a warm-up: the prescription speaks to
    // the work rows only (a ticked warm-up falling through here would be the data-loss the
    // cascade fix removed, two files over).
    if (s.done) return s
    const o = { ...s }
    if (rows) {
      const row = rows[ordinal]
      // Past the end of the wave's rows sits whatever the plan added of its own — an
      // intensifier's extra sets keep their own load.
      if (row) { o.w = row.w; o.r = row.r }
      return o
    }
    if (p.weight != null) o.w = p.weight
    if (p.reps != null) o.r = p.reps
    if (p.sec != null) o.sec = p.sec
    return o
  })

  // Last, because the work rows now carry their final weight: the warm-up block ramps toward
  // what you are actually about to lift, not toward what you lifted last time.
  return rerampWarmups(out, step)
}
