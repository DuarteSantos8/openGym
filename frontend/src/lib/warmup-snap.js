// Where one warm-up rung lands on the bar. Kept apart from lib/warmup-ramp.js because history.js
// needs it too (rerampWarmups re-aims a generated block when the work weight moves) and
// warmup-ramp.js already imports history.js.
import { ownedFloor } from './dumbbells.js'

const EPS = 1e-9
const tidy = x => Math.round(x * 1000) / 1000

/**
 * `x` rounded DOWN to something loadable. `grid` is what the rest of the app snaps to
 * (plates.js dropGrid): a number is the exercise's step, a list is the dumbbells or the machine
 * stack you own, and a function is the gym's own plates (the heaviest load at or under `x`).
 * Down, never up: a rung a notch light costs nothing, a notch heavy is a plate to strip.
 */
export function snapDown(x, grid) {
  if (!(x > 0)) return 0
  if (typeof grid === 'function') return tidy(grid(x))
  if (Array.isArray(grid)) return tidy(ownedFloor(grid, x))
  const step = Number(grid) > 0 ? Number(grid) : 2.5
  return tidy(Math.floor(x / step + EPS) * step)
}

/**
 * The weight of a generated rung: `pct` percent of the work weight (`wb` the bare bar, `pct` 0
 * the body alone on a weighted bodyweight lift), never under the bar (`floor`) and never above
 * the set it warms you up for.
 */
export function rungWeight(rung, work, grid, floor = 0) {
  if (!(work > 0)) return 0
  if (rung.wb) return Math.min(work, Math.max(0, floor))
  const pct = Number(rung.wp)
  if (!(pct > 0)) return 0
  return Math.min(work, Math.max(0, floor, snapDown(work * pct / 100, grid)))
}

/** Whether a set row was made from a rung (a generated or a saved warm-up), not by halving. */
export const isRungRow = row => !!row && (row.wb === true || Number.isFinite(row.wp))
