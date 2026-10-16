import { FATIGUE_STATES, STRENGTH_FLOOR } from './recovery.js'

// The fatigue and strength maps' fixed bands (BodyMap `thresholds`): absolute, so a muscle's
// shade means the same state from one week to the next.
export const FATIGUE_LEVELS = [
  { at: 0, level: 0 },
  { at: 0.15, level: 1 },
  { at: 0.25, level: 2 },
  { at: 0.4, level: 3 },
  { at: 0.55, level: 4, exclusive: true },
]

export const STRENGTH_LEVELS = [
  { at: STRENGTH_FLOOR, level: 0 },
  { at: 0.625, level: 1 },
  { at: 0.75, level: 2 },
  { at: 0.875, level: 3 },
  { at: 1, level: 4 },
]

/**
 * Return the whole weeks since a completed muscle-training timestamp.
 *
 * @param {number} now Current render-time timestamp in milliseconds.
 * @param {number} lastTrained Timestamp of the latest completed training event.
 * @returns {number} Non-negative whole weeks, including zero for ages under seven days.
 */
export function weeksSinceTraining(now, lastTrained) {
  return Math.max(0, Math.floor((now - lastTrained) / 86400000 / 7))
}

/**
 * Select the consumer-facing fatigue state for one numeric recovery value.
 * Values below .25 are ready, .25 through .5 are recovering, and values above .5 are fatigued.
 * Keeping this boundary selector in production code prevents views and tests from drifting apart.
 *
 * @param {number} value Numeric fatigue value from fatigueOf().
 * @returns {'ready'|'recovering'|'fatigued'} The stable state label for the UI.
 */
export function fatigueStateOf(value) {
  return value < 0.25
    ? FATIGUE_STATES.READY
    : value <= 0.5
      ? FATIGUE_STATES.RECOVERING
      : FATIGUE_STATES.FATIGUED
}
