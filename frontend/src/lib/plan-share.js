// Share a weekly plan.
//
// Two jobs:
//  1. A small, self-contained file a friend can import into THEIR openGym — just the
//     routines + the week schedule + the custom exercises those routines use. It never
//     carries workouts, weigh-ins or settings, and importing MERGES (adds routines with
//     fresh ids) so nothing the friend already has is touched.
//  2. A clean, printable page (Save as PDF) where a single exercise never splits across
//     a page break — each exercise, and each routine that fits, stays in one place.

import { EXIDX, isBodyweightEq } from './exercises.js'
import { modeOf, fmtSec, isBw, isPerSide, sideReps, MAX_PLANNED_WARMUPS } from './history.js'
import { deriveSessionName } from './session-merge.js'
import { uid, todayISO, DAYN, weekOrder, weekStartOf, fmtNum, exCount } from './format.js'
import { t, exerciseNameFor } from './i18n-core.js'

const PLAN_FMT = 1
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0]   // every getDay() index; only the reader's own
                                          // screen puts them in an order (see weekOrder)

// Keep only the meaningful config fields, so the file stays small and readable.
function cleanEx(e) {
  const o = { id: e.id, sets: e.sets }
  const mode = modeOf(e)
  if (mode === 'cardio') {
    if (e.min != null) o.min = e.min
    if (e.speed != null) o.speed = e.speed
  } else if (mode === 'time') {
    // Written out even though 'reps' is the fallback for a non-cardio id: a plan file that
    // dropped the mode would turn a 45-second plank into a 45-rep one at the other end.
    o.mode = 'time'
    if (e.sec != null) o.sec = e.sec
    if (e.weight) o.weight = e.weight
  } else {
    if (e.reps != null) o.reps = e.reps
    if (e.weight) o.weight = e.weight
  }
  // How the exercise is logged travels too (issues #31/#32) — the bodyweight flag only when
  // it disagrees with the catalogue, since agreeing is what the other end already assumes.
  if (e.bodyweight != null && e.bodyweight !== isBodyweightEq(e.id)) o.bodyweight = e.bodyweight
  // Only on reps work — `side` counts reps, and a timed hold has none to split.
  if (e.side && mode !== 'time' && mode !== 'cardio') o.side = true
  // Progression settings travel with the plan — a shared Greyskull routine that arrives
  // without its rule is just a list of weights.
  if (e.prog) o.prog = e.prog
  if (e.inc > 0) o.inc = e.inc
  // Epley deload factor is a per-occurrence progression setting. Omit the default so older
  // exports remain compact and importing them preserves the default 90% behaviour.
  if (e.deloadFactor != null && Number(e.deloadFactor) !== 0.9) o.deloadFactor = e.deloadFactor
  if (e.repsMin != null) o.repsMin = e.repsMin
  if (e.repsMax != null) o.repsMax = e.repsMax
  // The exercise's own rest (issue #10) is part of how it is prescribed, so it travels too —
  // only when set, so a plan that never asked for one leaves the recipient's own default
  // timer in charge. parsePlan and mergePlan carry it through by spread.
  if (e.restSec > 0) o.restSec = e.restSec
  if (e.sg) o.sg = e.sg
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

/** Build the shareable bundle: every routine, the week schedule, referenced customs. */
export function buildPlanBundle(S, name) {
  const routines = (S.routines || []).map(r => ({
    id: r.id, name: r.name, emoji: r.emoji,
    ...(r.prog ? { prog: r.prog } : {}),
    ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
    ex: (r.ex || []).map(cleanEx)
  }))
  const usedIds = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const customEx = (S.customEx || [])
    .filter(c => usedIds.has(c.id))
    .map(c => ({ id: c.id, n: c.n, bp: c.bp, ...(c.desc ? { desc: c.desc } : {}) }))
  // A weekday can hold several routines (merge order preserved). `[].concat` normalises a
  // legacy scalar id to a one-element list, so a bundle written before this change and one
  // written after are read the same way at the other end.
  const week = {}
  WEEK_DAYS.forEach(d => { if (S.week?.[d]?.length) week[d] = [].concat(S.week[d]) })
  return { opengym_plan: PLAN_FMT, exported: todayISO(), name: name || '', week, routines, customEx }
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
export function parsePlan(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!data || !data.opengym_plan || !Array.isArray(data.routines)) {
    throw new Error(t('this isn’t an openGym plan file'))
  }
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
      // planner get the same clamps on the way in that they get on the way out.
      const warm = cleanWarmupSets(e.warmupSets)
      const intens = cleanIntensifier(e.intensifier)
      const rest = cleanRestSec(e.restSec)
      const { warmupSets, intensifier, restSec, ...passthrough } = e
      return { ...passthrough, ...(warm ? { warmupSets: warm } : {}), ...(intens ? { intensifier: intens } : {}), ...(rest ? { restSec: rest } : {}) }
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
    scheduledDays: WEEK_DAYS.filter(d => data.week?.[d]?.length).length
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
  s.customEx = s.customEx || []
  const exIdMap = {}
  ;(bundle.customEx || []).forEach(c => {
    const same = s.customEx.find(x => (x.n || '').toLowerCase() === (c.n || '').toLowerCase() && x.bp === c.bp)
    if (same) { exIdMap[c.id] = same.id; return }
    const nid = uid()
    exIdMap[c.id] = nid
    s.customEx.push({ id: nid, n: c.n, bp: c.bp, ...(c.desc ? { desc: c.desc } : {}) })
  })
  const ridMap = {}
  bundle.routines.forEach(r => {
    const nid = uid()
    ridMap[r.id] = nid
    s.routines.push({
      id: nid,
      name: r.name || t('Shared routine'),
      emoji: r.emoji,
      ...(r.prog ? { prog: r.prog } : {}),
      ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
      ex: (r.ex || []).map(e => ({ ...e, id: exIdMap[e.id] || e.id }))
    })
  })
  if (schedule) {
    WEEK_DAYS.forEach(d => { delete s.week[d] })
    Object.entries(bundle.week || {}).forEach(([d, val]) => {
      // `[].concat` tolerates a pre-upgrade scalar bundle value. An element whose routine id
      // didn't survive parsing is dropped, not written as undefined; a day that ends up empty
      // is left absent rather than stored as `[]`.
      const ids = [].concat(val).map(oldId => ridMap[oldId]).filter(Boolean)
      if (ids.length) s.week[d] = ids
    })
  }
  return { routines: bundle.routines.length }
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
    ? routines.map(r => routineHTML(r, unit)).join('')
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
