// LIFTIQ-FORK: pure helpers of the review stage and the write-back to the set. No DOM, no vendor import.
import { buildVbt } from './sanitize.js'

/**
 * What the review shows for the "Include setup pull" switch. `review` is the controller's review:
 * { withSetup, auto, setupFlagged, fw, capturedAt }, both analyses from the same samples.
 * With no setup pull flagged the switch does not exist and both are the same list.
 */
export function pickAnalysis(review, includeSetup) {
  if (!review) return null
  const a = review.setupFlagged && includeSetup ? review.withSetup : review.auto
  const bars = review.withSetup.reps.map(p => ({ n: p.n, t: p.t, vPeak: p.vPeak, setup: !!p.setup, counted: includeSetup || !p.setup }))
  return {
    reps: a.reps,
    metrics: a.metrics,
    count: a.reps.length,
    bars: review.setupFlagged ? bars : bars.map(b => ({ ...b, counted: true })),
  }
}

/** The default of the switch: exclude when the analysis flagged a setup pull. */
export const defaultIncludeSetup = () => false

/**
 * The `vbt` object for a confirmed set. The velocities are those of the detected reps in the chosen
 * analysis, whatever count the user typed (a corrected count does not invent velocities).
 */
export function vbtFromReview(review, includeSetup, pkgVersion) {
  const chosen = pickAnalysis(review, includeSetup)
  return buildVbt({
    reps: chosen.reps,
    metrics: chosen.metrics,
    repsWithSetup: review.withSetup.reps.length,
    repsNoSetup: review.auto.reps.length,
    setupIncluded: review.setupFlagged && includeSetup,
    fw: review.fw,
    pkg: pkgVersion,
    capturedAt: review.capturedAt,
  })
}

/**
 * Put a confirmed recording on set `i` through the same handlers the workout screen uses:
 * the reps and the weight via onField (exactly what typing them does, including the weight
 * cascade to the following sets), `vbt` via onField, then the done-toggle, so `at` is stamped, the
 * PR check runs and the rest timer starts as if the set had been ticked. A set that is already
 * done stays done (a second toggle would un-tick it).
 */
export function writeBack({ i, set, reps, weight, vbt, onField, onToggle }) {
  onField(i, 'r', Math.max(0, Math.round(Number(reps) || 0)))
  const w = Number(weight)
  if (Number.isFinite(w) && w >= 0 && w !== Number(set?.w ?? 0)) onField(i, 'w', w)
  if (vbt) onField(i, 'vbt', vbt)
  if (!set?.done) onToggle(i)
}
