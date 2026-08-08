// Which muscles an exercise trains, and how hard — the data behind every muscle map.
//
// The exercise dataset names muscles in free text and is not consistent about it:
// "shoulders", "deltoids" and "delts" are the same thing, so are "quads" and
// "quadriceps", "lats" and "latissimus dorsi", "core" and "abdominals". Nineteen
// primary and forty secondary spellings collapse onto the eighteen muscles the body
// map can actually draw, via ALIAS below. Anything genuinely undrawable (hands,
// ankles, "cardiovascular system") maps to null and is dropped rather than guessed at.

import { isWarmupRow } from './workout-model.js'
import { EXIDX, smOf } from './exercises.js'

// The muscles a map can shade, in head-to-toe order — also the order of any list
// built from them, so "what am I neglecting" reads top-down like a body.
export const MUSCLES = [
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus',
  'biceps', 'triceps', 'forearm',
  'abs', 'obliques', 'lower-back',
  'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis',
]

// Drawn as the silhouette, never shaded: they carry no training load.
export const INERT = ['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles']

// English display names; these strings are the i18n keys (see lib/i18n.js).
export const MUSCLE_NAME = {
  trapezius: 'Traps', deltoids: 'Shoulders', chest: 'Chest', 'upper-back': 'Upper back',
  serratus: 'Serratus', biceps: 'Biceps', triceps: 'Triceps', forearm: 'Forearms',
  abs: 'Abs', obliques: 'Obliques', 'lower-back': 'Lower back', gluteal: 'Glutes',
  quadriceps: 'Quads', hamstring: 'Hamstrings', adductors: 'Adductors',
  'hip-flexors': 'Hip flexors', calves: 'Calves', tibialis: 'Shins',
}

// Every spelling that occurs in the dataset's `tg` and `sm` fields. null = not drawable.
const ALIAS = {
  // primaries
  abs: 'abs', pectorals: 'chest', biceps: 'biceps', glutes: 'gluteal', delts: 'deltoids',
  triceps: 'triceps', 'upper back': 'upper-back', lats: 'upper-back', calves: 'calves',
  quads: 'quadriceps', forearms: 'forearm', hamstrings: 'hamstring', spine: 'lower-back',
  traps: 'trapezius', adductors: 'adductors', 'serratus anterior': 'serratus',
  abductors: 'gluteal', 'levator scapulae': 'trapezius', 'cardiovascular system': null,
  // secondaries
  shoulders: 'deltoids', deltoids: 'deltoids', 'rear deltoids': 'deltoids',
  'rotator cuff': 'deltoids', quadriceps: 'quadriceps', core: 'abs', abdominals: 'abs',
  'lower abs': 'abs', chest: 'chest', 'upper chest': 'chest', 'hip flexors': 'hip-flexors',
  obliques: 'obliques', 'lower back': 'lower-back', rhomboids: 'upper-back',
  trapezius: 'trapezius', back: 'upper-back', 'latissimus dorsi': 'upper-back',
  brachialis: 'biceps', soleus: 'calves', shins: 'tibialis', wrists: 'forearm',
  'wrist flexors': 'forearm', 'wrist extensors': 'forearm', 'grip muscles': 'forearm',
  groin: 'adductors', 'inner thighs': 'adductors',
  ankles: null, feet: null, hands: null, 'ankle stabilizers': null,
  sternocleidomastoid: null,
}

// Custom exercises carry only a body part, so they fall back to it. Weights inside a
// group sum to 1 — "upper legs" spreads over three muscles rather than counting triple.
const BY_BODYPART = {
  chest: { chest: 1 },
  back: { 'upper-back': 0.75, 'lower-back': 0.25 },
  shoulders: { deltoids: 1 },
  'upper arms': { biceps: 0.5, triceps: 0.5 },
  'lower arms': { forearm: 1 },
  waist: { abs: 0.7, obliques: 0.3 },
  'upper legs': { quadriceps: 0.4, hamstring: 0.35, gluteal: 0.25 },
  'lower legs': { calves: 0.8, tibialis: 0.2 },
  neck: { trapezius: 1 },
  cardio: {},
}

const SECONDARY = 0.4   // a supporting muscle counts this much against a primary

const arrayOf = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value]

// Completed history entries may retain a nested snapshot after their custom exercise is
// deleted from the profile catalogue. Prefer that snapshot when the outer entry has no muscle
// metadata of its own, while keeping direct/legacy entry fields authoritative when present.
function metadataOf(ex) {
  if (!ex || typeof ex !== 'object') return ex
  const hasDirect = ['muscleGroups', 'muscles', 'targetMuscles'].some(key => Object.prototype.hasOwnProperty.call(ex, key))
    || [ex.tg, ex.mg, ...arrayOf(ex.sm)].some(value => value != null && value !== '')
  return !hasDirect && ex.muscleSnapshot && typeof ex.muscleSnapshot === 'object' && !Array.isArray(ex.muscleSnapshot)
    ? ex.muscleSnapshot
    : ex
}

function explicitGroupsOf(ex) {
  if (!ex || typeof ex !== 'object') return null
  if (Object.prototype.hasOwnProperty.call(ex, 'muscleGroups')) {
    const groups = arrayOf(ex.muscleGroups)
    return groups.length ? groups : null
  }
  if (Object.prototype.hasOwnProperty.call(ex, 'muscles')) {
    const groups = arrayOf(ex.muscles)
    return groups.length ? groups : null
  }
  if (Object.prototype.hasOwnProperty.call(ex, 'targetMuscles')) {
    const groups = arrayOf(ex.targetMuscles)
    return groups.length ? groups : null
  }
  return null
}

/** True only when the catalogue explicitly supplied muscle groups, not a body-part fallback. */
export function hasExplicitMuscleMetadata(ex) {
  const source = metadataOf(ex)
  if (!source || typeof source !== 'object') return false
  const groups = explicitGroupsOf(source)
  if (groups && groups.some(value => canonicalMuscle(value))) return true
  return [source.tg, source.mg, ...arrayOf(source.sm)].some(value => canonicalMuscle(value))
}

function canonicalMuscle(value) {
  const name = String(value || '').toLowerCase().trim()
  if (MUSCLES.includes(name)) return name
  return ALIAS[name] || null
}

/** Canonical unique muscle groups, accepting both new arrays and legacy single fields. */
export function muscleGroupsOf(ex) {
  const sourceEx = metadataOf(ex)
  const explicit = explicitGroupsOf(sourceEx)
  const source = explicit || [sourceEx?.tg, sourceEx?.mg, ...arrayOf(smOf(sourceEx))]
  const out = []
  source.forEach(value => {
    const slug = canonicalMuscle(value)
    if (slug && !out.includes(slug)) out.push(slug)
  })
  if (!out.length && explicit == null) Object.keys(BY_BODYPART[sourceEx?.bp] || {}).forEach(slug => { if (!out.includes(slug)) out.push(slug) })
  return out
}

export const normalizeMuscleGroups = muscleGroupsOf

/** True when any requested group matches; an empty request is an intentionally unfiltered query. */
export function matchesMuscleGroups(ex, requested) {
  const wanted = arrayOf(requested).map(canonicalMuscle).filter(Boolean)
  if (!wanted.length) return true
  const groups = new Set(muscleGroupsOf(ex))
  return wanted.some(group => groups.has(group))
}

/** Muscles one exercise trains: { slug: 0…1 }. Duplicate metadata never adds load twice. */
export function musclesOf(ex) {
  if (!ex) return {}
  const sourceEx = metadataOf(ex)
  if (sourceEx !== ex) return musclesOf(sourceEx)
  if (ex.muscleWeights && typeof ex.muscleWeights === 'object' && !Array.isArray(ex.muscleWeights)) {
    const snapshot = {}
    MUSCLES.forEach(slug => {
      const weight = Number(ex.muscleWeights[slug])
      if (Number.isFinite(weight) && weight > 0) snapshot[slug] = weight
    })
    if (Object.keys(snapshot).length) return snapshot
  }
  const out = {}
  const add = (name, w) => {
    const slug = canonicalMuscle(name)
    if (slug) out[slug] = Math.max(out[slug] || 0, w)
  }
  const explicit = explicitGroupsOf(ex)
  if (explicit) explicit.forEach(m => add(m, 1))
  else {
    add(ex.tg, 1)
    add(ex.mg, SECONDARY)
    arrayOf(smOf(ex)).forEach(m => add(m, SECONDARY))
  }
  // Nothing recognised (custom exercises, or a target we don't draw) — use the body part.
  if (!Object.keys(out).length) Object.assign(out, BY_BODYPART[ex.bp] || {})
  return out
}

/** Snapshot display and weighted muscle metadata into a completed history entry. */
export function exerciseMuscleSnapshot(ex) {
  if (!ex || typeof ex !== 'object') return {}
  const out = {}
  if (ex.n != null) out.n = ex.n
  if (ex.bp != null) out.bp = ex.bp
  const weights = musclesOf(ex)
  if (Object.keys(weights).length) out.muscleWeights = { ...weights }
  if (hasExplicitMuscleMetadata(ex)) out.muscleGroups = [...muscleGroupsOf(ex)]
  return out
}

/**
 * Training load per muscle, in "effective sets".
 * `items` is [{ id, sets }] — sets being a count, so a 4×8 bench press weighs four
 * times a single set. Volume in kg is deliberately not used: 100 kg of leg press
 * against 12 kg of lateral raise says nothing about which muscle worked harder.
 */
export function loadOf(items) {
  const load = {}
  items.forEach(item => {
    const { id, sets } = item || {}
    if (!sets) return
    const historical = item.ex || item.exercise
    const source = historical?.muscleWeights ? historical : (EXIDX[id] || historical || item)
    const m = musclesOf(source)
    for (const slug in m) load[slug] = (load[slug] || 0) + m[slug] * sets
  })
  return load
}

/**
 * Load for finished workouts (only sets actually ticked off count). `pick` narrows that
 * further — the map can then answer "where did the *hard* sets go", which is a different
 * question from where the sets went: a muscle can lead on volume and still never be trained
 * near failure.
 */
export const loadOfWorkouts = (workouts, pick) =>
  loadOf((workouts || []).flatMap(w =>
    (w.entries || []).map(e => ({ id: e.id, ex: e.exercise || e, sets: (e.sets || []).filter(s => s.done && !isWarmupRow(s) && (!pick || pick(s))).length }))))

/** Load a routine *would* produce, from its planned set counts. */
export const loadOfRoutine = routine =>
  loadOf((routine?.ex || []).map(c => ({ id: c.id, ex: c, sets: c.sets || 1 })))

/** Load for a workout still in progress — the sets ticked so far. */
export const loadOfActive = active =>
  loadOf((active?.entries || []).map(e => ({ id: e.id, ex: e.exercise || e, sets: (e.sets || []).filter(s => s.done && !isWarmupRow(s)).length })))

/**
 * Shade buckets 0–4 per muscle.
 *
 * With no `thresholds`, levels remain relative to the hardest-worked muscle in the same
 * window. This is the original balance-map behavior. When `thresholds` is supplied, levels
 * use an absolute scale instead: it is an ordered array of `{ at, level, exclusive? }` rules,
 * and the last matching rule wins. An exclusive rule matches values strictly greater than
 * `at`; otherwise the boundary is inclusive. Values below the first matching rule are l0.
 * Absolute rules let recovery views keep fixed semantic bands instead of renormalizing to the
 * strongest muscle on screen.
 */
export function levelsOf(load, thresholds) {
  if (thresholds) {
    const lv = {}
    MUSCLES.forEach(m => {
      const value = Number(load[m] || 0)
      let level = 0
      for (const rule of thresholds) {
        const matches = rule.exclusive ? value > rule.at : value >= rule.at
        if (matches) level = Math.max(0, Math.min(4, rule.level))
      }
      lv[m] = level
    })
    return lv
  }

  const max = Math.max(0, ...MUSCLES.map(m => load[m] || 0))
  const lv = {}
  MUSCLES.forEach(m => {
    const v = load[m] || 0
    lv[m] = !v ? 0 : max <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(v / max * 4)))
  })
  return lv
}

/** Muscles sorted hardest-worked first; untrained ones last, in body order. */
export function rankOf(load) {
  const worked = MUSCLES.filter(m => (load[m] || 0) > 0).sort((a, b) => load[b] - load[a])
  const missed = MUSCLES.filter(m => !(load[m] > 0))
  return { worked, missed }
}
