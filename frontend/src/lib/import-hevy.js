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
import { daysBetween, importId, priorCustom, roundWeight } from './import-csv.js'
import { normalizeRepRange } from './rep-range.js'
import { normalizeMeasurementEntry, DEFAULT_MEASUREMENT_KEYS } from './measurements.js'
import { stampWorkout } from './sync-merge.js'

export { HEVY_ID_MAP, HEVY_TITLE_MAP }
export const HEVY_API = 'https://api.hevyapp.com'
export const HEVY_DEV_SETTINGS = 'https://hevy.com/settings?developer'

const LB_TO_KG = 0.45359237
const NOTE_MAX = 280              // an exercise's note, as the CSV import keeps it
const text = v => (typeof v === 'string' ? v.trim() : '')
const pos = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

/* --------------------------------------------------------------- auth/fetch -- */

class HevyApiError extends Error {
  constructor(status, message) {
    super(message || `Hevy API error ${status}`)
    this.name = 'HevyApiError'
    this.status = status
  }
}

async function hevyGet(path, apiKey, params = {}) {
  const url = new URL(path, HEVY_API)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  // Hevy publishes no rate limit, but a large account is 100+ sequential page requests; a 429
  // gets a short back-off and one more try before it surfaces as its own error kind.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'api-key': apiKey } })
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
} = {}) {
  const items = []
  let page = 1
  let pageCount = 1
  while (page <= pageCount) {
    const data = await hevyGet(path, apiKey, { page, pageSize })
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
  // The account's weight unit. The API gives kg either way, so it only explains why the numbers
  // look different from Hevy's own screen. Without it the import goes on.
  let unit = null
  try {
    const u = (await hevyGet('/v1/user/info', key))?.data?.weight_unit
    unit = u === 'lbs' || u === 'lb' ? 'lb' : u === 'kg' ? 'kg' : null
  } catch (e) {
    if (!(e instanceof HevyApiError)) throw e
  }
  return { templates, workouts, routines, bodyMeasurements, unit }
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

// Hevy's muscle groups → the muscle map's (lib/muscles.js MUSCLES). Cardio, neck, full body and
// other have no muscle there and are left out.
const HEVY_MUSCLE = Object.assign(Object.create(null), {
  abdominals: 'abs', shoulders: 'deltoids', biceps: 'biceps', triceps: 'triceps', forearms: 'forearm',
  quadriceps: 'quadriceps', hamstrings: 'hamstring', calves: 'calves', glutes: 'gluteal',
  abductors: 'gluteal', adductors: 'adductors', lats: 'upper-back', upper_back: 'upper-back',
  traps: 'trapezius', lower_back: 'lower-back', chest: 'chest',
})
// Hevy's equipment → the library's. "other" is left as it is.
const HEVY_EQUIPMENT = Object.assign(Object.create(null), {
  none: 'body weight', barbell: 'barbell', dumbbell: 'dumbbell', kettlebell: 'kettlebell',
  machine: 'leverage machine', plate: 'weight plate', resistance_band: 'resistance band', suspension: 'suspension trainer',
})

/**
 * What a Hevy template says about its exercise, as a custom exercise stores it: `eq` (or none)
 * and the muscles (`tg`, `primaries`, `secondaries`, `sm`, `muscleGroups`, or none).
 */
export function hevyTemplateInfo(t) {
  const title = String(t?.title || '')
  const out = {}
  const eq = HEVY_EQUIPMENT[t?.equipment]
  if (eq) out.eq = t.equipment === 'machine' && /\bcable\b/i.test(title) ? 'cable'
    : t.equipment === 'machine' && /\bsmith\b/i.test(title) ? 'smith machine' : eq
  const primaries = [HEVY_MUSCLE[t?.primary_muscle_group]].filter(Boolean)
  const secondaries = [...new Set((Array.isArray(t?.secondary_muscle_groups) ? t.secondary_muscle_groups : [])
    .map(g => HEVY_MUSCLE[g]).filter(m => m && !primaries.includes(m)))]
  if (primaries.length) Object.assign(out, { tg: primaries[0], primaries, secondaries, sm: secondaries, muscleGroups: [...primaries, ...secondaries] })
  return out
}

function bpOfTemplate(t) {
  const g = String(t?.primary_muscle_group || '').toLowerCase()
  return HEVY_BP[g] || 'upper legs'
}

/**
 * Shared resolver: the user's own custom exercise when an earlier import made one (priorCustom,
 * so one exercise keeps one id once the map learns it), else a HEVY_ID_MAP hit, else one custom
 * exercise per Hevy template id. `customEx`: the custom exercises already in state.
 */
function makeResolver(templates, customEx) {
  const byId = new Map((templates || []).map(t => [t.id, t]))
  const created = new Map()
  const titleOf = new Map()      // custom id → the name Hevy showed for it
  const matchedIds = new Set()

  const resolve = (templateId, fallbackTitle) => {
    const key = templateId || String(fallbackTitle || '').toLowerCase()
    if (!key) return null
    const t = templateId ? byId.get(templateId) : null
    const own = priorCustom(customEx, importId('im', 'Hevy|' + key), t?.title || fallbackTitle)
    if (own) return own.id
    const pinned = templateId && canonicalExId(HEVY_ID_MAP[templateId])
    if (pinned && EXIDX[pinned]) {
      matchedIds.add(pinned)
      return pinned
    }
    let c = created.get(key)
    if (!c) {
      const name = (t?.title || fallbackTitle || 'exercise').toLowerCase()
      c = {
        id: importId('im', 'Hevy|' + key), n: name, custom: true, eq: 'custom', tg: '', desc: '',
        bp: bpOfTemplate(t) || (t?.type === 'distance_duration' || t?.type === 'duration' ? 'cardio' : null)
          || 'upper legs',
        ...hevyTemplateInfo(t),
      }
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
export function parseHevyWorkouts(workouts, templates, { unit = 'kg', customEx = [] } = {}) {
  const R = makeResolver(templates, customEx)
  const byDate = new Map()           // Hevy workout -> the session being built
  let sets = 0, skipped = 0, matched = 0, warmups = 0, rpeSets = 0

  for (const w of workouts || []) {
    const start = localWhen(w.start_time)
    const end = localWhen(w.end_time)
    if (!start) { skipped++; continue }
    // The history list renders the name as it is stored, so only text may become one.
    const title = typeof w.title === 'string' ? w.title : ''

    // One workout per Hevy workout, not per day: a morning and an evening session stay two (#505).
    const key = w.id != null ? 'id|' + w.id : start.d + '|' + start.t + '|' + title
    let day = byDate.get(key)
    if (!day) {
      day = { d: start.d, ex: new Map(), name: title, start: start.t, end: end?.t ?? null, note: '', notes: new Map(), routine: null }
      byDate.set(key, day)
    } else if (!day.name && title) day.name = title
    // The description is the workout's note, as in Hevy's CSV; the routine it was started from is
    // kept, so linkHevyRoutines can file it under that routine once the routine is here.
    if (!day.note) day.note = text(w.description)
    if (day.routine == null && w.routine_id != null && w.routine_id !== '') day.routine = String(w.routine_id)
    // Past midnight the end's clock restarts; count it from the start day's midnight instead.
    if (end?.t != null) day.end = end.t + daysBetween(start.d, end.d) * 86400000

    for (const ex of w.exercises || []) {
      const id = R.resolve(ex.exercise_template_id, ex.title)
      if (!id) { skipped++; continue }
      if (EXIDX[id] && !String(id).startsWith('im')) matched++

      // Filed only once a set lands in it: an exercise whose sets all had nothing measured would
      // otherwise import as an entry with no sets, which nothing that reads a session back expects.
      const list = day.ex.get(id) || []
      // The exercise's notes, one per entry as the app keeps it (the CSV import's way).
      const note = text(ex.notes)
      if (note) {
        const notes = day.notes.get(id) || []
        if (!notes.includes(note)) notes.push(note)
        day.notes.set(id, notes)
      }

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

        if (!isCardio && s.rpe != null && isFinite(Number(s.rpe)) && Number(s.rpe) > 0) {
          set.rpe = Math.min(10, Math.round(Number(s.rpe) * 100) / 100)
          rpeSets++
        }
        list.push(set)
        sets++
      }
      if (list.length && !day.ex.has(id)) day.ex.set(id, list)
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
  }
}

/**
 * Hevy routine → openGym routine config.
 * Work sets become `sets`×`reps`/`weight`; warm-ups become `warmupSets`;
 * supersets keep adjacency via `sg`. Always imported as *new* routines.
 */
export function parseHevyRoutines(routines, templates, { unit = 'kg', customEx = [] } = {}) {
  const R = makeResolver(templates, customEx)
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
      const reps = sample?.reps != null ? Math.round(sample.reps) : 0
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
      }
      if (warm > 0) cfg.warmupSets = Math.min(5, warm)
      if (he.notes) cfg.note = String(he.notes).slice(0, 280)
      // The exercise's rest, and a rep range ("8–12") as double progression over that range.
      const rest = pos(he.rest_seconds)
      if (rest) cfg.restSec = Math.round(rest)
      const range = cfg.mode === 'reps' && work.map(s => s?.rep_range).find(x => pos(x?.start) && pos(x?.end))
      if (range) {
        const lo = Math.round(Math.min(range.start, range.end)), hi = Math.round(Math.max(range.start, range.end))
        if (lo === hi) cfg.reps = hi
        else Object.assign(cfg, normalizeRepRange(hi, lo), { prog: 'double' })
      }

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

    out.push({
      id: 'hr' + uid(),
      name: (r.title || 'Imported').trim() || 'Imported',
      emoji: 'figureStrength',
      hevyId: r.id || null,
      ex,
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
  }
}

/** Merge Hevy routines into state — always added as new routines (fresh ids). */
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
  let added = 0, updated = 0
  for (const r of parsed.routines || []) {
    const ex = (r.ex || []).map(e => ({ ...e, id: exIdMap[e.id] || e.id }))
    const existing = r.hevyId ? S.routines.find(x => x.hevyId === r.hevyId) : null
    if (existing) {
      existing.name = r.name
      existing.ex = ex
      updated++
      continue
    }
    S.routines.push({
      id: uid(),
      name: r.name,
      emoji: r.emoji || 'figureStrength',
      ...(r.hevyId ? { hevyId: r.hevyId } : {}),
      ex,
    })
    added++
  }
  return { added, updated }
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

// Hevy's body measurement fields → the app's (lib/measurements.js, all cm). Hevy's unsuffixed
// ones are cm too. Lean mass has no field here and is left out.
const HEVY_MEASURE = {
  neck_cm: 'neck', shoulder_cm: 'shoulders', chest_cm: 'chest',
  left_bicep_cm: 'upperArmLeft', right_bicep_cm: 'upperArmRight',
  left_forearm_cm: 'forearmLeft', right_forearm_cm: 'forearmRight',
  abdomen: 'abdomen', waist: 'waist', hips: 'hips',
  left_thigh: 'thighLeft', right_thigh: 'thighRight', left_calf: 'calfLeft', right_calf: 'calfRight',
  fat_percent: 'bodyFat',
}

/** Body measurements from the Hevy API → measurement entries, one a day (the later row's values first), sorted. */
export function parseHevyMeasurements(list) {
  const byDay = new Map()
  for (const m of list || []) {
    const d = String(m?.date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    const e = byDay.get(d) || { d, t: new Date(d + 'T12:00:00').getTime() }
    for (const [from, to] of Object.entries(HEVY_MEASURE)) {
      const v = pos(m[from])
      if (v != null && !(to === 'bodyFat' && v > 100)) e[to] = Math.round(v * 10) / 10
    }
    byDay.set(d, e)
  }
  const keys = Object.values(HEVY_MEASURE)
  return [...byDay.values()].filter(e => keys.some(k => e[k] != null)).sort((a, b) => (a.d < b.d ? -1 : 1))
}

/** The measured days `S` does not have yet: a day that already has measurements is kept, as with weigh-ins. */
export const freshHevyMeasurements = (S, entries) => {
  const have = new Set((S?.measurements || []).map(e => e?.d))
  return (entries || []).filter(e => !have.has(e.d))
}

/** Adds the fresh days to `S.measurements` and switches on a field that got a value. Returns how many. */
export function mergeHevyMeasurements(S, entries) {
  const fresh = freshHevyMeasurements(S, entries)
  if (!fresh.length) return 0
  const custom = S.customMeasurements || []
  S.measurements = [...(S.measurements || []), ...fresh.map(e => normalizeMeasurementEntry(e, custom))]
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  const used = Object.values(HEVY_MEASURE).filter(k => fresh.some(e => e[k] != null))
  const on = Array.isArray(S.measurementEnabled) ? S.measurementEnabled : DEFAULT_MEASUREMENT_KEYS
  if (used.some(k => !on.includes(k))) S.measurementEnabled = [...on, ...used.filter(k => !on.includes(k))]
  return fresh.length
}

// A custom exercise an earlier import made, and nobody has filled in since: the import made it
// without muscles, and the custom-exercise form always stores some.
const untouched = c => c && c.custom && (c.eq === 'custom' || !c.eq) && !c.tg && !(c.primaries?.length) && !(c.sm?.length)

/** Gives an earlier import's custom exercises their template's muscles and equipment. Returns how many. */
export function fillHevyCustoms(S, templates) {
  let n = 0
  const byId = new Map((S.customEx || []).map(c => [c?.id, c]))
  for (const t of templates || []) {
    const c = byId.get(importId('im', 'Hevy|' + t?.id))
    if (!untouched(c)) continue
    const info = hevyTemplateInfo(t)
    if (!Object.keys(info).length) continue
    Object.assign(c, info)
    n++
  }
  return n
}

const LINK_MS = 2 * 60000      // an earlier import's workout starting this close to a Hevy one is that one

/**
 * Files Hevy workouts under their routine. A workout already here that is the same session as a
 * Hevy one (same day, a start within two minutes, no routine: an earlier CSV import) takes its
 * Hevy routine id first; then every workout with a Hevy routine id and no routine gets the routine
 * with that Hevy id, if it is here. A routine set in the app is never changed. Mutates `S`;
 * returns how many it linked.
 */
export function linkHevyRoutines(S, parsedWorkouts, now = Date.now()) {
  const list = S.workouts || []
  const touched = new Set()
  for (const p of parsedWorkouts || []) {
    if (!p?.hevyRoutineId) continue
    for (const w of list) {
      if (w.d !== p.d || w.routineId || w.hevyRoutineId || !(Math.abs((w.start || 0) - (p.start || 0)) <= LINK_MS)) continue
      w.hevyRoutineId = p.hevyRoutineId
      touched.add(w)
    }
  }
  const byHevy = new Map((S.routines || []).filter(r => r?.hevyId).map(r => [String(r.hevyId), r.id]))
  let linked = 0
  for (const w of list) {
    if (!w?.hevyRoutineId || w.routineId) continue
    const rid = byHevy.get(String(w.hevyRoutineId))
    if (!rid) continue
    w.routineId = rid
    touched.add(w)
    linked++
  }
  // Stamped as edits, so the link syncs to the other devices (sync-merge.js stampWorkout).
  for (const w of touched) stampWorkout(w, now)
  return linked
}

/** How many workouts `linkHevyRoutines` would link, without changing `S`. */
export function linkableHevyWorkouts(S, parsedWorkouts) {
  const copy = { workouts: (S?.workouts || []).map(w => ({ ...w })), routines: S?.routines || [] }
  return linkHevyRoutines(copy, parsedWorkouts)
}

/**
 * Fetch + parse. Returns `{ workouts, routines, bodyweight, measurements, templates, accountUnit }`
 * ready to merge, or throws `HevyApiError`. The apiKey is only read here — never written.
 */
export async function importHevyData(apiKey, { unit = 'kg', onProgress, customEx = [] } = {}) {
  const { templates, workouts, routines, bodyMeasurements, unit: accountUnit } = await fetchHevyAccount(apiKey, { onProgress })
  onProgress && onProgress({ stage: 'parse' })
  return {
    workouts: parseHevyWorkouts(workouts, templates, { unit, customEx }),
    routines: parseHevyRoutines(routines, templates, { unit, customEx }),
    bodyweight: parseHevyBodyweight(bodyMeasurements, { unit }),
    measurements: parseHevyMeasurements(bodyMeasurements),
    // For fillHevyCustoms after the merge: only what it reads.
    templates: templates.filter(t => t?.id != null)
      .map(({ id, title, equipment, primary_muscle_group, secondary_muscle_groups }) => ({ id, title, equipment, primary_muscle_group, secondary_muscle_groups })),
    accountUnit,
    templateCount: templates.length,
  }
}

export { HevyApiError }
