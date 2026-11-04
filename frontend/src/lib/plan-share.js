// Share a weekly plan.
//
// Two jobs:
//  1. A small, self-contained file a friend can import into THEIR openGym — just the
//     routines + the week schedule + the custom exercises those routines use. It never
//     carries workouts, weigh-ins or settings, and importing MERGES (adds routines with
//     fresh ids) so nothing the friend already has is touched.
//  2. A clean, printable page (Save as PDF) where a single exercise never splits across
//     a page break — each exercise, and each routine that fits, stays in one place.

import { warmupModeOf, ownRowsOf } from './warmup-ramp.js'
import { EXIDX, canonicalExId, isBodyweightEq, isCustomEx } from './exercises.js'
import { cleanBackups } from './routine-backups.js'
import { cleanUrl } from './media-refs.js'
import { modeOf, fmtSec, isBw, isPerSide, sideReps, exLine, MAX_PLANNED_WARMUPS } from './history.js'
import { deriveSessionName } from './session-merge.js'
import { uid, todayISO, DAYN, weekOrder, weekStartOf, fmtNum, exCount, routineCount, weightDecimals } from './format.js'
import { t, exerciseNameFor, exerciseNameClass } from './i18n-core.js'
import { convertWeight, convertStateUnit } from './units.js'
import { exUnitPin, withExUnit, viewTarget, exUnitOf } from './ex-unit.js'
import { migrateProfileV1ToV2 } from '../../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'
import { fmtSpeed, speedUnitOf } from './speed.js'
import { clampIncline } from './incline.js'
import { MUSCLES, inMuscleOrder } from './muscles.js'
import { SG_NAME_MAX } from './superset-meta.js'
import { esc, printShell, printDocument, probeMarks } from './print-doc.js'
import { MEDIA_CREDIT, isPrintPicture, loadPrintPictures } from './print-pictures.js'
import { normalizeAliases } from './exercise-aliases.js'
import { bundleProgramme, importedProgramme, programmeById, programmeRoutineIds, programmesOf, IMPORT_MAX_PROGRAMMES } from './programmes.js'
import { migrateOccurrence, supports, validateIntensifier, validatePlanRule, validateWarmup } from './prescription/index.js'
import { coachExOf } from '../../../api/coach/core/plan-view.js'

const PLAN_FMT = 3
const PROGRAMME_FMT = 1
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

function convertedBundle(bundle, destinationUnit) {
  const sourceUnit = declaredPlanUnit(bundle)
  if (!sourceUnit || sourceUnit === destinationUnit) return bundle
  return convertStateUnit({ ...bundle, unit: sourceUnit }, destinationUnit)
}

// What a routine occurrence carries into a shared plan: the engine's own identity and
// prescription (occurrenceId, exerciseId, rule) plus the handful of presentation fields
// below — order, mode, laterality, superset tag, note, rest, warm-up recipe. This is the
// authoritative list of what travels; every legacy per-mode field (sets, reps, weight,
// intensifier, prog, inc, deloadFactor, side…) lived on the pre-engine exercise shape and no
// longer exists on a canonical occurrence — the rule carries the prescription wholesale. The one
// legacy exception is `warmupSets`, migrated to `warmup` by `migrateOccurrence` before this runs.
function cleanOccurrence(o) {
  const out = { occurrenceId: o.occurrenceId, exerciseId: o.exerciseId, order: o.order, mode: o.mode }
  if (o.rule) out.rule = o.rule
  for (const key of ['side', 'bodyweight', 'assisted', 'excludeFromProgression', 'lastToFailure', 'backoff']) if (typeof o[key] === 'boolean') out[key] = o[key]
  // The warm-ups' "no timer" and their own rest, and the break between sides, travel only when set.
  const warmupRest = cleanRestSec(o.warmupRestSec)
  if (o.warmupRestOff === true) out.warmupRestOff = true
  else if (warmupRest) out.warmupRestSec = warmupRest
  const sideRest = cleanRestSec(o.sideRestSec)
  if (o.side === true && o.sideRestOff === true) out.sideRestOff = true
  else if (o.side === true && sideRest) out.sideRestSec = sideRest
  // Planned substitutes (lib/routine-backups.js): the catalogue's only, since the other end may not
  // have someone's own exercises.
  const subs = cleanBackups(o.subs, o.exerciseId, id => !!EXIDX[id] && !isCustomEx(EXIDX[id]))
  if (subs.length) out.subs = subs
  if (['each', 'total', 'as'].includes(o.dbLoad)) out.dbLoad = o.dbLoad
  if (o.laterality) out.laterality = o.laterality
  // What the cardio sheet edits (sets, minutes, speed, the treadmill's grade), cleaned like any field of someone else's file.
  if (o.cardio && typeof o.cardio === 'object') {
    const c = o.cardio, incline = clampIncline(c.incline)
    out.cardio = { sets: Math.max(1, Math.round(Number(c.sets)) || 1), min: Math.max(1, Math.round(Number(c.min)) || 20), speed: Math.max(0, Number(c.speed) || 8), ...(incline > 0 ? { incline } : {}) }
  }
  if (o.sg) {
    out.sg = o.sg
    // A superset's name and its rest between rounds (#292) ride on every member, so they travel with the group.
    const name = cleanSgName(o.sgName), sgRest = cleanRestSec(o.sgRest)
    if (name) out.sgName = name
    if (sgRest) out.sgRest = sgRest
  }
  if (o.note) out.note = o.note
  if (o.restFromProfile) out.restFromProfile = true
  // A recipe the rule cannot use (timed, unloaded) is dropped rather than carried inert.
  const can = o.rule && supports(o.rule)
  if (o.warmup && can?.warmup) {
    out.warmup = o.warmup
    if (warmupModeOf(o) === 'own') out.warmupRows = ownRowsOf(o)
    if (o.legacyWarmupSets > 0) out.legacyWarmupSets = Math.min(5, Math.round(o.legacyWarmupSets))
  }
  if (o.intensifier && can?.[o.intensifier.type]) out.intensifier = o.intensifier
  const rest = cleanRestSec(o.restSec)
  if (o.restOff === true) out.restOff = true   // "No timer" for this exercise
  else if (rest) out.restSec = rest
  return out
}

/** A positive whole number of seconds or nothing — a hand-edited plan file can't hand the rest
 *  timer a string or a negative. */
function cleanRestSec(v) {
  const n = Math.round(Number(v)) || 0
  return n > 0 ? n : 0
}

/** A superset name as setSupersetMeta writes it: a trimmed string of at most SG_NAME_MAX, or nothing. */
function cleanSgName(v) {
  return typeof v === 'string' ? v.trim().slice(0, SG_NAME_MAX) : ''
}

/** A rule is the prescription itself — an unknown preset or an out-of-range parameter isn't
 *  a field to drop quietly like an unrecognised legacy toggle, it's a bundle that doesn't parse. */
function assertValidRule(rule) {
  const { ok, errors } = validatePlanRule(rule)
  if (!ok) throw new Error(errors.join('; '))
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

/** Build the shareable bundle: every routine, the week schedule, referenced customs, and
 *  never the exporter's workout history, prescriptions or 1RMs (the recipient is prompted for
 *  their own). */
export function buildPlanBundle(S, name) {
  const unit = planUnit(S.unit == null ? 'kg' : S.unit)
  if (!unit) unitError()
  const routines = (S.routines || []).map(r => ({
    id: r.id, name: r.name, emoji: r.emoji,
    ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
    ex: (r.ex || []).map(cleanOccurrence)
  }))
  const usedIds = new Set(routines.flatMap(r => r.ex.map(e => e.exerciseId)))
  const customEx = (S.customEx || [])
    .filter(c => usedIds.has(c.id))
    .map(cleanCustom)
  // A weekday can hold several routines (merge order preserved). `[].concat` normalises a
  // legacy scalar id to a one-element list, so a bundle written before this change and one
  // written after are read the same way at the other end.
  const week = {}
  WEEK_DAYS.forEach(d => { if (S.week?.[d]?.length) week[d] = [].concat(S.week[d]) })
  const programmes = programmesOf(S).map(bundleProgramme).filter(Boolean)
  // The plan's exercises that are shown in a weight unit of their own (#657), so a shared lb
  // machine arrives as one. The numbers stay in the file's `unit`; an older app skips the map.
  const exUnit = Object.fromEntries([...usedIds].map(id => [id, exUnitPin(S, id)]).filter(([, u]) => u))
  return { opengym_plan: PLAN_FMT, exported: todayISO(), name: name || '', unit, week, routines, customEx,
    ...(Object.keys(exUnit).length ? { exUnit } : {}),
    ...(programmes.length ? { programme_fmt: PROGRAMME_FMT, programmes } : {}) }
}

/**
 * One programme as a plan file: its routines, its weekdays as the file's week (what an older app
 * imports as the schedule), and the programme itself. Null for an unknown id.
 */
export function buildProgrammeBundle(S, id) {
  const p = programmeById(S, id)
  if (!p) return null
  const ids = new Set(programmeRoutineIds(S, p))
  const sub = { ...S, routines: (S.routines || []).filter(r => ids.has(r.id)), week: p.days || {}, programmes: { [p.id]: p } }
  return buildPlanBundle(sub, p.name)
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
  // v1 shared plans use the same converter and catalogue as profiles. Format 2's retired
  // bindings are still refused: they are not v1 exercise configs.
  if (data?.opengym_plan === 1 && Array.isArray(data.routines) && destination) {
    const unit = declaredPlanUnit(data) || destination
    const { profile } = migrateProfileV1ToV2({ unit, restSec: data.restSec, routines: data.routines.map(r => ({ ...r, ex: (r.ex || []).map(e => ({ ...e, id: (data.customEx || []).some(c => c.id === e.id) ? e.id : canonicalExId(e.id) })) })), customEx: data.customEx, workouts: [] }, LIB_BY_ID)
    data = { ...data, opengym_plan: PLAN_FMT, routines: profile.routines, migrationAudit: profile.migrationAudit }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.opengym_plan !== PLAN_FMT || !Array.isArray(data.routines) || !destination) {
    throw new Error(t('this isn’t an openGym plan file'))
  }
  const sourceUnit = declaredPlanUnit(data)
  const customEx = (Array.isArray(data.customEx) ? data.customEx : []).filter(c => c && c.id)
  const known = new Set(customEx.map(c => c.id))
  let dropped = 0
  let routines = data.routines.filter(r => r && Array.isArray(r.ex)).map(r => ({
    ...r,
    ex: r.ex.filter(e => {
      // An occurrence with no rule can't be started, so it is dropped like an unknown exercise.
      const ok = !!e && !!e.occurrenceId && !!e.rule && (known.has(e.exerciseId) || !!EXIDX[e.exerciseId])
      if (!ok) { dropped++; return false }
      // A rule is validated before anything is imported: an unknown preset or an out-of-range
      // parameter is a bundle that doesn't parse, not an exercise to drop quietly.
      assertValidRule(e.rule)
      if (e.rule.exerciseId !== e.exerciseId) throw new Error(t('this isn’t an openGym plan file'))
      if (!validateWarmup(migrateOccurrence(e).warmup, weightDecimals()) || !validateIntensifier(e.intensifier)) throw new Error(t('this isn’t an openGym plan file'))
      return true
    }).map(e => cleanOccurrence(migrateOccurrence(e)))
  }))
  // Exercise units (#657): only kg or lb, and only for exercises the plan still holds.
  const inPlan = new Set(routines.flatMap(r => r.ex.map(e => e.exerciseId)))
  const exUnit = Object.fromEntries(Object.entries(data.exUnit && typeof data.exUnit === 'object' && !Array.isArray(data.exUnit) ? data.exUnit : {})
    .map(([id, u]) => [known.has(id) ? id : canonicalExId(id), u])
    .filter(([id, u]) => (u === 'kg' || u === 'lb') && inPlan.has(id)))
  if (sourceUnit && sourceUnit !== destination) routines = convertStateUnit({ unit: sourceUnit, routines }, destination).routines
  return {
    name: (data.name || '').trim(),
    routines,
    week: data.week || {},
    exUnit,
    customEx,
    dropped,
    routineCount: routines.length,
    exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0),
    scheduledDays: WEEK_DAYS.filter(d => data.week?.[d]?.length).length,
    // A newer programme format than this app reads is left out rather than half understood.
    programmes: Array.isArray(data.programmes) && !(Number(data.programme_fmt) > PROGRAMME_FMT)
      ? data.programmes.filter(p => p && typeof p === 'object' && !Array.isArray(p)).slice(0, IMPORT_MAX_PROGRAMMES) : [],
    // `unit` is the unit of the returned prescriptions. `sourceUnit` is null for a legacy file;
    // that absence means its numbers were intentionally treated as already in `destination`.
    unit: destination,
    sourceUnit: sourceUnit || null,
    destinationUnit: destination,
    ...(data.migrationAudit ? { migrationAudit: data.migrationAudit } : {})
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
  const ridMap = {}, occurrenceMap = {}
  source.routines.forEach(r => {
    const nid = uid()
    ridMap[r.id] = nid
    s.routines.push({
      id: nid,
      name: r.name || t('Shared routine'),
      emoji: r.emoji,
      ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
      // Fresh occurrence and rule identity — a merged routine never shares live engine identity
      // with the file it came from — but the prescription itself survives. Re-validated here too:
      // mergePlan is a public entry point of its own, not only reached through parsePlan.
      ex: (r.ex || []).map(e => {
        assertValidRule(e.rule)
        const occurrenceId = uid()
        occurrenceMap[e.occurrenceId] = occurrenceId
        const exerciseId = exIdMap[e.exerciseId] || canonicalExId(e.exerciseId)
        return {
          ...e,
          exerciseId,
          occurrenceId,
          rule: { ...e.rule, id: occurrenceId, revision: 1, routineId: nid, exerciseId }
        }
      })
    })
  })
  if (source.migrationAudit) {
    const audit = source.migrationAudit
    s.migrationAudit = { ...s.migrationAudit, fromSchema: 1,
      unsupported: [...(s.migrationAudit?.unsupported || []), ...(audit.unsupported || []).map(a => ({ ...a,
        routineId: ridMap[a.routineId] || a.routineId, occurrenceId: occurrenceMap[a.occurrenceId] || a.occurrenceId, exerciseId: exIdMap[a.exerciseId] || a.exerciseId }))],
      discarded: [...(s.migrationAudit?.discarded || []), ...(audit.discarded || [])] }
  }
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
  // An exercise the plan shows in a unit of its own (#657) is pinned the same here, unless this
  // profile already made its own choice for it.
  for (const [id, u] of Object.entries(source.exUnit || {})) {
    const nid = exIdMap[id] || canonicalExId(id)
    if (s.exUnit && typeof s.exUnit === 'object' && s.exUnit[nid]) continue
    s.exUnit = withExUnit(s.exUnit, nid, u)
  }
  // Programmes, over the routines just added (lib/programmes.js importedProgramme). Never started.
  let programmes = 0
  for (const p of source.programmes || []) {
    const got = importedProgramme(p, ridMap, exIdMap)
    if (!got) continue
    s.programmes = { ...(s.programmes && typeof s.programmes === 'object' ? s.programmes : {}), [got.id]: got }
    programmes++
  }
  // `ids`: the new routines' ids in the plan's order, for a caller that puts them in a rotation.
  return { routines: source.routines.length, ids: source.routines.map(r => ridMap[r.id]), programmes }
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
function exerciseHTML(stored, n, profile, { speedUnit, ticks, state }) {
  // In the exercise's own weight unit when it has one (#657).
  const e = state ? viewTarget(state, stored.id, stored) : stored
  const unit = state ? exUnitOf(state, stored.id) : profile
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
function routineHTML(r, unit, { bare = false, speedUnit, ticks = false, lead = '', m, key, state }) {
  let n = 0
  const list = units(r.ex)
  const blocks = list.map((u, bi) => {
    const items = u.map(e => exerciseHTML(e, ++n, unit, { speedUnit, ticks, state })).join('')
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

// ---- with pictures (#817): a grid of cells, two to a row, like the paper plan a gym hands out ----
// Each row is one block that stays whole on a page; the routine's heading travels in its first
// row, as in the list. The row is a CSS table (two cells of equal height), the picture sits on the
// leading side of its cell with the name, sets, rest and note beside it: at 27 mm the picture
// reads at a glance and a cell stays short enough for five or six rows to a page.
const restText = sec => (sec < 60 ? sec + 's' : Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'))

function cellHTML(stored, n, profile, { speedUnit, ticks, state, pictures }) {
  const e = state ? viewTarget(state, stored.id, stored) : stored
  const unit = state ? exUnitOf(state, stored.id) : profile
  const ex = EXIDX[e.id]
  const { name, en, cls } = printedName(ex)
  const part = ex && ex.bp && ex.bp !== 'cardio' ? ` <span class="part">${esc(t(ex.bp))}</span>` : ''
  const pic = pictures[stored.id]
  const rest = Math.round(Number(e.restSec)) > 0 && modeOf(e) !== 'cardio' ? `<div class="gc-rest">${esc(t('Rest'))} ${esc(restText(Math.round(e.restSec)))}</div>` : ''
  const boxes = ticks ? `<div class="ticks">${'<i></i>'.repeat(Math.min(12, Math.max(1, e.sets || 1)))}</div>` : ''
  return `<div class="gc"><div class="gc-in${pic ? '' : ' no-pic'}">`
    + (pic ? `<div class="gc-pic"><img src="${esc(pic)}" alt="" width="180" height="180"></div>` : '')
    + `<div class="gc-txt"><div class="gc-top"><span class="ex-num">${n}</span><div class="ex-n ${ex ? cls : ''}">${esc(name)}${part}</div></div>`
    + (en ? `<div class="ex-en">${esc(en)}</div>` : '')
    + `<div class="gc-s">${schemeHTML(schemeParts(e, unit, speedUnit))}</div>`
    + rest
    + (e.note ? `<div class="ex-note">${esc(e.note)}</div>` : '')
    + boxes
    + `</div></div></div>`
}

// Cells two by two; an odd last one keeps its half of the row.
const gridRows = cells => {
  const rows = []
  for (let i = 0; i < cells.length; i += 2) rows.push(`<div class="g-row">${cells[i]}${cells[i + 1] || '<div class="gc gc-empty"></div>'}</div>`)
  return rows
}

function routineGridHTML(r, unit, { bare = false, speedUnit, ticks = false, lead = '', m, key, state, pictures }) {
  let n = 0
  const opts = { speedUnit, ticks, state, pictures }
  // Single exercises fill rows two at a time; a superset closes the row before it and gets its
  // own framed block, its members two to a row inside it, so the group still reads as one.
  const blocks = []
  let loose = []
  const flush = () => { gridRows(loose).forEach(row => blocks.push(row)); loose = [] }
  for (const u of units(r.ex)) {
    if (u.length > 1) {
      flush()
      const cells = u.map(e => cellHTML(e, ++n, unit, opts))
      blocks.push(`<div class="ss"><div class="ss-tag">${esc(t('Superset'))}</div>${gridRows(cells).join('')}</div>`)
    } else loose.push(cellHTML(u[0], ++n, unit, opts))
  }
  flush()
  const html = blocks.map((body, bi) => {
    const id = `${key}-${bi}`
    const head = bi === 0
      ? lead + (bare ? '' : `${m.h(id)}<div class="r-head"><h2>${esc(r.name)}</h2><span class="r-count">${esc(exCount(r.ex.length))}</span></div>`)
      : ''
    return `<div class="keep">${m.s(id)}${head}${body}${m.e(id)}</div>`
  })
  if (!html.length) html.push(`<div class="keep">${lead}${bare ? '' : `<div class="r-head"><h2>${esc(r.name)}</h2></div>`}<div class="none">${esc(t('No exercises yet.'))}</div></div>`)
  return `<section class="routine grid">${html.join('')}</section>`
}

const GRID_CSS = `
  .g-row { display: table; table-layout: fixed; width: 100%; border-collapse: collapse; }
  .gc { display: table-cell; width: 50%; vertical-align: top; padding: 7pt 0; border-bottom: 1px solid var(--rule-soft); }
  .gc:first-child { padding-inline-end: 9pt; }
  .gc + .gc { padding-inline-start: 9pt; border-inline-start: 1px solid var(--rule-soft); }
  .gc-empty { border-bottom: 0; }
  .gc-in { display: flex; align-items: flex-start; gap: 7pt; }
  .gc-pic { flex: none; width: 27mm; height: 27mm; border: 1px solid var(--rule); border-radius: 3pt; background: #fff; overflow: hidden; }
  /* Paper is never dark: no inversion or tint a dark theme might carry over. */
  .gc-pic img { display: block; width: 100%; height: 100%; object-fit: contain; filter: none !important; mix-blend-mode: normal; }
  .gc-txt { flex: 1 1 auto; min-width: 0; }
  .gc-top { display: flex; align-items: flex-start; gap: 5pt; }
  .gc-top .ex-num { flex: none; }
  .gc-s { margin-top: 3pt; color: var(--ink-2); font-weight: 500; }
  .gc-s .s-main { display: block; }
  .gc-s .s-x { display: block; font-size: 8pt; font-weight: 400; color: var(--muted); }
  .gc-s .sep { display: none; }
  .gc-rest { font-size: 8pt; color: var(--muted); }
  .gc .ticks { justify-content: flex-start; }
  .grid .ss { margin: 4pt 0; }
  .grid .ss .g-row:last-child .gc { border-bottom: 0; }
`

/**
 * Full self-contained HTML for the print/PDF view. With `routineId` it is that one routine on
 * its own page (#282) — the session you take to the gym, not the week around it — so the week
 * schedule is left out and the routine's name is the page title. `probe` is for the layout check
 * (lib/print-doc.js probeMarks), never set in the app.
 * `pictures` ({ [exercise id]: data URL }, lib/print-pictures.js loadPrintPictures) prints the
 * exercises as a grid with a picture each (#817); an exercise without one gets a text-only cell.
 * With no picture for any printed exercise the page is the plain list. The licence's credit line
 * is added only when a catalogue picture is on the page.
 */
export function planPrintHTML(S, owner, { routineId, probe = false, pictures = null } = {}) {
  const m = probeMarks(probe)
  const unit = S.unit || 'kg'
  const speedUnit = speedUnitOf(S)
  const single = routineId ? (S.routines || []).find(r => r.id === routineId) || null : null
  const routines = routineId ? [single].filter(Boolean) : (S.routines || []).filter(r => r.ex && r.ex.length)
  const pics = {}
  if (pictures && typeof pictures === 'object') {
    for (const r of routines) for (const e of r.ex || []) if (isPrintPicture(pictures[e.exerciseId ?? e.id])) pics[e.exerciseId ?? e.id] = pictures[e.exerciseId ?? e.id]
  }
  const grid = Object.keys(pics).length > 0
  const credit = grid && Object.keys(pics).some(id => EXIDX[id] && !isCustomEx(EXIDX[id])) ? MEDIA_CREDIT : ''
  const lead = routineId ? '' : `<h3 class="sec-h">${esc(t('Routines'))}</h3>`
  const one = (routine, i) => {
    const r = { ...routine, ex: routine.ex.map(e => ({ ...e, ...coachExOf(e, EXIDX[e.exerciseId ?? e.id]), ...(e.note ? { note: e.note } : {}) })) }
    const o = { bare: !!single, speedUnit, ticks: !!single, lead: i === 0 ? lead : '', m, key: 'r' + i, state: S }
    return grid ? routineGridHTML(r, unit, { ...o, pictures: pics }) : routineHTML(r, unit, o)
  }
  const body = routines.length
    ? routines.map(one).join('')
    : `<p class="none">${esc(t('No routines yet.'))}</p>`
  const title = single ? single.name : t('Weekly Training Plan')
  const facts = single ? [exCount(single.ex.length)] : [routineCount(routines.length)]
  return printShell({
    title, kicker: single ? t('Routine') : t('Training plan'), facts, owner, date: todayISO(),
    body: (routineId ? '' : weekHTML(S, m)) + body,
    css: PLAN_CSS + (grid ? GRID_CSS : ''),
    credit,
  })
}

/**
 * Print the plan: the browser's print dialog (→ Save as PDF) on the web, the phone's print sheet
 * in the app (lib/print-doc.js printDocument). `opts` is planPrintHTML's: `{ routineId }` prints
 * a single routine; `withPictures` loads the exercise pictures first (lib/print-pictures.js),
 * waiting at most a few seconds, and prints whatever made it in. `name` names the print job;
 * `beforePrint` runs once the page is ready, just before the dialog opens; returning false there
 * (the sheet was dismissed while the pictures loaded) prints nothing.
 */
export async function printPlan(S, owner, { withPictures = false, name, beforePrint, loadPictures = loadPrintPictures, ...opts } = {}) {
  let pictures = null
  if (withPictures) {
    try { pictures = await loadPictures(S, { routineId: opts.routineId }) } catch { pictures = null }
  }
  const job = name || (opts.routineId ? (S.routines || []).find(r => r.id === opts.routineId)?.name || t('Routine') : t('Weekly Training Plan'))
  const html = planPrintHTML(S, owner, { ...opts, pictures })
  if (beforePrint && beforePrint() === false) return
  return printDocument(html, job)
}
