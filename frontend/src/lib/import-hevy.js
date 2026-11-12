// Import a Hevy account through the public API (https://api.hevyapp.com/docs/).
//
// Exercise identity is Hevy's `exercise_template_id`, looked up in the generated
// `hevy-id-map.js` table — never the localized title on a set. Regenerate the map
// with `node scripts/build-hevy-id-map.mjs`. The API key never leaves this module's
// callers: nothing here stores it.

import { EXIDX, canonicalExId } from './exercises.js'
import { uid } from './format.js'
import { isWarmupRow } from './workout-model.js'
import { HEVY_ID_MAP, HEVY_TITLE_MAP } from './hevy-id-map.js'
import { daysBetween, importId, mergeImport, priorCustom, roundWeight } from './import-csv.js'
import { NOTE_MAX } from './history.js'
import { pickFor, nameKey, inRange } from './import-choices.js'
import { cleanFolder, folderOf } from './routine-folders.js'
import { stampWorkout } from './sync-merge.js'
import { splitSportWorkouts } from './activities.js'
import { MUSCLE_MODEL, inMuscleOrder } from './muscles.js'
import { MEASUREMENT_KEYS } from './measurements.js'

export { HEVY_ID_MAP, HEVY_TITLE_MAP }
export const HEVY_API = 'https://api.hevyapp.com'
export const HEVY_DEV_SETTINGS = 'https://hevy.com/settings?developer'

const LB_TO_KG = 0.45359237

/* --------------------------------------------------------------- auth/fetch -- */

class HevyApiError extends Error {
  constructor(status, message) {
    super(message || `Hevy API error ${status}`)
    this.name = 'HevyApiError'
    this.status = status
  }
}

async function hevyGet(path, apiKey, params = {}, signal) {
  const url = new URL(path, HEVY_API)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  // Hevy publishes no rate limit, but a large account is 100+ sequential page requests; a 429
  // gets a short back-off and one more try before it surfaces as its own error kind.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'api-key': apiKey }, ...(signal ? { signal } : {}) })
    if (res.status === 401 || res.status === 403) {
      throw new HevyApiError(res.status, 'auth')
    }
    if (res.status === 429 && attempt < 2) {
      const after = Number(res.headers?.get?.('retry-after'))
      await new Promise(r => setTimeout(r, (after > 0 && after <= 30 ? after : 2 * (attempt + 1)) * 1000))
      continue
    }
    if (res.status === 429) throw new HevyApiError(res.status, 'rate-limit')
    if (!res.ok) throw new HevyApiError(res.status, `http ${res.status}`)
    return res.json()
  }
}

/** Page through a Hevy list endpoint. `pageSize` caps differ per resource. */
export async function fetchHevyPages(path, apiKey, {
  resultKey,
  pageSize = 10,
  onProgress,
  signal,
} = {}) {
  const items = []
  let page = 1
  let pageCount = 1
  while (page <= pageCount) {
    const data = await hevyGet(path, apiKey, { page, pageSize }, signal)
    // Given up on (orNullWithin): no more pages, and no progress over a later stage's.
    if (signal?.aborted) break
    pageCount = Math.max(1, data.page_count || 1)
    const batch = data[resultKey] || []
    items.push(...batch)
    onProgress && onProgress({ page, pageCount, loaded: items.length, resultKey })
    if (!batch.length) break
    page++
  }
  return items
}

export async function fetchHevyAccount(apiKey, { onProgress } = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new HevyApiError(0, 'empty')

  const templates = await fetchHevyPages('/v1/exercise_templates', key, {
    resultKey: 'exercise_templates', pageSize: 100,
    onProgress: p => onProgress && onProgress({ stage: 'templates', ...p }),
  })
  const workouts = await fetchHevyPages('/v1/workouts', key, {
    resultKey: 'workouts', pageSize: 10,
    onProgress: p => onProgress && onProgress({ stage: 'workouts', ...p }),
  })
  const routines = await fetchHevyPages('/v1/routines', key, {
    resultKey: 'routines', pageSize: 10,
    onProgress: p => onProgress && onProgress({ stage: 'routines', ...p }),
  })
  // The routine folders, null when they could not be read (an error, a key from before Hevy had
  // them): the routines still import, and the folders they already have here are left alone.
  let routineFolders = null
  if (routines.length) {
    routineFolders = await orNullWithin(OPTIONAL_WAIT_MS, signal => fetchHevyPages('/v1/routine_folders', key, {
      resultKey: 'routine_folders', pageSize: 10, signal,
      onProgress: p => onProgress && onProgress({ stage: 'routines', ...p }),
    }))
  }
  let bodyMeasurements = []
  try {
    bodyMeasurements = await fetchHevyPages('/v1/body_measurements', key, {
      resultKey: 'body_measurements', pageSize: 10,
      onProgress: p => onProgress && onProgress({ stage: 'body', ...p }),
    })
  } catch (e) {
    // Older keys / accounts may lack measurements — workouts still import.
    if (!(e instanceof HevyApiError) || e.message === 'auth') throw e
  }
  const weightUnit = await fetchHevyWeightUnit(key)
  return { templates, workouts, routines, routineFolders, bodyMeasurements, weightUnit }
}

// How long an optional read may take before the import goes on without it.
const OPTIONAL_WAIT_MS = 20e3

/**
 * What `read(signal)` answers, or null when it throws or takes longer than `ms`. The signal is
 * aborted then, so the request ends and a late answer changes nothing.
 */
async function orNullWithin(ms, read) {
  const stop = new AbortController()
  let timer
  const late = new Promise(r => { timer = setTimeout(() => { stop.abort(); r(null) }, ms) })
  try {
    return await Promise.race([read(stop.signal), late])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The unit the Hevy account shows weights in ('kg' | 'lb'), for one line on the summary. Null
 * when it cannot be read (an error, no answer within 20 s, an answer without it): nothing else
 * depends on it, so the import goes on either way.
 */
export function fetchHevyWeightUnit(apiKey) {
  return orNullWithin(OPTIONAL_WAIT_MS, async signal => {
    const res = await fetch(new URL('/v1/user/info', HEVY_API), { headers: { 'api-key': apiKey }, signal })
    if (!res?.ok) return null
    const u = (await res.json())?.data?.weight_unit
    return u === 'lbs' || u === 'lb' ? 'lb' : u === 'kg' ? 'kg' : null
  })
}

/* ---------------------------------------------------------- template → id -- */

// Hevy primary_muscle_group → openGym body-part for exercises we invent. Indexed straight from
// the API's text, so it has no prototype: a plain object answers "constructor" and "__proto__"
// with Object's own machinery, and that would ride into the store as a body part.
const HEVY_BP = Object.assign(Object.create(null), {
  biceps: 'upper arms', triceps: 'upper arms', forearms: 'lower arms',
  chest: 'chest', lats: 'back', upper_back: 'back', lower_back: 'back',
  traps: 'back', shoulders: 'shoulders',
  abdominals: 'waist', abs: 'waist', obliques: 'waist',
  quadriceps: 'upper legs', hamstrings: 'upper legs', glutes: 'upper legs',
  abductors: 'upper legs', adductors: 'upper legs', calves: 'lower legs',
  cardio: 'cardio', full_body: 'upper legs', other: 'upper legs', neck: 'neck',
})

/**
 * Resolve a Hevy exercise template to a catalogue id.
 *
 * Deterministic: only `HEVY_ID_MAP` (generated by scripts/build-hevy-id-map.mjs).
 * No runtime name guessing — unmatched templates become custom exercises.
 */
export function matchHevyTemplate(template) {
  if (!template?.id) return null
  const id = HEVY_ID_MAP[template.id]
  return id && EXIDX[id] ? id : null
}

/** Build templateId → catalogue id (or null) from a templates list. */
export function buildHevyExerciseMap(templates) {
  const map = new Map()
  for (const t of templates || []) {
    if (!t?.id) continue
    map.set(t.id, matchHevyTemplate(t))
  }
  return map
}

/* --------------------------------------------------------------- parse ---- */

const p2 = n => String(n).padStart(2, '0')

// An id from the API as text to compare by: a string or a number, anything else is no id. Ids are
// only ever compared through a Map, never used to index a plain object.
const ID_MAX = 100
const hevyIdOf = v => (typeof v === 'string' ? (v && v.length <= ID_MAX ? v : null)
  : typeof v === 'number' && Number.isFinite(v) ? String(v) : null)

/** Hevy ISO timestamps → local calendar date + ms-since-midnight (matches CSV import). */
export function localWhen(iso) {
  // Hevy writes ISO strings. Anything else is not a time — null in particular, which Date
  // reads as the epoch and would file the session under 1970.
  if (typeof iso !== 'string') return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  const t = d.getHours() * 3600000 + d.getMinutes() * 60000 + d.getSeconds() * 1000
  return { d: day, t }
}

function bpOfTemplate(t) {
  const g = String(t?.primary_muscle_group || '').toLowerCase()
  return HEVY_BP[g] || 'upper legs'
}

// Hevy's muscle groups → the muscles the body map draws (lib/muscles.js). "shoulders" is the
// generic shoulder; cardio, neck, full body and other have no muscle there and are left out.
const HEVY_MUSCLE = Object.assign(Object.create(null), {
  abdominals: 'abs', shoulders: 'deltoids', biceps: 'biceps', triceps: 'triceps', forearms: 'forearm',
  quadriceps: 'quadriceps', hamstrings: 'hamstring', calves: 'calves', glutes: 'gluteal',
  abductors: 'gluteal', adductors: 'adductors', lats: 'lats', upper_back: 'upper-back',
  traps: 'trapezius', lower_back: 'lower-back', chest: 'chest',
})
// Hevy's equipment → the app's equipment kinds. "other" has no kind and stays as it was.
const HEVY_EQUIPMENT = Object.assign(Object.create(null), {
  none: 'body weight', barbell: 'barbell', dumbbell: 'dumbbell', kettlebell: 'kettlebell',
  machine: 'leverage machine', plate: 'weight plate', resistance_band: 'resistance band',
  suspension: 'suspension trainer',
})
const muscleOf = g => (typeof g === 'string' ? HEVY_MUSCLE[g.toLowerCase()] || null : null)

/**
 * What a Hevy exercise template says about its exercise: `eq` (an equipment kind, or null) and
 * the `primaries` and `secondaries` (muscle keys, each possibly empty). Hevy calls a cable or a
 * Smith machine just "machine", so the title tells those apart.
 */
export function hevyTemplateInfo(t) {
  const kind = typeof t?.equipment === 'string' ? t.equipment.toLowerCase() : ''
  const title = typeof t?.title === 'string' ? t.title : ''
  let eq = HEVY_EQUIPMENT[kind] || null
  if (kind === 'machine' && /\bcable\b/i.test(title)) eq = 'cable'
  if (kind === 'machine' && /\bsmith\b/i.test(title)) eq = 'smith machine'
  const primaries = [muscleOf(t?.primary_muscle_group)].filter(Boolean)
  const others = Array.isArray(t?.secondary_muscle_groups) ? t.secondary_muscle_groups : []
  const secondaries = inMuscleOrder([...new Set(others.map(muscleOf).filter(m => m && !primaries.includes(m)))])
  return { eq, primaries, secondaries }
}

const hasMuscles = c => !!(c.tg || c.primaries?.length || c.secondaries?.length || c.sm?.length || c.muscleGroups?.length)

/**
 * A custom exercise made from a Hevy template takes the template's muscles when it has none, and
 * its equipment when it has none of its own ('custom' is what the import gave it). What is set on
 * the exercise is never replaced. Mutates `c`; returns whether anything changed.
 */
function fromHevyTemplate(c, t) {
  const { eq, primaries, secondaries } = hevyTemplateInfo(t)
  let changed = false
  if (eq && (!c.eq || c.eq === 'custom')) { c.eq = eq; changed = true }
  if (primaries.length && !hasMuscles(c)) {
    Object.assign(c, {
      tg: primaries[0], primaries, secondaries, sm: secondaries,
      muscleGroups: [...primaries, ...secondaries], mv: MUSCLE_MODEL,
    })
    changed = true
  }
  return changed
}

/**
 * The custom exercises an earlier import made from Hevy templates (their id comes from the
 * template id, see makeResolver) get the muscles and equipment they still lack. Mutates `S`;
 * returns how many it changed.
 */
export function fillHevyCustomExercises(S, templates) {
  const byId = new Map((Array.isArray(S?.customEx) ? S.customEx : []).filter(c => c?.custom).map(c => [c.id, c]))
  let n = 0
  for (const t of Array.isArray(templates) ? templates : []) {
    const tid = hevyIdOf(t?.id)
    const c = tid ? byId.get(importId('im', 'Hevy|' + tid)) : null
    if (c && fromHevyTemplate(c, t)) n++
  }
  return n
}

/**
 * Shared resolver: the user's own custom exercise when an earlier import made one (priorCustom,
 * so one exercise keeps one id once the map learns it), else a HEVY_ID_MAP hit, else one custom
 * exercise per Hevy template id. `customEx`: the custom exercises already in state.
 */
function makeResolver(templates, customEx, matches) {
  const byId = new Map((templates || []).map(t => [t.id, t]))
  const created = new Map()
  const titleOf = new Map()      // custom id → the name Hevy showed for it
  const matchedIds = new Set()
  const names = new Map()        // template → { key, name, id, auto } for the summary's choices

  const resolve = (templateId, fallbackTitle) => {
    const key = templateId || String(fallbackTitle || '').toLowerCase()
    if (!key) return null
    const t = templateId ? byId.get(templateId) : null
    const title = String(t?.title || fallbackTitle || '').trim()
    const ownId = importId('im', 'Hevy|' + key)
    const own = priorCustom(customEx, ownId, t?.title || fallbackTitle)
    const pinned = templateId && canonicalExId(HEVY_ID_MAP[templateId])
    const auto = own ? own.id : pinned && EXIDX[pinned] ? pinned : null
    // Your pick on the summary (lib/import-choices.js) beats the table; "keep it as your own"
    // still finds the one an earlier import made.
    const pick = pickFor(matches, title, customEx)
    const id = pick === undefined ? auto : pick === null ? (own ? own.id : null) : pick
    if (!names.has(key) && title) names.set(key, { key: nameKey(title), name: title, id: id || ownId, auto: auto || ownId })
    if (id) {
      if (EXIDX[id] && !EXIDX[id].custom) matchedIds.add(id)
      return id
    }
    let c = created.get(key)
    if (!c) {
      const name = (t?.title || fallbackTitle || 'exercise').toLowerCase()
      c = {
        id: importId('im', 'Hevy|' + key), n: name, custom: true, eq: 'custom', tg: '', desc: '',
        bp: bpOfTemplate(t) || (t?.type === 'distance_duration' || t?.type === 'duration' ? 'cardio' : null)
          || 'upper legs',
      }
      // Its muscles and equipment, as Hevy has them.
      if (t) fromHevyTemplate(c, t)
      created.set(key, c)
      titleOf.set(c.id, t?.title || fallbackTitle || name)
    }
    return c.id
  }

  // Everything is reported against the ids the parse actually kept: resolve() runs before an
  // exercise's sets are read, so one whose sets all had nothing measured has been resolved and
  // invented but points at nothing — and would otherwise be counted, listed under "added as your
  // own", and (mergeHevyRoutines takes every custom it is given) put in the library on its own.
  const kept = used => [...created.values()].filter(c => used.has(c.id))
  return {
    resolve,
    names: (used, stats) => [...names.entries()].filter(([, x]) => used.has(x.id) || stats?.has(x.key))
      .map(([k, x]) => ({ ...x, sets: stats?.get(x.key)?.sets || 0, workouts: stats?.get(x.key)?.sessions.size || 0 })),
    byId,
    customEx: used => kept(used),
    unmatchedNames: used => [...new Set(kept(used).map(c => titleOf.get(c.id)))].sort(),
    matchedIds: used => [...matchedIds].filter(id => used.has(id)),
    matchedCount: used => [...matchedIds].filter(id => used.has(id)).length,
    createdCount: used => kept(used).length,
  }
}

/**
 * The import sheet's two counts over the parts switched on: each exercise once, by id. An
 * exercise in both the workouts and the routines is one exercise (the same catalogue id, or the
 * same custom one), so adding the two parts' counts would show it twice.
 */
export function hevySummaryCounts(w, r, { workouts = true, routines = true } = {}) {
  const parts = [workouts && w, routines && r].filter(Boolean)
  return {
    matched: new Set(parts.flatMap(p => p.matchedIds || [])).size,
    created: new Set(parts.flatMap(p => (p.customEx || []).map(c => c.id))).size,
  }
}

const toProfileWeight = (wKg, unit) => {
  if (wKg == null || !isFinite(wKg)) return 0
  if (unit === 'lb') return roundWeight(wKg / LB_TO_KG)
  return roundWeight(wKg)
}

/**
 * Turn Hevy API workouts into the same shape `mergeImport` already understands.
 * Mapping is by `exercise_template_id` through `HEVY_ID_MAP` only — localized
 * titles on each set are never used to pick a catalogue entry.
 */
// Hevy's text fields as a note: only text, trimmed, at most NOTE_MAX.
const noteOf = v => (typeof v === 'string' ? v.trim().slice(0, NOTE_MAX) : '')

export function parseHevyWorkouts(workouts, templates, { unit = 'kg', customEx = [], matches, skip, from, to, notes: keepNotes = true, effort: keepEffort = true } = {}) {
  const R = makeResolver(templates, customEx, matches)
  const byDate = new Map()           // Hevy workout -> the session being built
  const stats = new Map()            // name key -> { sets, sessions }, for the summary's choices
  let sets = 0, skipped = 0, matched = 0, warmups = 0, rpeSets = 0
  let excluded = 0, notesSeen = 0, effortSeen = 0

  for (const w of workouts || []) {
    const start = localWhen(w.start_time)
    const end = localWhen(w.end_time)
    if (!start) { skipped++; continue }
    // Sessions outside the days you chose stay in Hevy.
    if (!inRange(start.d, from, to)) {
      excluded += (w.exercises || []).reduce((n, ex) => n + (Array.isArray(ex?.sets) ? ex.sets.length : 0), 0)
      continue
    }
    // The history list renders the name as it is stored, so only text may become one.
    const title = typeof w.title === 'string' ? w.title : ''

    // One workout per Hevy workout, not per day: a morning and an evening session stay two (#505).
    const key = w.id != null ? 'id|' + w.id : start.d + '|' + start.t + '|' + title
    let day = byDate.get(key)
    if (!day) {
      day = { d: start.d, ex: new Map(), name: title, start: start.t, end: end?.t ?? null, note: '', notes: new Map(), routine: null }
      byDate.set(key, day)
    } else if (!day.name && title) day.name = title
    // The routine it was done from is kept, so linkHevyRoutines can file it under that routine
    // once the routine is here.
    if (day.routine == null) day.routine = hevyIdOf(w.routine_id)
    // The workout's description is its note, the way the Hevy CSV import reads it (#815).
    const desc = noteOf(w.description)
    if (desc) notesSeen++
    if (desc && keepNotes && !day.note) day.note = desc
    // Past midnight the end's clock restarts; count it from the start day's midnight instead.
    if (end?.t != null) day.end = end.t + daysBetween(start.d, end.d) * 86400000

    for (const ex of w.exercises || []) {
      const id = R.resolve(ex.exercise_template_id, ex.title)
      if (!id) { skipped++; continue }
      const nk = nameKey(R.byId.get(ex.exercise_template_id)?.title || ex.title)
      let st = stats.get(nk)
      if (!st) stats.set(nk, st = { sets: 0, sessions: new Set() })
      st.sets += Array.isArray(ex.sets) ? ex.sets.length : 0
      st.sessions.add(key)
      // An exercise you unticked stays out, and so does the exercise of your own it would make.
      if (skip && skip.has(nk)) { excluded += Array.isArray(ex.sets) ? ex.sets.length : 0; continue }
      if (EXIDX[id] && !String(id).startsWith('im')) matched++
      const exNote = noteOf(ex.notes)
      if (exNote) notesSeen++

      // Filed only once a set lands in it: an exercise whose sets all had nothing measured would
      // otherwise import as an entry with no sets, which nothing that reads a session back expects.
      const list = day.ex.get(id) || []

      for (const s of ex.sets || []) {
        const warmup = /warm/i.test(String(s.type || ''))
        if (warmup) warmups++
        const reps = s.reps != null ? Math.round(s.reps) : 0
        const wgt = toProfileWeight(s.weight_kg, unit)
        const secs = s.duration_seconds != null ? Number(s.duration_seconds) : 0
        // A distance that is not a number would otherwise divide into a NaN speed.
        const dist = Number(s.distance_meters)
        const km = isFinite(dist) ? dist / 1000 : 0
        if (!wgt && !reps && !secs && !km) { skipped++; continue }

        const isCardio = (km > 0 || secs > 0) && !reps
        const mins = secs > 0 ? Math.round(secs / 60 * 10) / 10 : 0
        const set = isCardio
          ? { min: mins, speed: mins > 0 ? Math.round(km / (mins / 60) * 10) / 10 : 0, done: true, ...(warmup ? { phase: 'warmup' } : {}) }
          : { w: wgt, r: reps || 0, done: true, ...(warmup ? { phase: 'warmup' } : {}) }
        // Hevy's "failure" set type is the app's set taken to failure (workout-model isFailureSet).
        if (!isCardio && !warmup && /fail/i.test(String(s.type || ''))) set.failure = true

        if (s.rpe != null && isFinite(Number(s.rpe)) && Number(s.rpe) > 0) {
          effortSeen++
          if (keepEffort) {
            set.rpe = Math.min(10, Math.round(Number(s.rpe) * 100) / 100)
            rpeSets++
          }
        }
        list.push(set)
        sets++
      }
      if (list.length && !day.ex.has(id)) day.ex.set(id, list)
      // The exercise's note for that workout is its entry's note.
      if (list.length && exNote && keepNotes) {
        const ns = day.notes.get(id) || []
        if (!ns.includes(exNote)) ns.push(exNote)
        day.notes.set(id, ns)
      }
    }
  }

  // A session in which nothing measurable landed is not a workout — and imported, it would block
  // the real one from a later export, since existing days win in mergeImport.
  const days = [...byDate.values()].filter(day => day.ex.size)
    .sort((a, b) => (a.d === b.d ? (a.start ?? 0) - (b.start ?? 0) : a.d < b.d ? -1 : 1))
  const dates = days.map(day => day.d)
  const outWorkouts = days.map(day => {
    const d = day.d
    const entries = [...day.ex.entries()].map(([id, ss]) => {
      const mx = Math.max(0, ...ss.filter(s => !isWarmupRow(s)).map(s => s.w || 0))
      const note = (day.notes.get(id) || []).join(' · ').slice(0, NOTE_MAX)
      return { id, sets: ss, topW: mx || null, ...(note ? { note } : {}) }
    })
    const base = new Date(d + 'T00:00:00').getTime()
    const startMs = base + (day.start ?? 18 * 3600000)
    const endMs = day.end != null ? base + day.end : startMs
    const workout = {
      // From what it is (importId), so the same import on two devices merges into one.
      id: importId('iw', JSON.stringify(['Hevy', d, startMs, day.name || '', entries.map(e => [e.id, e.sets])])), d, start: startMs, end: endMs > startMs ? endMs : startMs,
      routineId: null, name: day.name || 'Imported', entries, prs: [],
      ...(day.note ? { note: day.note } : {}),
      ...(day.routine ? { hevyRoutineId: day.routine } : {}),
    }
    // Work sets only, the number `workoutVolume` gives a workout finished in the app; it is stored for good.
    workout.vol = entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + (isWarmupRow(s) ? 0 : (s.w || 0) * (s.r || 0)), 0), 0)
    return workout
  })
  const used = new Set(outWorkouts.flatMap(w => w.entries.map(e => e.id)))

  return {
    kind: 'workouts',
    source: 'Hevy',
    workouts: outWorkouts,
    customEx: R.customEx(used),
    matched: R.matchedCount(used),
    matchedIds: R.matchedIds(used),
    matchedSets: matched,
    created: R.createdCount(used),
    unmatchedNames: R.unmatchedNames(used),
    sets, skipped, warmups,
    fileUnit: 'kg',
    mixedUnits: false,
    converted: unit === 'lb',
    rpeSets, rirSets: 0,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    names: R.names(used, stats), excluded, notesSeen, effortSeen,
  }
}

/**
 * Hevy routine → openGym routine config.
 * Work sets become `sets`×`reps`/`weight`; warm-ups become `warmupSets`;
 * supersets keep adjacency via `sg`. Always imported as *new* routines.
 */
// A routine set's rep range ({ start, end }) as whole reps, low to high, or null.
function repRangeOf(set) {
  const rr = set?.rep_range
  if (!rr || typeof rr !== 'object') return null
  const a = Math.round(Number(rr.start)), b = Math.round(Number(rr.end))
  const ok = n => Number.isFinite(n) && n > 0 && n <= 100
  if (ok(a) && ok(b)) return { lo: Math.min(a, b), hi: Math.max(a, b) }
  if (ok(a) || ok(b)) { const n = ok(a) ? a : b; return { lo: n, hi: n } }
  return null
}

/**
 * Hevy's routine folders ([{ id, title, index }]) by id: { name, at }, the name as a folder name
 * here (cleanFolder; '' when it has none) and its place in Hevy's list (-1 when unknown). Null
 * when the folders could not be read.
 */
function folderBook(folders) {
  if (!Array.isArray(folders)) return null
  const book = new Map()
  for (const f of folders) {
    const id = hevyIdOf(f?.id)
    if (id == null || book.has(id)) continue
    const name = typeof f.title === 'string' ? cleanFolder(f.title) : ''
    book.set(id, { name, at: name && typeof f.index === 'number' && Number.isFinite(f.index) ? f.index : -1 })
  }
  return book
}

/**
 * `folders`: Hevy's routine folders, or null when they could not be read. With them each routine
 * carries `hevyFolder` (its folder's name, '' for none) and `hevyFolderAt` (the folder's place in
 * Hevy, -1 for none); without them it carries neither, and mergeHevyRoutines leaves folders alone.
 */
export function parseHevyRoutines(routines, templates, { unit = 'kg', customEx = [], matches, folders = null } = {}) {
  const R = makeResolver(templates, customEx, matches)
  const book = folderBook(folders)
  const out = []

  for (const r of routines || []) {
    const ex = []
    const sgMap = new Map() // Hevy superset_id → openGym sg token

    for (const he of r.exercises || []) {
      const id = R.resolve(he.exercise_template_id, he.title)
      if (!id) continue

      const allSets = he.sets || []
      const warm = allSets.filter(s => /warm/i.test(String(s.type || ''))).length
      const work = allSets.filter(s => !/warm/i.test(String(s.type || '')))
      if (!work.length && !warm) continue

      const sample = work[0] || allSets[0]
      // A range ("8 to 12") is double progression in openGym: its top is the reps, its bottom
      // repsMin, and a range of one number is just that many reps (#815).
      const range = repRangeOf(sample)
      const reps = sample?.reps != null ? Math.round(sample.reps) : range ? range.hi : 0
      const secs = sample?.duration_seconds != null ? Number(sample.duration_seconds) : 0
      const km = sample?.distance_meters != null ? Number(sample.distance_meters) / 1000 : 0
      const wgt = toProfileWeight(sample?.weight_kg, unit)
      const nWork = Math.max(1, work.length)

      let cfg
      if (km > 0 && !reps) {
        const mins = secs > 0 ? Math.round(secs / 60 * 10) / 10 : 20
        cfg = {
          id, sets: nWork, min: mins || 20,
          speed: mins > 0 ? Math.round(km / (mins / 60) * 10) / 10 : 0,
        }
      } else if (secs > 0 && !reps && !wgt) {
        cfg = { id, sets: nWork, sec: Math.round(secs), weight: 0, mode: 'time' }
      } else {
        cfg = { id, sets: nWork, reps: reps || 10, weight: wgt || 0, mode: 'reps' }
        if (range && range.hi > range.lo) Object.assign(cfg, { reps: range.hi, repsMin: range.lo, prog: 'double' })
      }
      if (warm > 0) cfg.warmupSets = Math.min(5, warm)
      // The routine's rest after each set of this exercise. Hevy's 0 is "no timer set", which
      // here is the app's default, not a rest of nothing.
      const rest = Math.round(Number(he.rest_seconds))
      if (Number.isFinite(rest) && rest > 0) cfg.restSec = Math.min(rest, 3600)
      if (he.notes) cfg.note = String(he.notes).slice(0, NOTE_MAX)

      if (he.superset_id != null && he.superset_id !== '') {
        const key = String(he.superset_id)
        if (!sgMap.has(key)) sgMap.set(key, 'hs' + uid())
        cfg.sg = sgMap.get(key)
      }
      ex.push(cfg)
    }

    if (!ex.length) continue
    // Drop singleton supersets (partner missing after drops).
    ex.forEach((e, i) => {
      if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg
    })

    const folder = book ? book.get(hevyIdOf(r.folder_id)) : null
    out.push({
      id: 'hr' + uid(),
      name: (r.title || 'Imported').trim() || 'Imported',
      emoji: 'figureStrength',
      hevyId: r.id || null,
      ex,
      ...(book ? { hevyFolder: folder?.name || '', hevyFolderAt: folder?.name ? folder.at : -1 } : {}),
    })
  }

  const used = new Set(out.flatMap(r => r.ex.map(e => e.id)))
  return {
    kind: 'routines',
    source: 'Hevy',
    routines: out,
    customEx: R.customEx(used),
    matched: R.matchedCount(used),
    matchedIds: R.matchedIds(used),
    created: R.createdCount(used),
    unmatchedNames: R.unmatchedNames(used),
    exerciseCount: out.reduce((n, r) => n + r.ex.length, 0),
    converted: unit === 'lb',
    names: R.names(used),
  }
}

/**
 * A routine's folder from Hevy (`hevyFolder` on the parsed routine) onto the routine here. A new
 * routine takes it. One imported before follows Hevy only while its folder here is still the one
 * the last import gave it (`hevyFolder` on the routine here; a routine from before folders came
 * over counts as given none), so a folder changed or removed in the app is kept. Mutates `x`.
 */
function applyHevyFolder(x, r, fresh) {
  if (typeof r.hevyFolder !== 'string') return
  const hevy = cleanFolder(r.hevyFolder)
  const last = typeof x.hevyFolder === 'string' ? cleanFolder(x.hevyFolder) : ''
  if (fresh || folderOf(x) === last) {
    if (hevy) x.folder = hevy
    else delete x.folder
  }
  x.hevyFolder = hevy
}

/**
 * Merge Hevy routines into state: new ones are added (fresh ids), one already here from an earlier
 * import is replaced in place. New ones come in the order of their Hevy folders, so each folder's
 * routines sit together (those in no folder first).
 */
export function mergeHevyRoutines(S, parsed) {
  S.customEx = S.customEx || []
  S.routines = S.routines || []
  const exIdMap = {}
  ;(parsed.customEx || []).forEach(c => {
    const same = S.customEx.find(x => (x.n || '').toLowerCase() === (c.n || '').toLowerCase() && x.bp === c.bp)
    if (same) { exIdMap[c.id] = same.id; return }
    // Keep the pre-assigned id from parse so routine configs already point at it.
    if (!S.customEx.some(x => x.id === c.id)) S.customEx.push(c)
  })
  // A second import must not double every plan: a routine that already carries the same Hevy
  // id is replaced in place (its exercises re-read from Hevy), everything else is appended.
  let updated = 0
  const fresh = []
  for (const r of parsed.routines || []) {
    const ex = (r.ex || []).map(e => ({ ...e, id: exIdMap[e.id] || e.id }))
    const existing = r.hevyId ? S.routines.find(x => x.hevyId === r.hevyId) : null
    if (existing) {
      existing.name = r.name
      existing.ex = ex
      applyHevyFolder(existing, r, false)
      updated++
      continue
    }
    const x = {
      id: uid(),
      name: r.name,
      emoji: r.emoji || 'figureStrength',
      ...(r.hevyId ? { hevyId: r.hevyId } : {}),
      ex,
    }
    applyHevyFolder(x, r, true)
    fresh.push([x, Number.isFinite(r.hevyFolderAt) ? r.hevyFolderAt : -1])
  }
  // Array sort is stable: within a folder, and with no folders at all, Hevy's order stays.
  fresh.sort((a, b) => a[1] - b[1])
  for (const [x] of fresh) S.routines.push(x)
  return { added: fresh.length, updated }
}

// A workout already here starting this close to a Hevy one on the same day is that session: an
// earlier import of the same history (Hevy's CSV has the start to the minute only).
const LINK_MS = 2 * 60000

/**
 * Files workouts under the routine Hevy says they were done from. A workout already here that is
 * the same session as one of `parsedWorkouts` (same day, a start within two minutes, no routine)
 * takes its Hevy routine id first; then every workout with a Hevy routine id and no routine gets
 * the routine here with that Hevy id, if there is one. A routine set in the app is never changed.
 * Every workout changed is stamped as an edit (sync-merge stampWorkout), so the link reaches the
 * other devices. Mutates `S`; returns how many workouts it linked.
 */
export function linkHevyRoutines(S, parsedWorkouts, now = Date.now()) {
  const list = Array.isArray(S?.workouts) ? S.workouts : []
  const touched = new Set()
  for (const p of parsedWorkouts || []) {
    const hid = hevyIdOf(p?.hevyRoutineId)
    if (!hid) continue
    // One session is one workout: the nearest one still without a routine, so two sessions a
    // minute apart each find their own.
    let best = null
    let gap = LINK_MS
    for (const w of list) {
      if (!w || w.d !== p.d || w.routineId || w.hevyRoutineId) continue
      const g = Math.abs((Number(w.start) || 0) - (Number(p.start) || 0))
      if (g <= gap && (!best || g < gap)) { best = w; gap = g }
    }
    if (best) { best.hevyRoutineId = hid; touched.add(best) }
  }
  const byHevy = new Map()
  for (const r of Array.isArray(S?.routines) ? S.routines : []) {
    const hid = hevyIdOf(r?.hevyId)
    if (hid && r.id != null && !byHevy.has(hid)) byHevy.set(hid, r.id)
  }
  let linked = 0
  for (const w of list) {
    if (!w || w.routineId) continue
    const hid = hevyIdOf(w.hevyRoutineId)
    const rid = hid ? byHevy.get(hid) : undefined
    if (rid == null) continue
    w.routineId = rid
    touched.add(w)
    linked++
  }
  for (const w of touched) stampWorkout(w, now)
  return linked
}

/**
 * How many workouts the import would link (linkHevyRoutines), without changing `S`: counted after
 * the parts switched on would be merged. `workouts`: the parsed Hevy workouts to import (those on a
 * day already here stay out, as in mergeImport, and so does a session that was only sport, which
 * comes in as an activity); `routines`: the parsed Hevy routines to import.
 */
export function linkableHevyWorkouts(S, { workouts = [], routines = [], customEx = [] } = {}) {
  const here = Array.isArray(S?.workouts) ? S.workouts : []
  const have = new Set(here.map(w => w?.d))
  const named = e => customEx.find(c => c.id === e.id)?.n || EXIDX[e.id]?.n || ''
  const adding = splitSportWorkouts((workouts || []).filter(w => w && !have.has(w.d)), named).workouts
  const copy = {
    workouts: [...here, ...adding].map(w => (w && typeof w === 'object' ? { ...w } : w)),
    routines: [...(Array.isArray(S?.routines) ? S.routines : []), ...(routines || [])],
  }
  return linkHevyRoutines(copy, workouts)
}

/** Body measurements from the Hevy API → `mergeImport` bodyweight shape. */
export function parseHevyBodyweight(measurements, { unit = 'kg' } = {}) {
  const out = new Map()
  for (const m of measurements || []) {
    const d = String(m.date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    let w = Number(m.weight_kg)
    if (!isFinite(w) || w <= 0) continue
    w = roundWeight(unit === 'lb' ? w / LB_TO_KG : w)
    const t = m.created_at ? new Date(m.created_at).getTime() : new Date(d + 'T12:00:00').getTime()
    out.set(d, { d, w, t: isFinite(t) ? t : new Date(d + 'T12:00:00').getTime() })
  }
  const dates = [...out.keys()].sort()
  return {
    kind: 'bodyweight',
    source: 'Hevy',
    bodyweight: dates.map(d => out.get(d)),
    fileUnit: 'kg',
    converted: unit === 'lb',
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
  }
}

// Hevy's body measurement fields → the app's (lib/measurements.js). Hevy's fields without "_cm"
// are centimetres too, as stored here; `fat_percent` is body fat. Lean mass has no field here.
const HEVY_MEASURE = Object.freeze({
  neck_cm: 'neck', shoulder_cm: 'shoulders', chest_cm: 'chest',
  abdomen: 'abdomen', waist: 'waist', hips: 'hips',
  left_bicep_cm: 'upperArmLeft', right_bicep_cm: 'upperArmRight',
  left_forearm_cm: 'forearmLeft', right_forearm_cm: 'forearmRight',
  left_thigh: 'thighLeft', right_thigh: 'thighRight', left_calf: 'calfLeft', right_calf: 'calfRight',
  fat_percent: 'bodyFat',
})
const reading = (v, key) => {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || (key === 'bodyFat' && n > 100)) return null
  return Math.round(n * 10) / 10
}

/**
 * Body measurements from the Hevy API (the circumferences and body fat; the weight is
 * parseHevyBodyweight's) → one check-in a day, `{ d, values, other }` the way mergeImport files
 * measurements. Two rows on a day are one check-in, the later row's values first.
 */
export function parseHevyMeasurements(list) {
  const byDay = new Map()
  for (const m of Array.isArray(list) ? list : []) {
    const d = typeof m?.date === 'string' ? m.date.slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    const values = byDay.get(d) || {}
    for (const [from, key] of Object.entries(HEVY_MEASURE)) {
      const v = reading(m[from], key)
      if (v != null) values[key] = v
    }
    byDay.set(d, values)
  }
  const days = [...byDay.keys()].filter(d => Object.keys(byDay.get(d)).length).sort()
  return {
    kind: 'measurements',
    source: 'Hevy',
    measurements: days.map(d => ({ d, values: byDay.get(d), other: [] })),
  }
}

/** The measured days of `parsed` that `S` has no check-in on yet. */
export function newHevyMeasurements(S, parsed) {
  const have = new Set((Array.isArray(S?.measurements) ? S.measurements : []).map(e => e?.d))
  return (parsed?.measurements || []).filter(m => !have.has(m.d))
}

/**
 * Merge Hevy's body measurements into state: a day that already has a check-in keeps it, as with
 * weigh-ins. A field that gets a value is switched on in the measurement list, so it shows. Mutates
 * `S`; returns how many days came in.
 */
export function mergeHevyMeasurements(S, parsed) {
  const fresh = newHevyMeasurements(S, parsed)
  if (!fresh.length) return 0
  const added = mergeImport(S, { kind: 'bodyweight', bodyweight: [], measurements: fresh }).measurements || 0
  if (!added) return 0
  const on = Array.isArray(S.measurementEnabled) ? S.measurementEnabled : []
  const used = MEASUREMENT_KEYS.filter(k => !on.includes(k) && fresh.some(m => m.values[k] != null))
  if (used.length) S.measurementEnabled = [...on, ...used]
  return added
}

/**
 * Fetch + parse. Returns `{ workouts, routines, bodyweight, measurements }` ready to merge,
 * or throws `HevyApiError`. The apiKey is only read here — never written.
 */
export async function importHevyData(apiKey, { unit = 'kg', onProgress, customEx = [], ...choices } = {}) {
  const raw = await fetchHevyAccount(apiKey, { onProgress })
  onProgress && onProgress({ stage: 'parse' })
  return parseHevyAccount(raw, { unit, customEx, ...choices })
}

/**
 * The fetched account read as what it would import, with the summary's choices
 * (lib/import-choices.js). `raw` comes along, so the sheet can read it again when a choice
 * changes, without asking Hevy (or keeping the key) a second time.
 */
export function parseHevyAccount(raw, { unit = 'kg', customEx = [], ...choices } = {}) {
  const { templates = [], workouts = [], routines = [], routineFolders = null, bodyMeasurements = [], weightUnit = null } = raw || {}
  return {
    workouts: parseHevyWorkouts(workouts, templates, { unit, customEx, ...choices }),
    routines: parseHevyRoutines(routines, templates, { unit, customEx, matches: choices.matches, folders: routineFolders }),
    bodyweight: parseHevyBodyweight(bodyMeasurements, { unit }),
    measurements: parseHevyMeasurements(bodyMeasurements),
    // The unit the Hevy account shows weights in, or null when it could not be read.
    weightUnit: weightUnit === 'kg' || weightUnit === 'lb' ? weightUnit : null,
    templateCount: templates.length,
    raw,
  }
}

export { HevyApiError }
