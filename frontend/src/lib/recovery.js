import { isWarmupRow } from './workout-model.js'
import { EXIDX } from './exercises.js'
import { MUSCLES, musclesOf } from './muscles.js'

/** Completed-workout window used when calculating current fatigue. */
// A "normal" hard session for one muscle, in primary-set equivalents. The saturation curve
// 1 - exp(-stimulus / REF) maps any session size onto [0,1) so volume raises the starting
// fatigue level without ever pinning it, and the value can then fade asymptotically.
export const FATIGUE_REF_VOLUME = 2000  // default reference: kg of intensity-weighted volume per session
export const FATIGUE_MIN_SESSIONS = 3  // sessions needed before the reference personalises to the user's own average
// Computational bound for the stimulus scan, not a semantic cliff: after 30 days (20
// half-lives) a session contributes below 1e-6 to the accumulated value.
export const FATIGUE_SCAN_MS = 30 * 24 * 60 * 60 * 1000
export const BODYWEIGHT_REF_LOAD = 75  // kg assumed for bodyweight exercises when no load is logged
export const CARDIO_TONNAGE_PER_MIN = 50  // duration proxy for cardio/timed work

/** Exponential half-life for fatigue stimulus. */
export const FATIGUE_HALF_LIFE_MS = 129600000

/** Period after training during which retained strength remains at full value. */
export const STRENGTH_FULL_MS = 1209600000

/** Exponential half-life for retained strength after the full-retention period. */
export const STRENGTH_HALF_LIFE_MS = 2419200000

/** Minimum retained-strength value for an untrained or fully detrained muscle. */
export const STRENGTH_FLOOR = 0.5

/**
 * Stable labels for consumer fatigue buckets: values below 0.25 are ready, values from 0.25
 * through 0.5 are recovering, and values above 0.5 are fatigued.
 */
export const FATIGUE_STATES = Object.freeze({
  READY: 'ready',
  RECOVERING: 'recovering',
  FATIGUED: 'fatigued',
})

/**
 * Return exponential decay expressed as a fraction of one half-life.
 *
 * @param {number} ageMs Elapsed age of the stimulus in milliseconds.
 * @param {number} halfLifeMs Duration of one half-life in milliseconds.
 * @returns {number} Remaining fraction, using the exact `0.5 ** (age / halfLife)` formula.
 */
export function halfLifeDecay(ageMs, halfLifeMs) {
  return 0.5 ** (ageMs / halfLifeMs)
}

// The v2 data contract has one timestamp per workout, not per set. Keep this fallback in one
// place so fatigue and strength use exactly the same stimulus time as effort.js.
function workoutTimestamp(workout) {
  const timestamp = workout?.start || new Date(workout?.d).getTime()
  return Number.isFinite(timestamp) ? timestamp : Number(timestamp)
}

function emptyMuscleMap(value) {
  return Object.fromEntries(MUSCLES.map(slug => [slug, value]))
}

function setUnitFor(set, entry, workout) {
  const u = set?.unit || entry?.unit || entry?.target?.unit || workout?.unit || null
  return u ? String(u).toLowerCase() : 'kg'
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// Epley one-rep-max estimate, matching onerm.js (REP_CAP included so high-rep sets do not
// inflate the estimate). Used only to express a set's intensity relative to the lifter's own
// capacity - the same formula the app already shows for estimated 1RM.
const REP_CAP = 12
const epley1RM = (load, reps) => load * (1 + Math.min(reps || 1, REP_CAP) / 30)

// Best recent Epley estimate per exercise, from done sets inside the scan window. A set's
// intensity (load / its exercise's estimated 1RM) is what defines a hard set: the same
// tonnage at 90% of your 1RM is far more fatiguing than at 50%, and the estimate is always
// the user's own, so beginners and experts are treated by the same relative scale.
function exercise1RMs(workouts, cutoff) {
  const best = new Map()
  for (const workout of workouts || []) {
    const timestamp = workoutTimestamp(workout)
    if (!Number.isFinite(timestamp) || timestamp <= cutoff) continue
    for (const entry of workout.entries || []) {
      for (const set of entry.sets || []) {
        if (set?.done !== true || !(set.w > 0) || !(set.r > 0) || isWarmupRow(set)) continue
        const unit = setUnitFor(set, entry, workout)
        const est = epley1RM(unit === 'lb' ? set.w * 0.45359237 : set.w, set.r)
        if (!best.has(entry.id) || est > best.get(entry.id)) best.set(entry.id, est)
      }
    }
  }
  return best
}

// Intensity-weighted tonnage for one completed set: load x reps x (load / exercise 1RM)^1.5.
// The exponent saturates the "hard set" effect - a set at 90% of your 1RM counts ~0.81 of its
// raw tonnage, one at 50% only ~0.35. Cardio, timed holds, and sets whose exercise has no
// 1RM history stay unweighted (duration proxies, or intensity 1 for the first sessions).
function setTonnage(ex, entry, set, bodyweightKg, oneRm, unit) {
  if (ex?.bp === 'cardio') {
    return Math.max(set?.min || 0, (set?.sec || 0) / 60) * CARDIO_TONNAGE_PER_MIN
  }
  if (set?.sec != null && set?.r == null) {
    return (set.sec / 60) * CARDIO_TONNAGE_PER_MIN
  }
  const reps = set?.r || 1
  // Bodyweight-targeted work: the body IS the load, and any added weight adds to it.
  const bodyweightTargeted = ex?.eq === 'body weight' || !!(entry?.target && entry.target.bodyweight)
  let load = bodyweightTargeted ? (bodyweightKg || BODYWEIGHT_REF_LOAD) + (set?.w || 0) : (set?.w || 0)
  if ((unit || set?.unit) === 'lb') load *= 0.45359237
  const raw = load * reps
  if (!(oneRm > 0) || !(load > 0)) return raw
  return raw * Math.min(1, load / oneRm) ** 1.5
}

// The user's own reference volume for a muscle: the mean per-session tonnage over the scan
// window (raw session sums, not decayed). With fewer than FATIGUE_MIN_SESSIONS of history the
// reference stays at FATIGUE_REF_VOLUME so a light or new user still sees a sensible curve.
function referenceTonnage(workouts, slug, now, bodyweightKg, oneRms) {
  const cutoff = Number(now) - FATIGUE_SCAN_MS
  const sessions = []
  for (const workout of workouts || []) {
    const timestamp = workoutTimestamp(workout)
    if (!Number.isFinite(timestamp) || timestamp <= cutoff) continue
    let sum = 0
    for (const entry of workout.entries || []) {
      const weights = musclesOf(EXIDX[entry.id])
      const weight = weights[slug]
      if (!weight) continue
      for (const set of entry.sets || []) {
        if (set?.done !== true) continue
        sum += setTonnage(EXIDX[entry.id], entry, set, bodyweightKg, oneRms.get(entry.id), setUnitFor(set, entry, workout)) * weight
      }
    }
    if (sum > 0) sessions.push(sum)
  }
  if (sessions.length >= FATIGUE_MIN_SESSIONS) {
    return sessions.reduce((a, b) => a + b, 0) / sessions.length
  }
  return FATIGUE_REF_VOLUME
}

// Yield one weighted stimulus per completed set. The stimulus is the set's tonnage scaled by
// the exercise's per-muscle weights (primary 1, secondary 0.4), so one set of 50 reps at
// medium weight registers real volume instead of counting like one set of 5.
function completedStimuli(workouts, include, bodyweightKg, oneRms, includeSet) {
  const stimuli = []
  for (const workout of workouts || []) {
    const timestamp = workoutTimestamp(workout)
    if (!Number.isFinite(timestamp) || !include(timestamp)) continue
    for (const entry of workout.entries || []) {
      const weights = musclesOf(EXIDX[entry.id])
      for (const set of entry.sets || []) {
        if (set?.done !== true) continue
        if (includeSet && !includeSet(set)) continue
        const tonnage = setTonnage(EXIDX[entry.id], entry, set, bodyweightKg, oneRms.get(entry.id), setUnitFor(set, entry, workout))
        if (tonnage <= 0) continue
        for (const [slug, weight] of Object.entries(weights)) {
          if (Object.prototype.hasOwnProperty.call(MUSCLES_BY_SLUG, slug)) {
            stimuli.push({ slug, timestamp, stimulus: tonnage * weight })
          }
        }
      }
    }
  }
  return stimuli
}

const MUSCLES_BY_SLUG = Object.fromEntries(MUSCLES.map(slug => [slug, true]))

function fatigueValue(events, now, refVolume = FATIGUE_REF_VOLUME) {
  if (!events.length) return 0
  events.sort((a, b) => a.timestamp - b.timestamp)

  let value = 0
  let lastTimestamp = events[0].timestamp
  for (const event of events) {
    value *= halfLifeDecay(event.timestamp - lastTimestamp, FATIGUE_HALF_LIFE_MS)
    value += event.stimulus
    lastTimestamp = event.timestamp
  }
  value *= halfLifeDecay(now - lastTimestamp, FATIGUE_HALF_LIFE_MS)
  // Normalise the accumulated stimulus to a saturating fatigue level: more volume starts
  // higher but never pins, and the value fades asymptotically - no window-edge cliff.
  return 1 - Math.exp(-value / refVolume)
}

/**
 * Calculate current per-muscle fatigue from completed sets in the recent window.
 *
 * Stimulus time is `workout.start`, falling back to the workout date `workout.d`. Each completed
 * set contributes the exercise's `musclesOf` weights; the scan is bounded to FATIGUE_SCAN_MS for
 * performance, not semantics. Stimuli are accumulated chronologically with a 36-hour half-life,
 * decayed to `now`, and normalised with the saturation curve 1 - exp(-v / FATIGUE_REF_VOLUME).
 * The result always contains every drawable muscle slug.
 *
 * @param {Array<object>} workouts Workout history with `start`/`d` and entry set arrays.
 * @param {number} now Current time in milliseconds; injected to keep this function deterministic.
 * @returns {Record<string, number>} Fatigue values keyed by every drawable muscle slug.
 */
export function fatigueOf(workouts, now, opts = {}) {
  const current = Number(now)
  const cutoff = current - FATIGUE_SCAN_MS
  const bodyweightKg = opts.bodyweightKg || null
  const oneRms = exercise1RMs(workouts, cutoff)
  const stimuli = completedStimuli(workouts, timestamp => timestamp > cutoff, bodyweightKg, oneRms, set => !isWarmupRow(set))
  const byMuscle = Object.fromEntries(MUSCLES.map(slug => [slug, []]))
  for (const stimulus of stimuli) byMuscle[stimulus.slug].push(stimulus)

  const result = emptyMuscleMap(0)
  if (!Number.isFinite(current)) return result
  for (const slug of MUSCLES) {
    const refVolume = referenceTonnage(workouts, slug, current, bodyweightKg, oneRms)
    result[slug] = fatigueValue(byMuscle[slug], current, refVolume)
  }
  return result
}

/**
 * Calculate retained per-muscle strength from the latest completed stimulus in all history.
 *
 * A muscle with no completed set starts at the 0.5 floor. After a completed set, strength is
 * 1.0 through 14 days old, then decays toward the floor with a 28-day half-life. Any later
 * completed set becomes the new latest stimulus and resets the 14-day full-retention period.
 * The result always contains every drawable muscle slug.
 *
 * @param {Array<object>} workouts Workout history with `start`/`d` and entry set arrays.
 * @param {number} now Current time in milliseconds; injected to keep this function deterministic.
 * @returns {Record<string, number>} Retained-strength values keyed by every drawable muscle slug.
 */
export function strengthOf(workouts, now) {
  const current = Number(now)
  const latest = Object.fromEntries(MUSCLES.map(slug => [slug, -Infinity]))
  const oneRms = exercise1RMs(workouts, -Infinity)
  const stimuli = completedStimuli(workouts, () => true, null, oneRms, set => !isWarmupRow(set))
  for (const stimulus of stimuli) {
    if (stimulus.timestamp > latest[stimulus.slug]) latest[stimulus.slug] = stimulus.timestamp
  }

  const result = emptyMuscleMap(STRENGTH_FLOOR)
  if (!Number.isFinite(current)) return result
  for (const slug of MUSCLES) {
    const lastTimestamp = latest[slug]
    if (!Number.isFinite(lastTimestamp)) continue
    const age = current - lastTimestamp
    if (age <= STRENGTH_FULL_MS) {
      result[slug] = 1
    } else {
      result[slug] = Math.max(
        STRENGTH_FLOOR,
        halfLifeDecay(age - STRENGTH_FULL_MS, STRENGTH_HALF_LIFE_MS),
      )
    }
  }
  return result
}

/**
 * List muscles currently above the fatigued threshold.
 *
 * @param {Array<object>} workouts Workout history passed to {@link fatigueOf}.
 * @param {number} now Current time in milliseconds passed to {@link fatigueOf}.
 * @returns {string[]} Muscle slugs whose fatigue value is greater than 0.5, in `MUSCLES`
 * head-to-toe order.
 * @example
 * const avoid = fatiguedMuscles(workouts, now)
 */
export function fatiguedMuscles(workouts, now) {
  return Object.entries(fatigueOf(workouts, now))
    .filter(([, value]) => value > 0.5)
    .map(([slug]) => slug)
}

/**
 * List muscles whose retained strength is below full retention.
 *
 * @param {Array<object>} workouts Workout history passed to {@link strengthOf}.
 * @param {number} now Current time in milliseconds passed to {@link strengthOf}.
 * @returns {string[]} Muscle slugs whose retained strength is less than 1.0, in `MUSCLES`
 * head-to-toe order; never-trained muscles are included at the 0.5 floor.
 * @example
 * const targets = detrainedMuscles(workouts, now)
 */
export function detrainedMuscles(workouts, now) {
  return Object.entries(strengthOf(workouts, now))
    .filter(([, value]) => value < 1)
    .map(([slug]) => slug)
}
