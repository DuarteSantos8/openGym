// Programmes (#159, docs/superpowers/specs/2026-11-04-programme-coach-effort-v2-design.md): your
// routines run as a block of 1 to 16 weeks through the training engine.
//
//   S.programmes[id]       a definition (engine contract 1): schedule, duration, one track per bound
//                          occurrence with a stage per week (api/engine/programme.js)
//   S.programme            { runId, saved } | null: the current run, and the plan to put back at its end
//   S.programmeRuns[id]    a run: the definition frozen at its start, each track's acknowledged
//                          choices, adopted 1RM and entry values
//   S.programmeEvents[id]  what happened to a run since (pause, skip, close, reference, amend, …), append-only
//   S.refReviews[key]      a 1RM proposal reviewed for one context: keep, or later
//   S.refUpdates, S.programmeEnd   the Config defaults ('ask' | 'keep', 'stop' | 'extend')
//
// WHERE A RUN STANDS IS REPLAYED, NEVER STORED: api/engine/programme-run.js deriveRun folds the run,
// its events and the saved workouts into each track's week, attempt and decisions (programmeView),
// so two devices that merge their events per key read the same run. A session's prescription is
// generated from its stage (session-start.js: slotFor → slotInputs), never patched afterwards.
//
// THE SCHEDULE IS APPLIED, NOT RESOLVED. Starting a run writes its appointments into S.week (or
// S.rotation), keeping the plan you had in `saved`; ending it puts that plan back. Home's Today,
// Plan, the reminders and the MCP keep reading S.week and S.queue as always.
import { fmtDate, fmtNum, localTZ, todayISO, uid, SUNDAY } from './format.js'
import { queueOf } from './queue.js'
import { REST, saveRotation, startPass, stopPass, chooseFixedWeek } from './rotation.js'
import { best1RM } from './onerm.js'
import { effortOf } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { t } from './i18n-core.js'
import { OPERATOR_METRICS, currentOneRm, deriveRun, editPlan, needsOneRm, referenceProposals, slotFor, validateProgramme, weeklyTemplate } from './prescription/index.js'
import { dateIn } from '../../../api/engine/programme-run.js'
import { convertLegacyProgramme, loadedWork, seedOf } from '../../../api/migration/programme-upgrade.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'
import { validateCanonicalProfile } from '../../../api/migration/profile-validation.js'

export const MAX_WEEKS = 16
export const PCT_MIN = 30
export const PCT_MAX = 110
export const RPE_MIN = 6
export const RPE_MAX = 10
export const REPEAT_BUMP = 2.5
// What a plan file may bring (plan-share.js parsePlan): far past any real programme, and a bound on
// what a stranger's file can put into the synced profile.
export const IMPORT_MAX_PROGRAMMES = 32
export const IMPORT_MAX_SEQUENCE = 64
export const IMPORT_MAX_TARGETS = 200

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const map = v => (isMap(v) ? v : {})
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const half = v => Math.round(v * 2) / 2
const isPolicy = p => isMap(p) && ['advance', 'repeat'].includes(p.onFailure) && ['advance', 'repeat'].includes(p.onSkipped)

/* ------------------------- a legacy week (plan files of format 1) ------------------------- */
// Week = { deload?: true, rpe?: number, t?: { [exId | 'rid:exId']: { pct?, rpe? } } }: what a
// programme was before engine contract 1, still read from a format-1 plan file (importedProgramme).

/** A %1RM kept to the half percent and inside 30 to 110, else null. */
export const cleanPct = v => {
  const n = num(v)
  return n >= PCT_MIN && n <= PCT_MAX ? half(n) : null
}
/** An RPE kept to the half point and inside 6 to 10, else null. */
export const cleanRpe = v => {
  const n = num(v)
  return n >= RPE_MIN && n <= RPE_MAX ? half(n) : null
}

function cleanTarget(x) {
  if (!isMap(x)) return null
  const pct = cleanPct(x.pct), rpe = cleanRpe(x.rpe)
  if (pct == null && rpe == null) return null
  return { ...(pct != null ? { pct } : {}), ...(rpe != null ? { rpe } : {}) }
}

/** One week as stored: only what it says, so an empty week is `{}`. */
export function cleanWeek(w) {
  const out = {}
  if (!isMap(w)) return out
  if (w.deload === true) out.deload = true
  const rpe = cleanRpe(w.rpe)
  if (rpe != null) out.rpe = rpe
  if (isMap(w.t)) {
    const t = {}
    for (const [k, v] of Object.entries(w.t)) {
      const c = cleanTarget(v)
      // "__proto__" from a parsed file is an own key there, but here it would set t's prototype.
      if (c && k && k !== '__proto__') t[k] = c
    }
    if (Object.keys(t).length) out.t = t
  }
  return out
}

/* ------------------------------------ definitions ------------------------------------ */

const isDef = p => isMap(p) && typeof p.id === 'string' && !!p.id && isMap(p.schedule) && Array.isArray(p.tracks)
const apptRids = def => (def.schedule.mode === 'rotation' ? def.schedule.sequence : (def.schedule.appts || []).map(a => a.rid))
const occOf = (S, rid, oid) => (S?.routines || []).find(r => r.id === rid)?.ex?.find(o => o.occurrenceId === oid) || null
const ws = S => (S?.weekStart === SUNDAY ? 0 : 1)

/** Every programme definition, newest first; anything else under the key is left out. */
export const programmesOf = S => Object.values(map(S?.programmes)).filter(isDef).sort((a, b) => (b.at || 0) - (a.at || 0))

export function programmeById(S, id) {
  const all = map(S?.programmes)
  return Object.hasOwn(all, id) && isDef(all[id]) ? all[id] : null
}

/** The routine ids a programme schedules that still exist, each once, in schedule order. */
export function programmeRoutineIds(S, p) {
  const have = new Set((S?.routines || []).map(r => r.id))
  return [...new Set(isDef(p) ? apptRids(p) : [])].filter(id => id !== REST && have.has(id))
}

const cleanDays = days => {
  const out = {}
  if (!isMap(days)) return out
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const ids = [].concat(days[d] ?? []).filter(x => typeof x === 'string' && x)
    if (ids.length) out[d] = ids
  }
  return out
}

/** The schedule you train by right now, as a legacy programme wrote it: `{ days }` or `{ sequence }`. */
export function currentSchedule(S) {
  const q = queueOf(S)
  const seq = Array.isArray(S?.rotation?.sequence) ? S.rotation.sequence : []
  if ((q || S?.scheduleMode === 'rotation') && seq.some(x => x !== REST)) return { sequence: seq.slice() }
  return { days: cleanDays(S?.week) }
}

// A legacy programme over this profile's routines as a definition: the one conversion the upgrade,
// the starters and a plan file of format 1 share.
const convert = (S, legacy) => convertLegacyProgramme(legacy, { routines: S?.routines || [], catalogue: LIB_BY_ID, customEx: S?.customEx, progression: S?.progression, weekStart: ws(S) })

/** A new programme of `n` weeks over the schedule you train by now; not saved yet. */
export function newProgramme(S, name, n = 4, now = Date.now()) {
  const k = Math.max(1, Math.min(MAX_WEEKS, Math.round(n) || 1))
  return convert(S, { id: uid(), name, at: now, weeks: Array.from({ length: k }, () => ({})), ...currentSchedule(S) })
}

// A definition that no longer compiles against today's routines is kept readable, marked for
// repair: profile validation refuses any other (api/migration/profile-validation.js).
function marked(s, def) {
  if (def.needs?.includes('repair') || validateProgramme(def, { routines: s.routines || [] }).ok) return def
  return { ...def, needs: [...new Set([...(def.needs || []), 'repair'])] }
}

/**
 * Programmes a routine edit broke (an occurrence they bind removed or swapped) marked for repair, in
 * the same change. A run is left alone: its replay blocks the track while that week is open (rule B).
 */
export function markBrokenProgrammes(s) {
  if (!isMap(s.programmes)) return
  let next = null
  for (const [id, p] of Object.entries(s.programmes)) {
    if (!isDef(p)) continue
    const m = marked(s, p)
    if (m !== p) (next ||= { ...s.programmes })[id] = m
  }
  if (next) s.programmes = next
}

// A running (or paused) programme counts its weeks or rounds as it started: its run reads that from
// the definition frozen at its start (programme-run.js), so a change of it waits for the run to end.
function countingLocked(S, def) {
  if (currentRun(S)?.programmeId !== def.id) return false
  const v = programmeView(S)
  return ['running', 'paused'].includes(v?.status) && def.schedule.mode !== v.run.def.schedule.mode
}

/** Writes `def` into the draft (store.update) one revision up; for the running programme an `amend`
 *  event takes it to the run, from its next unstarted week (spec 7.1). Whatever the route, it refuses
 *  (throws 'running programme', so the draft is dropped) to change how the running one counts. */
export function saveProgramme(s, def, now = Date.now()) {
  if (!isDef(def)) return null
  if (countingLocked(s, def)) throw new Error('running programme')
  const prev = map(s.programmes)[def.id]
  const next = marked(s, { ...def, rev: Math.max(Number(prev?.rev) || 0, Number(def.rev) || 0) + 1 })
  s.programmes = { ...map(s.programmes), [next.id]: next }
  const run = currentRun(s)
  if (run?.programmeId === next.id) addEvent(s, run, 'amend', { def: bumped(next, run.bump) }, now)
  return next
}

/** Removes a programme, ending it first when it is the one running. */
export function deleteProgramme(s, id, today = todayISO(), now = Date.now()) {
  if (currentRun(s)?.programmeId === id) endProgramme(s, today, now)
  if (!isMap(s.programmes) || !Object.hasOwn(s.programmes, id)) return
  const next = { ...s.programmes }
  delete next[id]
  s.programmes = next
}

// A repeated round's cumulative bump, on percentage stages only (spec 15.3), capped at 110.
function bumped(def, bump) {
  const b = Number(bump) || 0
  if (!b) return clone(def)
  const up = x => (x.own === 'set' && x.phase?.parameters?.load?.mode === 'percent_1rm'
    ? { ...x, phase: { ...x.phase, parameters: { ...x.phase.parameters, load: { ...x.phase.parameters.load, percent: Math.min(PCT_MAX, x.phase.parameters.load.percent + b) } } } } : x)
  return clone({ ...def, tracks: def.tracks.map(tr => ({ ...tr, stages: tr.stages.map(st => ({ ...st, targets: Object.fromEntries(Object.entries(map(st.targets)).map(([oid, x]) => [oid, up(x)])) })) })) })
}

/* ------------------------------------ the running one ------------------------------------ */

function currentRun(S) {
  const id = S?.programme?.runId
  const runs = map(S?.programmeRuns)
  return typeof id === 'string' && Object.hasOwn(runs, id) && isMap(runs[id]) ? runs[id] : null
}

const event = (run, type, fields, now) => ({ id: `${run.id}:${type}:${uid()}`, runId: run.id, type, at: new Date(now).toISOString(), ...fields })
function addEvent(s, run, type, fields, now = Date.now()) {
  const e = event(run, type, fields, now)
  s.programmeEvents = { ...map(s.programmeEvents), [e.id]: e }
  return e
}

const views = new WeakMap()
/**
 * The current run as its records say on `today` (a local date in the run's own timezone, by
 * default now): deriveRun's RunView plus `run`, with the workout in progress `A` pending on its
 * slots. Null with no current run (`S.programme.runId` null: only a plan to put back). Memoized on
 * `S`, and on every record it reads, so a draft that appends an event reads it at once.
 */
export function programmeView(S, today = null, A = null) {
  const run = currentRun(S)
  if (!run) return null
  const day = today || dateIn(Date.now(), run.tz || 'UTC')
  const key = [day, A, run, S.programmeEvents, S.workouts, S.prescriptions, S.routines]
  const hit = views.get(S)
  if (hit && hit.key.every((v, i) => v === key[i])) return hit.view
  const view = { ...deriveRun({ run, events: map(S.programmeEvents), workouts: S.workouts || [], prescriptions: map(S.prescriptions), active: A, today: day, routines: S.routines || [] }), run }
  views.set(S, { key, view })
  return view
}

/** What applying a schedule must keep of the plan it replaces, to put back at the end. */
const snapshot = s => ({
  week: clone(s.week || {}),
  scheduleMode: s.scheduleMode ?? null,
  rotation: clone(s.rotation ?? null),
  // A pass of this app's own loop was running: ending puts a fresh one back.
  pass: !!queueOf(s) && !!s.rotation && queueOf(s).rotationId === s.rotation.id,
})

// The schedule as the plan screens read it: weekdays from the appointments' preferred days, or a
// loop (a rotation, a loop bound to weeks, or weekly sessions none of which has a day).
export function legacyScheduleOf(def) {
  if (def.schedule.mode === 'rotation') return { sequence: def.schedule.sequence.slice() }
  if (isMap(def.src) && Array.isArray(def.src.sequence)) return { sequence: def.src.sequence.slice() }
  if (def.schedule.appts?.length && def.schedule.appts.every(a => a.day == null)) return { sequence: def.schedule.appts.map(a => a.rid) }
  const days = {}
  for (const a of def.schedule.appts || []) if (a.day != null) (days[a.day] ||= []).push(a.rid)
  return { days }
}

function applySchedule(s, def, today, now) {
  const have = new Set((s.routines || []).map(r => r.id))
  const p = legacyScheduleOf(def)
  if (p.sequence) {
    const seq = p.sequence.filter(id => id === REST || have.has(id))
    if (seq.some(id => id !== REST)) {
      // A loop of its own, with an id of its own: the one you had is in `saved`, untouched.
      stopPass(s, today)
      s.rotation = null
      saveRotation(s, seq, def.name || '', today, now)
      s.scheduleMode = 'rotation'
      return
    }
  }
  chooseFixedWeek(s, today)
  const days = {}
  for (const [d, ids] of Object.entries(p.days || {})) {
    const kept = ids.filter(id => have.has(id))
    if (kept.length) days[d] = kept
  }
  s.week = days
}

// The partial first week owes the appointments from today on: none before the start is invented (spec 7.2).
function owedFrom(def, today, weekStart) {
  if (def.schedule.mode !== 'weeks') return undefined
  const from = (new Date(today + 'T12:00:00').getDay() - weekStart + 7) % 7
  return def.schedule.appts.map((a, i) => i).filter(i => def.schedule.appts[i].day == null || (def.schedule.appts[i].day - weekStart + 7) % 7 >= from)
}
/** The appointments a start on `today` owes in its partial first week (weeks only; undefined for a rotation). */
export const firstWeekOf = (S, def, today) => owedFrom(def, today, ws(S))

function makeRun(s, def, { policies, acks = {}, end, firstWeek, today, now, cycle = 1, bump = 0, tms = {} }) {
  const runDef = bumped(def, bump)
  const tracks = {}
  for (const tr of runDef.tracks) {
    const ref = currentOneRm(s.oneRepMaxes, tr.exerciseId)
    // The ordinary track's values the run's adaptive weeks carry on from (spec 6), as an upgraded run's.
    const seed = Object.fromEntries(tr.slots.map(sl => { const occ = occOf(s, sl.rid, sl.oid); return [sl.oid, occ ? seedOf(occ.rule, s.progression?.[sl.oid]) : null] }).filter(([, v]) => v))
    tracks[tr.id] = {
      policy: { ...policies[tr.id] }, ack: acks[tr.id] ?? 'user', refs: refPreference(s, { def: runDef, track: tr }).pref,
      ...(ref ? { ref: clone(ref) } : {}), ...(tms[tr.id] ? { tm: clone(tms[tr.id]) } : {}), ...(Object.keys(seed).length ? { seed } : {})
    }
  }
  const weekStart = ws(s)
  const fw = firstWeek ?? owedFrom(runDef, today, weekStart)
  return {
    id: `run:${def.id}:${uid()}`, programmeId: def.id, def: runDef, startedOn: today, weekStart, tz: localTZ(),
    at: new Date(now).toISOString(), end, cycle, bump: Number(bump) || 0, ...(fw ? { firstWeek: fw } : {}), tracks
  }
}

const operational = def => def.tracks.some(tr => tr.stages.some(st => Object.values(map(st.targets)).some(x => x?.effort?.mode === 'operational')))

/**
 * Starts programme `id` on `today` (inside store.update) with the choices the person acknowledged:
 * both advance/repeat choices for every track (`policies`) and the end policy (spec 8.1, 8.5).
 * Each track adopts the current 1RM as its reference and freezes its reference preference; a lift
 * with no 1RM yet does not block the start (its first session asks for one). A run already going is
 * ended first, so `saved` always holds the plan from before any programme.
 */
// What a run of `def` still needs before it may start (spec 8.1, 8.5, 11, 7.1): a recorded choice
// for every track and the end, effort logging for operational effort, a binding, a repair.
export function missingFor(s, def, policies, end) {
  const missing = []
  if (def.tracks.some(tr => !isPolicy(policies?.[tr.id]))) missing.push('policy')
  if (!['stop', 'extend'].includes(end)) missing.push('end')
  if (operational(def) && effortOf(s) === 'none') missing.push('effort-off')
  if (def.needs?.includes('binding')) missing.push('binding')
  if (def.needs?.includes('repair') || !validateProgramme(def, { routines: s.routines || [] }).ok) missing.push('repair')
  return missing
}

export function startProgramme(s, id, { policies = {}, end, firstWeek, today = todayISO(), now = Date.now() } = {}) {
  const def = programmeById(s, id)
  if (!def) return { ok: false, missing: ['repair'] }
  const missing = missingFor(s, def, policies, end)
  if (missing.length) return { ok: false, missing }
  if (s.programme) endProgramme(s, today, now)
  const saved = snapshot(s)
  applySchedule(s, def, today, now)
  const run = makeRun(s, def, { policies, end, firstWeek, today, now })
  s.programmeRuns = { ...map(s.programmeRuns), [run.id]: run }
  s.programme = { runId: run.id, saved }
  return { ok: true }
}

export function pauseProgramme(s, now = Date.now()) {
  const v = programmeView(s)
  if (v?.status === 'running') addEvent(s, v.run, 'pause', {}, now)
}

/** Resumes where it was paused: the paused weeks are not counted (programme-run.js). */
export function resumeProgramme(s, now = Date.now()) {
  const v = programmeView(s)
  if (v?.status === 'paused') addEvent(s, v.run, 'resume', {}, now)
}

// Ending with `keepReached`: each track's reached load becomes its occurrence's own start, an
// explicit plan edit (editPlan). Without it the routines stay as they were: a run never wrote them.
function keepReachedLoads(s, view) {
  const reached = {}
  for (const [id, tv] of Object.entries(view.tracks)) {
    for (const sl of tv.def?.tracks.find(x => x.id === id)?.slots || []) {
      const p = tv.values?.[sl.oid]?.lastPrescription
      const load = p && (p.prefill?.load ?? p.rows?.find(r => r.load)?.load)
      if (load?.value > 0) reached[`${sl.rid}|${sl.oid}`] = load
    }
  }
  s.routines = (s.routines || []).map(r => {
    if (!(r.ex || []).some(o => reached[`${r.id}|${o.occurrenceId}`])) return r
    return { ...r, ex: r.ex.map(o => {
      const load = reached[`${r.id}|${o.occurrenceId}`]
      return load ? { ...o, rule: editPlan(o.rule, { load: { mode: 'absolute', value: load.value, unit: load.unit } }) } : o
    }) }
  })
}

/** Ends the run (an `end` event) and puts back the plan you had before it (weekdays, loop, mode). */
export function endProgramme(s, today = todayISO(), now = Date.now(), { keepReached = false } = {}) {
  const sel = s.programme
  const run = currentRun(s)
  if (run) {
    if (keepReached) keepReachedLoads(s, programmeView(s))
    addEvent(s, run, 'end', {}, now)
  }
  s.programme = null
  const saved = isMap(sel) && isMap(sel.saved) ? sel.saved : null
  if (!saved) return
  const ownQ = queueOf(s)
  if (ownQ && (!s.rotation || ownQ.rotationId === s.rotation.id)) stopPass(s, today)
  s.week = isMap(saved.week) ? clone(saved.week) : {}
  s.rotation = clone(saved.rotation ?? null)
  s.scheduleMode = saved.scheduleMode ?? null
  if (saved.pass && s.rotation) startPass(s, today, now)
}

const lastOf = (s, run, type, match = () => true) => Object.values(map(s.programmeEvents))
  .filter(e => e?.runId === run.id && e.type === type && match(e)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1)

/**
 * Runs the programme again as a new run from week 1, with the choices recorded for this one (its
 * own, or a later `policy` / `end-policy` event), fresh references, and each training max as its
 * qualified cycles left it (spec 9). `bump` raises every %1RM stage by that many points on top of
 * the last round's; kg, reps and seconds stay. It passes the start's own checks: a track added
 * since, with no recorded choice, is `missing: ['policy']`, never given one.
 */
export function repeatProgramme(s, today = todayISO(), bump = 0, now = Date.now()) {
  const run = currentRun(s)
  const def = run && programmeById(s, run.programmeId)
  if (!def) return { ok: false, missing: ['repair'] }
  const view = programmeView(s)
  const policies = {}, acks = {}, tms = {}
  for (const tr of def.tracks) {
    const policy = lastOf(s, run, 'policy', e => e.trackId === tr.id)?.policy ?? run.tracks?.[tr.id]?.policy
    if (policy) policies[tr.id] = policy
    acks[tr.id] = run.tracks?.[tr.id]?.ack ?? 'user'
    if (view?.tracks[tr.id]?.tm) tms[tr.id] = view.tracks[tr.id].tm
  }
  const end = lastOf(s, run, 'end-policy')?.end ?? run.end
  const missing = missingFor(s, def, policies, end)
  if (missing.length) return { ok: false, missing }
  addEvent(s, run, 'end', {}, now)
  const next = makeRun(s, def, { policies, acks, end, today, now, cycle: (Number(run.cycle) || 1) + 1, bump: (Number(run.bump) || 0) + (Number(bump) || 0), tms })
  s.programmeRuns = { ...map(s.programmeRuns), [next.id]: next }
  // Its schedule is already in place: the plan from before the first round stays in `saved`.
  s.programme = { runId: next.id, saved: s.programme?.saved ?? null }
  return { ok: true }
}

/** The choices the current run goes by now: each exercise's latest advance/repeat answers and the end policy. */
export function runChoices(S) {
  const run = currentRun(S)
  if (!run) return null
  const def = programmeView(S)?.def ?? run.def
  const policies = Object.fromEntries(def.tracks.map(tr => [tr.id, lastOf(S, run, 'policy', e => e.trackId === tr.id)?.policy ?? run.tracks?.[tr.id]?.policy]).filter(([, p]) => isPolicy(p)))
  return { def, policies, end: lastOf(S, run, 'end-policy')?.end ?? run.end }
}

/** Closes the current week (or round) now: what it left unattempted is skipped (spec 7.2). */
export function closeWeek(s, now = Date.now()) {
  const v = programmeView(s)
  if (v) addEvent(s, v.run, 'close', { period: Math.max(1, v.period.index) }, now)
}
export function skipSlot(s, slot, now = Date.now()) {
  const run = currentRun(s)
  if (run) addEvent(s, run, 'skip', { slot }, now)
}
export function resolveSlot(s, slot, as, now = Date.now()) {
  const run = currentRun(s)
  if (run && ['failed', 'skipped'].includes(as)) addEvent(s, run, 'resolve', { slot, as }, now)
}
export function setRunPolicy(s, trackId, policy, now = Date.now()) {
  const run = currentRun(s)
  if (run && isPolicy(policy)) addEvent(s, run, 'policy', { trackId, policy: { onFailure: policy.onFailure, onSkipped: policy.onSkipped } }, now)
}
export function setRunEnd(s, end, now = Date.now()) {
  const run = currentRun(s)
  if (run && ['stop', 'extend'].includes(end)) addEvent(s, run, 'end-policy', { end }, now)
}

// Where a session of routine `rid` on `now` goes in the current run, one slotFor answer per
// occurrence; `A`, a workout in progress, holds its own appointments already.
function placed(S, rid, now, appt = null, A = null) {
  const view = programmeView(S, null, A)
  if (!view) return []
  const date = dateIn(now, view.run.tz || 'UTC')
  return ((S.routines || []).find(r => r.id === rid)?.ex || []).map(o => slotFor({ view, run: view.run, rid, oid: o.occurrenceId, date, appt }))
}

/**
 * The appointments of routine `rid` still open this week when it has two or more (spec 7.2), for
 * the person to say which one this session is: `[{ appt, day }]`, else none.
 */
export function sessionChoices(S, rid, now = Date.now(), A = null) {
  const view = programmeView(S, null, A)
  if (view?.def.schedule.mode !== 'weeks') return []
  const appts = view.def.schedule.appts
  const open = appts.map((a, i) => i).filter(i => appts[i].rid === rid
    && placed(S, rid, now, i, A).some(x => x.assignment?.role === 'work' && x.assignment.slot.startsWith(`p${x.assignment.period}:a${i}:`)))
  return open.length > 1 ? open.map(i => ({ appt: i, day: appts[i].day ?? null })) : []
}

/**
 * The earlier appointments a session of routine `rid` (at appointment `appt`) would pass in an
 * ordered week or a rotation (spec 7.3): `[{ id, period, appt, rid }]`, none when it passes nothing.
 */
export function bypassOf(S, rid, now = Date.now(), appt = null, A = null) {
  const view = programmeView(S, null, A)
  const ids = [...new Set(placed(S, rid, now, appt, A).flatMap(x => x.bypass))]
  return ids.map(id => { const [, p, a] = /^p(\d+):a(\d+)$/.exec(id); return { id, period: Number(p), appt: Number(a), rid: apptRids(view.def)[Number(a)] } })
}

/**
 * Continuing with routine `rid` past the earlier appointments of its week or round (spec 7.3): the
 * acknowledged bypass, recorded as `bypass { period, appts }` per period. Returns the bypassed
 * appointment ids (`p<n>:a<i>`), none when there is nothing to pass.
 */
export function bypassTo(s, rid, now = Date.now(), appt = null, A = null) {
  const view = programmeView(s, null, A)
  const passed = bypassOf(s, rid, now, appt, A)
  const periods = {}
  for (const b of passed) (periods[b.period] ||= []).push(b.appt)
  for (const [period, appts] of Object.entries(periods)) addEvent(s, view.run, 'bypass', { period: Number(period), appts }, now)
  return passed.map(b => b.id)
}

/** The training week (or round) a stage is, from 1, in the definition a track runs; 0 when it has none. */
export const stageNumber = (def, trackId, stageId) => (def?.tracks.find(t => t.id === trackId)?.stages.findIndex(s => s.id === stageId) ?? -1) + 1

// The work slots a workout in progress holds, and whether a work row of each was ticked.
const heldSlots = (A, view) => (A?.exposures || []).filter(x => view && x?.programme?.runId === view.run.id && x.programme.role === 'work')
const workedOn = (A, x) => ((A.entries || []).find(e => e.exposureId === x.exposureId)?.sets || []).some(row => row.done && !isWarmupRow(row))

/**
 * The events a discarded workout leaves on its programme slots (spec 8.2): `discard { slot, worked }`
 * per work slot, `worked` once a work row was ticked (failed as abandoned; skipped without).
 * Maintenance and extra work decide nothing, so they leave none.
 */
export const discardEvents = (A, view, now = Date.now()) => heldSlots(A, view).map(x => event(view.run, 'discard', { slot: x.programme.slot, worked: workedOn(A, x) }, now))

/** What discarding says it records (spec 8.2): per programme exercise, its training week (or round) and whether it counts as missed. */
export const discardNotes = (A, view) => heldSlots(A, view).map(x => ({
  exerciseId: x.exerciseId, worked: workedOn(A, x), rounds: view.def.schedule.mode === 'rotation',
  week: stageNumber(view.tracks[x.programme.trackId]?.def ?? view.def, x.programme.trackId, x.programme.stage),
}))

/**
 * A loop programme's binding, chosen at its start (spec 15.3): 'weeks' runs one round a week in its
 * order (skipping ahead skips the sessions passed); 'rounds' makes it a free rotation, one round per block.
 */
export function bindProgramme(def, how) {
  const { needs, ...rest } = def
  const left = (needs || []).filter(n => n !== 'binding')
  const out = { ...rest, ...(left.length ? { needs: left } : {}) }
  if (how !== 'rounds') return { ...out, schedule: { ...def.schedule, ordered: true } }
  const have = new Set(apptRids(def))
  const sequence = (Array.isArray(def.src?.sequence) ? def.src.sequence : apptRids(def)).filter(x => x === REST || have.has(x))
  return { ...out, schedule: { mode: 'rotation', sequence }, duration: { n: def.duration.n, unit: 'blocks' } }
}

/** The 1RM each lift of `def` that is planned as a %1RM keeps from its start (spec 10.1): `[{ exerciseId, ref }]`, `ref` null without one yet. */
export function startReferences(S, def) {
  const pct = tr => tr.stages.some(st => tr.slots.some(sl => {
    const x = map(st.targets)[sl.oid], occ = occOf(S, sl.rid, sl.oid)
    return x?.own === 'set' ? x.phase?.parameters?.load?.mode === 'percent_1rm' : !!occ?.rule && needsOneRm(occ.rule)
  }))
  return [...new Set(def.tracks.filter(pct).map(tr => tr.exerciseId))].map(exerciseId => ({ exerciseId, ref: currentOneRm(S?.oneRepMaxes, exerciseId) ?? null }))
}

/** The appointments of the current week or round a required session is still open in, in order: `[{ appt, rid, day }]`. */
export function openSessions(view) {
  const k = view.period.index
  const appts = view.def.schedule.mode === 'weeks' ? view.def.schedule.appts : view.def.schedule.sequence.map(rid => ({ rid }))
  const open = new Set(Object.values(view.tracks).filter(tv => tv.period === k && tv.state === 'active')
    .flatMap(tv => tv.slots.filter(sl => sl.required && sl.outcome === 'pending').map(sl => sl.appt)))
  return [...open].sort((a, b) => a - b).filter(i => appts[i]).map(i => ({ appt: i, rid: appts[i].rid, day: appts[i].day ?? null }))
}

// Any run replayed as of now: the current one through programmeView, an older one (a session in
// history) on its own, memoized per profile.
const pastViews = new WeakMap()
function runViewOf(S, runId) {
  if (S?.programme?.runId === runId) return programmeView(S)
  const run = map(S?.programmeRuns)[runId]
  if (!isMap(run)) return null
  if (!pastViews.has(S)) pastViews.set(S, new Map())
  const views = pastViews.get(S)
  if (!views.has(runId)) views.set(runId, { ...deriveRun({ run, events: map(S.programmeEvents), workouts: S.workouts || [], prescriptions: map(S.prescriptions), today: dateIn(Date.now(), run.tz || 'UTC'), routines: S.routines || [] }), run })
  return views.get(runId)
}

/**
 * What became of a logged programme session (spec 14, evaluation apart from advancement), from the
 * stamp it was saved with: `{ role }` for extra and maintenance work; for work, once its week (or
 * round) was decided, `{ action, week, missed, rounds }`, `week` the training week it tried. Null
 * while that is still open.
 */
export function sessionOutcome(S, stamp) {
  if (!stamp?.runId) return null
  if (stamp.role !== 'work') return { role: stamp.role }
  const tv = runViewOf(S, stamp.runId)?.tracks[stamp.trackId]
  const d = tv?.decisions.find(x => x.stage === stamp.stage && x.attempt === stamp.attempt && x.action !== 'hold')
  if (!d) return null
  return { role: 'work', action: d.action, week: stageNumber(tv.def, stamp.trackId, d.stage), missed: d.reasons.failed.length + d.reasons.skipped.length > 0, rounds: tv.def.schedule.mode === 'rotation' }
}

/* ------------------------------------ references (spec 10) ------------------------------------ */

/**
 * Whether a newer 1RM is offered for one context: Config → routine → occurrence for standalone work
 * (`{ routine, occ }`), Config → programme → track for a definition (`{ def, track }`), and the
 * preference the run froze at its start for a running track (`{ run, trackId }`). 'inherit' passes on.
 */
export function refPreference(S, c = {}) {
  if (c.run) return { pref: c.run.tracks?.[c.trackId]?.refs === 'keep' ? 'keep' : 'ask', from: 'run' }
  let pref = S?.refUpdates === 'keep' ? 'keep' : 'ask', from = 'config'
  const steps = c.def ? [[c.def.refs, 'programme'], [c.track?.refs, 'track']] : [[c.routine?.refs, 'routine'], [c.occ?.refs, 'occurrence']]
  for (const [v, f] of steps) if (v === 'ask' || v === 'keep') { pref = v; from = f }
  return { pref, from }
}

const percentsOf = phases => [...new Set(phases.flatMap(ph => (ph?.parameters?.load?.mode === 'percent_1rm' ? [ph.parameters.load.percent] : [])))]

/**
 * Every context with an adopted 1RM a newer one could replace (referenceProposals' input): each
 * standalone occurrence with its own reference, `occ:<oid>`, and each track of the current run,
 * `run:<run>:<track>`, with the percentages still ahead of it.
 */
export function referenceContexts(S, today = null) {
  const out = []
  for (const r of S?.routines || []) {
    for (const occ of r.ex || []) {
      const percents = occ.ref && occ.rule ? percentsOf(occ.rule.program.phases) : []
      if (percents.length) out.push({ key: `occ:${occ.occurrenceId}`, exerciseId: occ.exerciseId, ref: occ.ref, pref: refPreference(S, { routine: r, occ }).pref, percents, rounding: occ.rule.rounding, occurrenceId: occ.occurrenceId })
    }
  }
  const view = programmeView(S, today)
  if (view && ['running', 'paused'].includes(view.status)) {
    for (const [id, tv] of Object.entries(view.tracks)) {
      const tr = tv.def?.tracks.find(x => x.id === id)
      if (!tr || tv.state === 'removed') continue
      const at = Math.max(0, tr.stages.findIndex(st => st.id === tv.stage))
      const percents = percentsOf(tr.stages.slice(at).flatMap(st => Object.values(map(st.targets)).filter(x => x?.own === 'set').map(x => x.phase)))
      out.push({ key: `run:${view.run.id}:${id}`, exerciseId: tr.exerciseId, ref: tv.nextRef, pref: refPreference(S, { run: view.run, trackId: id }).pref, percents,
        rounding: occOf(S, tr.slots[0].rid, tr.slots[0].oid)?.rule.rounding, ...(tv.tm ? { tm: tv.tm } : {}), runId: view.run.id, trackId: id })
    }
  }
  return out
}

/**
 * Adopts `proposal.to` (referenceProposals) for the selected contexts, atomically (spec 10.2): when
 * any of them no longer adopts the reference the person reviewed, nothing is written and the answer
 * is `{ ok: false, stale: true }`. A standalone occurrence takes it at its next session, a running
 * track at its next unstarted week (a `reference` event naming the reference it replaces). A context
 * with a training max gets no 1RM proposal (referenceProposals): rebasing one needs its own
 * before/after preview (spec 10.3), which nothing offers yet.
 */
export function acceptReference(s, keys, proposal, now = Date.now()) {
  const ctx = Object.fromEntries(referenceContexts(s).map(c => [c.key, c]))
  const fresh = k => ctx[k] && ctx[k].exerciseId === proposal?.exerciseId && (ctx[k].ref?.id ?? null) === (proposal?.from?.id ?? null)
  if (!keys?.length || !proposal?.to || !keys.every(fresh)) return { ok: false, stale: true }
  const occs = new Set(keys.filter(k => ctx[k].occurrenceId).map(k => ctx[k].occurrenceId))
  if (occs.size) s.routines = (s.routines || []).map(r => (r.ex || []).some(o => occs.has(o.occurrenceId)) ? { ...r, ex: r.ex.map(o => (occs.has(o.occurrenceId) ? { ...o, ref: clone(proposal.to) } : o)) } : r)
  const run = currentRun(s)
  for (const k of keys) if (ctx[k].trackId && run?.id === ctx[k].runId) addEvent(s, run, 'reference', { trackId: ctx[k].trackId, ref: clone(proposal.to), from: proposal.from?.id ?? null }, now)
  return { ok: true }
}

/** "Keep current" hides this candidate for these contexts; "later" leaves it offered (spec 10.2). */
export function reviewReference(s, keys, proposal, decision, now = Date.now()) {
  if (!['keep', 'later'].includes(decision) || !proposal?.candidateId) return
  s.refReviews = { ...map(s.refReviews), ...Object.fromEntries((keys || []).map(k => [k, { candidateId: proposal.candidateId, decision, at: now }])) }
}

/**
 * The 1RM proposals to show (spec 10.2), one per exercise and candidate: `{ exerciseId, to,
 * candidateId, later, contexts }`, each context a referenceProposals answer (its own adopted `from`
 * and samples) plus where it lives (`routineId`, or `programmeId`) and when it would take the new
 * value (`next`: 'session', 'week' or 'round'). `later` once every context was put off for this candidate.
 * `kept`: the review by hand of the contexts set to keep the 1RM in use (spec 10.2), which offer
 * nothing by themselves; every newer 1RM is listed there, reviewed or not.
 */
export function referenceOffers(S, today = null, { kept = false } = {}) {
  const contexts = referenceContexts(S, today).filter(c => !kept || c.pref === 'keep').map(c => (kept ? { ...c, pref: 'ask' } : c))
  const byKey = Object.fromEntries(contexts.map(c => [c.key, c]))
  const reviews = kept ? {} : map(S?.refReviews)
  const out = new Map()
  for (const p of referenceProposals({ contexts, oneRepMaxes: S?.oneRepMaxes || {}, reviews })) {
    const id = `${p.exerciseId}|${p.candidateId}`
    if (!out.has(id)) out.set(id, { exerciseId: p.exerciseId, to: p.to, candidateId: p.candidateId, contexts: [] })
    const c = byKey[p.key], run = c.runId ? map(S.programmeRuns)[c.runId] : null
    out.get(id).contexts.push({ ...p, ...(run
      ? { programmeId: run.programmeId, next: run.def.schedule.mode === 'rotation' ? 'round' : 'week' }
      : { routineId: (S.routines || []).find(r => (r.ex || []).some(o => o.occurrenceId === c.occurrenceId))?.id ?? null, next: 'session' }) })
  }
  return [...out.values()].map(o => ({ ...o, later: o.contexts.every(c => reviews[c.key]?.decision === 'later' && reviews[c.key].candidateId === o.candidateId) }))
}

/** Takes an offer's new 1RM for the ticked contexts (`keys`), each over its own adopted value; all or nothing. */
export function acceptOffer(s, offer, keys, now = Date.now()) {
  const picked = (offer?.contexts || []).filter(c => keys.includes(c.key))
  const ctx = Object.fromEntries(referenceContexts(s).map(c => [c.key, c]))
  if (!picked.length || picked.some(p => !ctx[p.key] || (ctx[p.key].ref?.id ?? null) !== (p.from?.id ?? null))) return { ok: false, stale: true }
  for (const p of picked) acceptReference(s, [p.key], p, now)
  return { ok: true }
}

/** Keep (or later) for every context of an offer. */
export const reviewOffer = (s, offer, decision, now = Date.now()) => reviewReference(s, offer.contexts.map(c => c.key), offer, decision, now)

/** When and how a 1RM came: "estimated 3 Nov", "entered 3 Nov". */
export const refWhen = ref => (ref.source === 'estimated' ? t('estimated {0}', fmtDate(String(ref.capturedAt).slice(0, 10))) : t('entered {0}', fmtDate(String(ref.capturedAt).slice(0, 10))))
/** A 1RM as a start keeps it: "100 kg, estimated 3 Nov". */
export const refText = ref => `${fmtNum(ref.value)} ${ref.unit}, ${refWhen(ref)}`

/** The first reference a running track adopts, when its first session finds a 1RM (spec 10.1). */
export function captureReference(s, trackId, ref, now = Date.now()) {
  const run = currentRun(s)
  if (run && ref) addEvent(s, run, 'reference', { trackId, ref: clone(ref), from: null }, now)
}

/** "Week 2 of 6", "Push block, paused", "Programme done": the current run in a few words, or null. */
export function programmeChip(S, today = null) {
  const v = programmeView(S, today)
  if (!v) return null
  if (['stopped', 'complete', 'ended'].includes(v.status)) return t('Programme done')
  if (v.status === 'paused') return t('{0}, paused', programmeById(S, v.run.programmeId)?.name || v.def.name || t('Programme'))
  const n = Math.min(v.nominal.used + 1, v.nominal.of)
  return v.nominal.unit === 'blocks' ? t('Round {0} of {1}', n, v.nominal.of) : t('Week {0} of {1}', n, v.nominal.of)
}

const round1 = v => Math.round(v * 10) / 10

/**
 * The weight `pct` percent of a 1RM comes to, on something you can load: of the adopted reference
 * `ref` when given, else of the exercise's best estimate. The nearest owned weight when the profile
 * lists them (`owned`), else the nearest multiple of `step`, never under the bar (`floor`). Null
 * without a 1RM to take it from.
 */
export function pctWeight(S, exId, pct, { step = 2.5, owned = null, floor = 0 } = {}, ref = null) {
  const est = ref?.value > 0 ? ref.value : best1RM(S, exId)?.est
  if (!(est > 0) || !(pct > 0)) return null
  const ideal = est * pct / 100
  let w
  if (Array.isArray(owned) && owned.length) {
    w = owned.reduce((b, x) => (Math.abs(x - ideal) < Math.abs(b - ideal) ? x : b), owned[0])
  } else {
    w = step > 0 ? round1(Math.round(ideal / step) * step) : round1(ideal)
  }
  return Math.max(w, floor || 0)
}

/** The RPE as the profile logs effort: "RPE 8", or "RIR 2" for a profile that logs reps in reserve. */
export const rpeAs = (rpe, effort) => (effort === 'rir' ? { k: 'RIR', v: Math.max(0, 10 - rpe) } : { k: 'RPE', v: rpe })

/* ------------------------------------ in a plan file ------------------------------------ */

/** A programme as it travels in a plan file (format 2): the definition and the choices it proposes,
 *  never a run, an acknowledgment, a reviewed proposal or a Config default (spec 17). Only one that
 *  runs over the routines going with it: one waiting on a repair or a binding stays home, so the
 *  file it would have spoiled still imports. */
export function bundleProgramme(def, routines) {
  if (!isDef(def) || def.needs?.length || !validateProgramme(def, { routines }).ok) return null
  const { id, name, schedule, duration, end, refs, tracks } = clone(def)
  return { id, name, schedule, duration, end, refs, tracks }
}

const own = (m, k) => (isMap(m) && typeof k === 'string' && Object.hasOwn(m, k) && typeof m[k] === 'string' ? m[k] : null)

// Format 1 (today's programmes): routine ids and exercise ids mapped, the rest kept at its size.
function legacyImported(p, ridMap, exMap) {
  const rid = id => (id === REST ? REST : own(ridMap, id))
  const key = k => {
    const i = k.indexOf(':')
    if (i < 0) return own(exMap, k) || k
    const r = own(ridMap, k.slice(0, i))
    return r ? `${r}:${own(exMap, k.slice(i + 1)) || k.slice(i + 1)}` : null
  }
  const weeks = (Array.isArray(p.weeks) ? p.weeks : []).slice(0, MAX_WEEKS).map(cleanWeek).map(w => {
    if (!w.t) return w
    const t = {}
    for (const [k, v] of Object.entries(w.t).slice(0, IMPORT_MAX_TARGETS)) { const nk = key(k); if (nk) t[nk] = v }
    return { ...w, t }
  })
  const seq = Array.isArray(p.sequence) ? p.sequence.slice(0, IMPORT_MAX_SEQUENCE).filter(x => typeof x === 'string').map(rid).filter(Boolean) : []
  if (seq.some(x => x !== REST)) return { weeks, sequence: seq }
  const days = Object.fromEntries(Object.entries(cleanDays(p.days)).map(([d, ids]) => [d, ids.map(rid).filter(Boolean)]).filter(([, ids]) => ids.length))
  return Object.keys(days).length ? { weeks, days } : null
}

// What a format-2 file may say about a stage and a target (spec 17): anything else is left behind.
const STAGE_KINDS = ['work', 'recovery', 'rest'], CLOSES = ['completion', 'calendar']
const PHASE_KEYS = ['id', 'parameters', 'target', 'groups', 'success', 'progression', 'exit', 'stall']
const pick = (x, keys) => Object.fromEntries(keys.filter(k => isMap(x) && x[k] !== undefined).map(k => [k, clone(x[k])]))
const notPlan = () => { throw Object.assign(new Error(t('this isn’t an openGym plan file')), { code: 'not-plan' }) }
// The definition check the profile itself runs (api/migration/profile-validation.js), over these routines alone.
const canonical = (def, routines) => validateCanonicalProfile({ engineSchemaVersion: 2, engineContractRevision: 1, prescriptions: {}, oneRepMaxes: {}, progression: {}, workouts: [], routines, programmes: { [def.id]: def } }).ok

function targetOf(x, rest) {
  if (!isMap(x)) notPlan()
  const out = pick(x, rest ? ['own'] : ['own', 'options'])
  // A seed names an operator metric and its entry value (spec 6); a rest stage has none, nor options.
  if (!rest && isMap(x.seed)) out.seed = Object.fromEntries(Object.entries(x.seed).filter(([m, v]) => OPERATOR_METRICS.includes(m) && (v === 'copy' || Number.isFinite(v))))
  if (isMap(x.phase)) out.phase = pick(x.phase, PHASE_KEYS)
  if (isMap(x.effort)) out.effort = pick(x.effort, ['mode', 'rpe'])
  if (isMap(x.deload)) out.deload = pick(x.deload, ['factor'])
  // ponytail: below the phase's own keys (parameters, groups) the engine's shapes are validated, not whitelisted.
  return out
}

/**
 * A programme from a plan file over the routines the import just created: format 1 through the
 * converter (routines and exercises it names that did not come along are left out, as before);
 * format 2 with its routine (`ridMap`), occurrence (`occMap`) and exercise (`exMap`) ids mapped,
 * only the keys a definition has, a new id of its own, never started. A format-2 programme is
 * taken whole or not at all (spec 17): an id the import did not map, a stage of an unknown kind,
 * a definition over the bounds or one the profile's own check refuses throws the plan-file error.
 * Null for a format-1 programme that names none of the new routines.
 */
export function importedProgramme(p, { ridMap = {}, occMap = {}, exMap = {}, fmt = 1 } = {}, S, now = Date.now()) {
  if (!isMap(p)) return null
  const name = String(p.name ?? '').trim().slice(0, 80)
  if (fmt < 2) {
    const legacy = legacyImported(p, ridMap, exMap)
    return legacy ? { ...convert(S, { id: uid(), name, at: now, ...legacy }), rev: 1 } : null
  }
  if (!isMap(p.schedule) || !Array.isArray(p.tracks) || p.tracks.length > 50) notPlan()
  const mapped = (m, k) => own(m, k) ?? notPlan()
  const list = v => (Array.isArray(v) ? v : notPlan())
  const schedule = p.schedule.mode === 'rotation'
    ? { mode: 'rotation', sequence: list(p.schedule.sequence).map(id => (id === REST ? REST : mapped(ridMap, id))) }
    : { mode: 'weeks', appts: list(p.schedule.appts).map(a => ({ rid: mapped(ridMap, a?.rid), ...(Number.isInteger(a.day) ? { day: a.day } : {}) })), ...(p.schedule.ordered === true ? { ordered: true } : {}) }
  if (apptRids({ schedule }).length > IMPORT_MAX_SEQUENCE) notPlan()
  // Checked against the routines it was imported with, not the rest of the profile it lands in.
  const routines = (S?.routines || []).filter(r => Object.values(ridMap).includes(r.id))
  const tracks = p.tracks.map(tr => {
    const slots = list(tr?.slots).map(sl => ({ rid: mapped(ridMap, sl?.rid), oid: mapped(occMap, sl.oid), ...(sl.optional === true ? { optional: true } : {}) }))
    const bound = new Set(slots.map(sl => sl.oid))
    // The track's exercise is its occurrence's, as the import named it (a custom id mapped, an alias resolved).
    const occ = slots.length ? occOf({ routines }, slots[0].rid, slots[0].oid) : null
    return {
      id: String(tr.id ?? notPlan()), exerciseId: occ?.exerciseId ?? (own(exMap, tr.exerciseId) || tr.exerciseId), slots,
      stages: list(tr.stages).map(st => {
        if (!isMap(st) || !STAGE_KINDS.includes(st.kind) || (st.close !== undefined && !CLOSES.includes(st.close))) notPlan()
        // A target only for an occurrence the track binds: one for any other is nothing the engine reads.
        return { id: String(st.id), kind: st.kind, ...(st.close ? { close: st.close } : {}), ...(st.cycleEnd === true ? { cycleEnd: true } : {}),
          targets: Object.fromEntries(Object.entries(map(st.targets)).map(([oid, x]) => [mapped(occMap, oid), x]).filter(([oid]) => bound.has(oid)).map(([oid, x]) => [oid, targetOf(x, st.kind === 'rest')])) }
      }),
      refs: ['ask', 'keep'].includes(tr.refs) ? tr.refs : 'inherit',
      ...(isPolicy(tr.policy) ? { policy: { onFailure: tr.policy.onFailure, onSkipped: tr.policy.onSkipped } } : {}),
      // The cycle increment is a number the run adds to the training max (programme-run.js).
      ...(isMap(tr.tm) ? { tm: { ...pick(tr.tm, ['value', 'unit']), ...(Number.isFinite(tr.tm.increment) ? { increment: tr.tm.increment } : {}) } } : {})
    }
  })
  const def = { id: uid(), name, at: now, rev: 1, schedule, duration: { n: p.duration?.n, unit: p.duration?.unit }, end: p.end === 'extend' ? 'extend' : 'stop', refs: ['ask', 'keep'].includes(p.refs) ? p.refs : 'inherit', tracks }
  if (!canonical(def, routines)) notPlan()
  return def
}


/* ------------------------------------ authoring (the editor) ------------------------------------ */
// Each helper returns a new definition with its stage ids kept; the editor saves only what
// validateProgramme passes (checkedEdit), so a refused edit leaves the saved one as it was.

const trackOf = (def, id) => def.tracks.find(tr => tr.id === id) ?? null
const withTrack = (def, id, fn) => ({ ...def, tracks: def.tracks.map(tr => (tr.id === id ? fn(tr) : tr)) })
const withStage = (def, id, stageId, fn) => withTrack(def, id, tr => ({ ...tr, stages: tr.stages.map(st => (st.id === stageId ? fn(st) : st)) }))
const freshId = stages => { let k = stages.length + 1; while (stages.some(st => st.id === `s${k}`)) k++; return `s${k}` }
// A target as another week takes it: its entry seed belongs to the week it was written for.
const unseeded = targets => Object.fromEntries(Object.entries(map(targets)).map(([oid, { seed, ...x }]) => [oid, clone(x)]))

/** How an occurrence is logged: 'reps', 'time' or 'cardio' (the session's own reading). */
export const occMode = occ => occ?.mode ?? (occ?.cardio || occ?.rule?.program.phases[0].parameters.speed ? 'cardio' : occ?.rule?.program.phases[0].parameters.durationSeconds ? 'time' : 'reps')
/** Reps against an external load: not a hold, the body alone, a band or an assistance machine (what a %1RM or a training max fits). */
export const loadedOcc = occ => loadedWork(occ, LIB_BY_ID.get(occ.exerciseId) ?? null, occMode(occ))

// Tracks follow the routines the schedule plans: a slot whose occurrence is gone (or now another
// exercise) leaves its track, and an occurrence new to them gets a track of its own that follows
// its own progression every week. Never linked by itself (spec 4).
function synced(def, S) {
  const planned = new Set(apptRids(def).filter(r => r !== REST))
  const tracks = def.tracks.map(tr => ({ ...tr, slots: tr.slots.filter(sl => planned.has(sl.rid) && occOf(S, sl.rid, sl.oid)?.exerciseId === tr.exerciseId) })).filter(tr => tr.slots.length)
  const bound = new Set(tracks.flatMap(tr => tr.slots.map(sl => `${sl.rid}|${sl.oid}`)))
  for (const r of S?.routines || []) {
    if (!planned.has(r.id) || r.excludeFromProgression === true) continue
    for (const occ of r.ex || []) {
      if (!occ.rule || bound.has(`${r.id}|${occ.occurrenceId}`)) continue
      tracks.push({ id: `t:${def.id}:${occ.occurrenceId}`, exerciseId: occ.exerciseId, slots: [{ rid: r.id, oid: occ.occurrenceId }], refs: 'inherit',
        stages: Array.from({ length: def.duration.n }, (_, i) => ({ id: `s${i + 1}`, kind: 'work', targets: { [occ.occurrenceId]: { own: 'inherit' } } })) })
    }
  }
  return { ...def, tracks }
}

/**
 * `def` on another schedule: `{ mode: 'weeks', appts: [{ rid, day? }], ordered? }` or `{ mode:
 * 'rotation', sequence }`, its duration counted in weeks or rounds to match. Choosing one is the
 * binding a loop waited for. The exercises follow the routines it plans (synced).
 */
export function setSchedule(def, schedule, S) {
  const { needs, src, ...rest } = def
  const left = (needs || []).filter(n => n !== 'binding')
  const out = { ...rest, ...(typeof src === 'string' ? { src } : {}), ...(left.length ? { needs: left } : {}), schedule: clone(schedule), duration: { n: def.duration.n, unit: schedule.mode === 'rotation' ? 'blocks' : 'weeks' } }
  return synced(out, S)
}

/** `def` lasting `n` weeks (or rounds), 1 to 16: each exercise has as many training weeks, a new one a copy of its last work week. */
export function setDuration(def, n) {
  const k = Math.max(1, Math.min(MAX_WEEKS, Math.round(n) || 1))
  return { ...def, duration: { ...def.duration, n: k }, tracks: def.tracks.map(tr => {
    const stages = tr.stages.slice(0, k)
    while (stages.length < k) {
      const last = stages.findLast(st => st.kind === 'work') ?? stages.at(-1)
      stages.push({ id: freshId(stages), kind: 'work', targets: Object.fromEntries(Object.entries(unseeded(last.targets)).map(([oid, { deload, ...x }]) => [oid, x])) })
    }
    return { ...tr, stages }
  }) }
}

/** One week's target for one occurrence of an exercise. */
export const setTarget = (def, trackId, stageId, oid, target) => withStage(def, trackId, stageId, st => ({ ...st, targets: { ...map(st.targets), [oid]: clone(target) } }))

/** A week made work, recovery (needs its sessions done until said otherwise, spec 9) or rest (no targets). */
export const setStageKind = (def, trackId, stageId, kind) => withStage(def, trackId, stageId, ({ close, ...st }) => ({
  ...st, kind, ...(kind === 'recovery' ? { close: close ?? 'completion' } : {}),
  targets: Object.fromEntries(Object.entries(map(st.targets)).map(([oid, { deload, ...x }]) => [oid, kind === 'rest' ? { own: 'inherit' } : kind === 'recovery' && deload ? { ...x, deload } : x])),
}))

/** Week `fromId`'s work copied into week `toId`, which keeps its id. */
export function copyStage(def, trackId, fromId, toId) {
  const from = trackOf(def, trackId)?.stages.find(st => st.id === fromId)
  return from ? withStage(def, trackId, toId, st => ({ ...clone(from), id: st.id, targets: unseeded(from.targets) })) : def
}

/** A week moved one place up (`dir` -1) or down (+1), its id with it. */
export const moveStage = (def, trackId, stageId, dir) => withTrack(def, trackId, tr => {
  const i = tr.stages.findIndex(st => st.id === stageId), j = i + dir
  if (i < 0 || j < 0 || j >= tr.stages.length) return tr
  const stages = tr.stages.slice();
  [stages[i], stages[j]] = [stages[j], stages[i]]
  return { ...tr, stages }
})

/**
 * Several exercises counted as one (spec 4: Monday's and Friday's bench), the first keeping its id,
 * choices and weeks, each week holding every occurrence's own targets. `{ error }` for different
 * exercises ('exercise') or week counts ('length'); a different load meaning is validateProgramme's.
 */
export function linkSlots(def, trackIds) {
  const tracks = trackIds.map(id => trackOf(def, id))
  if (tracks.length < 2 || tracks.some(tr => !tr)) return { error: 'missing' }
  if (tracks.some(tr => tr.exerciseId !== tracks[0].exerciseId)) return { error: 'exercise' }
  if (tracks.some(tr => tr.stages.length !== tracks[0].stages.length)) return { error: 'length' }
  const [first, ...rest] = tracks
  const merged = { ...first, slots: tracks.flatMap(tr => tr.slots), stages: first.stages.map((st, i) => ({ ...st, targets: Object.assign({}, ...tracks.map(tr => clone(map(tr.stages[i].targets)))) })) }
  return { ...def, tracks: def.tracks.filter(tr => !rest.includes(tr)).map(tr => (tr === first ? merged : tr)) }
}

/** The pairs of exercises that may be counted as one: the same exercise, loaded the same way. */
export function linkable(S, def) {
  const out = []
  def.tracks.forEach((a, i) => def.tracks.slice(i + 1).forEach(b => {
    const linked = linkSlots(def, [a.id, b.id])
    if (!linked.error && !validateProgramme(linked, { routines: S?.routines || [] }).errors.some(e => e.includes('linked slots'))) out.push([a.id, b.id])
  }))
  return out
}

/**
 * An exercise's weeks filled from a template (api/engine weeklyTemplate), its week ids kept:
 * 'five_three_one' (the 4-week cycle over and over, on `tm`, the training max it starts from) or
 * 'copy' (its own work, steps removed, every week). `S` gives the routines.
 */
export function applyTemplate(def, trackId, name, { S, tm } = {}) {
  const tr = trackOf(def, trackId)
  if (!tr || tr.slots.some(sl => !occOf(S, sl.rid, sl.oid))) return def
  const per = tr.slots.map(sl => weeklyTemplate(name, { oid: sl.oid, occRule: occOf(S, sl.rid, sl.oid).rule, n: tr.stages.length }))
  const stages = tr.stages.map((st, i) => {
    const [x] = per.map(p => p[i % p.length])
    return { id: st.id, kind: x.kind, ...(x.cycleEnd ? { cycleEnd: true } : {}), targets: Object.assign({}, ...per.map(p => p[i % p.length].targets)) }
  })
  return withTrack(def, trackId, t => ({ ...t, stages, ...(name === 'five_three_one' && tm ? { tm: clone(tm) } : {}) }))
}

/** An exercise's proposed advance/repeat answers, its 1RM preference ('inherit' | 'ask' | 'keep') or its training max (null removes it). */
export const setTrackChoice = (def, trackId, { policy, refs, tm } = {}) => withTrack(def, trackId, ({ policy: p, tm: m, ...tr }) => ({
  ...tr,
  ...(policy === undefined ? (p ? { policy: p } : {}) : isPolicy(policy) ? { policy: { onFailure: policy.onFailure, onSkipped: policy.onSkipped } } : {}),
  ...(refs === undefined ? {} : { refs: ['ask', 'keep'].includes(refs) ? refs : 'inherit' }),
  ...(tm === undefined ? (m ? { tm: m } : {}) : tm ? { tm: clone(tm) } : {}),
}))

/**
 * What the editor may save of `def`: `{ def }` when it validates against today's routines (a
 * repair it was waiting on is then done), else `{ errors }` (validateProgramme's) and nothing saved.
 */
export function checkedEdit(S, def) {
  const next = synced(def, S)
  const { errors } = validateProgramme(next, { routines: S?.routines || [] })
  if (errors.length) return { errors }
  const { needs, ...rest } = next
  const left = (needs || []).filter(n => n !== 'repair')
  return { def: { ...rest, ...(left.length ? { needs: left } : {}) } }
}
