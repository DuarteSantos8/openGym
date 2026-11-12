// The watch link, the page's side. Two transports, one protocol:
//   iPhone + Apple Watch   native ios/App/App/WatchBridgePlugin.swift (WatchConnectivity), the
//                          watch app ios/App/Watch
//   Android + Wear OS      native android/app/.../WatchBridgePlugin.java (the Wearable Data
//                          Layer), the watch app android/wear (docs/WEAR_OS.md)
//   any + Zepp OS          lib/watch-relay.js: the same calls over the user's own server (the
//                          watch's Side Service lives in the Zepp app), watch-zepp/ (docs/ZEPP_OS.md)
// Both plugins are called WatchBridge and answer the same calls, and both watches read the same
// snapshot and send the same events, so everything below is the same for either.
//
// Phone → watch: while a workout runs, a snapshot of it (each exercise by name, its sets with
// weight, reps and done, the rest, where you are) goes to the watch whenever it changes. The watch
// then runs the session on its own: the phone's page sleeps once the phone is locked in a pocket.
//
// Watch → phone: what happened on the watch comes back as small events ({ id, type: 'setDone',
// wid, exId, entryIdx, setIdx, w, r, at }). They are applied through the workout screen's own
// actions (bindWatchActions), the same ones a tap on the phone runs (rest timer, the high-water
// mark, the end-of-workout sheet), never a second copy of them. Each event is applied once, by its
// id, and only then acknowledged, which takes it out of the native queue; until the workout screen
// is there to apply it, it waits in that queue.
//
// Nothing gets lost, nothing runs twice (the 1.4.5 protocol, docs/WATCH_SYNC.md):
//   - the watch keeps every event in an outbox of its own, numbered (`seq`), and sends it again
//     until the phone says it has it: the snapshot names the ids applied here lately (`acked`);
//   - here each id is applied once (the applied list survives restarts), the events of one drain
//     go in the watch's order (seq), and an event of a workout started on the watch whose start
//     has not arrived yet waits for it instead of being thrown away;
//   - a start for a workout this phone already had (saved or discarded) never starts it again;
//   - a set the watch logged after the phone saved the workout lands in the saved workout, even
//     for an exercise the phone had left empty (and so out of what it saved).
//
// The phone apps only. Without a paired watch with the app on it, nothing is sent and nothing
// arrives: the phone behaves exactly as before.
import { stripBidi } from './bidi.js'
import { setBandsOf, bandText } from './bands.js'
import { isOn } from './modules.js'
import { MOBILE, nativePlatform } from './mobile.js'
import { EXIDX, gifSrc, imgSrc, figureOf, isAssisted } from './exercises.js'
import { packId, packDrawingId } from './anim-quality.js'
import { getState as animPacks } from './anim-packs.js'
import { getLang, baseLang, onLangChange } from './i18n.js'
import { modeOf, setLabel, lastEntryFor, effectiveRoutineIds, isBw, isPerSide, EFFORT, effortOf } from './history.js'
import { isWarmupRow, isSideSet, syncSideAggregate } from './workout-model.js'
import { bestSetFor } from './exercise-history.js'
import { weightIncrement } from './progression.js'
import { sessionHistory } from './backfill.js'
import { buildCombinedEntries, deriveSessionName } from './session-merge.js'
import { todayISO, exerciseNameText } from './format.js'
import { sanitizeHr } from './heart-rate.js'
import { readWatchPrefs, settingsForWatch, writeWatchStatus, readWatchStatus, onWatchPrefs, writeGarminLink } from './watch-settings.js'
import { forgottenForWatch, readForgottenPrefs, readForgottenState, onForgottenChange, gymReminderOn } from './forgotten-workout.js'
import { garminSnapshot, GARMIN_ACKED_MAX } from './garmin-snapshot.js'
import { plannedType } from './health-connect.js'
import { exView, exConverted, exUnitOf, viewEntry, viewRow, shownWeight, storedWeight } from './ex-unit.js'
import { streakInfo } from './streak.js'
import { accentValue, accentPair, customAccentVars } from './accent.js'
import { circuitClock } from './circuit.js'

// A circuit's clock (lib/circuit.js, store/useCircuit.js), when one runs: its rests and its get
// ready go to the watch as the rest it already counts down; the station on now is the current
// exercise (`cur`). The watch apps have no screen for a circuit's work interval or its round, so
// those stay on the phone. The store tells this module, rather than this module importing it.
let circuitRun = () => null
const circuitListeners = new Set()
export function bindCircuitSource (get) { circuitRun = typeof get === 'function' ? get : () => null }
export function circuitChanged () { for (const fn of circuitListeners) { try { fn() } catch { /* the next change tries again */ } } }
/** The rest the watch should count: a circuit's rest when its clock runs, else the rest timer. */
export function watchRestTimer (timer, run = circuitRun()) {
  const cc = circuitClock(run)
  // a paused rest is said as paused (#1149): the watch then keeps its countdown, as for a phone rest
  if (cc) return cc.kind === 'rest' ? (cc.paused ? { endsAt: cc.endsAt, paused: true } : { endsAt: cc.endsAt }) : null
  return timer
}

export const SNAPSHOT_VERSION = 1
const APPLIED_KEY = 'gym_watch_applied'
const APPLIED_MAX = 1000
// The workouts started on the watch that this phone has met (started, run or ended): a late copy
// of their start is not a new workout, and their late events are not waited on.
const SEEN_KEY = 'gym_watch_wids'
const SEEN_MAX = 60
// How many of the applied ids the snapshot carries back to the watch (its outbox lets go of them).
export const ACKED_MAX = 80
// How long an event of a watch-started workout waits for that workout's start to arrive.
export const DEFER_MAX_MS = 48 * 3600e3
const SEND_DEBOUNCE_MS = 400
// Routines the watch can start besides today's: enough to choose from, small enough to send.
const READY_MAX = 8

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
// A body weight from the watch that holds up (kg or lb, whatever the profile uses).
const okBw = v => { const n = num(v); return n != null && n > 0 && n < 700 }
// One side of a per-side set, from the watch: 'L', 'R', or none (the whole set).
const sideOf = v => (v === 'L' || v === 'R' ? v : null)
// What a tick of a hold (`sec`) or of one side carries besides the numbers; nothing for a plain set.
const extraOf = ev => ({ ...(num(ev.sec) != null ? { sec: num(ev.sec) } : {}), ...(sideOf(ev.side) ? { side: sideOf(ev.side) } : {}), ...effortFrom(ev) })
// The effort the watch logged on a set: { rpe } or { rir } on the half-point grid, inside the
// phone's own scale (lib/history.js EFFORT); nothing for none, or for a number that does not hold up.
export function effortFrom (ev) {
  for (const k of ['rpe', 'rir']) {
    const v = num(ev?.[k])
    if (v == null) continue
    const e = EFFORT[k]
    const snapped = Math.round(v * 2) / 2
    return snapped >= (k === 'rpe' ? 1 : e.min) && snapped <= e.max ? { [k]: snapped } : {}
  }
  return {}
}

/* ---------- the snapshot ---------- */

// The best set before today, per exercise and mode, for the watch's PRs at the finish. Worked out
// once per history (S.workouts), not on every tick of the running session.
let bestCache = { workouts: null, map: new Map() }
function bestFor (S, id, mode) {
  if (mode !== 'reps' && mode !== 'time') return null
  if (bestCache.workouts !== S?.workouts) bestCache = { workouts: S?.workouts, map: new Map() }
  const key = id + '|' + mode
  if (!bestCache.map.has(key)) {
    let b = null
    try { b = bestSetFor(S, id, mode)?.set || null } catch { b = null }
    bestCache.map.set(key, b ? (mode === 'time' ? { sec: num(b.sec), w: num(b.w) } : { w: num(b.w), r: num(b.r) }) : null)
  }
  return bestCache.map.get(key)
}

const stepOf = (cfg, S) => { try { return num(weightIncrement(cfg, S?.unit === 'lb' ? 'lb' : 'kg')) } catch { return null } }

const sideRow = v => ({ w: num(v?.w), r: num(v?.r), done: v?.done === true })

// One set as the watch shows it. A per-side set (a unilateral exercise) carries its two sides,
// each ticked on its own; `done` is both.
function watchSet (s) {
  return {
    w: num(s.w), r: num(s.r), sec: num(s.sec), done: !!s.done, warmup: !!isWarmupRow(s),
    // when it was ticked: of two ticks of the same set (phone and watch), the later wins
    ...(num(s.at) ? { at: num(s.at) } : {}),
    ...(isSideSet(s) ? { sides: { L: sideRow(s.sides.L), R: sideRow(s.sides.R) } } : {}),
    // Its bands by name (lib/bands.js), shown as text; a watch app that does not know it ignores it.
    ...(setBandsOf(s).length ? { band: bandText(setBandsOf(s)) } : {}),
    ...(num(s.m) > 0 ? { m: num(s.m) } : {}),
  }
}

// One exercise as the watch shows it. Only optional fields were added over time (bodyweight,
// perSide, group, best, assisted), so an older watch app reads a newer phone's snapshot.
// An exercise in a weight unit of its own (#657) goes to the watch in that unit, its weights, last
// time, best and step converted and `unit` saying which; the watch's numbers come back in it too
// (the workout screen's mutEntry and patchSetIn store them in the profile's unit).
function watchEntry (stored, H, S) {
  const e = S ? viewEntry(S, stored) : stored
  const ex = EXIDX[e.id]
  const target = e.target || {}
  const cfg = { ...target, id: e.id }
  const mode = modeOf(cfg)
  const own = S && exConverted(S, e.id) ? exUnitOf(S, e.id) : null
  let last = null
  try {
    const l = H ? lastEntryFor(H, e.id, e.rid) : null
    if (l && Array.isArray(l.sets) && l.sets.length) last = l.sets.map(s => stripBidi(setLabel(e.id, own ? viewRow(S, e.id, s) : s, l.target))).join(', ')
  } catch { last = null }
  const stBest = S ? bestFor(S, e.id, mode) : null
  const best = stBest && own && stBest.w != null ? { ...stBest, w: shownWeight(S, e.id, stBest.w) } : stBest
  const V = own ? exView(S, e.id) : S
  return {
    // A string always: the watch reads the whole snapshot or nothing (WatchCore Model.swift), and
    // one id that came in as a number (an import) would leave it with nothing at all.
    id: String(e.id),
    // Title-cased as on the phone; the watch has no CSS to do it (lib/format.js exerciseNameText).
    name: ex ? exerciseNameText(ex) : String(target.name || e.name || e.id),
    // A carry or a sled in metres (Reddit, #1011) goes to the watches as one logged on the phone,
    // the way cardio does: no watch app knows metres yet, and none may log it as reps.
    mode: mode === 'distance' ? 'cardio' : mode,
    ...(mode === 'distance' ? { track: 'distance' } : {}),
    restSec: num(target.restSec),
    last,
    sets: (e.sets || []).map(watchSet),
    ...(isBw(cfg) ? { bodyweight: true } : {}),
    ...(isPerSide(cfg) ? { perSide: true } : {}),
    // a superset: the exercises next to each other with the same group, done in turns
    ...(e.sg ? { group: String(e.sg) } : {}),
    ...(best ? { best } : {}),
    ...(mode === 'reps' && isAssisted(e.id) ? { assisted: true } : {}),
    // the step the weight moves in, as on the phone (this exercise's own, else its plates' default)
    ...(mode === 'reps' && stepOf(cfg, V) ? { step: stepOf(cfg, V) } : {}),
    ...(own ? { unit: own } : {}),
  }
}

/**
 * What the watch can start by itself, the phone asleep: today's planned session and a few other
 * routines, each with its exercises built exactly as starting it on the phone builds them
 * (buildCombinedEntries, as sheets.jsx beginWorkout does).
 */
export function buildReady (S, today = todayISO()) {
  let H = null
  try { H = sessionHistory(S) } catch { H = null }
  // One routine that cannot be built is left out, not the whole list with it.
  const session = ids => {
    try {
      const { entries, routineIds, routines } = buildCombinedEntries(S, ids)
      if (!routines.length) return null
      const healthType = plannedType(entries)
      return {
        routineIds: routineIds.map(String),
        name: String(deriveSessionName(routines.map(r => r.name)) || ''),
        entries: entries.filter(e => e && e.id != null).map(e => watchEntry(e, H, S)),
        // Apple Health's workout type on the watch: a run is a run (#799)
        ...(healthType ? { healthType } : {}),
      }
    } catch { return null }
  }
  let todayIds = []
  try { todayIds = effectiveRoutineIds({ ...S, routines: S.routines || [], week: S.week || {}, dayPlan: S.dayPlan || {} }, today, today) || [] } catch { todayIds = [] }
  const planned = todayIds.length ? session(todayIds) : null
  const others = (S.routines || []).filter(r => r && !todayIds.includes(r.id)).slice(0, READY_MAX).map(r => session([r.id])).filter(Boolean)
  return { today: planned, others }
}

/** What the watch needs to run the session: plain data, no media (licence: text only). */
export function buildSnapshot(S, { timer = null, ready = null, activeAt = null } = {}) {
  const A = S && S.active
  const unit = S && S.unit === 'lb' ? 'lb' : 'kg'
  const restSec = num(S && S.restSec) || 0
  if (!A || !Array.isArray(A.entries)) return { v: SNAPSHOT_VERSION, unit, restSec, active: null, ready }
  let H = null
  try { H = sessionHistory(S) } catch { H = null }
  const healthType = plannedType(A.entries)
  return {
    v: SNAPSHOT_VERSION,
    unit,
    restSec,
    ready,
    active: {
      id: A.id || null,
      name: A.name || '',
      // when it started (ms), for the watch's summary at the finish
      ...(num(A.start) ? { start: num(A.start) } : {}),
      // paused on the phone (#976): the watch's clock stands at this moment (ms) until it resumes
      ...(num(A.pausedAt) ? { pausedAt: num(A.pausedAt) } : {}),
      unit,
      cur: Math.max(0, Math.min(A.entries.length - 1, A.cur || 0)),
      restSec: num(S.restSec) || 0,
      // a rest running on the phone, so the watch counts down the same one
      rest: timer && !timer.paused && !timer.ready && num(timer.endsAt) ? { endsAt: timer.endsAt } : null,
      // paused, not over (#1149): the watch tells a pause from a Skip here, which ends its rest too
      ...(timer && timer.paused && !timer.ready ? { restPaused: true } : {}),
      entries: A.entries.filter(e => e && e.id != null).map(e => watchEntry(e, H, S)),
      // Apple Health's workout type on the watch: a run is a run (#799)
      ...(healthType ? { healthType } : {}),
      // The last thing done in it on the phone (#904): the watch's forgotten-workout clock
      // counts from it, so sets ticked on the phone keep the watch from ending the workout.
      ...(num(activeAt) ? { activeAt: num(activeAt) } : {}),
    },
  }
}

/* ---------- what happened on the phone, for the watch's forgotten-workout check (#904) ---------- */

// The watch asks "All done?" after 20 idle minutes and ended a workout after 45 (#790), counting
// from the last set it knew of. Its copy of the workout can be stale (snapshots that did not
// reach it), and it ended a workout somebody was logging on the phone, set by set. So the phone
// says when it was last used in the workout (activeAt in the snapshot, which the watch also reads
// back from the native side when it asks before ending), and checks an idle finish against its
// own log before it saves anything.
export const IDLE_GUARD_MS = 20 * 60 * 1000
// Clocks of a phone and its watch agree to well within this.
const CLOCK_SLACK_MS = 60 * 1000
// The workout last changed by hand here (ticks, edits), and the app last brought to the front
// with it running. Not what the watch's own events change (applyingWatch).
let editedHere = { wid: null, at: 0 }
let openedHere = { wid: null, at: 0 }
let applyingWatch = false
export function notePhoneEdit (wid, now = Date.now()) { if (wid && !applyingWatch) editedHere = { wid, at: now } }
export function notePhoneOpen (wid, now = Date.now()) { if (wid) openedHere = { wid, at: now } }
/** The newest set ticked in the running workout (either side's tick counts), else 0. */
export function lastTickIn (A) {
  let last = 0
  for (const e of A?.entries || []) for (const s of e?.sets || []) { const at = num(s?.at); if (at && (s.done || s.sides?.L?.done || s.sides?.R?.done) && at > last) last = at }
  return last
}
/** When the running workout was last worked on here: a set ticked or an edit made. */
export function phoneWorkedAt (A) {
  if (!A) return 0
  return Math.max(lastTickIn(A), editedHere.wid === A.id ? editedHere.at : 0)
}
/** What the watch hears: the above, or the app opened with the workout on screen, whichever is later. */
export function phoneActiveAt (A) {
  if (!A) return 0
  return Math.max(phoneWorkedAt(A), openedHere.wid === A.id ? openedHere.at : 0)
}
/**
 * Whether a finish from the watch is stale: the phone has logged the workout past the moment the
 * watch ended it (its `at`, the last set the watch knew of for an idle finish), or, for an idle
 * finish (`idle: true`), the phone was worked on in the last 20 minutes. The phone keeps the
 * workout running then. A watch built before `idle` existed sends an idle finish at its last set,
 * which the first rule catches too.
 */
export function staleWatchFinish (A, ev, now = Date.now()) {
  const worked = phoneWorkedAt(A)
  if (!worked) return false
  const at = num(ev?.at)
  if (at && worked > at + CLOCK_SLACK_MS) return true
  // Ended because the lifter left the gym, which this phone saw too, after the last work here: not stale.
  if (ev?.idle === true && ev?.left === true && A.id) {
    const left = num(readForgottenState(A.id)?.leftAt)
    if (left && worked <= left) return false
  }
  return ev?.idle === true && now - worked < IDLE_GUARD_MS
}

/**
 * The running workout's animations for the watch, from what this phone itself shows for each
 * exercise: the smallest downloaded animation pack of the figure (240 px, `packId` + `drawing`, read
 * through Background Assets on the phone) when there is one, else the app's built-in clip (`path` inside the app package:
 * the 180 px animated WebP of the store build, an MP4 loop in other builds). The native side makes
 * each into a small GIF and sends it as a file; the watch deletes them when the workout ends.
 * Each also names the exercise's 180 px still of the same figure in the app package (`still`): a
 * Wear OS watch gets only that, for its Overview. Nothing is ever fetched from anywhere.
 */
export const WATCH_PACK_PX = 240
// A file inside the app package: relative, no way out of it, and of the expected kind.
const inPackage = (p, kind) => typeof p === 'string' && kind.test(p) && !/^[a-z]+:|^\//i.test(p) && !p.includes('..')
export function clipsFor (S, packs = animPacks().packs || {}) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries)) return []
  const figure = figureOf(S)
  const pid = packId(WATCH_PACK_PX, figure)
  const pack = packs[pid] && packs[pid].state === 'ready' ? pid : null
  const out = [], seen = new Set()
  for (const e of A.entries) {
    const ex = e && EXIDX[e.id]
    if (!ex || seen.has(e.id) || !ex.gif) continue
    seen.add(e.id)
    const s = imgSrc(ex, figure)
    const still = inPackage(s, /\.(webp|jpe?g|png)$/i) ? { still: s } : {}
    const drawing = packDrawingId(ex, figure)
    // a pack's files are read through Background Assets on the phone, never by a path
    if (pack && drawing && /^[A-Za-z0-9_-]+$/.test(drawing)) { out.push({ exId: e.id, packId: pack, drawing, ...still }); continue }
    const path = gifSrc(ex, figure)
    if (!inPackage(path, /\.(webp|mp4|gif)$/i)) continue
    out.push({ exId: e.id, path, ...still })
  }
  return out
}

/* ---------- applying the watch's events ---------- */

// A run that stopped for something that settles by itself in a moment (an action that threw
// because its screen was between two workouts): drainWatchEvents drains once more shortly (RERUN_MS).
let rerunSoon = false
export const RERUN_MS = 250
// How often an event's action threw (this run of the page).
const failedTries = new Map()
export const POISON_TRIES = 3
let handlers = null      // the workout screen's: setDone, finish, discard
let appHandlers = null   // the app's: start
const readList = key => { try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] } }
const readApplied = () => readList(APPLIED_KEY)
const writeApplied = ids => { try { localStorage.setItem(APPLIED_KEY, JSON.stringify(ids.slice(-APPLIED_MAX))) } catch { /* the queue's ack is what counts */ } }
const readSeen = () => readList(SEEN_KEY)
const noteSeen = (seen, wid) => {
  if (!wid || seen.includes(wid)) return
  seen.push(wid)
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_MAX))) } catch { /* only a guard */ }
}
/** The ids of the events applied here lately, newest last: the watch's outbox lets go of them. */
export function ackedIds (max = ACKED_MAX) { return readApplied().slice(-max) }

/**
 * The events in the order the watch made them: those that carry the watch's `seq` are sorted by it
 * among themselves (they can arrive out of order: a fast message overtaking a queued transfer), the
 * others keep their places.
 */
export function inWatchOrder (events) {
  const at = [], withSeq = []
  events.forEach((ev, i) => { if (num(ev?.seq) != null) { at.push(i); withSeq.push(ev) } })
  if (withSeq.length < 2) return events
  withSeq.sort((a, b) => num(a.seq) - num(b.seq))
  const out = events.slice()
  at.forEach((i, k) => { out[i] = withSeq[k] })
  return out
}

// A tick as the fields of a set, for a set that is written directly (a saved workout's, or a row
// the running workout had to be given): what the workout screen's own tick would have put there.
function tickFields (ev) {
  const fields = { done: true, ...(num(ev.w) != null ? { w: num(ev.w) } : {}), ...(num(ev.r) != null ? { r: num(ev.r) } : {}), ...(num(ev.sec) != null ? { sec: num(ev.sec) } : {}), ...(num(ev.at) ? { at: num(ev.at) } : {}), ...effortFrom(ev) }
  const hr = sanitizeHr(ev.hr)
  if (hr) fields.hr = hr
  return fields
}
const whereOf = (ev, wid = ev.wid) => ({ wid, exId: ev.exId, entryIdx: ev.entryIdx, setIdx: ev.setIdx, ...(sideOf(ev.side) ? { side: sideOf(ev.side) } : {}) })

/** The entry an event means: by position when it still holds that exercise, else by the exercise. */
function entryIndexOf (A, ev) {
  if (A.entries[ev.entryIdx] && A.entries[ev.entryIdx].id === ev.exId) return ev.entryIdx
  return A.entries.findIndex(e => e.id === ev.exId)
}

/* ---------- which workouts the watch has (lib/phone-workout.js) ---------- */

// Workouts the watch said it runs: it sent a heart rate for them, or anything at all about them
// while its Apple Health is on (its workout session then runs). The iPhone's own session (#818)
// leaves those to the watch, so Apple Health gets one workout, not two.
const claimedByWatch = new Set()
const claimListeners = new Set()
/** Whether the watch runs this workout's session (as far as its events tell). */
export const watchClaimed = wid => !!wid && (claimedByWatch.has(wid) || (startedOnWatch.has(wid) && readWatchStatus()?.health === 'on'))
export function onWatchClaim (fn) { claimListeners.add(fn); return () => claimListeners.delete(fn) }
function claim (ev) {
  const wid = typeof ev.wid === 'string' && ev.wid ? ev.wid : null
  if (!wid || claimedByWatch.has(wid)) return
  const measured = !!(sanitizeHr(ev.hr) || sanitizeHr(ev.restHr))
  if (!measured && readWatchStatus()?.health !== 'on') return
  claimedByWatch.add(wid)
  for (const fn of claimListeners) { try { fn(wid) } catch { /* a listener's problem */ } }
}

/**
 * Applies the events not applied yet, in order. Returns the ids that are done with: applied now,
 * applied before, or about a workout that is not running any more. An event whose actions are not
 * there yet (a set before the workout screen is open) stops the run: it and everything after it
 * stay queued, in order, for the next drain.
 *
 *   start   { routineIds, wid, at }  the app starts that session with the watch's id and start
 *   setDone { wid, exId, entryIdx, setIdx, w, r, at, rpe?|rir? }   the workout screen's own tick
 *   finish  { wid, at, idle? }       the workout screen's own Finish and save; not when it is stale
 *                                    (staleWatchFinish: the phone logged it after `at`, #904)
 *            idle: ended as forgotten, saved ending at `at` (last set + rest) and offered for
 *            Reopen; `left: true` when the watch ended it because the phone left the gym
 *   discard { wid, at }              the workout screen's own Discard (confirmed on the watch)
 *   stillHere { wid, at }            "Keep going" on the watch's "Still training?" (1.4.5)
 *   setHr   { wid, exId, entryIdx, setIdx, hr?, restHr? }   heart rate on a set (lib/heart-rate.js)
 *
 * A tick for a workout already saved (finished on the phone while the watch was away) is written
 * into that saved workout, stamped so the next sync keeps it. A tick while the workout screen is
 * not open opens it (appHandlers.openWorkout), and the queue drains once it is there. Of two
 * changes of the same set, the later one (`at`) wins.
 */
export function applyEvents (events, getState, now) {
  if (!Array.isArray(events)) return []
  // What the watch's events change in the workout is the watch's activity, not the phone's.
  applyingWatch = true
  try { return applyEach(events, getState, now) } finally { applyingWatch = false }
}
function applyEach (events, getState, now = Date.now()) {
  const applied = readApplied()
  const seen = readSeen()
  const done = []
  // The workouts whose start is in this very queue and not applied yet: what belongs to them
  // waits for it, whatever its age. And those something waited for in this run: when their start
  // is applied later in the same run (it came after them), one more drain follows by itself.
  const startWaits = new Set(events.filter(e => e && e.type === 'start' && typeof e.id === 'string' && typeof e.wid === 'string' && e.wid && !applied.includes(e.id)).map(e => e.wid))
  const waited = new Set()
  for (const ev of inWatchOrder(events)) {
    if (!ev || typeof ev.id !== 'string') continue
    // Applied before and sent again (the watch had not heard yet): named as the newest again, so the
    // next snapshot's `acked` carries it even when many came after it (a Garmin's list is short).
    if (applied.includes(ev.id)) { applied.splice(applied.indexOf(ev.id), 1); applied.push(ev.id); done.push(ev.id); continue }
    const S = getState()?.S
    const A = S?.active
    const ours = A && Array.isArray(A.entries) && (!ev.wid || ev.wid === A.id)
    // A workout finished on the phone while the watch was away: its later ticks still count.
    const saved = !ours && ev.wid && Array.isArray(S?.workouts) ? S.workouts.find(w => w && w.id === ev.wid) : null
    const wid = typeof ev.wid === 'string' && ev.wid ? ev.wid : null
    if (ours && wid) noteSeen(seen, wid)
    // A workout the watch started whose start has not got here yet (it overtook it, or the start is
    // still on its way): the event waits in the queue, unacknowledged, until it has. Not forever:
    // after two days (or for a workout this phone met and let go of) it is meaningless.
    // While its start is here and waiting (below: another workout runs on the phone), it waits
    // with it however old it is, a heart rate without a time of its own too.
    if (ev.type !== 'start' && wid && wid.startsWith('watch-') && !ours && !saved && ['setDone', 'setHr', 'finish', 'discard'].includes(ev.type) &&
        !seen.includes(wid) && !discardedFor(now).includes(wid) && (startWaits.has(wid) || (num(ev.at) && now - num(ev.at) < DEFER_MAX_MS))) { waited.add(wid); continue }
    // A copy of a start for a workout this phone already had (saved, discarded, or running) is
    // not a new workout: nothing starts again (no zombie session after a resend).
    const had = ev.type === 'start' && wid && (seen.includes(wid) || saved || discardedFor(now).includes(wid))
    // Started on the watch while another workout runs here: it waits (its sets with it) until that
    // one is saved or discarded, then starts, so what was logged at the wrist is never thrown away.
    // However long that takes: a workout left open on the phone for days (forgotten workouts
    // switched off) used to cost every workout done at the wrist meanwhile once two days had passed.
    if (ev.type === 'start' && !had && A && wid && A.id !== wid) continue
    if (['start', 'setDone', 'setHr', 'finish', 'discard'].includes(ev.type)) claim(ev)
    // An action that throws (a screen caught between two workouts, a state nobody foresaw) must
    // not stop the queue for good: the event is tried again on the next drains, and after
    // POISON_TRIES it is let go of, so the sets behind it still get through.
    try {
      if (ev.type === 'start') {
        if (!A && !had) {
          if (!appHandlers) break
          // Started at the wrist: the watch app is open already, nothing to open there (startWatchSync).
          if (wid) startedOnWatch.add(wid)
          if (wid && waited.has(wid)) rerunSoon = true
          appHandlers.start(Array.isArray(ev.routineIds) ? ev.routineIds : [], { id: wid, start: num(ev.at), ...(okBw(ev.bw) ? { bw: num(ev.bw) } : {}) })
        }
        if (wid && (!A || A.id === wid)) noteSeen(seen, wid)
        // A workout already running on the phone is kept; one with the watch's id is this one.
      } else if (ev.type === 'setDone' && saved) {
        if (!appHandlers) break
        appHandlers.patchSet(whereOf(ev), tickFields(ev), { ifNewer: num(ev.at) })
      } else if (ev.type === 'setDone' && ours) {
        if (!handlers) {
          // The tick is the workout screen's to apply: open it, and the queue drains when it binds.
          if (appHandlers?.openWorkout) appHandlers.openWorkout()
          break
        }
        const idx = entryIndexOf(A, ev)
        const set = idx >= 0 ? A.entries[idx].sets?.[ev.setIdx] : null
        if (set) handlers.setDone(idx, ev.setIdx, { w: num(ev.w), r: num(ev.r), at: num(ev.at), hr: sanitizeHr(ev.hr), ...extraOf(ev) })
        // The workout here has no such row: the exercise was taken out on the phone while the watch
        // logged it, a row was removed, or the watch started a routine the phone has changed (or
        // deleted) since the watch last heard. A set done at the wrist is never thrown away: the
        // workout gets the row with the set in it, in one change (ensureWatchSet), as a set for a
        // workout already saved does. Only an exercise this phone does not know is let go of.
        else if (!A.editingWorkoutId && appHandlers?.ensureSet) appHandlers.ensureSet(whereOf(ev, A.id), tickFields(ev))
      } else if (ev.type === 'weighIn') {
        // The weigh-in the watch asks for before a workout it starts: a body weight entry on its
        // day, as the phone's own check-in makes one (today's replaces today's).
        if (okBw(ev.w)) {
          if (!appHandlers?.weighIn) break
          appHandlers.weighIn({ w: num(ev.w), at: num(ev.at) || Date.now() })
        }
      } else if (ev.type === 'healthDeleted') {
        // The watch took its copies of deleted workouts out of Apple Health: the phone's own removal
        // (which kept retrying the ones it could not delete) runs again and now finds them gone.
        if (appHandlers?.healthDeleted) appHandlers.healthDeleted(Array.isArray(ev.ids) ? ev.ids.filter(x => typeof x === 'string') : [])
      } else if (ev.type === 'stillHere' && ours) {
        // "Keep going" on the watch's "Still training?" (forgotten workouts): the phone stops asking too.
        appHandlers?.stillHere?.(num(ev.at) || now)
      } else if (ev.type === 'watchStatus') {
        // What the watch says about itself, for Settings → Apple Watch. Never queued behind anything.
        // An older one that arrives late (a transfer overtaken by a message) does not undo a newer one.
        if (!(num(ev.at) && num(readWatchStatus()?.at) > num(ev.at))) writeWatchStatus(ev)
      } else if (ev.type === 'setHr') {
        // The rest's heart rate comes once the rest is over, maybe after the workout was saved:
        // a field on that set, wherever the set is now. Nothing for a reading that does not hold up.
        const fields = {}
        const hr = sanitizeHr(ev.hr), restHr = sanitizeHr(ev.restHr)
        if (hr) fields.hr = hr
        if (restHr) fields.restHr = restHr
        if (Object.keys(fields).length) {
          if (!appHandlers) break
          appHandlers.patchSet({ wid: ev.wid, exId: ev.exId, entryIdx: ev.entryIdx, setIdx: ev.setIdx }, fields)
        }
      } else if (ev.type === 'finish' && ours && staleWatchFinish(A, ev)) {
        // The watch took the workout for forgotten while it was being logged here (#904): it keeps
        // running, and the phone says why the watch has let go of it.
        handlers?.idleKept?.()
      } else if ((ev.type === 'finish' || ev.type === 'discard') && ours) {
        if (!handlers) {
          if (appHandlers?.openWorkout) appHandlers.openWorkout()
          break
        }
        // A workout the watch ended as forgotten ends where the watch says (its last set plus the
        // rest), marked so the summary and History offer Reopen (lib/forgotten-workout.js).
        if (ev.type === 'finish') {
          if (ev.idle === true && num(ev.at)) handlers.finish({ end: num(ev.at), auto: ev.left === true ? 'left' : 'idle' })
          // Finish tapped at the wrist: the workout ended then, not when the phone hears of it (a
          // workout done with the phone in the locker, merged an hour later).
          else if (num(ev.at) && num(ev.at) < now) handlers.finish({ end: num(ev.at) })
          else handlers.finish()
        } else handlers.discard?.()
      }
    } catch {
      const n = (failedTries.get(ev.id) || 0) + 1
      failedTries.set(ev.id, n)
      if (n < POISON_TRIES) { rerunSoon = true; break }
    }
    // Applied, or meaningless now (another workout, a set that is gone): either way it is done.
    applied.push(ev.id)
    done.push(ev.id)
  }
  writeApplied(applied)
  return done
}

/**
 * How many seconds to take off a rest the phone just started for a set ticked on the watch: the
 * time since that tick (`at`, the watch's). The watch started its rest at the tick; the phone hears
 * of it a moment later, or minutes later when it was asleep in a pocket or out of reach, and used
 * to count the whole rest from then: the wrist buzzed, and the phone rang "rest's over" long after,
 * or ran a rest for a set done half an hour ago. 0 for a rest that is not this tick's own (it did
 * not start just now), one that is paused or over, a tick heard within two seconds, or a tick
 * from a clock ahead of this one. More than is left: the rest is over already.
 */
export function restLagSec (timer, at, now = Date.now()) {
  if (!timer || timer.ready || timer.paused || !num(at) || !num(timer.endsAt) || !num(timer.total)) return 0
  if (Math.abs(now - (timer.endsAt - timer.total * 1000)) > 1500) return 0
  const lag = now - at
  return lag >= 2000 ? Math.round(lag / 1000) : 0
}

/** The app's own actions, for what needs no screen (starting a session, a set's heart rate). */
export function bindWatchAppActions (h) {
  appHandlers = h
  drainWatchEvents()
  return () => { if (appHandlers === h) appHandlers = null }
}

/* ---------- the native plugin ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then`, so a promise must never resolve with
// the bare proxy (lib/rest-alert.js, the Coach hang #42).
// The iPhone's (Apple Watch) or the Android phone's (Wear OS); the web has none.
export const WATCH_PLATFORMS = ['ios', 'android']
const watchPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || !WATCH_PLATFORMS.includes(await nativePlatform())) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { WatchBridge: registerPlugin('WatchBridge') }
})().catch(() => null))

let getStateRef = null
let draining = null
let drainAgain = false
let rerunTm = null
// The store has its copy back (boot's finishBoot: the file mirror, the server's pull). Before that,
// S can be the empty copy a WebView whose storage was evicted starts with: a tick would find no
// workout, count as meaningless and be acknowledged away, and a "start" would begin a new session
// over it. A store without the flag (a test's) counts as ready.
const storeReady = () => getStateRef?.()?.ready !== false

/**
 * Takes what the watch sent from the native queue, applies it, and acknowledges what is done, but
 * only once the change is on disk (the store's saveNow): the queue is the event's last copy.
 */
export function drainWatchEvents () {
  // Asked while a drain runs (a set from the watch landed meanwhile): one more drain right after,
  // or that set would wait for the next event to be seen (REDDIT-146, "not always syncing").
  if (draining) { drainAgain = true; return draining }
  drainAgain = false
  draining = (async () => {
    try {
      const native = await watchPlugin()
      if (!getStateRef || !storeReady()) return []
      const all = []
      // The native link first, then the others (the Zepp watches' relay), each on its own: one
      // that cannot be reached keeps nobody else's events waiting.
      for (const p of [native, ...extraLinks]) {
        if (!p) continue
        try {
          const { events = [] } = (await p.WatchBridge.drain()) || {}
          const done = applyEvents(events, getStateRef)
          if (done.length) await getStateRef()?.saveNow?.()
          if (done.length) await p.WatchBridge.ack({ ids: done })
          all.push(...done)
        } catch { /* not now: the next drain tries again */ }
      }
      // The watch hears what was applied (the snapshot's `acked`), also when nothing in the workout
      // changed (an event that was meaningless by now): else it would keep sending it.
      if (all.length) for (const fn of ackListeners) { try { fn(all) } catch { /* a link's problem */ } }
      return all
    } catch { return [] } finally {
      draining = null
      if (drainAgain) { drainAgain = false; rerunSoon = false; Promise.resolve().then(() => drainWatchEvents()) }
      else if (rerunSoon) { rerunSoon = false; clearTimeout(rerunTm); rerunTm = setTimeout(() => { drainWatchEvents() }, RERUN_MS) }
    }
  })()
  return draining
}
const ackListeners = new Set()

/** The workout screen hands over its own actions while it is mounted. Returns the unbind. */
export function bindWatchActions (h) {
  handlers = h
  drainWatchEvents()
  return () => { if (handlers === h) handlers = null }
}

/**
 * Started once by the app. Sends a snapshot whenever the workout or its rest changes (debounced,
 * and only what differs from the last one sent), drains the queue when the app comes back.
 */
// Workouts the watch started, so the phone doesn't open the watch app for them again.
const startedOnWatch = new Set()
/** How long after its start a workout that turns up still opens the watch app (not one restored on launch). */
export const OPEN_ON_WATCH_WINDOW_MS = 2 * 60 * 1000

/**
 * Whether a workout that just appeared on the phone opens the watch app (Settings → Apple Watch,
 * "Open on the watch"): a new live session started here a moment ago, not one the watch started,
 * not a backfilled past one, and not one that came back with the app's saved state.
 */
export function shouldOpenOnWatch (prev, next, { prefs = readWatchPrefs(), now = Date.now(), fromWatch = startedOnWatch } = {}) {
  if (!next || !next.id || (prev && prev.id === next.id)) return false
  if (!prefs.enabled || !prefs.autoShow || next.backfill || fromWatch.has(next.id)) return false
  const start = Number(next.start)
  return Number.isFinite(start) && start > 0 && Math.abs(now - start) <= OPEN_ON_WATCH_WINDOW_MS
}

// The application context has a size limit (about 65 KB); a snapshot over it is refused, and then
// the watch would never hear of the workout. Kept well under it, with room for the settings.
export const SNAPSHOT_MAX_BYTES = 48 * 1024
const bytesOf = v => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).length

/**
 * The snapshot made small enough to send, dropping first what matters least: the "last time" lines
 * of the routines the watch could start, then those routines but today's, then today's own "last
 * time" lines and records, then the "last time" of the running workout, then what is ready
 * altogether. The running workout's sets are never cut: without them the watch has nothing to do.
 */
export function fitSnapshot (snap, max = SNAPSHOT_MAX_BYTES) {
  if (bytesOf(snap) <= max) return snap
  const out = JSON.parse(JSON.stringify(snap))
  const strip = (entries, ...keys) => { for (const e of entries || []) for (const k of keys) delete e[k] }
  const steps = [
    () => { for (const r of out.ready?.others || []) strip(r.entries, 'last', 'best') },
    () => { if (out.ready) out.ready.others = (out.ready.others || []).slice(0, 3) },
    () => { if (out.ready) out.ready.others = [] },
    () => { if (out.ready?.today) strip(out.ready.today.entries, 'last', 'best') },
    () => { if (out.active) strip(out.active.entries, 'last') },
    () => { out.ready = null },
    () => { if (out.active) strip(out.active.entries, 'best') },
  ]
  for (const step of steps) {
    step()
    if (bytesOf(out) <= max) return out
  }
  return out
}

// How many deleted workouts the watch is told about at most (the newest deletions).
export const HEALTH_GONE_MAX = 60

/**
 * The Apple Health sync ids of workouts deleted in openGym (S.deleted, newest first), for the watch
 * to take its own copies out of Health: a workout the watch app saved is the watch's, and the phone
 * may not delete it, nor the heart rate and calories saved with it (lib/health-connect.js goneIds
 * names the same ids for the phone's own copies).
 */
export function healthGoneFor (S, max = HEALTH_GONE_MAX) {
  const del = S?.deleted && typeof S.deleted === 'object' && S.deleted.workouts && typeof S.deleted.workouts === 'object' ? S.deleted.workouts : {}
  return Object.entries(del)
    .filter(([, at]) => Number(at) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, max)
    .map(([id]) => 'opengym-w-' + id)
}

// Workouts discarded on the phone (#776), newest last: the snapshot names them for a while, so a
// watch running one ends its Apple Health workout without saving it. Gone from the snapshot it
// looks the same as a finished one. In localStorage, not S: a fact about this phone and its
// watch, and it has to outlive the reload of "Discard the running workout" (ErrorBoundary).
const DISCARDED_KEY = 'gym_watch_discarded'
const DISCARDED_MAX = 5
// Long enough for a watch out of range (or asleep in a bag) to hear it.
export const DISCARDED_FOR_MS = 12 * 3600e3
const readDiscarded = () => {
  try { const v = JSON.parse(localStorage.getItem(DISCARDED_KEY)); return Array.isArray(v) ? v.filter(x => x && typeof x.id === 'string' && Number(x.at) > 0) : [] } catch { return [] }
}

/** The running workout `wid` is being discarded: call before it leaves S.active. */
export function markDiscarded (wid, now = Date.now()) {
  if (!wid || typeof wid !== 'string') return
  const list = [...readDiscarded().filter(x => x.id !== wid), { id: wid, at: now }].slice(-DISCARDED_MAX)
  try { localStorage.setItem(DISCARDED_KEY, JSON.stringify(list)) } catch { /* the watch then saves it, as before */ }
}

/**
 * The ids of the workouts discarded here lately, oldest first. With `S`: never one that runs or is
 * in the history after all (a workout set aside for the tour and back, then finished).
 */
export function discardedFor (now = Date.now(), S = null) {
  const kept = id => !S || (S.active?.id !== id && !(Array.isArray(S.workouts) && S.workouts.some(w => w && w.id === id)))
  return readDiscarded().filter(x => now - Number(x.at) < DISCARDED_FOR_MS && kept(x.id)).map(x => x.id)
}

/**
 * The running workout left `prev` without being saved (`next` has neither it running nor in its
 * history): discarded, whichever way that happened. The workout screen's Discard and
 * ErrorBoundary name it themselves; this catches the rest (a discard on another device that
 * synced in), so the watch never takes it for finished. Not for the tour's practice workout
 * (the real one is only set aside), a saved workout's editor, or one logged into the past.
 */
export function leftUnsaved (prev, next, { tour = false } = {}) {
  const A = prev?.active
  if (tour || !A || !A.id || A.editingWorkoutId || A.backfill) return null
  if (next?.active?.id === A.id) return null
  if (Array.isArray(next?.workouts) && next.workouts.some(w => w && w.id === A.id)) return null
  return A.id
}

/**
 * What the watch takes from the app beyond its own settings: the app's language (the watch shows
 * its words in it, whatever the watch itself is set to), and whether a workout starts with the
 * weigh-in (Settings → During a workout) with the last body weight to start the crown from.
 */
export function watchExtras (S) {
  let lang = 'en'
  try { lang = baseLang(getLang()) || 'en' } catch { lang = 'en' }
  const bw = Array.isArray(S?.bodyweight) && S.bodyweight.length ? S.bodyweight[S.bodyweight.length - 1] : null
  return {
    lang,
    weighIn: S?.weighIn !== false,
    ...(bw && num(bw.w) ? { lastBw: num(bw.w) } : {}),
    // the effort scale the profile logs ('rpe' or 'rir'): the watch's set page offers it then
    ...(EFFORT[effortOf(S)] ? { effort: effortOf(S) } : {}),
    // Settings → Workout → "Timed holds start by themselves": the watch's holds count in after a rest too.
    ...(S?.autoHolds === true ? { autoHolds: true } : {}),
    // The accent the app wears, as the dark theme draws it, and the ink on it: the watch wears it too.
    ...watchAccent(S),
  }
}

/** The app's accent for the watch's black screen: a preset as is, the user's own colour made readable on black. */
export function watchAccent (S) {
  try {
    const v = accentValue(S)
    const own = customAccentVars(v, 'dark')
    const pair = accentPair(v)
    return { accent: own ? own['--acc'] : pair.accent, onAccent: own ? own['--on-acc'] : pair.ink }
  } catch { return {} }
}

/**
 * The week streak for the watch's Tile and complication (Wear OS; the Apple Watch ignores it):
 * weeks in a row, and whether this week has a workout yet (lib/streak.js).
 */
export function streakFor (S, today = todayISO()) {
  try {
    const st = streakInfo(S, today)
    return { weeks: st.current, thisWeekDone: !!st.thisWeekDone }
  } catch { return { weeks: 0, thisWeekDone: false } }
}

export async function startWatchSync ({ useStore, useUI }) {
  const p = await watchPlugin()
  if (!p) return () => {}
  return runLink(p, { useStore, useUI }, { garmin: true })
}

// Links besides the phone's own WatchBridge, with the same calls (lib/watch-relay.js). Their
// events are drained with the native queue's.
const extraLinks = new Set()

/**
 * Runs the sync below over another link than the native one: `plugin` answers WatchBridge's calls
 * (status, sendSnapshot, drain, ack, addListener). `health: false` for a watch that has no Apple
 * Health, `clips: false` for one that gets no animations. Returns the stop.
 */
export async function startLinkSync (plugin, { useStore, useUI }, opts = {}) {
  const p = { WatchBridge: plugin }
  extraLinks.add(p)
  let stop = () => {}
  try { stop = await runLink(p, { useStore, useUI }, opts) } catch { /* the link failed to start: nothing runs */ }
  return () => { extraLinks.delete(p); stop() }
}

async function runLink (p, { useStore, useUI }, { health = true, clips: withClips = true, garmin: withGarmin = false } = {}) {
  getStateRef = () => useStore.getState()
  let lastSent = null, lastClips = null, tm = null
  // The ready sessions only change with the plan, the log or the day: built again only then.
  let readyKey = null, ready = null
  const readyFor = S => {
    const key = [S.routines, S.week, S.dayPlan, S.workouts, S.exWeights, S.unit, todayISO()]
    if (!readyKey || key.some((v, i) => v !== readyKey[i])) {
      readyKey = key
      try { ready = buildReady(S) } catch { ready = null }
    }
    return ready
  }
  // Whether a watch with the app is there: asked at start and when the app comes back, not on every
  // change. Without one nothing below runs at all: no snapshot, no clips, no bridge call per tick.
  // The phone's own link can also reach a Garmin (status `garmin`, docs/GARMIN.md): that watch gets
  // the cut-down snapshot (lib/garmin-snapshot.js) alongside, made here so Java and Swift don't.
  let linked = false, garmin = false
  // A Garmin's `acked` list is short (GARMIN_ACKED_MAX, its messages are small), and a workout
  // logged with the phone away comes back as dozens of events within a second or two. The ids
  // applied since the last snapshot wait here and are named oldest first, a list per snapshot,
  // or the first ones would only be named after the watch sent them a second time a minute later.
  let unnamed = []
  const onAcked = (ids = []) => {
    if (garmin && Array.isArray(ids)) unnamed = [...unnamed.filter(id => !ids.includes(id)), ...ids].slice(-ACKED_MAX)
    // Sent again even when nothing differs: an event that came a second time means the watch never
    // got the snapshot that named it (the link dropped it), and the same one again is what it needs.
    lastSent = null
    schedule()
  }
  const checkLink = async () => {
    const was = linked
    try { const st = await p.WatchBridge.status(); linked = !!(st && st.paired && st.installed); garmin = withGarmin && linked && !!st.garmin } catch { linked = false; garmin = false }
    if (withGarmin) writeGarminLink(garmin)
    // A watch that is new here (the app just installed on it, or reinstalled): it has nothing yet,
    // so the snapshot goes again even when it is the same as the last one sent.
    if (linked && !was) lastSent = null
    return linked
  }
  await checkLink()
  // Apple Health on the watch follows the phone's own Apple Health switch (Settings → Data).
  let healthOn = false, offHealth = () => {}
  if (health) try {
    const hs = await import('./health-sync.js')
    healthOn = !!(await hs.loadHealth())?.on
    offHealth = hs.onHealthChange(h => { if (!!h?.on !== healthOn) { healthOn = !!h?.on; schedule() } })
  } catch { /* no Apple Health here: the watch measures nothing */ }
  const send = async () => {
    tm = null
    if (useStore.getState().tourSandbox) return
    // Not before the store has its copy: an empty one would tell the watch its workout is over.
    if (!linked || !storeReady()) return
    try {
      const S = useStore.getState().S
      // Settings → Modules: the Watch module off pauses the watch the same way as its own switch.
      const prefs = isOn(S, 'watch') ? readWatchPrefs() : { ...readWatchPrefs(), enabled: false }
      // Settings → Apple Watch: off, the watch is told there is nothing (no workout, nothing ready).
      const snap = prefs.enabled
        ? buildSnapshot(S, { timer: watchRestTimer(useUI.getState().timer), ready: readyFor(S), activeAt: phoneActiveAt(S.active) })
        : { v: SNAPSHOT_VERSION, unit: S.unit === 'lb' ? 'lb' : 'kg', active: null, ready: null }
      // Apple Health on the watch pauses with the Health module, as the phone's own sync does.
      const hOn = healthOn && isOn(S, 'health')
      snap.settings = { ...settingsForWatch(prefs, hOn), ...watchExtras(S), forgotten: forgottenForWatch(readForgottenPrefs(), gymReminderOn()) }
      // Forgotten workouts: the phone left the gym during this workout (the watch asks at once).
      if (snap.active?.id) {
        const f = readForgottenState(snap.active.id)
        if (f.leftAt) snap.active.leftGymAt = f.leftAt
      }
      if (prefs.enabled && isOn(S, 'motivation')) snap.streak = streakFor(S)
      // Discarded here: the watch drops its Apple Health workout instead of saving it (#776).
      const discarded = discardedFor(Date.now(), S)
      if (discarded.length) snap.discarded = discarded
      // The events applied here lately: the watch's outbox lets go of them, and its own copy of a
      // set it ticked gives way to the phone's from then on (an untick or edit here sticks).
      const acked = ackedIds()
      if (acked.length) snap.acked = acked
      // With Apple Health on: the deleted workouts, so the watch removes the copies it saved. The
      // discarded ones too: a copy saved before the watch heard (it was away, or ended the workout
      // itself as forgotten) is taken out once it does.
      if (hOn) {
        const gone = [...healthGoneFor(S), ...discarded.map(id => 'opengym-w-' + id).reverse()]
        if (gone.length) snap.healthGone = [...new Set(gone)]
      }
      const json = JSON.stringify(fitSnapshot(snap))
      // With the Watch module (or the watch's own switch) off this is the empty snapshot, so the
      // Garmin pauses with the others.
      const naming = garmin && unnamed.length > GARMIN_ACKED_MAX ? unnamed.slice(0, GARMIN_ACKED_MAX) : null
      const g = garmin ? JSON.stringify(garminSnapshot(naming ? { ...snap, acked: naming } : snap)) : null
      const sent = g ? json + '\n' + g : json
      if (sent !== lastSent) {
        const r = await p.WatchBridge.sendSnapshot(g ? { json, garmin: g } : { json })
        if (r && r.sent) lastSent = sent
        // The next list of ids goes with the next snapshot (the newest ones are in every one).
        unnamed = naming ? unnamed.filter(id => !naming.includes(id)) : []
        if (unnamed.length) schedule()
      }
      // The workout's animations, once per workout and exercise (the native side remembers).
      const clips = prefs.enabled && withClips ? clipsFor(S) : []
      const key = S.active ? S.active.id + '|' + clips.map(c => c.exId).join(',') : ''
      if (clips.length && key !== lastClips) {
        await p.WatchBridge.sendClips({ wid: S.active.id, clips })
        lastClips = key
      } else if (!S.active && lastClips) {
        // The workout is over: animations still on their way to the watch are not wanted any more.
        lastClips = null
        await p.WatchBridge.dropClips?.()
      }
    } catch { /* no watch, or not now: the next change tries again */ }
  }
  // The tour's practice workout (useStore enterTourSandbox) never reaches the watch.
  const schedule = () => { if (!linked || useStore.getState().tourSandbox) return; clearTimeout(tm); tm = setTimeout(send, SEND_DEBOUNCE_MS) }
  const offStore = useStore.subscribe((s, prev) => {
    // Boot done: what the watch sent meanwhile is applied now, and the watch hears the real state.
    if (s.ready && !prev.ready) { drainWatchEvents(); schedule() }
    if (s.S === prev.S) return
    // Not while the store boots (its first copy replaces an empty one).
    if (s.ready !== false && prev.ready !== false) {
      // The running workout changed here (a tick, an edit): the watch's idle clock starts again.
      if (s.S?.active && s.S.active !== prev.S?.active && s.S.active.id === prev.S?.active?.id && !useStore.getState().tourSandbox) notePhoneEdit(s.S.active.id)
      const gone = leftUnsaved(prev.S, s.S, { tour: !!(s.tourSandbox || prev.tourSandbox) })
      if (gone && !discardedFor().includes(gone)) markDiscarded(gone)
    }
    schedule()
    // The running workout ended or changed here: a start from the watch that waited for it applies now.
    if (prev.S?.active?.id && s.S?.active?.id !== prev.S.active.id) drainWatchEvents()
    // A workout started on the phone: the watch app opens with it (HealthKit's startWatchApp).
    if (linked && shouldOpenOnWatch(prev.S?.active, s.S?.active)) Promise.resolve().then(() => p.WatchBridge.openOnWatch({ type: plannedType(s.S.active.entries) || undefined })).catch(() => {})
  })
  // The rest as the watch needs it changes when it starts, stops or is paused, not every second.
  const restOf = t => (t ? `${t.endsAt}|${!!t.paused}|${!!t.ready}` : '')
  const offUI = useUI.subscribe((s, prev) => { if (s.timer !== prev.timer && restOf(s.timer) !== restOf(prev.timer)) schedule() })
  const offPrefs = onWatchPrefs(() => schedule())
  const offForgotten = onForgottenChange(() => schedule())
  ackListeners.add(onAcked)
  circuitListeners.add(schedule)
  // The watch speaks the app's language, not its own system's: told again when it changes (the
  // exercise names in the snapshot change with it too).
  let offLang = () => {}
  try { offLang = onLangChange(() => schedule()) } catch { /* a test without i18n */ }
  const sub = await p.WatchBridge.addListener('watchEvent', () => { drainWatchEvents() })
  // The link itself changed (the session finished activating after launch, a watch was paired, the
  // app was installed on it): asked again, and the snapshot sent when there is a watch now.
  // Sent again even when unchanged: a reinstalled watch app starts with nothing.
  const subLink = await Promise.resolve(p.WatchBridge.addListener('watchState', () => { checkLink().then(() => { lastSent = null; schedule() }) })).catch(() => null)
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    // The app in front with a workout running counts as using it, for the watch's idle clock.
    notePhoneOpen(useStore.getState().S?.active?.id)
    drainWatchEvents()
    checkLink().then(() => schedule())
  }
  document.addEventListener('visibilitychange', onVisible)
  // Asked once more now that the listeners are there: the link may have come up (watchState) while
  // the first answer above was on its way, and that event had no one to hear it. Without this the
  // watch heard nothing until the app went to the background and came back.
  if (!linked) await checkLink()
  schedule()
  drainWatchEvents()
  return () => { ackListeners.delete(onAcked); circuitListeners.delete(schedule); offStore(); offUI(); offPrefs(); offForgotten(); offHealth(); offLang(); sub?.remove?.(); subLink?.remove?.(); document.removeEventListener('visibilitychange', onVisible); clearTimeout(tm) }
}

// Test seams.
export function _setWatchPluginForTest (plugin, getState) { pluginP = Promise.resolve(plugin ? { WatchBridge: plugin } : null); getStateRef = getState || null }
export function _resetWatchSync () { extraLinks.clear(); ackListeners.clear(); startedOnWatch.clear(); claimedByWatch.clear(); handlers = null; appHandlers = null; pluginP = null; getStateRef = null; draining = null; drainAgain = false; rerunSoon = false; clearTimeout(rerunTm); rerunTm = null; failedTries.clear(); editedHere = { wid: null, at: 0 }; openedHere = { wid: null, at: 0 }; applyingWatch = false }

/**
 * Writes `fields` (heart rate) onto one set: in the running session when it is that workout, else in
 * the saved workout of that id, which is then stamped as edited so the next sync keeps the change
 * (lib/sync-merge.js: of two copies of a workout the one edited last wins). Only these optional
 * fields are ever added; nothing is removed or renamed.
 */
export function patchSetIn (s, { wid, exId, entryIdx, setIdx, side = null }, fields, stamp, { ifNewer = null, recount = null } = {}) {
  // One side of a per-side set: that side takes the numbers and the tick, the row's own w/r/done
  // follow from both sides (lib/workout-model.js syncSideAggregate).
  const write = (set, given) => {
    // A weight from the watch is in the exercise's own unit (#657), the one it was sent in.
    const f = given.w != null ? { ...given, w: storedWeight(s, exId, given.w, side && isSideSet(set) ? set.sides[side]?.w : set.w) } : given
    // A warm-up whose numbers the watch changed is set by hand, as on the phone (#525).
    const cur = side && isSideSet(set) ? set.sides[side] || {} : set
    if (isWarmupRow(set) && ((f.w != null && f.w !== cur.w) || (f.r != null && f.r !== cur.r))) set.edited = true
    if (side && isSideSet(set)) {
      const { w, r, done, rpe, rir, ...rest } = f
      const one = { ...set.sides[side] }
      if (w != null) one.w = w
      if (r != null) one.r = r
      if (done) one.done = true
      // a side's effort is that side's (the row's follows from both, as on the phone)
      if (rpe != null) one.rpe = rpe
      if (rir != null) one.rir = rir
      set.sides = { ...set.sides, [side]: one }
      const agg = syncSideAggregate(set)
      for (const k of Object.keys(set)) if (!(k in agg)) delete set[k]
      Object.assign(set, agg, rest)
    } else Object.assign(set, f)
  }
  const find = w => {
    if (!w || !Array.isArray(w.entries)) return null
    const i = w.entries[entryIdx] && w.entries[entryIdx].id === exId ? entryIdx : w.entries.findIndex(e => e && e.id === exId)
    return i >= 0 ? w.entries[i].sets?.[setIdx] || null : null
  }
  if (s.active && s.active.id === wid) {
    const set = find(s.active)
    if (set) write(set, fields)
    return !!set
  }
  const w = (s.workouts || []).find(x => x && x.id === wid)
  // A set the watch logged after the phone saved the workout, of an exercise the phone had left
  // without a set done (so not in what it saved), or past its last row: it gets its place there.
  const set = find(w) || (w && Array.isArray(w.entries) && fields.done && exId != null && Number.isInteger(setIdx) && setIdx >= 0 && setIdx < 100 ? lateRow(w, exId, setIdx) : null)
  if (!set) return false
  // Two changes of the same set: the later one wins (a tick from the watch older than an edit
  // made on the phone since keeps the phone's numbers; its heart rate still lands).
  let f = fields
  if (ifNewer != null && set.done && Number(set.at) > ifNewer) {
    f = {}
    if (fields.hr) f.hr = fields.hr
    if (fields.restHr) f.restHr = fields.restHr
    // the watch's effort still lands on a set that has none
    if (set.rpe == null && set.rir == null) Object.assign(f, effortFrom(fields))
    if (!Object.keys(f).length) return false
  }
  const before = JSON.stringify(set)
  write(set, f)
  // The same event again (the queue handed it over twice): nothing new, so the saved workout is
  // not stamped as edited now, which would let it win over a later edit made on another device.
  if (JSON.stringify(set) === before) return true
  if (recount) recount(w)
  if (stamp) stamp(w)
  return true
}

/**
 * The running workout gets the row a set from the watch names when it has none: the rows up to
 * `setIdx` in its exercise (each like the last one there, not done), and the exercise itself, at
 * the end, when the workout does not have it (`build(exId)` makes it as adding it by hand would;
 * null for an exercise this phone does not know). With `fields`, the set is written into the row
 * in the same change. Returns whether the row is there now.
 */
export function ensureWatchSet (s, where, build, fields = null, stamp = null, opts = {}) {
  const { exId, setIdx } = where || {}
  const A = s?.active
  if (!A || !Array.isArray(A.entries) || A.editingWorkoutId || exId == null || !Number.isInteger(setIdx) || setIdx < 0 || setIdx >= 100) return false
  let e = A.entries.find(x => x && x.id === exId)
  if (!e) {
    let made = null
    try { made = build ? build(exId) : null } catch { made = null }
    if (!made || typeof made !== 'object') return false
    e = { ...made, id: exId, sets: Array.isArray(made.sets) ? made.sets : [] }
    A.entries.push(e)
  }
  if (!Array.isArray(e.sets)) e.sets = []
  while (e.sets.length <= setIdx) e.sets.push(rowLike(e.sets[e.sets.length - 1]))
  // The set itself, when given: written as a set from the watch is anywhere else (patchSetIn).
  if (fields) patchSetIn(s, { ...where, wid: A.id }, fields, stamp, opts)
  return true
}

// One more row after `l`, as the workout screen's "add set" makes one: the same plan, not done,
// nothing of what was logged on `l` (its time, heart rate, effort, note).
function rowLike (l) {
  if (!l) return { w: null, r: null, done: false }
  if (l.min != null) return { min: l.min, ...(l.speed != null ? { speed: l.speed } : {}), done: false }
  if (isSideSet(l)) {
    const side = v => ({ w: v?.w ?? null, r: v?.r ?? null, done: false })
    return { w: l.w ?? null, r: l.r ?? null, done: false, sides: { L: side(l.sides.L), R: side(l.sides.R) } }
  }
  return { w: l.w ?? null, r: l.r ?? null, ...(l.sec != null ? { sec: l.sec } : {}), done: false }
}

/** The row for set `setIdx` of `exId` in saved workout `w`, made with its entry when missing. */
function lateRow (w, exId, setIdx) {
  let e = w.entries.find(x => x && x.id === exId)
  if (!e) { e = { id: exId, sets: [], topW: null, target: null }; w.entries.push(e) }
  if (!Array.isArray(e.sets)) e.sets = []
  while (e.sets.length <= setIdx) e.sets.push({ w: null, r: null, done: false })
  return e.sets[setIdx]
}

/** Whether a watch is paired and has the app, for Settings → Apple Watch. */
/**
 * Settings → Garmin (views/GarminSettings.jsx): the native Garmin calls of WatchBridge
 * (garminStatus, garminPick, garminStore; docs/GARMIN.md). No phone app, or a build without them:
 * null.
 */
export async function garminCall (name, args = {}) {
  if (!['garminStatus', 'garminPick', 'garminStore'].includes(name)) return null
  const p = await watchPlugin()
  if (!p) return null
  try { return (await p.WatchBridge[name](args)) || null } catch { return null }
}

/**
 * The Wear OS link by itself, for Settings → Wear OS watch (views/WearSettings.jsx, lib/wear-view.js):
 * { supported, paired, installed, reachable, watches }. A phone app from before the plugin said it
 * that way answers with the plain fields, which are the same thing where there is no Garmin.
 */
export async function wearStatus () {
  const none = { supported: false, paired: false, installed: false, reachable: false, watches: [] }
  const p = await watchPlugin()
  if (!p) return none
  try {
    const st = await p.WatchBridge.status()
    const w = st?.wear && typeof st.wear === 'object' ? st.wear : (st?.garmin ? null : st)
    if (!w) return none
    return { supported: !!w.supported, paired: !!w.paired, installed: !!w.installed, reachable: !!w.reachable, watches: Array.isArray(w.watches) ? w.watches : [] }
  } catch { return none }
}

export async function watchStatus () {
  const p = await watchPlugin()
  if (!p) return { paired: false, installed: false }
  try {
    const st = await p.WatchBridge.status()
    // `activated` false: the link is still starting (right after launch), paired/installed not known yet.
    // `reachable`: the watch app is there right now (open, or running its workout session).
    return { paired: !!st?.paired, installed: !!st?.installed, activated: st?.activated !== false, reachable: !!st?.reachable }
  } catch { return { paired: false, installed: false } }
}
