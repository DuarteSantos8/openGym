import { CATALOGUE } from '../../frontend/src/lib/exercises.js'
import { buildCompletedWorkout } from '../../frontend/src/lib/finish-workout.js'
import { backfillStart, insertChronological } from '../../frontend/src/lib/backfill.js'
import { workoutVolume } from '../../frontend/src/lib/history.js'
import { stampWorkout } from '../../frontend/src/lib/sync-merge.js'
import { MEASUREMENT_KEYS, emptyMeasurement, normalizeMeasurementEntry } from '../../frontend/src/lib/measurements.js'
import { ProfileConflictError } from './profileStore.js'

// Narrow, pure edits. Each apply* takes a fresh profile and one validated request, returns a clone,
// and is idempotent so updateProfile can replay it on a 409. No deletes, no arbitrary state: Claude
// never supplies a profile or a key outside the allowlist. Weights are in the profile's unit as given.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const finite = x => typeof x === 'number' && Number.isFinite(x)
const reserved = new Set(['__proto__', 'constructor', 'prototype'])
const CATALOGUE_BY_ID = new Map(CATALOGUE.map(e => [e.id, e]))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key))
const round1 = x => Math.round(x * 10) / 10
// The app's own caps (sheets.jsx): a lift past the slider and a body weight past any person.
const loadMax = unit => (unit === 'lb' ? 660 : 300)
const bodyMax = unit => (unit === 'lb' ? 1500 : 700)
const unitOf = profile => profile.unit || 'kg'

const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// A real calendar day (2026-02-30 is not), not in the future, local zone like todayISO().
function date(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isoOf(new Date(`${value}T12:00:00`)) !== value ||
    value < '2000-01-01' || value > isoOf(new Date(now))) throw new Error('invalid date')
  return value
}

function list(profile, key) {
  if (profile[key] == null) return []
  if (!Array.isArray(profile[key])) throw new Error(`invalid ${key}`)
  return profile[key]
}

/* ------------------------------------ workout ------------------------------------ */

function parseWorkout(request, now) {
  if (!only(request, ['creationId', 'date', 'name', 'durationMin', 'exercises'])) throw new Error('invalid workout')
  if (typeof request.creationId !== 'string' || !UUID.test(request.creationId) || reserved.has(request.creationId)) throw new Error('invalid creationId')
  const day = date(request.date, now)
  if (request.name != null && (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 100)) throw new Error('invalid name')
  if (request.durationMin != null && (!Number.isInteger(request.durationMin) || request.durationMin < 1 || request.durationMin > 1440)) throw new Error('invalid duration')
  const list = request.exercises
  if (!Array.isArray(list) || list.length < 1 || list.length > 30) throw new Error('invalid workout')
  const exercises = list.map(raw => {
    if (!only(raw, ['id', 'sets']) || typeof raw.id !== 'string' || !raw.id || reserved.has(raw.id)) throw new Error('invalid workout')
    if (!Array.isArray(raw.sets) || raw.sets.length < 1 || raw.sets.length > 50) throw new Error('invalid workout')
    const sets = raw.sets.map(set => {
      if (!only(set, ['weight', 'reps'])) throw new Error('invalid workout')
      if (!finite(set.weight) || set.weight < 0) throw new Error('invalid weight')
      if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 999) throw new Error('invalid reps')
      return { w: set.weight, r: set.reps, done: true }
    })
    return { id: raw.id, sets }
  })
  return { id: request.creationId, d: day, name: request.name?.trim() || 'Freestyle', durationMin: request.durationMin ?? 60, exercises }
}

function builtWorkout(profile, parsed, now) {
  const customs = Array.isArray(profile.customEx) ? profile.customEx : []
  for (const { id, sets } of parsed.exercises) {
    if (!customs.some(x => x && x.id === id) && !CATALOGUE_BY_ID.has(id)) throw new Error('unknown exercise')
    if (sets.some(set => set.w > loadMax(unitOf(profile)))) throw new Error('invalid weight')
  }
  const start = backfillStart(parsed.d)
  const w = buildCompletedWorkout(
    { id: parsed.id, d: parsed.d, start, name: parsed.name, bw: null, entries: parsed.exercises.map(e => ({ id: e.id, sets: e.sets })) },
    { end: start + parsed.durationMin * 60000, prs: [] },
  )
  w.vol = workoutVolume(w)
  return stampWorkout(w, now)
}

// What a replay of the same creationId must still equal; later edits of note/media/stamps don't count.
const sameLog = (a, b) => JSON.stringify([a.d, a.name, a.start, a.end, a.entries]) === JSON.stringify([b.d, b.name, b.start, b.end, b.entries])

export function applyWorkout(profile, request, { now = Date.now() } = {}) {
  const parsed = parseWorkout(request, now)
  const next = structuredClone(profile)
  const workouts = list(next, 'workouts')
  const w = builtWorkout(next, parsed, now)
  const existing = workouts.find(x => x && x.id === w.id)
  // creationId is the workout id: a replay after a lost response finds its own record and leaves
  // it; a different workout at that id fails closed. Never deduped by date or name.
  if (existing) {
    if (!sameLog(existing, w)) throw new Error('creationId already used')
    return next
  }
  next.workouts = insertChronological(workouts, w)
  return next
}

/* ------------------------------------ body weight ------------------------------------ */

function parseBodyWeight(request, now) {
  if (!only(request, ['date', 'weight'])) throw new Error('invalid body weight')
  const d = date(request.date, now)
  if (!finite(request.weight) || request.weight <= 0) throw new Error('invalid weight')
  return { d, w: round1(request.weight) }
}

// One weigh-in per day, {d, w, t}: same day is updated in place, other days (including ones a
// concurrent device added) are untouched.
export function applyBodyWeight(profile, request, { now = Date.now() } = {}) {
  const { d, w } = parseBodyWeight(request, now)
  if (w <= 0 || w > bodyMax(unitOf(profile))) throw new Error('invalid weight')
  const next = structuredClone(profile)
  const entries = list(next, 'bodyweight')
  const existing = entries.find(b => b && b.d === d)
  if (existing) {
    if (existing.w !== w) { existing.w = w; existing.t = now }
  } else entries.push({ d, w, t: now })
  entries.sort((a, b) => (a.d < b.d ? -1 : 1))
  next.bodyweight = entries
  return next
}

/* ------------------------------------ measurement ------------------------------------ */

function parseMeasurement(request, now) {
  if (!only(request, ['date', 'valuesCm'])) throw new Error('invalid measurement')
  const d = date(request.date, now)
  const raw = request.valuesCm
  if (!object(raw) || Object.keys(raw).length === 0) throw new Error('invalid measurement')
  const values = {}
  for (const key of Object.keys(raw)) {
    const value = raw[key]
    // bodyFat is a percentage; every other field is centimetres whatever the weight unit.
    const max = key === 'bodyFat' ? 100 : 1000
    if (!MEASUREMENT_KEYS.includes(key) || !finite(value) || round1(value) <= 0 || value > max) throw new Error('invalid measurement')
    values[key] = round1(value)
  }
  return { d, values }
}

// One check-in per date, merged field by field: a field not in the request keeps its value.
export function applyMeasurement(profile, request, { now = Date.now() } = {}) {
  const { d, values } = parseMeasurement(request, now)
  const next = structuredClone(profile)
  const entries = list(next, 'measurements')
  const custom = Array.isArray(next.customMeasurements) ? next.customMeasurements : []
  const at = entries.findIndex(e => e && e.d === d)
  const entry = at < 0 ? emptyMeasurement(d, custom) : normalizeMeasurementEntry(entries[at], custom)
  const changed = at < 0 || Object.entries(values).some(([key, value]) => entry[key] !== value)
  Object.assign(entry, values)
  if (changed) entry.t = now
  if (at < 0) entries.push(entry); else entries[at] = entry
  entries.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  next.measurements = entries
  return next
}

/* ------------------------------------ settings ------------------------------------ */

// The only keys Claude may write. Not unit (it needs conversion), credentials, admin flags, ids,
// reminders or anything holding data. Each value is checked; the rest of the profile is untouched.
const SETTINGS = Object.freeze({
  restSec: v => Number.isInteger(v) && v >= 0 && v <= 900,
  theme: v => ['dark', 'light', 'system'].includes(v),
  weekStart: v => v === 0 || v === 1,
  targetW: v => v === null || (finite(v) && v > 0),
  wdec: v => v === 1 || v === 2,
  effort: v => v === null || ['none', 'rir', 'rpe'].includes(v),
})

function parseSetting(request) {
  if (!only(request, ['key', 'value']) || typeof request.key !== 'string' || !Object.hasOwn(SETTINGS, request.key)) throw new Error('unsupported setting')
  if (!SETTINGS[request.key](request.value)) throw new Error('invalid setting value')
  return { key: request.key, value: request.value }
}

export function applySetting(profile, request) {
  const { key, value } = parseSetting(request)
  if (key === 'targetW' && value !== null && value > bodyMax(unitOf(profile))) throw new Error('invalid setting value')
  const next = structuredClone(profile)
  next[key] = value
  return next
}

/* ------------------------------------ update wrappers ------------------------------------ */

// Validate the request before touching the store, then re-run the pure edit on every state
// updateProfile hands over. The first state's unit is pinned: the request's numbers are in that
// unit, and a retry that finds the other one must not save them.
async function run(store, bearer, check, apply, summary) {
  check()
  let unit
  try {
    const profile = await store.updateProfile(bearer, current => {
      if (unit === undefined) unit = unitOf(current)
      else if (unitOf(current) !== unit) throw new Error('unit mismatch')
      return apply(current)
    })
    return summary(profile)
  } catch (error) {
    if (error instanceof ProfileConflictError) throw new Error('profile conflict')
    throw error
  }
}

export function logWorkout(store, bearer, request, { now = Date.now() } = {}) {
  return run(store, bearer, () => parseWorkout(request, now), current => applyWorkout(current, request, { now }), profile => {
    const w = profile.workouts.find(x => x.id === request.creationId)
    return {
      id: w.id, date: w.d, name: w.name, exercises: w.entries.length,
      sets: w.entries.reduce((n, e) => n + e.sets.length, 0), volume: w.vol, unit: unitOf(profile),
    }
  })
}

export function logBodyWeight(store, bearer, request, { now = Date.now() } = {}) {
  return run(store, bearer, () => parseBodyWeight(request, now), current => applyBodyWeight(current, request, { now }), profile => {
    const b = profile.bodyweight.find(x => x.d === request.date)
    return { date: b.d, weight: b.w, unit: unitOf(profile) }
  })
}

export function logMeasurement(store, bearer, request, { now = Date.now() } = {}) {
  return run(store, bearer, () => parseMeasurement(request, now), current => applyMeasurement(current, request, { now }),
    () => ({ date: request.date, fields: Object.keys(request.valuesCm), unit: 'cm' }))
}

export function changeSetting(store, bearer, request) {
  return run(store, bearer, () => parseSetting(request), current => applySetting(current, request), profile => ({ key: request.key, value: profile[request.key] }))
}
