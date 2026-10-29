// Share a weekly plan.
//
// Two jobs:
//  1. A small, self-contained file a friend can import into THEIR openGym — just the
//     routines + the week schedule + the custom exercises those routines use. It never
//     carries workouts, weigh-ins or settings, and importing MERGES (adds routines with
//     fresh ids) so nothing the friend already has is touched.
//  2. A clean, printable page (Save as PDF) where a single exercise never splits across
//     a page break — each exercise, and each routine that fits, stays in one place.

import { EXIDX, canonicalExId, isBodyweightEq, isCustomEx } from './exercises.js'
import { cleanBackups } from './routine-backups.js'
import { cleanUrl } from './media-refs.js'
import { modeOf, exLine, MAX_PLANNED_WARMUPS } from './history.js'
import { deriveSessionName } from './session-merge.js'
import { isPyramid, normalizePyramid, normalizePyramidRest, normalizePyramidWeight } from './pyramid.js'
import { isBackoff } from './backoff.js'
import { dbLoadOf } from './dumbbells.js'
import { MAX_TRIPLE_SETS } from './progression.js'
import { uid, todayISO, DAYN, weekOrder, weekStartOf, exCount, routineCount } from './format.js'
import { t, exerciseNameFor, exerciseNameClass } from './i18n-core.js'
import { convertWeight } from './units.js'
import { fmtSpeed, speedUnitOf } from './speed.js'
import { clampIncline, hasIncline } from './incline.js'
import { MUSCLES, inMuscleOrder } from './muscles.js'
import { SG_NAME_MAX } from './superset-meta.js'
import { esc, printShell, printDocument, probeMarks } from './print-doc.js'
import { normalizeAliases } from './exercise-aliases.js'

const PLAN_FMT = 1
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0]   // every getDay() index; only the reader's own
                                          // screen puts them in an order (see weekOrder)
const PLAN_UNITS = new Set(['kg', 'lb'])

// A plan's numbers are in the unit that wrote it. Missing unit is deliberately legacy-compatible:
// old files were read as already being in the recipient's unit, so keep their values unchanged.
const planUnit = value => value === 'lbs' ? 'lb' : PLAN_UNITS.has(value) ? value : null
const unitError = () => { throw new Error(t('this isn’t an openGym plan file')) }

function declaredPlanUnit(data) {
  let declared = null
  for (const key of ['unit', 'weightUnit']) {
    if (data[key] == null) continue
    const unit = planUnit(data[key])
    if (!unit || (declared && declared !== unit)) unitError()
    declared = unit
  }
  return declared
}

function convertedExercise(e, sourceUnit, destinationUnit) {
  if (!sourceUnit || sourceUnit === destinationUnit) return e
  const out = { ...e }
  if (out.weight != null) out.weight = convertWeight(out.weight, sourceUnit, destinationUnit)
  // A timed increment is seconds, not a load. Rep-mode increments are load overrides.
  if (modeOf(out) === 'reps' && out.inc > 0) out.inc = convertWeight(out.inc, sourceUnit, destinationUnit)
  if (Array.isArray(out.pyramidWeight)) out.pyramidWeight = out.pyramidWeight.map(w => (w > 0 ? convertWeight(w, sourceUnit, destinationUnit) : w))
  return out
}

function convertedBundle(bundle, destinationUnit) {
  const sourceUnit = declaredPlanUnit(bundle)
  if (!sourceUnit || sourceUnit === destinationUnit) return bundle
  return {
    ...bundle,
    unit: destinationUnit,
    routines: (bundle.routines || []).map(r => ({
      ...r,
      ex: (r.ex || []).map(e => convertedExercise(e, sourceUnit, destinationUnit))
    }))
  }
}

// Keep only the meaningful config fields, so the file stays small and readable.
function cleanEx(e) {
  const o = { id: e.id, sets: e.sets }
  const mode = modeOf(e)
  if (mode === 'cardio') {
    // Written out for the same reason as 'time' below: swings set to cardio would otherwise
    // arrive as reps with no target (#640).
    o.mode = 'cardio'
    if (e.min != null) o.min = e.min
    if (e.speed != null) o.speed = e.speed
    if (hasIncline(e)) o.incline = clampIncline(e.incline)
  } else if (mode === 'time') {
    // Written out even though 'reps' is the fallback for a non-cardio id: a plan file that
    // dropped the mode would turn a 45-second plank into a 45-rep one at the other end.
    o.mode = 'time'
    if (e.sec != null) o.sec = e.sec
    if (e.weight) o.weight = e.weight
  } else {
    if (e.reps != null) o.reps = e.reps
    if (e.weight) o.weight = e.weight
    // Pyramid sets are the prescription itself; without them a "12 · 8 · 6 · Max · 12" arrives as 5 × 12.
    if (isPyramid(e)) {
      o.pyramid = normalizePyramid(e.pyramid)
      const rest = normalizePyramidRest(e.pyramidRest, o.pyramid.length)
      if (rest.length) o.pyramidRest = rest
      const weight = normalizePyramidWeight(e.pyramidWeight, o.pyramid.length)
      if (weight.length) o.pyramidWeight = weight
    }
  }
  // How the exercise is logged travels too (issues #31/#32) — the bodyweight flag only when
  // it disagrees with the catalogue, since agreeing is what the other end already assumes.
  if (e.bodyweight != null && e.bodyweight !== isBodyweightEq(e.id)) o.bodyweight = e.bodyweight
  // Reps work and timed holds (a per-side hold is an L and an R hold per set); never cardio.
  if (e.side && mode !== 'cardio') o.side = true
  // Progression settings travel with the plan — a shared Greyskull routine that arrives
  // without its rule is just a list of weights.
  if (e.prog) o.prog = e.prog
  if (e.inc > 0) o.inc = e.inc
  // Back-off sets step down by that same step; written only when on (lib/backoff.js).
  if (isBackoff(e)) o.backoff = true
  // "Last set to failure" is how the exercise is prescribed too; only when on, never on cardio.
  if (e.lastToFailure === true && mode !== 'cardio') o.lastToFailure = true
  // Epley deload factor is a per-occurrence progression setting. Omit the default so older
  // exports remain compact and importing them preserves the default 90% behaviour.
  if (e.deloadFactor != null && Number(e.deloadFactor) !== 0.9) o.deloadFactor = e.deloadFactor
  // What a dumbbell weight means in this slot (lib/dumbbells.js): without it "20 each" arrives
  // as a bare 20 and the other end counts half the volume.
  if (dbLoadOf(e.dbLoad)) o.dbLoad = dbLoadOf(e.dbLoad)
  if (e.repsMin != null) o.repsMin = e.repsMin
  // Triple progression's set ceiling (progression.js tripleSetsOf), rep work only.
  if (mode === 'reps' && e.setsMax > 0) o.setsMax = Math.min(MAX_TRIPLE_SETS, Math.round(e.setsMax))
  if (e.repsMax != null) o.repsMax = e.repsMax
  // The exercise's own rest (issue #10) is part of how it is prescribed, so it travels too —
  // only when set, so a plan that never asked for one leaves the recipient's own default
  // timer in charge. parsePlan and mergePlan carry it through by spread.
  if (e.restSec > 0) o.restSec = e.restSec
  else if (e.restOff === true) o.restOff = true   // "No timer" for this exercise
  if (e.warmupRestSec > 0) o.warmupRestSec = e.warmupRestSec   // the ramp's own rest travels with the work rest
  // The warm-ups' "no timer" and the break between sides travel the same way, only when set.
  // Planned substitutes (lib/routine-backups.js): the catalogue's only, since the other end may
  // not have someone's own exercises.
  const subs = cleanBackups(e.subs, e.id, id => !!EXIDX[id] && !isCustomEx(EXIDX[id]))
  if (subs.length) o.subs = subs
  if (e.warmupRestOff === true) o.warmupRestOff = true
  if (e.side && e.sideRestOff === true) o.sideRestOff = true
  else if (e.side && e.sideRestSec > 0) o.sideRestSec = e.sideRestSec
  if (e.sg) {
    o.sg = e.sg
    // A superset's name and its rest between rounds (#292) ride on every member, so they travel
    // with the group; without them a shared "Arms · 90 s" arrives nameless, resting the default.
    const name = cleanSgName(e.sgName), rest = cleanRestSec(e.sgRest)
    if (name) o.sgName = name
    if (rest) o.sgRest = rest
  }
  if (e.note) o.note = e.note
  const warm = cleanWarmupSets(e.warmupSets)
  if (warm) o.warmupSets = warm
  // Drop-sets and rest-pause are part of how the exercise is prescribed, not a logging detail.
  // Without this a shared "3x5 with a double drop" arrived at the other end as a plain 3x5,
  // silently — parsePlan's `dropped` counter only tracks exercises it cannot resolve at all.
  const intens = cleanIntensifier(e.intensifier)
  if (intens) o.intensifier = intens
  return o
}

/** Clamped the same way buildSets clamps it on the way out — the stepper showed a hand-edited
 *  plan file's "999" verbatim, because the clamp only happened when the rows were built. */
function cleanWarmupSets(v) {
  const n = Math.round(Number(v)) || 0
  return n > 0 ? Math.min(MAX_PLANNED_WARMUPS, n) : 0
}

/** A positive whole number of seconds or nothing — the same gate cleanEx applies on the way
 *  out, so a hand-edited plan file can't hand the rest timer a string or a negative. */
function cleanRestSec(v) {
  const n = Math.round(Number(v)) || 0
  return n > 0 ? n : 0
}

/** A superset name as setSupersetMeta writes it: a trimmed string of at most SG_NAME_MAX, or nothing. */
function cleanSgName(v) {
  return typeof v === 'string' ? v.trim().slice(0, SG_NAME_MAX) : ''
}

/** Keep the floors the config sheet and applyIntensifierPlan already enforce, and nothing else:
 *  a plan file is someone else's data, so anything unrecognised is dropped rather than trusted. */
function cleanIntensifier(x) {
  const type = x && x.type
  if (type === 'dropset') {
    return { type, count: Math.max(1, Math.round(Number(x.count)) || 1), pct: Math.max(5, Math.round(Number(x.pct)) || 20) }
  }
  if (type === 'restpause') {
    return { type, totalReps: Math.max(1, Math.round(Number(x.totalReps)) || 1), restSec: Math.max(5, Math.round(Number(x.restSec)) || 15) }
  }
  return null
}

// The muscles the map can draw, plus the one label the form gives a cardio exercise.
const CUSTOM_MUSCLES = new Set([...MUSCLES, 'cardiovascular system'])
const muscleList = v => inMuscleOrder([...new Set((Array.isArray(v) ? v : []).filter(m => CUSTOM_MUSCLES.has(m)))])

/** A custom exercise with its own metadata — equipment, muscles, description — in the shape
 *  CustomExForm writes, minus the recipient-side `custom`/`sm` fields mergePlan adds. The bundle
 *  used to carry only {id, n, bp}, so the exercise arrived with an empty equipment tag, no muscle
 *  credit, and (stored without `custom: true`) no way to edit or delete it (QA C7). The same gate
 *  runs on the way in as on the way out, since a plan file is someone else's data: only muscles the
 *  map can draw, a secondary never repeating a primary, the way the form itself enforces. Fields
 *  that are empty stay absent, so a file written before this change reads the same as one after. */
function cleanCustom(c) {
  const o = { id: c.id, n: c.n, bp: c.bp }
  const aliases = normalizeAliases(c.aliases)
  if (aliases.length) o.aliases = aliases
  if (c.desc) o.desc = c.desc
  // The link to a video or guide travels with a shared plan (#246), cleaned both ways like any
  // other field of someone else's file; the exercise's own photo or video never does — it is a
  // file on the sender's device and server, and a plan file is plain JSON.
  const url = cleanUrl(c.url)
  if (url) o.url = url
  if (typeof c.eq === 'string' && c.eq) o.eq = c.eq
  const prim = muscleList(c.primaries)
  const sm = muscleList(c.secondaries).filter(m => !prim.includes(m))
  // `tg` is the legacy single primary; the form keeps it equal to the first primary.
  const tg = prim[0] || (CUSTOM_MUSCLES.has(c.tg) ? c.tg : '')
  if (tg) o.tg = tg
  if (prim.length) o.primaries = prim
  if (sm.length) o.secondaries = sm
  if (prim.length || sm.length) o.muscleGroups = [...prim, ...sm]
  return o
}

/** Build the shareable bundle: every routine, the week schedule, referenced customs. */
export function buildPlanBundle(S, name) {
  const unit = planUnit(S.unit == null ? 'kg' : S.unit)
  if (!unit) unitError()
  const routines = (S.routines || []).map(r => ({
    id: r.id, name: r.name, emoji: r.emoji,
    ...(r.prog ? { prog: r.prog } : {}),
    ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
    ex: (r.ex || []).map(cleanEx)
  }))
  const usedIds = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const customEx = (S.customEx || [])
    .filter(c => usedIds.has(c.id))
    .map(cleanCustom)
  // A weekday can hold several routines (merge order preserved). `[].concat` normalises a
  // legacy scalar id to a one-element list, so a bundle written before this change and one
  // written after are read the same way at the other end.
  const week = {}
  WEEK_DAYS.forEach(d => { if (S.week?.[d]?.length) week[d] = [].concat(S.week[d]) })
  return { opengym_plan: PLAN_FMT, exported: todayISO(), name: name || '', unit, week, routines, customEx }
}

/**
 * Validate + normalise an imported file. Throws with a friendly message if it isn't one.
 *
 * Every exercise id has to resolve — either to the built-in library or to a custom
 * exercise carried in the same file. An id that resolves to neither (a hand-edited file,
 * an export from a build with a different exercise dataset) is dropped here: kept, it
 * would sit invisibly in the routine and only surface as a blank screen when the routine
 * is trained.
 */
export function parsePlan(raw, destinationUnit = 'kg') {
  const notPlan = () => Object.assign(new Error(t('this isn’t an openGym plan file')), { code: 'not-plan' })
  let data = raw
  if (typeof raw === 'string') { try { data = JSON.parse(raw) } catch { throw notPlan() } }
  const destination = planUnit(destinationUnit)
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.opengym_plan || !Array.isArray(data.routines) || !destination) {
    throw notPlan()
  }
  const sourceUnit = declaredPlanUnit(data)
  const customEx = (Array.isArray(data.customEx) ? data.customEx : []).filter(c => c && c.id)
  const known = new Set(customEx.map(c => c.id))
  let dropped = 0
  const routines = data.routines.filter(r => r && Array.isArray(r.ex)).map(r => ({
    ...r,
    ex: r.ex.filter(e => {
      const ok = !!e && (known.has(e.id) || !!EXIDX[e.id])
      if (!ok) dropped++
      return ok
    }).map(e => {
      // The exercises pass through as written, so the fields that carry numbers into the
      // planner get the same clamps on the way in that they get on the way out. A drawing's id
      // (the female figure of an exercise) becomes the exercise's own.
      const warm = cleanWarmupSets(e.warmupSets)
      const intens = cleanIntensifier(e.intensifier)
      const rest = cleanRestSec(e.restSec)
      const restOff = e.restOff === true
      const warmRest = cleanRestSec(e.warmupRestSec)
      const warmOff = e.warmupRestOff === true
      const sideRest = cleanRestSec(e.sideRestSec)
      const sideOff = !!e.side && e.sideRestOff === true
      const incline = clampIncline(e.incline)
      // Planned substitutes: the catalogue's only, as they are exported.
      const subs = cleanBackups(Array.isArray(e.subs) ? e.subs.map(x => (typeof x === 'string' ? canonicalExId(x) : x)) : [], known.has(e.id) ? e.id : canonicalExId(e.id), x => !known.has(x) && !!EXIDX[x] && !isCustomEx(EXIDX[x]))
      // Superset meta only means something on a member of a superset; on a lone exercise it is dropped.
      const sgName = e.sg ? cleanSgName(e.sgName) : ''
      const sgRest = e.sg ? cleanRestSec(e.sgRest) : 0
      const pyramid = normalizePyramid(e.pyramid)
      const pyramidRest = pyramid.length ? normalizePyramidRest(e.pyramidRest, pyramid.length) : []
      const pyramidWeight = pyramid.length ? normalizePyramidWeight(e.pyramidWeight, pyramid.length) : []
      const { warmupSets, intensifier, restSec, restOff: _restOff, warmupRestSec, warmupRestOff: _warmOff, sideRestSec: _sideRest, sideRestOff: _sideOff, subs: _subs, pyramid: _pyramid, pyramidRest: _pyramidRest, pyramidWeight: _pyramidWeight, sgName: _sgName, sgRest: _sgRest, incline: _incline, ...passthrough } = e
      if (!known.has(passthrough.id)) passthrough.id = canonicalExId(passthrough.id)
      return convertedExercise({ ...passthrough, ...(pyramid.length ? { pyramid } : {}), ...(pyramidRest.length ? { pyramidRest } : {}), ...(pyramidWeight.length ? { pyramidWeight } : {}), ...(warm ? { warmupSets: warm } : {}), ...(intens ? { intensifier: intens } : {}), ...(rest ? { restSec: rest } : restOff ? { restOff: true } : {}), ...(warmOff ? { warmupRestOff: true } : warmRest ? { warmupRestSec: warmRest } : {}), ...(sideOff ? { sideRestOff: true } : sideRest ? { sideRestSec: sideRest } : {}), ...(subs.length ? { subs } : {}), ...(sgName ? { sgName } : {}), ...(sgRest ? { sgRest } : {}), ...(incline > 0 ? { incline } : {}) }, sourceUnit || destination, destination)
    })
  }))
  return {
    name: (data.name || '').trim(),
    routines,
    week: data.week || {},
    customEx,
    dropped,
    routineCount: routines.length,
    exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0),
    scheduledDays: WEEK_DAYS.filter(d => data.week?.[d]?.length).length,
    // `unit` is the unit of the returned prescriptions. `sourceUnit` is null for a legacy file;
    // that absence means its numbers were intentionally treated as already in `destination`.
    unit: destination,
    sourceUnit: sourceUnit || null,
    destinationUnit: destination
  }
}

/**
 * Merge a parsed bundle into a draft state `s` (call inside store.update).
 *  - customs: reuse one you already have with the same name + body part, else add it fresh
 *  - routines: always added as NEW routines (fresh ids) — never overwrites yours
 *  - schedule: optional; when on, the shared week REPLACES yours (days the shared plan
 *    leaves empty become rest days — a half-overwritten week would silently mix two plans)
 */
export function mergePlan(s, bundle, { schedule } = {}) {
  const destination = planUnit(s.unit == null ? 'kg' : s.unit)
  if (!destination) unitError()
  const source = convertedBundle(bundle, destination)
  s.customEx = s.customEx || []
  const exIdMap = {}
  ;(source.customEx || []).forEach(c => {
    const same = s.customEx.find(x => (x.n || '').toLowerCase() === (c.n || '').toLowerCase() && x.bp === c.bp)
    if (same) { exIdMap[c.id] = same.id; return }
    const nid = uid()
    exIdMap[c.id] = nid
    // Stored exactly as the form would have created it — `custom: true` is what lets the recipient
    // edit or delete it, and `sm` mirrors the secondaries the way the form writes them.
    const clean = cleanCustom(c)
    s.customEx.push({ ...clean, id: nid, ...(clean.secondaries ? { sm: clean.secondaries } : {}), custom: true })
  })
  const ridMap = {}
  source.routines.forEach(r => {
    const nid = uid()
    ridMap[r.id] = nid
    s.routines.push({
      id: nid,
      name: r.name || t('Shared routine'),
      emoji: r.emoji,
      ...(r.prog ? { prog: r.prog } : {}),
      ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
      ex: (r.ex || []).map(e => ({ ...e, id: exIdMap[e.id] || canonicalExId(e.id) }))
    })
  })
  if (schedule) {
    WEEK_DAYS.forEach(d => { delete s.week[d] })
    Object.entries(source.week || {}).forEach(([d, val]) => {
      // `[].concat` tolerates a pre-upgrade scalar bundle value. An element whose routine id
      // didn't survive parsing is dropped, not written as undefined; a day that ends up empty
      // is left absent rather than stored as `[]`.
      const ids = [].concat(val).map(oldId => ridMap[oldId]).filter(Boolean)
      if (ids.length) s.week[d] = ids
    })
  }
  // `ids`: the new routines' ids in the plan's order, for a caller that puts them in a rotation.
  return { routines: source.routines.length, ids: source.routines.map(r => ridMap[r.id]) }
}

/* ------------------------------- printable PDF ------------------------------- */

// One exercise's scheme, e.g. "3 × 8–12 · 60 kg · drop-set 1× −20%", "3 × 0:45" or
// "2 × 20 min @ 8 km/h" — the speed in the profile's unit (lib/speed.js), like the weight. The
// reps half is exLine's, so a double-progression range prints as the range it is ("8–12", not
// the top alone) and a per-side split reads "8/side" exactly as the routine editor shows it.
// As parts: the sets line, then what comes on top of it, each printed on a line of its own so the
// sets line never wraps in the middle of "4 × 12 · 35 kg".
function schemeParts(e, unit, speedUnit) {
  const sets = e.sets || 1
  const mode = modeOf(e)
  if (mode === 'cardio') {
    const body = `${e.min || 20} min @ ${fmtSpeed(e.speed || 8, speedUnit)}`
    return [sets > 1 ? `${sets} × ${body}` : body]
  }
  const line = exLine({ ...e, reps: e.reps ?? 10 }, unit, speedUnit)
  const extras = [intensifierLine(e.intensifier), e.lastToFailure === true ? t('Last set to failure') : ''].filter(Boolean)
  return [line, ...extras]
}
// The extra lines keep their " · " in the text (hidden on paper), so copied text reads as one line.
const schemeHTML = parts => parts.map((p, i) => i === 0
  ? `<span class="s-main">${esc(p)}</span>`
  : `<span class="s-x"><span class="sep"> · </span>${esc(p)}</span>`).join('')

// A drop-set or rest-pause is how the exercise is prescribed, so the printout names it — the
// sheet at the rack otherwise reads as plain straight sets.
function intensifierLine(x) {
  const intens = cleanIntensifier(x)
  if (!intens) return ''
  return intens.type === 'dropset'
    ? `${t('Drop-set')} ${intens.count}× −${intens.pct}%`
    : `${t('Rest-pause')} ${intens.totalReps} ${t('reps')}`
}

// Group consecutive exercises sharing a superset id into rendered units.
function units(ex) {
  const out = []
  ex.forEach((e, i) => {
    const prev = ex[i - 1]
    if (i > 0 && e.sg && prev?.sg === e.sg) out[out.length - 1].push(e)
    else out.push([e])
  })
  return out
}

/**
 * An exercise's printed name: the display name, and on a line of its own the English title the
 * app adds in parentheses to a translated one ("Bankdrücken mit Langhantel (barbell bench press)"),
 * so a long German name wraps once instead of three times. Shared with the workout printouts.
 */
export function printedName(ex, fallback) {
  if (!ex) return { name: fallback || t('Unknown exercise'), en: '', cls: '' }
  const full = exerciseNameFor(ex)
  const suffix = ` (${ex.n})`
  const split = ex.n && full !== ex.n && full.endsWith(suffix)
  return { name: split ? full.slice(0, -suffix.length) : full, en: split ? ex.n : '', cls: exerciseNameClass(ex) }
}

// One exercise row. `n` is its number in the routine; `ticks` draws a box per set to tick off at
// the gym (the single-routine sheet, which is the one you take with you).
function exerciseHTML(e, n, unit, { speedUnit, ticks }) {
  const ex = EXIDX[e.id]
  const { name, en, cls } = printedName(ex)
  // Translated, and set apart by a real space: glued to the name, "capitalize" read the two as
  // one word and printed "Curlupper Legs".
  const part = ex && ex.bp && ex.bp !== 'cardio' ? ` <span class="part">${esc(t(ex.bp))}</span>` : ''
  const boxes = ticks ? `<div class="ticks">${'<i></i>'.repeat(Math.min(12, Math.max(1, e.sets || 1)))}</div>` : ''
  return `<div class="ex"><div class="ex-num">${n}</div><div class="ex-main">`
    + `<div class="ex-n ${ex ? cls : ''}">${esc(name)}${part}</div>`
    + (en ? `<div class="ex-en">${esc(en)}</div>` : '')
    + (e.note ? `<div class="ex-note">${esc(e.note)}</div>` : '')
    + `</div><div class="ex-s">${schemeHTML(schemeParts(e, unit, speedUnit))}${boxes}</div></div>`
}

// A routine as a run of blocks that each stay whole on a page: one per exercise, one per superset.
// The routine's heading (and, for the first routine, the section heading above it) travels inside
// the first block, so it can never be stranded at the bottom of a page with its exercises overleaf.
// The routine itself may run over a page: holding all of it together left whole pages blank.
function routineHTML(r, unit, { bare = false, speedUnit, ticks = false, lead = '', m, key }) {
  let n = 0
  const list = units(r.ex)
  const blocks = list.map((u, bi) => {
    const items = u.map(e => exerciseHTML(e, ++n, unit, { speedUnit, ticks })).join('')
    const body = u.length > 1
      ? `<div class="ss"><div class="ss-tag">${esc(t('Superset'))}</div>${items}</div>`
      : items
    const id = `${key}-${bi}`
    const head = bi === 0
      ? lead + (bare ? '' : `${m.h(id)}<div class="r-head"><h2>${esc(r.name)}</h2><span class="r-count">${esc(exCount(r.ex.length))}</span></div>`)
      : ''
    return `<div class="keep">${m.s(id)}${head}${body}${m.e(id)}</div>`
  })
  if (!blocks.length) blocks.push(`<div class="keep">${lead}${bare ? '' : `<div class="r-head"><h2>${esc(r.name)}</h2></div>`}<div class="none">${esc(t('No exercises yet.'))}</div></div>`)
  return `<section class="routine">${blocks.join('')}</section>`
}

function weekHTML(S, m) {
  // The printout is read by whoever exported it, so the week runs in their order.
  const rows = weekOrder(weekStartOf(S)).map(d => {
    const names = [].concat(S.week?.[d] || [])
      .map(id => S.routines.find(x => x.id === id)?.name)
      .filter(Boolean)
    const val = names.length ? esc(deriveSessionName(names)) : `<span class="rest">${esc(t('Rest'))}</span>`
    return `<tr><th scope="row">${esc(t(DAYN[d]))}</th><td>${val}</td></tr>`
  }).join('')
  return `<div class="keep">${m.s('week')}${m.h('week')}<h3 class="sec-h first">${esc(t('Week schedule'))}</h3><table class="week">${rows}</table>${m.e('week')}</div>`
}

const PLAN_CSS = `
  .routine { margin-bottom: 8pt; }
  .r-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10pt; margin: 14pt 0 2pt; padding-bottom: 4pt; border-bottom: 1.5px solid var(--ink); }
  .r-head h2 { font-size: 13pt; letter-spacing: -.01em; margin: 0; overflow-wrap: anywhere; }
  .r-count { font-size: 8pt; color: var(--muted); white-space: nowrap; }

  .ex { display: flex; align-items: flex-start; gap: 8pt; padding: 6pt 0; border-bottom: 1px solid var(--rule-soft); }
  .ex-num { flex: none; width: 14pt; height: 14pt; margin-top: 1pt; border-radius: 50%; background: var(--tint); color: var(--muted);
    font-size: 7pt; font-weight: 700; line-height: 14pt; text-align: center; }
  .ex-main { flex: 1 1 auto; min-width: 0; }
  .ex-n { font-weight: 600; overflow-wrap: anywhere; }
  .ex-n.capitalize { text-transform: capitalize; }
  .ex-n .part { display: inline-block; text-transform: none; color: var(--faint); font-weight: 400; font-size: 8pt; margin-inline-start: 3pt; }
  .ex-n .part::first-letter { text-transform: uppercase; }
  .ex-en { color: var(--faint); font-size: 8pt; text-transform: capitalize; overflow-wrap: anywhere; }
  .ex-note { color: var(--ink-2); font-size: 8.5pt; margin-top: 2pt; font-style: italic; }
  .ex-s { flex: none; max-width: 46%; text-align: end; color: var(--ink-2); font-weight: 500; }
  .ex-s .s-main { display: block; white-space: nowrap; }
  .ex-s .s-x { display: block; font-size: 8pt; font-weight: 400; color: var(--muted); }
  .ex-s .sep { display: none; }
  .ticks { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 3pt; margin-top: 4pt; }
  .ticks i { display: block; width: 9pt; height: 9pt; border: 1px solid #c4c9d2; border-radius: 2pt; }

  .ss { border-inline-start: 2.5pt solid var(--lime); padding-inline-start: 8pt; margin: 4pt 0; }
  .ss-tag { font-size: 7pt; letter-spacing: .1em; text-transform: uppercase; color: var(--lime-ink); font-weight: 700; padding-top: 5pt; }
  .ss .ex:last-child { border-bottom: 0; }

  table.week th { width: 32%; text-transform: none; letter-spacing: 0; font-size: 9pt; color: var(--ink); font-weight: 600; padding: 4pt 8pt 4pt 0; border-bottom: 1px solid var(--rule-soft); }
  table.week td { padding: 4pt 0; }
  table.week tr:last-child th, table.week tr:last-child td { border-bottom: 0; }
  .rest { color: var(--faint); }
`

/**
 * Full self-contained HTML for the print/PDF view. With `routineId` it is that one routine on
 * its own page (#282) — the session you take to the gym, not the week around it — so the week
 * schedule is left out and the routine's name is the page title. `probe` is for the layout check
 * (lib/print-doc.js probeMarks), never set in the app.
 */
export function planPrintHTML(S, owner, { routineId, probe = false } = {}) {
  const m = probeMarks(probe)
  const unit = S.unit || 'kg'
  const speedUnit = speedUnitOf(S)
  const single = routineId ? (S.routines || []).find(r => r.id === routineId) || null : null
  const routines = routineId ? [single].filter(Boolean) : (S.routines || []).filter(r => r.ex && r.ex.length)
  const lead = routineId ? '' : `<h3 class="sec-h">${esc(t('Routines'))}</h3>`
  const body = routines.length
    ? routines.map((r, i) => routineHTML(r, unit, { bare: !!single, speedUnit, ticks: !!single, lead: i === 0 ? lead : '', m, key: 'r' + i })).join('')
    : `<p class="none">${esc(t('No routines yet.'))}</p>`
  const title = single ? single.name : t('Weekly Training Plan')
  const facts = single ? [exCount(single.ex.length)] : [routineCount(routines.length)]
  return printShell({
    title, kicker: single ? t('Routine') : t('Training plan'), facts, owner, date: todayISO(),
    body: (routineId ? '' : weekHTML(S, m)) + body,
    css: PLAN_CSS,
  })
}

/**
 * Print the plan: the browser's print dialog (→ Save as PDF) on the web.
 * `opts` is planPrintHTML's: `{ routineId }` prints a single routine.
 */
export function printPlan(S, owner, opts) {
  return printDocument(planPrintHTML(S, owner, opts), opts?.routineId ? (S.routines || []).find(r => r.id === opts.routineId)?.name : t('Weekly Training Plan'))
}
