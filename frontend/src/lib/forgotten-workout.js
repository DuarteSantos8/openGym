// Settings → Workout → Forgotten workouts (1.4.5): a workout left running after the gym.
//
// One decision, made here and followed by every screen that can ask: the phone (an in-app card and
// a local notification with Keep going / Finish), the Apple Watch (WatchCore Idle) and Wear OS
// (WatchLogic.kt Idle), which get the choices below in their snapshot (lib/watch-sync.js,
// settings.forgotten) and the gym leave as workout.leftGymAt.
//
//   quiet for `askMin` minutes   "Still training?"  Keep going / Finish
//   left the gym (geofence)      "Looks like you left the gym"  Finish now / Keep going / Discard,
//                                at once, whatever the clock says (only with the gym reminder set
//                                up on this phone and "End by itself when I leave the gym" on)
//   nobody answers for `graceMin` it finishes by itself. Never discards: a forgotten workout is a
//                                real one, and Reopen brings it back for 24 hours.
//
// A rest or a hold running is a workout going on, however long. The end that is saved is the last
// logged set plus its usual rest, never "now": a workout ended by itself an hour later still reads
// as the 52 minutes it was (sessionEnd does the reach of the sets; the rest is added here).
//
// Times in ms. The choices are this device's (localStorage), like the gym reminder they lean on:
// the places only exist on this phone, and a laptop has no business ending a phone's workout.
import { sessionEnd } from './finish-workout.js'
import { hasCompletedWork } from './workout-model.js'

export const FORGOTTEN_KEY = 'gym_forgotten_v1'
// What the phone remembers about the workout running now: when it last asked, a "Keep going",
// when the phone left the gym. Gone with the workout.
export const FORGOTTEN_STATE_KEY = 'gym_forgotten_state_v1'
// Reopen: the workout as it was before it ended by itself, for 24 hours, this device only.
export const REOPEN_KEY = 'gym_reopen_v1'
export const REOPEN_MS = 24 * 3600 * 1000

export const ASK_CHOICES = Object.freeze([30, 45, 60, 90, 0])
export const GRACE_CHOICES = Object.freeze([2, 5, 10])
export const FORGOTTEN_DEFAULTS = Object.freeze({ askMin: 45, graceMin: 5, leaveGym: null })
// A rest nobody set: the app's own default.
const DEFAULT_REST_SEC = 90
const MIN = 60 * 1000

// Told whenever a choice or the running workout's leave changes: the watches get a new snapshot.
const listeners = new Set()
export const onForgottenChange = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const emit = () => { for (const fn of listeners) { try { fn() } catch { /* a listener's problem */ } } }

/** Whether the gym reminder is on on this device (lib/gym-reminder.js keeps only that flag here). */
export function gymReminderOn(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem('gym_reminder_v1') || 'null')?.on === true } catch { return false }
}

const read = (key, storage) => { try { return JSON.parse(storage?.getItem(key) || 'null') } catch { return null } }
const write = (key, v, storage) => { try { if (v == null) storage?.removeItem(key); else storage?.setItem(key, JSON.stringify(v)) } catch { /* private mode: for this run */ } }
const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)

/** This device's choices. `leaveGym` null: on exactly when the gym reminder is set up here. */
export function readForgottenPrefs(storage = globalThis.localStorage) {
  const v = read(FORGOTTEN_KEY, storage) || {}
  return {
    askMin: ASK_CHOICES.includes(v.askMin) ? v.askMin : FORGOTTEN_DEFAULTS.askMin,
    graceMin: GRACE_CHOICES.includes(v.graceMin) ? v.graceMin : FORGOTTEN_DEFAULTS.graceMin,
    leaveGym: typeof v.leaveGym === 'boolean' ? v.leaveGym : null,
  }
}

export function writeForgottenPrefs(patch, storage = globalThis.localStorage) {
  const next = readForgottenPrefs({ getItem: () => JSON.stringify({ ...readForgottenPrefs(storage), ...patch }) })
  write(FORGOTTEN_KEY, next, storage)
  emit()
  return next
}

/** Whether a gym leave ends the workout: the switch, or with no choice made, the gym reminder. */
export const leaveGymOn = (prefs, gymReminderOn) => (prefs?.leaveGym == null ? !!gymReminderOn : prefs.leaveGym) && !!gymReminderOn

/** For the watches (snapshot settings.forgotten): minutes, 0 = never asks. */
export const forgottenForWatch = (prefs = readForgottenPrefs(), gymReminderOn = false) =>
  ({ askMin: prefs.askMin, graceMin: prefs.graceMin, leaveGym: leaveGymOn(prefs, gymReminderOn) })

/* ---------- the workout ---------- */

const ticked = s => !!s && (hasCompletedWork(s) || s.sides?.L?.done || s.sides?.R?.done)

/** The newest logged set (one side of a per-side set counts) and its exercise, or null. */
export function lastSetOf(A) {
  let best = null
  for (const e of A?.entries || []) for (const s of e?.sets || []) {
    const at = num(s?.at)
    if (at && ticked(s) && (!best || at > best.at)) best = { at, entry: e, set: s }
  }
  return best
}

/** The rest that would have followed that set: its own, its exercise's, the app's. */
export function usualRestSec(last, restSec = DEFAULT_REST_SEC) {
  const own = num(last?.set?.rest) || num(last?.entry?.target?.restSec) || num(last?.entry?.restSec)
  if (own) return own
  if (last?.entry?.target?.restOff) return 0
  return restSec > 0 ? restSec : 0
}

/**
 * What idle time counts from: the last set, the start, the phone used in the workout
 * (`activeAt`: a tick, an edit, the app opened on it), a "Keep going" answered (`snoozeAt`).
 */
export function idleSince(A, { activeAt = 0, snoozeAt = 0 } = {}) {
  return Math.max(lastSetOf(A)?.at || 0, num(A?.start), num(activeAt), num(snoozeAt))
}

/** When a workout that ended by itself really ended: the reach of its sets plus the usual rest. */
export function honestEnd(A, { restSec = DEFAULT_REST_SEC, now = Date.now() } = {}) {
  const last = lastSetOf(A)
  // Nothing logged: it ended where it began (or where it was last touched, if later).
  if (!last) return Math.min(now, Math.max(num(A?.start), 0) || now)
  // The reach of the run of sets (a cardio row's own minutes included), however long ago.
  const reach = sessionEnd(A, Number.MAX_SAFE_INTEGER)
  return Math.min(now, Math.max(reach, last.at) + usualRestSec(last, restSec) * 1000)
}

/**
 * The decision, for `now`. Returns { state, reason?, deadline?, askAt?, endAt? }:
 *   none     no workout to look after (none running, a saved one being edited, a past one logged)
 *   active   nothing to ask; `askAt` says when the question would come (for a notification)
 *   ask      "Still training?"   (reason 'idle')
 *   left     "Looks like you left the gym"  (reason 'left')
 *   end      nobody answered: finish now, saved as ending at `endAt`
 * `askedAt`: when this device (or its notification) first put the question; until then the grace
 * has not started, so a phone that was in a drawer never ends a workout it never asked about,
 * unless its notification went out (the caller passes the notification's time then).
 * `leftAt`: when the phone left the gym, if it did during this workout. `resting`: a rest or a
 * hold is counting down.
 */
export function decideForgotten({ A, now = Date.now(), prefs = FORGOTTEN_DEFAULTS, leaveGym = false,
  leftAt = 0, askedAt = 0, snoozeAt = 0, activeAt = 0, resting = false, restSec = DEFAULT_REST_SEC } = {}) {
  if (!A || A.editingWorkoutId || A.backfill) return { state: 'none' }
  // Paused on purpose (lib/workout-pause.js): not forgotten.
  if (num(A.pausedAt)) return { state: 'active' }
  if (resting) return { state: 'active' }
  const since = idleSince(A, { activeAt, snoozeAt })
  const grace = (GRACE_CHOICES.includes(prefs?.graceMin) ? prefs.graceMin : FORGOTTEN_DEFAULTS.graceMin) * MIN
  const end = reason => ({ state: 'end', reason, endAt: honestEnd(A, { restSec, now }) })
  // Left the gym after the last thing that counts: asked at once, ends after the grace.
  const left = num(leftAt)
  if (leaveGym && left && left > since) {
    const deadline = left + grace
    return now >= deadline ? end('left') : { state: 'left', reason: 'left', deadline }
  }
  const askMin = ASK_CHOICES.includes(prefs?.askMin) ? prefs.askMin : FORGOTTEN_DEFAULTS.askMin
  if (!askMin) return { state: 'active' }
  const askAt = since + askMin * MIN
  if (now < askAt) return { state: 'active', askAt }
  // Asked before the last thing that counts is a question already answered.
  const asked = num(askedAt) >= askAt ? num(askedAt) : 0
  if (!asked) return { state: 'ask', reason: 'idle', askAt, deadline: now + grace, askNow: true }
  const deadline = asked + grace
  return now >= deadline ? end('idle') : { state: 'ask', reason: 'idle', askAt, deadline }
}

/* ---------- what the phone remembers while a workout runs ---------- */

/**
 * { wid, askedAt, snoozeAt, leftAt, notifyAt }, only for workout `wid` (another workout starts
 * clean). `notifyAt`: when the planned "Still training?" notification goes out.
 */
export function readForgottenState(wid, storage = globalThis.localStorage) {
  const v = read(FORGOTTEN_STATE_KEY, storage)
  if (!wid || !v || v.wid !== wid) return { wid: wid || null, askedAt: 0, snoozeAt: 0, leftAt: 0, notifyAt: 0 }
  return { wid, askedAt: num(v.askedAt), snoozeAt: num(v.snoozeAt), leftAt: num(v.leftAt), notifyAt: num(v.notifyAt) }
}

export function writeForgottenState(wid, patch, storage = globalThis.localStorage) {
  if (!wid) { write(FORGOTTEN_STATE_KEY, null, storage); return null }
  const before = readForgottenState(wid, storage)
  const next = { ...before, ...patch, wid }
  write(FORGOTTEN_STATE_KEY, next, storage)
  if (next.leftAt !== before.leftAt) emit()
  return next
}

/** "Keep going": idle counts from now, the question and a gym leave are answered. */
export const keepGoingPatch = (now = Date.now()) => ({ snoozeAt: now, askedAt: 0 })

/* ---------- Reopen (24 hours) ---------- */

/**
 * What Reopen needs, taken just before a workout ends by itself: the running workout as it was,
 * the best weights its finish may raise, and the session targets it may use up. Kept on this
 * device, where the finish happened.
 */
export function reopenRecord(st, A, w, { now = Date.now(), reason = 'idle' } = {}) {
  const ids = [...new Set((A?.entries || []).map(e => e?.id).filter(id => id != null))]
  const exWeights = {}
  for (const id of ids) exWeights[id] = st?.exWeights?.[id] ? { ...st.exWeights[id] } : null
  return {
    wid: w?.id ?? A?.id ?? null,
    reason,
    at: now,
    until: now + REOPEN_MS,
    active: JSON.parse(JSON.stringify(A)),
    exWeights,
    sessionTargets: st?.sessionTargets === undefined ? undefined : JSON.parse(JSON.stringify(st.sessionTargets ?? null)),
  }
}

export const saveReopen = (rec, storage = globalThis.localStorage) => write(REOPEN_KEY, rec, storage)

export function readReopen(storage = globalThis.localStorage, now = Date.now()) {
  const r = read(REOPEN_KEY, storage)
  if (!r || !r.wid || !r.active || !(num(r.until) > now)) return null
  return r
}

/** Whether saved workout `w` can still be reopened here. */
export const canReopen = (w, rec, now = Date.now()) =>
  !!w && !!rec && rec.wid != null && rec.wid === w.id && num(rec.until) > now

/**
 * Undoes the finish on the store's draft `s`: the saved workout goes, the running one comes back
 * (with idle counted from now), and the best weights its finish raised go back to what they were
 * unless they moved since for another reason (a later workout's). Returns false when there is
 * nothing to undo (another workout runs now, or the saved one is gone or was edited elsewhere).
 */
export function applyReopen(s, rec, now = Date.now()) {
  if (!rec || s.active) return false
  const w = (s.workouts || []).find(x => x.id === rec.wid)
  if (!w) return false
  s.workouts = s.workouts.filter(x => x !== w)
  for (const [id, prev] of Object.entries(rec.exWeights || {})) {
    const cur = s.exWeights?.[id]
    // Raised by this workout's finish: its day. Anything else is left alone.
    if (cur && cur.d === w.d) { if (prev) s.exWeights[id] = prev; else delete s.exWeights[id] }
  }
  if (rec.sessionTargets !== undefined) s.sessionTargets = rec.sessionTargets
  s.active = { ...rec.active, reopenedAt: now }
  return true
}
