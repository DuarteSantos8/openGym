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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// Epley one-rep-max estimate, matching onerm.js (REP_CAP included so high-rep sets do not
// inflate the estimate). Used only to express a set's intensity relative to the lifter's own
// capacity - the same formula the app already shows for estimated 1RM.
const REP_CAP = 12
const epley1RM = (load, reps) => load * (1 + Math.min(reps || 1, REP_CAP) / 30)

const LB_TO_KG = 0.45359237

function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function isPounds(unit) {
  return /^(?:lb|lbs|pound|pounds)$/i.test(String(unit ?? '').trim())
}

function unitOf(...records) {
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    for (const key of ['unit', 'u', 'weightUnit', 'weight_unit', 'loadUnit']) {
      if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') return record[key]
    }
  }
  return 'kg'
}

function kgOf(value, unit) {
  const n = numeric(value)
  if (n === null) return 0
  return Math.max(0, n) * (isPounds(unit) ? LB_TO_KG : 1)
}

// A bodyweight value stamped on a workout is the best historical value. When old records do not
// carry one, use the current profile's canonical bodyweight supplied by Stats, then the stable
// fallback used by the original fatigue model. `bodyweightKg` is already canonical; `bodyweight`
// is accepted for callers that provide a display-unit value explicitly.
function bodyweightKgFor(workout, opts = {}, stampedLoadUnit) {
  const stamped = numeric(workout?.bw) ?? numeric(workout?.bodyweight)
  if (stamped !== null) {
    return kgOf(stamped, unitOf(
      { unit: workout?.bwUnit },
      { unit: workout?.bodyweightUnit },
      workout,
      stampedLoadUnit && { unit: stampedLoadUnit },
      opts,
    ))
  }
  const canonical = numeric(opts.bodyweightKg)
  if (canonical !== null) return Math.max(0, canonical)
  const display = numeric(opts.bodyweight)
  if (display !== null) return kgOf(display, opts.bodyweightUnit || opts.unit || opts.profileUnit)
  return BODYWEIGHT_REF_LOAD
}

function bodyweightTarget(entry) {
  const target = entry?.target
  if (target && Object.prototype.hasOwnProperty.call(target, 'bodyweight')) return !!target.bodyweight
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'bodyweight')) return !!entry.bodyweight
  return null
}

function hasUnitStamp(...records) {
  return records.some(record => record && typeof record === 'object'
    && ['unit', 'u', 'weightUnit', 'weight_unit', 'loadUnit'].some(key => Object.prototype.hasOwnProperty.call(record, key)
      && record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== ''))
}

function bodyweightConfigured(ex, entry, set, workout, opts = {}) {
  const configured = bodyweightTarget(entry)
  if (configured !== null) return configured
  // Before target.bodyweight was persisted, a positive `w` on a catalogue bodyweight exercise
  // already meant an explicitly entered load. Keep those rows compatible when no body-mass
  // context is available; a stamped workout or a profile bodyweight makes the intended total-load
  // semantics unambiguous even for old entries.
  const added = kgOf(set?.w, unitOf(set, entry?.target, entry, workout, opts))
  const hasBodyweightContext = numeric(workout?.bw) !== null
    || numeric(workout?.bodyweight) !== null
    || Object.prototype.hasOwnProperty.call(opts, 'bodyweightKg')
    || numeric(opts.bodyweight) !== null
    || hasUnitStamp(set, entry?.target, entry, workout)
  return ex?.eq === 'body weight' && (added === 0 || hasBodyweightContext)
}

function loadKgFor(ex, entry, set, workout, opts = {}) {
  const setUnit = unitOf(set, entry?.target, entry, workout, opts)
  const addedKg = kgOf(set?.w, setUnit)
  const loadUnit = hasUnitStamp(set, entry?.target, entry) ? setUnit : undefined
  return bodyweightConfigured(ex, entry, set, workout, opts)
    ? bodyweightKgFor(workout, opts, loadUnit) + addedKg
    : addedKg
}

function optionsKey(opts = {}) {
  return [
    isPounds(opts.unit || opts.profileUnit) ? 'lb' : 'kg',
    numeric(opts.bodyweightKg) ?? '',
    numeric(opts.bodyweight) ?? '',
    opts.bodyweightUnit || '',
  ].join('|')
}

// Best recent Epley estimate per exercise, from done sets inside the scan window. A set's
// intensity (load / its exercise's estimated 1RM) is what defines a hard set: the same
// tonnage at 90% of your 1RM is far more fatiguing than at 50%, and the estimate is always
// the user's own, so beginners and experts are treated by the same relative scale.
// Memoised per (workouts, cutoff, load context): fatigueOf and strengthOf both call it on the
// same workouts array each 60-second tick, and the map is a pure function of those inputs.
let oneRmCache = { workouts: undefined, cutoff: NaN, context: '', map: new Map() }
function exercise1RMs(workouts, cutoff, opts = {}) {
  const context = optionsKey(opts)
  if (oneRmCache.workouts === workouts && oneRmCache.cutoff === cutoff && oneRmCache.context === context) return oneRmCache.map
  const best = new Map()
  for (const workout of workouts || []) {
    const timestamp = workoutTimestamp(workout)
    if (!Number.isFinite(timestamp) || timestamp <= cutoff) continue
    for (const entry of workout.entries || []) {
      const ex = EXIDX[entry.id]
      for (const set of entry.sets || []) {
        const load = loadKgFor(ex, entry, set, workout, opts)
        if (set?.done !== true || !(load > 0) || !(set.r > 0)) continue
        const est = epley1RM(load, set.r)
        if (!best.has(entry.id) || est > best.get(entry.id)) best.set(entry.id, est)
      }
    }
  }
  oneRmCache = { workouts, cutoff, context, map: best }
  return best
}

// Intensity-weighted tonnage for one completed set: load x reps x (load / exercise 1RM)^1.5.
// The exponent saturates the "hard set" effect - a set at 90% of your 1RM counts ~0.81 of its
// raw tonnage, one at 50% only ~0.35. Cardio, timed holds, and sets whose exercise has no
// 1RM history stay unweighted (duration proxies, or intensity 1 for the first sessions).
function setTonnage(ex, entry, set, workout, oneRm, opts = {}) {
  if (ex?.bp === 'cardio') {
    return Math.max(set?.min || 0, (set?.sec || 0) / 60) * CARDIO_TONNAGE_PER_MIN
  }
  if (set?.sec != null && set?.r == null) {
    return (set.sec / 60) * CARDIO_TONNAGE_PER_MIN
  }
  const reps = set?.r || 1
  const load = loadKgFor(ex, entry, set, workout, opts)
  const raw = load * reps
  // A bodyweight target is already an external-load-normalised total (body mass + any added
  // load). It has no meaningful barbell-style 1RM intensity ratio in the legacy data model, so
  // retain the monotonic total-load stimulus instead of letting a newly created low 1RM shrink
  // a weighted bodyweight set below the unloaded version.
  if (bodyweightConfigured(ex, entry, set, workout, opts)) return raw
  if (!(oneRm > 0) || !(load > 0)) return raw
  return raw * Math.min(1, load / oneRm) ** 1.5
}

// The user's own reference volume per muscle: the mean per-session tonnage over the scan
// window (raw session sums, not decayed). With fewer than FATIGUE_MIN_SESSIONS of history the
// reference stays at FATIGUE_REF_VOLUME so a light or new user still sees a sensible curve.
// ONE pass over history accumulates every muscle at once (the previous per-slug version
// walked the whole history once per muscle - 18 scans on every 60-second tick).
function referenceTonnages(workouts, now, opts = {}, oneRms) {
  const cutoff = Number(now) - FATIGUE_SCAN_MS
  const sessions = Object.fromEntries(MUSCLES.map(slug => [slug, []]))
  for (const workout of workouts || []) {
    const timestamp = workoutTimestamp(workout)
    if (!Number.isFinite(timestamp) || timestamp <= cutoff) continue
    const sums = Object.fromEntries(MUSCLES.map(slug => [slug, 0]))
    for (const entry of workout.entries || []) {
      const weights = musclesOf(EXIDX[entry.id])
      for (const set of entry.sets || []) {
        if (set?.done !== true) continue
        const tonnage = setTonnage(EXIDX[entry.id], entry, set, workout, oneRms.get(entry.id), opts)
        if (tonnage <= 0) continue
        for (const [slug, weight] of Object.entries(weights)) {
          if (Object.prototype.hasOwnProperty.call(MUSCLES_BY_SLUG, slug)) {
            sums[slug] += tonnage * weight
          }
        }
      }
    }
    for (const slug of MUSCLES) {
      if (sums[slug] > 0) sessions[slug].push(sums[slug])
    }
  }
  const out = {}
  for (const slug of MUSCLES) {
    const list = sessions[slug]
    out[slug] = list.length >= FATIGUE_MIN_SESSIONS
      ? list.reduce((a, b) => a + b, 0) / list.length
      : FATIGUE_REF_VOLUME
  }
  return out
}

// Yield one weighted stimulus per completed set. The stimulus is the set's tonnage scaled by
// the exercise's per-muscle weights (primary 1, secondary 0.4), so one set of 50 reps at
// medium weight registers real volume instead of counting like one set of 5.
function completedStimuli(workouts, include, opts = {}, oneRms, includeSet) {
  const stimuli = []
  for (const workout of workouts || []) {
    const timestamp = workoutTimestamp(workout)
    if (!Number.isFinite(timestamp) || !include(timestamp)) continue
    for (const entry of workout.entries || []) {
      const weights = musclesOf(EXIDX[entry.id])
      for (const set of entry.sets || []) {
        if (set?.done !== true) continue
        if (includeSet && !includeSet(set)) continue
        const tonnage = setTonnage(EXIDX[entry.id], entry, set, workout, oneRms.get(entry.id), opts)
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
 * The personalised reference is the user's OWN 30-day average, so the yardstick moves with
 * them: a month of steadily rising volume raises the reference in step and never reads as
 * accumulating fatigue, while a deload reads MORE fatigued as the average decays. That
 * "relative to your own capacity" semantics is deliberate, not a bug.
 *
 * @param {Array<object>} workouts Workout history with `start`/`d` and entry set arrays.
 * @param {number} now Current time in milliseconds; injected to keep this function deterministic.
 * @returns {Record<string, number>} Fatigue values keyed by every drawable muscle slug.
 */
export function fatigueOf(workouts, now, opts = {}) {
  const current = Number(now)
  const cutoff = current - FATIGUE_SCAN_MS
  const oneRms = exercise1RMs(workouts, cutoff, opts)
  const stimuli = completedStimuli(workouts, timestamp => timestamp > cutoff, opts, oneRms)
  const byMuscle = Object.fromEntries(MUSCLES.map(slug => [slug, []]))
  for (const stimulus of stimuli) byMuscle[stimulus.slug].push(stimulus)

  const result = emptyMuscleMap(0)
  if (!Number.isFinite(current)) return result
  const refVolumes = referenceTonnages(workouts, current, opts, oneRms)
  for (const slug of MUSCLES) {
    result[slug] = fatigueValue(byMuscle[slug], current, refVolumes[slug])
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
export function strengthOf(workouts, now, opts = {}) {
  const current = Number(now)
  const latest = Object.fromEntries(MUSCLES.map(slug => [slug, -Infinity]))
  const oneRms = exercise1RMs(workouts, -Infinity, opts)
  const stimuli = completedStimuli(workouts, () => true, opts, oneRms, set => !set?.warmup)
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
export function fatiguedMuscles(workouts, now, opts = {}) {
  return Object.entries(fatigueOf(workouts, now, opts))
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
export function detrainedMuscles(workouts, now, opts = {}) {
  return Object.entries(strengthOf(workouts, now, opts))
    .filter(([, value]) => value < 1)
    .map(([slug]) => slug)
}
