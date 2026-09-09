import { EXIDX } from './exercises.js'
import { MUSCLES, musclesOf } from './muscles.js'
import { isWarmupRow, dropsOf } from './workout-model.js'

// A "normal" hard session for one muscle, in primary-set equivalents. The saturation curve
// 1 - exp(-stimulus / REF) maps any session size onto [0,1) so volume raises the starting
// fatigue level without ever pinning it, and the value can then fade asymptotically.
export const FATIGUE_REF_VOLUME = 2000  // default reference: kg of intensity-weighted volume per session
export const FATIGUE_MIN_SESSIONS = 3  // smoothing horizon for the causal per-muscle reference
// Computational bound for the stimulus scan, not a semantic cliff: after 30 days (20
// half-lives) a session contributes below 1e-6 to the accumulated value.
export const FATIGUE_SCAN_MS = 30 * 24 * 60 * 60 * 1000
export const BODYWEIGHT_REF_LOAD = 75  // kg assumed for bodyweight exercises when no load is logged
export const CARDIO_TONNAGE_PER_MIN = 50  // duration proxy for cardio/timed work

// Preserve the shipped set-count signal when a completed custom/imported exercise has no load.
// Two such sets therefore retain the old 1 - exp(-2 / 3) starting-fatigue reading.
const ZERO_LOAD_SET_STIMULUS = FATIGUE_REF_VOLUME / 3

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

// Current catalogue metadata stays authoritative. Finished entries retain a nested muscle
// snapshot specifically so deleted custom exercises can still contribute to recovery maps.
function exerciseFor(entry) {
  return EXIDX[entry?.id] || entry
}

// Epley one-rep-max estimate, matching onerm.js (REP_CAP included so high-rep sets do not
// inflate the estimate). Used only to express a set's intensity relative to the lifter's own
// capacity - the same formula the app already shows for estimated 1RM.
const REP_CAP = 12
const epley1RM = (load, reps) => load * (1 + Math.min(reps || 1, REP_CAP) / 30)

export const LB_TO_KG = 0.45359237

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
    || numeric(opts.bodyweightKg) !== null
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

// Best Epley estimate inside one session. Keeping intensity context on the session makes a
// scored stimulus independent of later imports/deletes; unlike an all-history maximum, a
// 90-day-old CSV row cannot retroactively reweight today's sets.
function session1RMs(workout, opts = {}) {
  const best = new Map()
  for (const entry of workout?.entries || []) {
    const ex = exerciseFor(entry)
    for (const set of entry.sets || []) {
      const load = loadKgFor(ex, entry, set, workout, opts)
      if (set?.done !== true || !(load > 0) || !(set.r > 0)) continue
      const est = epley1RM(load, set.r)
      if (!best.has(entry.id) || est > best.get(entry.id)) best.set(entry.id, est)
    }
  }
  return best
}

// Extra tonnage from a drop-set's drops, weighted the same way as the row's own main set — a
// drop taken near failure counts the same as any other hard rep for fatigue purposes, it just
// carries its own (usually lighter) load.
//
// A rest-pause row's `clusters` are NOT extra here: the row's own `r` already is the total reps
// across every burst (see applyIntensifierPlan/history.js), so the main tonnage term below
// already covers it — adding clusters on top would double-count the same reps.
function extraTonnage(ex, entry, set, workout, oneRm, opts = {}) {
  const drops = dropsOf(set)
  if (!drops.length) return 0
  const isBwEx = bodyweightConfigured(ex, entry, set, workout, opts)
  const weigh = (load, reps) => {
    if (!(load > 0) || !(reps > 0)) return 0
    const raw = load * reps
    return isBwEx || !(oneRm > 0) ? raw : raw * Math.min(1, load / oneRm) ** 1.5
  }
  return drops.reduce((sum, d) => sum + weigh(loadKgFor(ex, entry, d, workout, opts), Number(d?.r) || 0), 0)
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
  const extra = extraTonnage(ex, entry, set, workout, oneRm, opts)
  // A bodyweight target is already an external-load-normalised total (body mass + any added
  // load). It has no meaningful barbell-style 1RM intensity ratio in the legacy data model, so
  // retain the monotonic total-load stimulus instead of letting a newly created low 1RM shrink
  // a weighted bodyweight set below the unloaded version.
  if (bodyweightConfigured(ex, entry, set, workout, opts)) return raw + extra
  if (!(oneRm > 0) || !(load > 0)) return raw + extra
  return raw * Math.min(1, load / oneRm) ** 1.5 + extra
}

// One session's per-muscle stimulus, calculated only from that session. A completed zero-load
// set gets the set-equivalent fallback instead of disappearing from fatigue.
function sessionTonnages(workout, opts = {}) {
  const sums = emptyMuscleMap(0)
  const oneRms = session1RMs(workout, opts)
  for (const entry of workout?.entries || []) {
    const ex = exerciseFor(entry)
    const weights = musclesOf(ex)
    for (const set of entry.sets || []) {
      if (set?.done !== true) continue
      const measured = setTonnage(ex, entry, set, workout, oneRms.get(entry.id), opts)
      const tonnage = Number.isFinite(measured) && measured > 0 ? measured : ZERO_LOAD_SET_STIMULUS
      for (const [slug, weight] of Object.entries(weights)) {
        if (Object.prototype.hasOwnProperty.call(MUSCLES_BY_SLUG, slug)) sums[slug] += tonnage * weight
      }
    }
  }
  return sums
}

// Build normalised stimuli in workout order. The reference seen by a session is strictly the
// reference left by earlier in-window sessions; the session cannot dilute its own score. The
// downward-only EWMA is deliberate: removing any earlier workout can only raise a later
// denominator (and removes its own positive stimulus), so deletion can never increase fatigue.
// Rebuilding from the bounded scan also makes imports older than the scan exactly irrelevant.
function fatigueStimuli(workouts, current, opts = {}) {
  const cutoff = current - FATIGUE_SCAN_MS
  const ordered = (workouts || [])
    .map((workout, index) => ({ workout, index, timestamp: workoutTimestamp(workout) }))
    .filter(item => Number.isFinite(item.timestamp) && item.timestamp > cutoff)
    .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)
  const references = emptyMuscleMap(FATIGUE_REF_VOLUME)
  const byMuscle = Object.fromEntries(MUSCLES.map(slug => [slug, []]))

  for (const { workout, timestamp } of ordered) {
    const sums = sessionTonnages(workout, opts)
    for (const slug of MUSCLES) {
      const stimulus = sums[slug]
      if (!(stimulus > 0)) continue
      byMuscle[slug].push({ slug, timestamp, stimulus: stimulus / references[slug] })
      const ewma = references[slug] + (stimulus - references[slug]) / FATIGUE_MIN_SESSIONS
      references[slug] = Math.min(references[slug], ewma)
    }
  }
  return byMuscle
}

const MUSCLES_BY_SLUG = Object.fromEntries(MUSCLES.map(slug => [slug, true]))

function fatigueValue(events, now) {
  if (!events.length) return 0
  events.sort((a, b) => a.timestamp - b.timestamp)

  let value = 0
  let lastTimestamp = events[0].timestamp
  for (const event of events) {
    value *= halfLifeDecay(event.timestamp - lastTimestamp, FATIGUE_HALF_LIFE_MS)
    value += event.stimulus
    lastTimestamp = event.timestamp
  }
  value *= halfLifeDecay(Math.max(0, now - lastTimestamp), FATIGUE_HALF_LIFE_MS)
  // Normalise the accumulated stimulus to a saturating fatigue level: more volume starts
  // higher but never pins, and the value fades asymptotically - no window-edge cliff.
  return 1 - Math.exp(-value)
}

/**
 * Calculate current per-muscle fatigue from completed sets in the recent window.
 *
 * Stimulus time is `workout.start`, falling back to the workout date `workout.d`. Each completed
 * set contributes the exercise's `musclesOf` weights; the scan is bounded to FATIGUE_SCAN_MS for
 * performance, not semantics. Stimuli are accumulated chronologically with a 36-hour half-life,
 * decayed to `now`, and normalised with the saturation curve 1 - exp(-v). Each session is scored
 * against a causal, downward-only EWMA left by strictly earlier in-window sessions. Session-local
 * intensity estimates and the causal reference make out-of-window imports irrelevant, while
 * deleting a workout can only remove stimulus and/or raise later references.
 * The result always contains every drawable muscle slug.
 *
 * @param {Array<object>} workouts Workout history with `start`/`d` and entry set arrays.
 * @param {number} now Current time in milliseconds; injected to keep this function deterministic.
 * @param {{unit?: string}} options Reserved profile-level options; unit is supplied at the UI boundary.
 * @returns {Record<string, number>} Fatigue values keyed by every drawable muscle slug.
 */
export function fatigueOf(workouts, now, opts = {}) {
  const current = Number(now)
  const result = emptyMuscleMap(0)
  if (!Number.isFinite(current)) return result
  const byMuscle = fatigueStimuli(workouts, current, opts)
  for (const slug of MUSCLES) result[slug] = fatigueValue(byMuscle[slug], current)
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
  for (const workout of workouts || []) {
    const timestamp = workoutTimestamp(workout)
    if (!Number.isFinite(timestamp)) continue
    for (const entry of workout.entries || []) {
      if (!(entry.sets || []).some(set => set?.done === true && !isWarmupRow(set))) continue
      for (const slug of Object.keys(musclesOf(exerciseFor(entry)))) {
        if (Object.prototype.hasOwnProperty.call(MUSCLES_BY_SLUG, slug) && timestamp > latest[slug]) {
          latest[slug] = timestamp
        }
      }
    }
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
