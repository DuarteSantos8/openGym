// Share a weekly plan.
//
// Two jobs:
//  1. A small, self-contained file a friend can import into THEIR openGym — just the
//     routines + the week schedule + the custom exercises those routines use. It never
//     carries workouts, weigh-ins or settings, and importing MERGES (adds routines with
//     fresh ids) so nothing the friend already has is touched.
//  2. A clean, printable page (Save as PDF) where a single exercise never splits across
//     a page break — each exercise, and each routine that fits, stays in one place.

import { EXIDX } from './exercises.js'
import { modeOf, fmtSec, isBw, isPerSide, sideReps } from './history.js'
import { deriveSessionName } from './session-merge.js'
import { uid, todayISO, DAYN, weekOrder, weekStartOf, fmtNum, exCount, weightDecimals } from './format.js'
import { t, exerciseNameFor } from './i18n-core.js'
import { convertWeight } from './units.js'
import { MUSCLES, inMuscleOrder } from './muscles.js'
import { migrateOccurrence, supports, validateIntensifier, validatePlanRule, validateWarmup } from './prescription/index.js'
import { coachExOf } from '../../../api/coach/core/plan-view.js'

const PLAN_FMT = 3
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
  if (o.laterality) out.laterality = o.laterality
  if (o.sg) out.sg = o.sg
  if (o.note) out.note = o.note
  // A recipe the rule cannot use (timed, unloaded) is dropped rather than carried inert.
  const can = o.rule && supports(o.rule)
  if (o.warmup && can?.warmup) out.warmup = o.warmup
  if (o.intensifier && can?.[o.intensifier.type]) out.intensifier = o.intensifier
  const rest = cleanRestSec(o.restSec)
  if (rest) out.restSec = rest
  return out
}

/** A positive whole number of seconds or nothing — a hand-edited plan file can't hand the rest
 *  timer a string or a negative. */
function cleanRestSec(v) {
  const n = Math.round(Number(v)) || 0
  return n > 0 ? n : 0
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
  if (c.desc) o.desc = c.desc
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
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  const destination = planUnit(destinationUnit)
  // PLAN_FMT 1 and 2 (per-mode fields, bindings) are refused outright rather than imported as
  // an empty plan: their routines carry no rule, so silently accepting them would drop every
  // exercise without saying why.
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.opengym_plan !== PLAN_FMT || !Array.isArray(data.routines) || !destination) {
    throw new Error(t('this isn’t an openGym plan file'))
  }
  const sourceUnit = declaredPlanUnit(data)
  const customEx = (Array.isArray(data.customEx) ? data.customEx : []).filter(c => c && c.id)
  const known = new Set(customEx.map(c => c.id))
  let dropped = 0
  const routines = data.routines.filter(r => r && Array.isArray(r.ex)).map(r => ({
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
      ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
      // Fresh occurrence and rule identity — a merged routine never shares live engine identity
      // with the file it came from — but the prescription itself survives. Re-validated here too:
      // mergePlan is a public entry point of its own, not only reached through parsePlan.
      ex: (r.ex || []).map(e => {
        assertValidRule(e.rule)
        const occurrenceId = uid()
        const exerciseId = exIdMap[e.exerciseId] || e.exerciseId
        return {
          ...e,
          exerciseId,
          occurrenceId,
          rule: { ...e.rule, id: occurrenceId, revision: 1, routineId: nid, exerciseId }
        }
      })
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
  return { routines: source.routines.length }
}

/* ------------------------------- printable PDF ------------------------------- */

const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// One exercise's scheme, e.g. "3 × 10 · 60 kg", "3 × 0:45" or "2 × 20 min @ 8 km/h".
function scheme(e, unit) {
  const sets = e.sets || 1
  const mode = modeOf(e)
  if (mode === 'cardio') {
    const body = `${e.min || 20} min @ ${fmtNum(e.speed || 8)} km/h`
    return sets > 1 ? `${sets} × ${body}` : body
  }
  let s = mode === 'time' ? `${sets} × ${fmtSec(e.sec || 45)}` : `${sets} × ${e.reps ?? 10}`
  if (e.weight) s += ` · ${isBw(e) ? '+' : ''}${fmtNum(e.weight)} ${unit}`
  // A printed plan is read at the rack, so the split earns its four characters.
  if (mode !== 'time' && isPerSide(e)) s += ` · ${t('{0}/side', fmtNum(sideReps(e.reps ?? 10)))}`
  return s
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

function routineHTML(r, unit) {
  const rows = units(r.ex).map(u => {
    const items = u.map(e => {
      const ex = EXIDX[e.id]
      const name = ex ? exerciseNameFor(ex) : t('Unknown exercise')
      const part = ex && ex.bp && ex.bp !== 'cardio' ? `<span class="part">${esc(ex.bp)}</span>` : ''
      const note = e.note ? `<div class="ex-note">${esc(e.note)}</div>` : ''
      return `<div class="ex"><div class="ex-row"><div class="ex-n">${esc(name)}${part}</div><div class="ex-s">${esc(scheme(e, unit))}</div></div>${note}</div>`
    }).join('')
    return u.length > 1
      ? `<div class="ss"><div class="ss-tag">${esc(t('Superset'))}</div><div class="ss-items">${items}</div></div>`
      : items
  }).join('')
  const count = exCount(r.ex.length)
  return `<section class="routine">
    <div class="r-head"><h2>${esc(r.name)}</h2><span class="r-count">${esc(count)}</span></div>
    <div class="ex-list">${rows || `<div class="ex empty">${esc(t('No exercises yet.'))}</div>`}</div>
  </section>`
}

function weekHTML(S) {
  // The printout is read by whoever exported it, so the week runs in their order.
  const rows = weekOrder(weekStartOf(S)).map(d => {
    const names = [].concat(S.week?.[d] || [])
      .map(id => S.routines.find(x => x.id === id)?.name)
      .filter(Boolean)
    const val = names.length ? esc(deriveSessionName(names)) : `<span class="rest">${esc(t('Rest'))}</span>`
    return `<div class="w-row"><div class="w-day">${esc(t(DAYN[d]))}</div><div class="w-r">${val}</div></div>`
  }).join('')
  return `<div class="week">${rows}</div>`
}

/** Full self-contained HTML for the print/PDF view. */
export function planPrintHTML(S, owner) {
  const unit = S.unit || 'kg'
  const routines = (S.routines || []).filter(r => r.ex && r.ex.length)
  const body = routines.length
    ? routines.map(r => routineHTML({ ...r, ex: r.ex.map(e => ({ ...coachExOf(e, EXIDX[e.exerciseId ?? e.id]), ...(e.note ? { note: e.note } : {}) })) }, unit)).join('')
    : `<p class="none">${esc(t('No routines yet.'))}</p>`
  const sub = [owner, todayISO()].filter(Boolean).map(esc).join(' · ')
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(t('Weekly Training Plan'))}</title>
<style>
  @page { margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: #16181d; background: #fff;
    font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .doc { max-width: 720px; margin: 0 auto; }
  header { border-bottom: 2px solid #16181d; padding-bottom: 12px; margin-bottom: 20px; }
  header .kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #6a7a3a; font-weight: 700; }
  header h1 { font-size: 27px; letter-spacing: -.02em; margin: 3px 0 0; }
  header .sub { color: #6b7180; font-size: 13px; margin-top: 4px; }

  h3.block { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #8a90a0; margin: 0 0 8px; font-weight: 700; }

  .week { border: 1px solid #e4e6ec; border-radius: 10px; overflow: hidden; margin-bottom: 26px; break-inside: avoid; page-break-inside: avoid; }
  .w-row { display: flex; align-items: baseline; padding: 8px 14px; border-top: 1px solid #eef0f4; }
  .w-row:first-child { border-top: 0; }
  .w-day { width: 116px; font-weight: 600; color: #16181d; flex: none; }
  .w-r { text-transform: capitalize; }
  .rest, .w-r .rest { color: #a2a8b6; text-transform: none; }

  .routine { break-inside: avoid; page-break-inside: avoid; margin-bottom: 20px; padding: 14px 16px; border: 1px solid #e4e6ec; border-radius: 12px; }
  .r-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; border-bottom: 1px solid #eef0f4; padding-bottom: 8px; margin-bottom: 8px; break-after: avoid; page-break-after: avoid; }
  .r-head h2 { font-size: 18px; letter-spacing: -.01em; margin: 0; text-transform: capitalize; }
  .r-count { font-size: 12px; color: #8a90a0; white-space: nowrap; }

  .ex-list { display: flex; flex-direction: column; }
  .ex { display: flex; flex-direction: column; padding: 6px 0; break-inside: avoid; page-break-inside: avoid; }
  .ex + .ex, .ss + .ex, .ex + .ss { border-top: 1px solid #f2f3f6; }
  .ex-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
  .ex-n { text-transform: capitalize; font-weight: 500; }
  .ex-n .part { text-transform: capitalize; color: #9aa0ae; font-weight: 400; font-size: 12px; margin-left: 8px; }
  .ex-s { color: #3d424e; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ex-note { color: #6a7080; font-size: 12px; margin-top: 2px; }
  .ex.empty, .none { color: #a2a8b6; }

  .ss { break-inside: avoid; page-break-inside: avoid; border-left: 3px solid #cfe08a; padding-left: 12px; margin: 4px 0; }
  .ss-tag { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #6a7a3a; font-weight: 700; padding-top: 4px; }
  .ss .ex:first-of-type { padding-top: 2px; }

  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #eef0f4; color: #a2a8b6; font-size: 11px; text-align: center; }
</style></head>
<body><div class="doc">
  <header>
    <div class="kicker">openGym</div>
    <h1>${esc(t('Weekly Training Plan'))}</h1>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
  </header>
  <h3 class="block">${esc(t('Week schedule'))}</h3>
  ${weekHTML(S)}
  <h3 class="block">${esc(t('Routines'))}</h3>
  ${body}
  <footer>${esc(t('Made with openGym'))} · opengym.duarte-santos.ch</footer>
</div></body></html>`
}

/**
 * Render the plan and open the browser's print dialog (→ Save as PDF).
 * Uses a hidden iframe so we never navigate away or trip a popup blocker.
 */
export function printPlan(S, owner) {
  const ifr = document.createElement('iframe')
  ifr.setAttribute('aria-hidden', 'true')
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'
  document.body.appendChild(ifr)
  const cleanup = () => { try { ifr.remove() } catch (e) { /* */ } }
  const run = () => {
    const w = ifr.contentWindow
    if (!w) { cleanup(); return }
    w.onafterprint = cleanup
    setTimeout(cleanup, 60000)   // safety net if afterprint never fires
    w.focus()
    try { w.print() } catch (e) { cleanup() }
  }
  const doc = ifr.contentWindow.document
  doc.open(); doc.write(planPrintHTML(S, owner)); doc.close()
  // Give the iframe a tick to lay out before printing.
  if (doc.readyState === 'complete') setTimeout(run, 120)
  else ifr.onload = () => setTimeout(run, 120)
}
