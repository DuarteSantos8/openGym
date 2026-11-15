// A planned rest-pause set: one activation set, then a few short bursts at the same weight with a
// short rest before each, written down as one row ("60×10+4+3+3"). Everything that decides how
// such a set is planned, read back and progressed lives here, so it can be tested on its own.
//
// The plan (`cfg.intensifier`, type 'restpause'):
//   reps      the activation set's reps (the exercise's own "Reps" field, cfg.reps)
//   bursts    how many bursts follow it
//   total     the reps wanted in the whole set, activation included, where a cycle starts
//   totalMax  the total that, once reached, makes the weight go up (and the total start over)
//   restSec   the rest before each burst
//   aim       stamped on a session's target only: the total that session asked for
//
// Plans saved before 1.4.6 carry `totalReps` instead: the reps wanted past the activation set,
// split into roughly halving bursts. They are read as that many bursts and that total, so an
// existing routine opens the same workload it promised, and it is upgraded the first time the
// sheet saves it.
//
// A row planned this way carries `act: true`: its `r` is the activation set plus every burst,
// and `clusters` are the bursts alone, so `r` minus the bursts is what the activation set did.
// Rows from before had no activation set in them (it was a separate warm-up row), which is how
// reading them back tells the two apart.
import { clustersOf, isRestPauseSet, isSideSet, splitBurstReps } from './workout-model.js'

export const RP_BURSTS_MAX = 6
export const RP_REST_MIN = 5
export const RP_REST_DEFAULT = 15
// Misses in a row, at the same plan, before the weight comes down. The same patience linear and
// double progression have (progression.js DELOAD_AFTER).
export const RP_DELOAD_AFTER = 3

// A whole number held to `min`; `fallback` when there is no number at all.
const whole = (v, min, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? Math.max(min, n) : fallback
}

/** Whether a config plans its sets as rest-pause. */
export const isRestPausePlan = cfg => cfg?.intensifier?.type === 'restpause'

/**
 * The rest-pause plan of a config, every number clamped to something trainable, or null when it
 * does not plan rest-pause. Tolerates the pre-1.4.6 `totalReps` shape (see the top of the file).
 */
export function restPausePlan(cfg) {
  if (!isRestPausePlan(cfg)) return null
  const x = cfg.intensifier
  const activation = whole(cfg.reps, 1, 8)
  const restSec = whole(x.restSec, RP_REST_MIN, RP_REST_DEFAULT)
  // Only a plan with no `total` at all is the old shape: one being typed into has an empty one.
  const legacy = x.total == null && Number(x.totalReps) > 0
  const extra = legacy ? whole(x.totalReps, 1, 1) : 0
  const bursts = Math.min(RP_BURSTS_MAX, whole(x.bursts, 1, legacy ? Math.max(1, splitBurstReps(extra).length) : 3))
  // Every burst gets a rep at least, so the total is never below the activation plus the bursts.
  // A per-side plan (cfg.side) trains the bursts on each side, so it needs them twice over.
  const total = Math.max(activation + bursts * (cfg.side ? 2 : 1), legacy ? activation + extra : whole(x.total, 1, 1))
  const totalMax = Math.max(total, whole(x.totalMax, 0, 0))
  return { activation, bursts, total, totalMax, restSec, legacy }
}

/** The total a session aims for: its stamped `aim` inside the plan's range, else where a cycle starts. */
export function restPauseAim(cfg) {
  const plan = restPausePlan(cfg)
  if (!plan) return null
  const aim = whole(cfg.intensifier.aim, 1, plan.total)
  return Math.min(plan.totalMax, Math.max(plan.total, aim))
}

/** The plan in the shape the config sheet saves: the new fields only, legacy ones gone. */
export function restPauseToSave(cfg) {
  const plan = restPausePlan(cfg)
  if (!plan) return cfg?.intensifier
  return { type: 'restpause', bursts: plan.bursts, total: plan.total, totalMax: plan.totalMax, restSec: plan.restSec }
}

/**
 * The bursts that follow an activation set of `activation` reps when the set aims for `total`:
 * what is left shared out over `bursts`, the first ones taking the odd reps, since a burst never
 * has more in it than the one before. 20 total after 10, in 3 bursts, is [4, 3, 3]. Fewer reps
 * left than bursts means fewer bursts, one rep each; none left, none.
 */
export function burstReps(total, activation, bursts) {
  const left = Math.max(0, Math.round(Number(total) || 0) - Math.max(0, Math.round(Number(activation) || 0)))
  const n = Math.min(Math.max(0, Math.round(Number(bursts) || 0)), left)
  if (!n) return []
  const base = Math.floor(left / n)
  const odd = left % n
  return Array.from({ length: n }, (_, i) => base + (i < odd ? 1 : 0))
}

/**
 * The one work row a rest-pause plan trains as, at weight `w` aiming for `aim` total reps.
 * A per-side plan's numbers cover both limbs (as its reps do everywhere): each side takes half,
 * the left the odd rep. `sides` builds the per-side row from two sides (history.js passes its
 * makeSideSet-shaped helper, which this module cannot import without a cycle).
 */
export function restPauseRow(plan, aim, w, { perSide = false, sideW = null, sides = null } = {}) {
  const one = (total, activation, weight) => ({
    w: weight, r: total, done: false, type: 'restpause', act: true,
    clusters: burstReps(total, activation, plan.bursts).map(r => ({ r, restSec: plan.restSec })),
  })
  if (!perSide || !sides) return one(aim, plan.activation, w)
  const half = (n, key) => (key === 'L' ? Math.ceil(n / 2) : Math.floor(n / 2))
  const side = key => one(half(aim, key), half(plan.activation, key), sideW?.[key] ?? w)
  const { clusters: _bursts, ...base } = one(aim, plan.activation, w)
  return sides(base, side('L'), side('R'))
}

/**
 * What a logged rest-pause row did: the activation set's reps, the total and the bursts, a per-side
 * row added up over the sides that were ticked. `complete` is whether every side was ticked (a
 * per-side row with one side left is done, but not finished). `planned` is false for a row from
 * before the activation set lived in it (no `act`), whose numbers cannot be judged against a total.
 */
export function readRestPauseRow(row) {
  const empty = { done: false, complete: false, planned: false, act: 0, total: 0, bursts: 0 }
  if (!row || !isRestPauseSet(row)) return empty
  const parts = isSideSet(row) ? [row.sides.L, row.sides.R].filter(s => s && s.done) : (row.done ? [row] : [])
  const planned = isSideSet(row) ? row.sides.L?.act === true || row.sides.R?.act === true || row.act === true : row.act === true
  if (!parts.length) return { ...empty, planned }
  const complete = isSideSet(row) ? parts.length === 2 : true
  let act = 0, total = 0, bursts = 0
  parts.forEach(p => {
    const r = Math.max(0, Number(p.r) || 0)
    const own = clustersOf(p).map(c => Math.max(0, Number(c?.r) || 0)).filter(n => n > 0)
    const sum = own.reduce((a, b) => a + b, 0)
    total += r
    act += Math.max(0, r - sum)
    bursts = Math.max(bursts, own.length)
  })
  return { done: true, complete, planned, act, total, bursts }
}

/** A plan's numbers as one comparable key: a session judged against another plan says nothing about this one. */
export const restPauseKey = plan => (plan ? [plan.activation, plan.bursts, plan.total, plan.totalMax].join('/') : '')

/**
 * Judge one session's rest-pause row against what it aimed for. Done means every side was
 * finished, the activation set reached its reps and the whole set reached the total; the bursts
 * may share it out any way.
 */
export function judgeRestPause(target, row) {
  const plan = restPausePlan(target)
  if (!plan) return null
  const aim = restPauseAim(target)
  const read = readRestPauseRow(row)
  return { ...read, aim, key: restPauseKey(plan), ok: read.complete && read.planned && read.total >= aim && read.act >= plan.activation }
}

/**
 * The next rest-pause session: double progression on the total. A clean session raises the total
 * by `step` (one rep, two for a per-side lift) at the same weight, never past `totalMax`; a clean
 * session at `totalMax` makes the weight go up and the total start over. A miss keeps the target,
 * and RP_DELOAD_AFTER misses in a row at the same weight take it down and start the total over.
 * Work with no load to add, or a weight with nothing heavier to go to, stops at the top and says so.
 *
 * `sessions` are readSession's reads, oldest first, each with `rp` (judgeRestPause) when its
 * target planned rest-pause. Only the sessions at the end that were planned with these same
 * numbers count: anything older, or a session from before the activation set was part of the row,
 * starts the plan again from its first total, at the weight last lifted (or the routine's own,
 * when it was edited along with the plan, as progression.js does for any other plan change).
 * `harder(w)` / `easier(w)` are the progression engine's own next and deload weights.
 */
export function restPausePrescription({ cfg, sessions = [], policy, harder, easier, step = 1, weightless = false }) {
  const plan = restPausePlan(cfg)
  if (!plan) return null
  const key = restPauseKey(plan)
  const last = sessions[sessions.length - 1]
  const lastW = last && last.weight > 0 ? last.weight : 0
  const keepW = lastW > 0 ? { weight: lastW } : cfg.weight > 0 ? { weight: cfg.weight } : {}
  const run = []
  for (let i = sessions.length - 1; i >= 0; i--) {
    const rp = sessions[i]?.rp
    if (!rp || !rp.planned || rp.key !== key) break
    run.unshift(sessions[i])
  }
  if (!last) return { policy, kind: 'first', rpAim: plan.total, why: ['Nothing logged yet, so this session sets the baseline.'] }
  if (!run.length) {
    const edited = cfg.weight > 0 && last.planned && (last.planned.weight ?? null) !== cfg.weight
    return { policy, kind: 'hold', ...(edited ? { weight: cfg.weight } : keepW), rpAim: plan.total, why: ['New rest-pause plan, so starting from {0} reps in total.', plan.total] }
  }
  const prev = run[run.length - 1]
  const aim = prev.rp.aim
  if (prev.rp.ok) {
    if (aim < plan.totalMax) {
      const next = Math.min(plan.totalMax, aim + step)
      return { policy, kind: 'up', ...keepW, rpAim: next, why: ['{0} reps in total last time. Go for {1} at the same weight.', prev.rp.total, next] }
    }
    const atTop = { policy, kind: 'hold', ...keepW, rpAim: plan.totalMax, why: ['{0} reps in total, the top of your range. Time to add weight or try a harder variation.', prev.rp.total] }
    if (weightless || !(lastW > 0)) return atTop
    const up = harder(lastW)
    // Nothing heavier to go to (the heaviest dumbbell, the whole stack): the total stays at the top.
    if (up === lastW) return atTop
    return { policy, kind: 'up', weight: up, rpAim: plan.total, why: ['Rest-pause target reached. The weight goes up and the total starts again at {0}.', plan.total] }
  }
  let misses = 0
  // Only misses at this weight: a deload starts its own count.
  for (let i = run.length - 1; i >= 0 && !run[i].rp.ok && run[i].weight === lastW; i--) misses++
  if (misses >= RP_DELOAD_AFTER && lastW > 0 && !weightless) {
    return { policy, kind: 'deload', weight: easier(lastW), rpAim: plan.total, why: ['Short of the rest-pause target {0} times in a row. A lighter weight, and the total starts again at {1}.', misses, plan.total] }
  }
  return { policy, kind: 'hold', ...keepW, rpAim: aim, why: ['Short of {0} reps in total last time. Same target again.', aim] }
}
