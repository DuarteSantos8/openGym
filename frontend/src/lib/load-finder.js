// A first working weight for an exercise never logged before (EP22-T04).
//
// A beginner facing an empty weight field has nothing to go on. The finder asks for a light set
// at the planned reps and how it felt, then moves the weight by about a fifth: up after "easy",
// down after "too hard", and it stops at "about right", when the answers bracket a weight, or
// after three test sets so that finding the weight never becomes the workout. It never goes
// under the floor it is given (the bar of a barbell lift) and says when it has hit it. Pure and
// deterministic: no body weight, age or sex goes in, and nothing here is advice about injuries.
//
// The starting weights are the lightest thing commonly on the gym floor for that equipment, not
// an estimate of what someone can lift. The person can change the number before answering, and
// the changed number is the one that counts.
import { snapWeight } from './progression.js'
import { BAR_EQ, defaultBarWeight } from './bar.js'

export const FEELS = ['easy', 'right', 'hard']
export const MAX_TRIES = 3
const JUMP = 0.2

const START = {
  kg: { dumbbell: 5, kettlebell: 8, cable: 10, 'leverage machine': 10, 'sled machine': 20, 'weight plate': 5, 'medicine ball': 3, other: 5 },
  lb: { dumbbell: 10, kettlebell: 18, cable: 20, 'leverage machine': 20, 'sled machine': 45, 'weight plate': 10, 'medicine ball': 6, other: 10 },
}

/** The weight the first test set is offered at: the empty bar, or the lightest usual pick. */
export function startLoad(ex, unit) {
  const u = unit === 'lb' ? 'lb' : 'kg'
  const eq = ex?.eq
  if (BAR_EQ.has(eq)) return defaultBarWeight(eq, u) ?? START[u].other
  return START[u][eq] ?? START[u].other
}

const snap = (v, step) => Math.max(0, snapWeight(v, step))
const EPS = 1e-9
// The owned weights someone has listed for this exercise (their dumbbells, a machine's stack),
// lightest first, or null when there is no such list and the step grid is in charge.
const listOf = weights => (Array.isArray(weights) && weights.length ? weights : null)
// The one nearest `ideal`, the lighter of two equally near: when in doubt, the finder errs light.
const nearest = (list, ideal) => list.reduce((best, x) => (Math.abs(x - ideal) < Math.abs(best - ideal) - EPS ? x : best), list[0])

/**
 * About a fifth heavier and always at least one step (or 0.5) more, on the step grid; with a
 * list of owned `weights`, the owned weight above `w` nearest that aim, or `w` at the top.
 */
export function nextUp(w, step, weights) {
  const own = listOf(weights)
  if (own) {
    const above = own.filter(x => x > w + EPS)
    return above.length ? nearest(above, w * (1 + JUMP)) : w
  }
  const min = step > 0 ? step : 0.5
  const up = snap(w * (1 + JUMP), step)
  return up > w ? up : snap(w + min, step)
}

/**
 * About a fifth lighter, at least one step less, and never under `floor`: the bar a barbell
 * lift is done with cannot be taken off it (history.js barFloor), and nothing weighs less than
 * zero. With owned `weights`, the owned weight below `w` nearest that aim, or `w` at the bottom.
 */
export function nextDown(w, step, floor = 0, weights) {
  const least = Math.max(0, Number(floor) || 0)
  const own = listOf(weights)
  if (own) {
    const below = own.filter(x => x < w - EPS && x >= least - EPS)
    return below.length ? nearest(below, w * (1 - JUMP)) : w
  }
  if (!(w > least)) return least
  const min = step > 0 ? step : 0.5
  const down = snap(w * (1 - JUMP), step)
  return Math.max(least, down < w ? down : snap(Math.max(0, w - min), step))
}

/** One tap of + or - over owned weights: the neighbour that way, or where it is at either end. */
export function stepIn(weights, v, dir) {
  const own = listOf(weights)
  if (!own) return v
  const side = dir > 0 ? own.filter(x => x > v + EPS) : own.filter(x => x < v - EPS)
  return side.length ? (dir > 0 ? side[0] : side[side.length - 1]) : v
}

/**
 * A fresh finder at `weight`, snapped to the step grid, or at `floor` when that is more (the
 * least this exercise can weigh, which is the athlete's own bar for a barbell lift). With owned
 * `weights` it starts on the owned weight nearest `weight`.
 */
export function begin(weight, step, { floor = 0, weights = null } = {}) {
  const least = Math.max(0, Number(floor) || 0)
  const own = listOf(weights)
  const usable = own ? own.filter(x => x >= least - EPS) : null
  const start = usable?.length ? nearest(usable, Number(weight) || 0) : Math.max(least, snap(Number(weight) || 0, step))
  return { weight: start, step, floor: least, weights: usable?.length ? usable : null, tries: 0, done: false, seen: [] }
}

/**
 * One test set answered. Returns the next state: `done` with the weight to start on, or the
 * next weight to try. Unknown answers and answers after the end change nothing.
 */
export function answer(state, feel) {
  if (!state || state.done || !FEELS.includes(feel)) return state
  const w = Math.max(0, Number(state.weight) || 0)
  const seen = [...state.seen, { w, feel }]
  const tries = state.tries + 1
  const end = weight => ({ ...state, weight, tries, seen, done: true })
  if (feel === 'right') return end(w)
  if (feel === 'easy') {
    // Something heavier was already too hard: this is the one to start on.
    if (state.seen.some(x => x.feel === 'hard' && x.w > w)) return end(w)
    const up = nextUp(w, state.step, state.weights)
    // Three test sets are enough, and at the top of the rack there is nothing heavier to try.
    if (tries >= MAX_TRIES || up === w) return end(w)
    return { ...state, weight: up, tries, seen }
  }
  // Too hard. If a lighter weight was easy, start there.
  const easier = state.seen.filter(x => x.feel === 'easy' && x.w < w).map(x => x.w)
  if (easier.length) return end(Math.max(...easier))
  // Too hard with nothing left to take off: say so (`atFloor`) rather than suggest a weight that
  // cannot be loaded, or the one that was just too hard as if it were an answer.
  const least = state.floor || 0
  const down = nextDown(w, state.step, least, state.weights)
  if (state.weights ? down === w : w <= least) return { ...end(state.weights ? w : least), atFloor: true }
  if (tries >= MAX_TRIES) return end(down)
  return { ...state, weight: down, tries, seen }
}
