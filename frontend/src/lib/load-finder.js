// A first working weight for an exercise never logged before (EP22-T04).
//
// A beginner facing an empty weight field has nothing to go on. The finder asks for a light set
// at the planned reps and how it felt, then moves the weight by about a fifth: up after "easy",
// down after "too hard", and it stops at "about right", when the answers bracket a weight, or
// after three test sets so that finding the weight never becomes the workout. Pure and
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

/** About a fifth heavier, on the step grid, and always at least one step (or 0.5) more. */
export function nextUp(w, step) {
  const min = step > 0 ? step : 0.5
  const up = snap(w * (1 + JUMP), step)
  return up > w ? up : snap(w + min, step)
}

/** About a fifth lighter, on the step grid, at least one step less, never below zero. */
export function nextDown(w, step) {
  if (!(w > 0)) return 0
  const min = step > 0 ? step : 0.5
  const down = snap(w * (1 - JUMP), step)
  return down < w ? down : snap(Math.max(0, w - min), step)
}

/** A fresh finder at `weight` (snapped to the step grid). */
export const begin = (weight, step) => ({ weight: snap(Number(weight) || 0, step), step, tries: 0, done: false, seen: [] })

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
    if (tries >= MAX_TRIES) return end(w)
    return { ...state, weight: nextUp(w, state.step), tries, seen }
  }
  // Too hard. If a lighter weight was easy, start there.
  const easier = state.seen.filter(x => x.feel === 'easy' && x.w < w).map(x => x.w)
  if (easier.length) return end(Math.max(...easier))
  const down = nextDown(w, state.step)
  if (tries >= MAX_TRIES || down === w) return end(down)
  return { ...state, weight: down, tries, seen }
}
