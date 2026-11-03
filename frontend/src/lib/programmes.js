// Programmes (#159, #679): your routines run as a block of 1 to 16 weeks, each week with its own
// intensity (a %1RM or an RPE per exercise, a week-wide RPE, a deload week).
//
//   S.programmes = { [id]: Programme }            one entry per programme, stamped per key
//   S.programme  = null | Run                       the one that is running, a plain setting
//
//   Programme = { id, name, at, weeks: Week[], days?: { [getDay()]: rid[] }, sequence?: (rid|'rest')[], src? }
//   Week      = { deload?: true, rpe?: number, t?: { [exId | 'rid:exId']: { pct?: number, rpe?: number } } }
//   Run       = { id, startedOn: iso, pausedOn?: iso, cycle: 1, bump: 0, saved: { week, scheduleMode, rotation, pass } }
//
// THE SCHEDULE IS APPLIED, NOT RESOLVED. A programme holds a schedule of its own: weekdays
// (`days`) or a loop (`sequence`, lib/rotation.js), taken from your plan when you make it. Starting
// it writes that schedule into S.week or S.rotation, keeping the plan you had in `saved`; ending it
// puts that plan back. So Home's Today, Plan, the reminders, the MCP and an older app that has
// never heard of programmes all follow the programme's days without a line of their own: they
// read the same S.week and S.queue as always. One schedule for every week of the block; what the
// weeks change is the intensity.
//
// THE WEEK IS THE CALENDAR WEEK. Week 1 is the calendar week (the profile's week start) the
// programme was started in, week 2 the next one, and so on, for a loop as for weekdays: a missed
// session does not hold the block up, a pause does (`pausedOn`; resuming moves the start on by the
// whole weeks it was paused). Past the last week the programme is done: its targets stop, the
// schedule stays until you choose to run it again or go back to your plan.
//
// TARGETS WIN WHILE IT RUNS. session-start.js asks programmeSlot for every planned exercise of a
// routine the programme schedules. A %1RM resolves against the exercise's best estimated 1RM
// (onerm.js best1RM, the profile's formula), snapped to the exercise's own step or to the weights
// you own (dumbbells, a machine's stack): that weight replaces whatever the progression policy or
// "Your last session" would have opened with, and the reps are the routine's. An RPE target is
// shown with it and leaves the weight to the policy. A deload week without a %1RM takes the policy's
// weight down by the usual deload factor, and none of its sessions count for progression.
import { isoOf, todayISO, uid, weekKey, MONDAY, SUNDAY } from './format.js'
import { queueOf } from './queue.js'
import { REST, saveRotation, startPass, stopPass, chooseFixedWeek } from './rotation.js'
import { best1RM } from './onerm.js'
import { t } from './i18n-core.js'

export const MAX_WEEKS = 16
export const PCT_MIN = 30
export const PCT_MAX = 110
export const RPE_MIN = 6
export const RPE_MAX = 10
export const REPEAT_BUMP = 2.5
// What a plan file may bring (importedProgramme, plan-share.js parsePlan): far past any real
// programme, and a bound on what a stranger's file can put into the synced profile.
export const IMPORT_MAX_PROGRAMMES = 32
export const IMPORT_MAX_SEQUENCE = 64
export const IMPORT_MAX_TARGETS = 200

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const half = v => Math.round(v * 2) / 2

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

const cleanDays = days => {
  const out = {}
  if (!isMap(days)) return out
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const ids = [].concat(days[d] ?? []).filter(x => typeof x === 'string' && x)
    if (ids.length) out[d] = ids
  }
  return out
}

/**
 * A programme as this app keeps it: 1 to 16 weeks, a schedule of weekdays or a loop, a name.
 * Null for something that is not one. Fields a newer app adds are kept as they are, so a phone a
 * version behind never strips them on its next edit.
 */
export function normalizeProgramme(p) {
  if (!isMap(p) || typeof p.id !== 'string' || !p.id) return null
  const weeks = (Array.isArray(p.weeks) ? p.weeks : []).slice(0, MAX_WEEKS).map(cleanWeek)
  if (!weeks.length) weeks.push({})
  const seq = Array.isArray(p.sequence) ? p.sequence.filter(x => typeof x === 'string' && x) : []
  const out = { ...p, name: String(p.name ?? '').trim().slice(0, 80), weeks }
  if (seq.some(x => x !== REST)) { out.sequence = seq; delete out.days }
  else { delete out.sequence; out.days = cleanDays(p.days) }
  return out
}

/** Every programme, newest first; the malformed ones are left out. */
export const programmesOf = S => Object.values(isMap(S?.programmes) ? S.programmes : {})
  .map(normalizeProgramme).filter(Boolean)
  .sort((a, b) => (b.at || 0) - (a.at || 0))

export const programmeById = (S, id) => normalizeProgramme(isMap(S?.programmes) ? S.programmes[id] : null)

/** The routine ids a programme schedules that still exist, each once, in schedule order. */
export function programmeRoutineIds(S, p) {
  const have = new Set((S?.routines || []).map(r => r.id))
  const ids = p?.sequence ? p.sequence : Object.keys(p?.days || {}).sort().flatMap(d => p.days[d])
  return [...new Set(ids)].filter(id => id !== REST && have.has(id))
}

/** The schedule you train by right now, the way a programme stores it. */
export function currentSchedule(S) {
  const q = queueOf(S)
  const seq = Array.isArray(S?.rotation?.sequence) ? S.rotation.sequence : []
  if ((q || S?.scheduleMode === 'rotation') && seq.some(x => x !== REST)) return { sequence: seq.slice() }
  return { days: cleanDays(S?.week) }
}

/** A new programme over the schedule you train by now; not saved yet. */
export function newProgramme(S, name, weeks = 4, now = Date.now()) {
  const n = Math.max(1, Math.min(MAX_WEEKS, Math.round(weeks) || 1))
  return normalizeProgramme({ id: uid(), name, at: now, weeks: Array.from({ length: n }, () => ({})), ...currentSchedule(S) })
}

/** Writes `p` into the draft state (store.update), cleaned. */
export function saveProgramme(s, p) {
  const clean = normalizeProgramme(p)
  if (!clean) return null
  s.programmes = { ...(isMap(s.programmes) ? s.programmes : {}), [clean.id]: clean }
  return clean
}

/** Removes a programme, ending it first when it is the one running. */
export function deleteProgramme(s, id, today = todayISO()) {
  if (s.programme?.id === id) endProgramme(s, today)
  if (!isMap(s.programmes) || !(id in s.programmes)) return
  const next = { ...s.programmes }
  delete next[id]
  s.programmes = next
}

/** A week list of `n` weeks: the ones kept as they were, new ones copied from the last. */
export function resizeWeeks(weeks, n) {
  const k = Math.max(1, Math.min(MAX_WEEKS, Math.round(n) || 1))
  const out = (weeks || []).slice(0, k).map(cleanWeek)
  while (out.length < k) out.push(out.length ? { ...clone(out[out.length - 1]), deload: undefined } : {})
  return out.map(cleanWeek)
}

/** Week `from`'s targets, every %1RM raised by `step` points (the RPEs as they are), for "same as last week, a bit heavier". */
export function stepWeek(week, step = REPEAT_BUMP) {
  const w = cleanWeek(week)
  const out = { ...(w.rpe != null ? { rpe: w.rpe } : {}) }
  if (w.t) {
    out.t = Object.fromEntries(Object.entries(w.t).map(([k, v]) => [k, {
      ...v, ...(v.pct != null ? { pct: cleanPct(Math.min(PCT_MAX, v.pct + step)) ?? v.pct } : {}),
    }]))
  }
  return cleanWeek(out)
}

/* ------------------------------- the running programme ------------------------------- */

const wsOf = S => (S?.weekStart === SUNDAY ? SUNDAY : MONDAY)
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const weeksBetween = (a, b, ws) => Math.round(daysBetween(weekKey(a, ws), weekKey(b, ws)) / 7)
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const isISO = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Where the running programme stands on `today`: `{ programme, run, week (1-based), weeks, paused,
 * done, current (the Week, or null once done) }`. Null with no programme running, or one whose
 * definition is gone (removed on another device: the schedule it wrote just stays).
 */
export function programmeStatus(S, today = todayISO()) {
  const run = S?.programme
  if (!isMap(run) || !isISO(run.startedOn)) return null
  const p = programmeById(S, run.id)
  if (!p) return null
  const ws = wsOf(S)
  const at = isISO(run.pausedOn) && run.pausedOn < today ? run.pausedOn : today
  const week = Math.max(1, weeksBetween(run.startedOn, at, ws) + 1)
  const weeks = p.weeks.length
  const done = week > weeks
  return {
    programme: p, run, week: Math.min(week, weeks), weeks, done,
    paused: isISO(run.pausedOn), cycle: Math.max(1, Math.round(Number(run.cycle) || 1)),
    current: done || isISO(run.pausedOn) ? null : p.weeks[week - 1],
  }
}

/** What applying a schedule must keep of the plan it replaces, to put back at the end. */
const snapshot = s => ({
  week: clone(s.week || {}),
  scheduleMode: s.scheduleMode ?? null,
  rotation: clone(s.rotation ?? null),
  // A pass of this app's own loop was running: ending puts a fresh one back.
  pass: !!queueOf(s) && !!s.rotation && queueOf(s).rotationId === s.rotation.id,
})

function applySchedule(s, p, today, now) {
  const have = new Set((s.routines || []).map(r => r.id))
  if (p.sequence) {
    const seq = p.sequence.filter(id => id === REST || have.has(id))
    if (seq.some(id => id !== REST)) {
      // A loop of its own, with an id of its own: the one you had is in `saved`, untouched.
      stopPass(s, today)
      s.rotation = null
      saveRotation(s, seq, p.name || '', today, now)
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

/**
 * Starts programme `id` today (inside store.update). A programme already running is ended first,
 * its plan put back, so `saved` always holds the plan you had before any programme. Returns false
 * when there is no such programme.
 */
export function startProgramme(s, id, today = todayISO(), now = Date.now(), { cycle = 1, bump = 0 } = {}) {
  const p = programmeById(s, id)
  if (!p) return false
  if (s.programme) endProgramme(s, today)
  const saved = snapshot(s)
  applySchedule(s, p, today, now)
  s.programme = { id, startedOn: today, cycle, bump, saved }
  return true
}

export function pauseProgramme(s, today = todayISO()) {
  if (!isMap(s.programme) || isISO(s.programme.pausedOn)) return
  s.programme = { ...s.programme, pausedOn: today }
}

/** Resumes where it was paused: the start moves on by the whole weeks the pause lasted. */
export function resumeProgramme(s, today = todayISO()) {
  const run = s.programme
  if (!isMap(run) || !isISO(run.pausedOn)) return
  const gap = Math.max(0, weeksBetween(run.pausedOn, today, wsOf(s)))
  const { pausedOn, ...rest } = run
  s.programme = { ...rest, startedOn: addDays(run.startedOn, gap * 7) }
}

/** Ends the programme and puts back the plan you had before it (weekdays, loop, mode). */
export function endProgramme(s, today = todayISO(), now = Date.now()) {
  const run = s.programme
  if (!isMap(run)) { s.programme = null; return }
  const saved = isMap(run.saved) ? run.saved : null
  s.programme = null
  if (!saved) return
  const ownQ = queueOf(s)
  if (ownQ && (!s.rotation || ownQ.rotationId === s.rotation.id)) stopPass(s, today)
  s.week = isMap(saved.week) ? clone(saved.week) : {}
  s.rotation = clone(saved.rotation ?? null)
  s.scheduleMode = saved.scheduleMode ?? null
  if (saved.pass && s.rotation) startPass(s, today, now)
}

/**
 * Runs the same programme again from week 1. `bump` raises every %1RM of the new round by that
 * many points on top of the last round's: the estimate already grew with the work, this is for
 * anyone who wants the next block heavier still.
 */
export function repeatProgramme(s, today = todayISO(), bump = 0, now = Date.now()) {
  const run = s.programme
  if (!isMap(run)) return false
  const next = { cycle: Math.max(1, Number(run.cycle) || 1) + 1, bump: (Number(run.bump) || 0) + (Number(bump) || 0) }
  // Its schedule is already in place: keep the plan from before the first round in `saved`.
  s.programme = { ...run, startedOn: today, ...next }
  delete s.programme.pausedOn
  return true
}

/** "Week 2 of 6", "Push block, paused", "Programme done": the running programme in a few words, or null. */
export function programmeChip(S, today = todayISO()) {
  const st = programmeStatus(S, today)
  if (!st) return null
  if (st.done) return t('Programme done')
  if (st.paused) return t('{0}, paused', st.programme.name || t('Programme'))
  return t('Week {0} of {1}', st.week, st.weeks)
}

/* ------------------------------- targets for a session ------------------------------- */

/**
 * The programme's target for one exercise of one routine on `iso`: `{ pct?, rpe?, deload, week,
 * weeks, name, bump }`, or null when no running programme speaks to it (paused, done, a routine it
 * does not schedule, a week with nothing for it).
 */
export function programmeSlot(S, rid, exId, iso = todayISO()) {
  const st = programmeStatus(S, iso)
  if (!st || !st.current || !rid) return null
  if (!programmeRoutineIds(S, st.programme).includes(rid)) return null
  const w = st.current
  const own = w.t?.[`${rid}:${exId}`] || w.t?.[exId] || {}
  const pct = own.pct != null ? own.pct : null
  const rpe = own.rpe != null ? own.rpe : w.rpe != null ? w.rpe : null
  const deload = w.deload === true
  if (pct == null && rpe == null && !deload) return null
  const bump = Number(S.programme?.bump) || 0
  return {
    ...(pct != null ? { pct: Math.min(PCT_MAX, pct + bump) } : {}),
    ...(rpe != null ? { rpe } : {}),
    deload, week: st.week, weeks: st.weeks, name: st.programme.name, bump,
  }
}

const round1 = v => Math.round(v * 10) / 10

/**
 * The weight `pct` percent of the exercise's best estimated 1RM comes to, on something you can
 * load: the nearest owned weight when the profile lists them (`owned`), else the nearest multiple
 * of `step`, never under the bar (`floor`). Null without an estimate to take it from.
 */
export function pctWeight(S, exId, pct, { step = 2.5, owned = null, floor = 0 } = {}) {
  const best = best1RM(S, exId)
  if (!(best?.est > 0) || !(pct > 0)) return null
  const ideal = best.est * pct / 100
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

/* ------------------------------- for a shared plan file ------------------------------- */

/** A programme as it travels in a plan file: no run state, no ids but the routines'. */
export function bundleProgramme(p) {
  const n = normalizeProgramme(p)
  if (!n) return null
  const { at, src, ...rest } = n
  return rest
}

/**
 * A programme from a plan file, with its routine ids mapped to the ones the import just created
 * (`ridMap`) and its exercise ids to the recipient's (`exMap`); one that names none of them is
 * dropped. A new id of its own, never running.
 */
export function importedProgramme(p, ridMap, exMap = {}, now = Date.now()) {
  // A file is someone else's: only the fields this app reads come in (no blob riding along into
  // the synced profile), and a loop or a week of targets only as long as anyone writes one.
  if (!isMap(p)) return null
  const n = normalizeProgramme({
    id: 'x', name: p.name, weeks: p.weeks, days: p.days,
    ...(Array.isArray(p.sequence) ? { sequence: p.sequence.slice(0, IMPORT_MAX_SEQUENCE) } : {}),
  })
  if (!n) return null
  // Own keys only: an id like "constructor" must not find Object's.
  const own = (m, k) => (isMap(m) && Object.hasOwn(m, k) && typeof m[k] === 'string' ? m[k] : null)
  const rid = id => (id === REST ? REST : own(ridMap, id))
  const key = k => {
    const i = k.indexOf(':')
    if (i < 0) return own(exMap, k) || k
    const r = own(ridMap, k.slice(0, i))
    return r ? `${r}:${own(exMap, k.slice(i + 1)) || k.slice(i + 1)}` : null
  }
  const weeks = n.weeks.map(w => {
    if (!w.t) return w
    const t = {}
    for (const [k, v] of Object.entries(w.t).slice(0, IMPORT_MAX_TARGETS)) { const nk = key(k); if (nk) t[nk] = v }
    return { ...w, t }
  })
  const out = { ...n, id: uid(), at: now, weeks }
  if (n.sequence) {
    out.sequence = n.sequence.map(rid).filter(Boolean)
    if (!out.sequence.some(x => x !== REST)) return null
  } else {
    out.days = Object.fromEntries(Object.entries(n.days || {}).map(([d, ids]) => [d, ids.map(rid).filter(Boolean)]).filter(([, ids]) => ids.length))
    if (!Object.keys(out.days).length) return null
  }
  return normalizeProgramme(out)
}
