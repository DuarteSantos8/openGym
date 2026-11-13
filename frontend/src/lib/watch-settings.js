// Settings → Apple Watch (iPhone app only): this phone's choices for its watch, and what the watch
// last said about itself. Per device, in localStorage, never in the profile: a profile signed in on
// two phones may have one watch, or none. The watch gets the choices with every snapshot
// (lib/watch-sync.js, `settings`); it reports back with a watchStatus event.
//
//   enabled      send workouts to the watch at all (off: the watch shows nothing to do)
//   autoShow     a workout started on the phone opens the watch app too (HealthKit's startWatchApp)
//   restHaptics  the wrist taps when a rest is over
//   crown        what the Digital Crown turns first on a set: 'reps' or 'weight' (older watch apps;
//                the watch now edits a value on its own screen, the crown there is that value's)
//   show         what a workout screen shows: clip (the animation), hr, last (last time's sets),
//                kcal (calories, default on), next (the next exercise during a rest), and rest:
//                'ring' or 'plain' (the countdown alone)
//   doubleTap, actionButton  what the watch's Double Tap / Action Button does in a workout: one of
//                GESTURE_ACTIONS' ids (docs/dev/WATCH_GESTURES.md). Default: Double Tap 'skipRest' (a pinch
//                while gripping a bar must not log a set), Action Button 'smart'. Unknown reads as the default.
//   gestureTest  the stamp (ms) of the last "test it" ping; set only by the test button, sent so the watch shows its test.
// Apple Health on the watch is not a choice of its own: it follows the phone's Apple Health switch
// (Settings → Data, lib/health-sync.js), which the watch gets as `settings.health`. An older build's
// `health` field in the stored prefs is left alone and not read.
export const WATCH_PREFS_KEY = 'gym_watch_v1'
export const WATCH_STATUS_KEY = 'gym_watch_status_v1'
// What the Gestures page remembers about the watch: { setup, testOk, seenAt } (see readGestureState).
export const GESTURE_STATE_KEY = 'gym_watch_gesture_v1'
// Whether the phone's watch link last found a Garmin with the openGym app (WatchBridge status
// `garmin`, docs/GARMIN.md). Settings → Modules asks before Watch goes off while one is there.
export const GARMIN_LINK_KEY = 'gym_garmin_link_v1'
export const SHOW_DEFAULTS = Object.freeze({ clip: true, hr: true, last: true, kcal: true, next: true, rest: 'ring' })
// The shared action list (the watch's WatchCore GestureAction has the same ids; the names are in
// lib/watch-gestures.js). `inputs` are where the action may be chosen: Double Tap can only press a
// button that is on screen, so Show metrics and Next exercise (no button of its own) are Action Button
// only. Never Finish, Discard or anything destructive.
const BOTH = Object.freeze(['doubleTap', 'actionButton'])
const BUTTON = Object.freeze(['actionButton'])
export const GESTURE_ACTIONS = Object.freeze([
  { id: 'smart', inputs: BOTH },
  { id: 'logSet', inputs: BOTH },
  { id: 'skipRest', inputs: BOTH },
  { id: 'addRest', inputs: BOTH },
  { id: 'hold', inputs: BOTH },
  { id: 'nextExercise', inputs: BUTTON },
  { id: 'showMetrics', inputs: BUTTON },
  { id: 'none', inputs: BOTH },
].map(a => Object.freeze(a)))
// Watch -> phone events of the test ping and the Action Button.
export const GESTURE_EVENTS = Object.freeze({ testOk: 'gestureTestOk', buttonSeen: 'actionButtonSeen' })
export const gestureChoice = (v, input) => GESTURE_ACTIONS.some(a => a.id === v && a.inputs.includes(input)) ? v : WATCH_DEFAULTS[input]

export const WATCH_DEFAULTS = Object.freeze({ enabled: true, autoShow: true, restHaptics: true, crown: 'reps', doubleTap: 'skipRest', actionButton: 'smart', show: SHOW_DEFAULTS })

const showOf = v => {
  const o = v && typeof v === 'object' ? v : {}
  const out = {}
  for (const k of ['clip', 'hr', 'last', 'kcal', 'next']) out[k] = typeof o[k] === 'boolean' ? o[k] : SHOW_DEFAULTS[k]
  out.rest = o.rest === 'plain' ? 'plain' : 'ring'
  return out
}

const listeners = new Set()
export const onWatchPrefs = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const emit = () => { for (const fn of listeners) { try { fn() } catch { /* a listener's problem */ } } }

const read = (key, storage) => { try { return JSON.parse(storage?.getItem(key) || 'null') } catch { return null } }

export function readWatchPrefs(storage = globalThis.localStorage) {
  const v = read(WATCH_PREFS_KEY, storage) || {}
  return {
    enabled: v.enabled !== false,
    autoShow: v.autoShow !== false,
    restHaptics: v.restHaptics !== false,
    crown: v.crown === 'weight' ? 'weight' : 'reps',
    doubleTap: gestureChoice(v.doubleTap, 'doubleTap'),
    actionButton: gestureChoice(v.actionButton, 'actionButton'),
    ...(v.gestureTest > 0 && Number.isFinite(v.gestureTest) ? { gestureTest: v.gestureTest } : {}),
    show: showOf(v.show),
  }
}

export function writeWatchPrefs(patch, storage = globalThis.localStorage) {
  const cur = readWatchPrefs(storage)
  // `show` is merged one choice at a time: a patch of one switch keeps the others.
  const merged = { ...cur, ...patch, ...(patch && patch.show ? { show: { ...cur.show, ...patch.show } } : {}) }
  const next = readWatchPrefs({ getItem: () => JSON.stringify(merged) })
  try { storage?.setItem(WATCH_PREFS_KEY, JSON.stringify(next)) } catch { /* private mode: for this run */ }
  emit()
  return next
}

/** Whether a Garmin with the openGym app was there the last time the link looked. */
export function readGarminLink(storage = globalThis.localStorage) {
  return read(GARMIN_LINK_KEY, storage) === true
}

export function writeGarminLink(on, storage = globalThis.localStorage) {
  try {
    if (on) storage?.setItem(GARMIN_LINK_KEY, 'true')
    else storage?.removeItem(GARMIN_LINK_KEY)
  } catch { /* private mode: asked again next time */ }
}

/** What the watch said last: { health: 'on'|'off'|'denied', version, at } or null. */
export function readWatchStatus(storage = globalThis.localStorage) {
  const v = read(WATCH_STATUS_KEY, storage)
  return v && typeof v === 'object' ? v : null
}

export function writeWatchStatus(ev, storage = globalThis.localStorage) {
  const health = ['on', 'off', 'denied'].includes(ev?.health) ? ev.health : null
  const next = { health, version: typeof ev?.version === 'string' ? ev.version.slice(0, 20) : null, at: Number(ev?.at) || Date.now() }
  try { storage?.setItem(WATCH_STATUS_KEY, JSON.stringify(next)) } catch { /* shown again next time */ }
  emit()
  return next
}

/** The choices as the watch reads them (WatchCore Model.swift WatchSettings); `health` is the phone's Apple Health switch. */
export const settingsForWatch = (p = readWatchPrefs(), health = false) => ({ health: !!health, restHaptics: p.restHaptics, crown: p.crown, doubleTap: p.doubleTap, actionButton: p.actionButton, ...(p.gestureTest ? { gestureTest: p.gestureTest } : {}), show: { ...p.show } })

/**
 * What the Gestures page knows about this phone's watch, per device like the choices:
 *   setup   the lifter said "I've done this" for the Action Button guide (we cannot check it)
 *   testOk  the stamp of the last test the watch answered (gestureTestOk), 0 for none
 *   seenAt  when an Action Button press last reached openGym (actionButtonSeen), 0 for never
 */
const cleanGestureState = v => {
  const n = x => (Number.isFinite(x) && x > 0 ? x : 0)
  return { setup: v.setup === true, testOk: n(v.testOk), seenAt: n(v.seenAt) }
}

export const readGestureState = (storage = globalThis.localStorage) => cleanGestureState(read(GESTURE_STATE_KEY, storage) || {})

export function writeGestureState(patch, storage = globalThis.localStorage) {
  const next = cleanGestureState({ ...readGestureState(storage), ...patch })
  try { storage?.setItem(GESTURE_STATE_KEY, JSON.stringify(next)) } catch { /* private mode: for this run */ }
  emit()
  return next
}

/** The watch's two gesture events (watch-sync applyEvents). The test answer echoes the stamp it was given; `at` stands in for it. */
export function noteGestureEvent(ev, storage = globalThis.localStorage) {
  if (ev?.type === GESTURE_EVENTS.testOk) {
    const stamp = Number(ev.stamp) > 0 ? Number(ev.stamp) : Number(ev.at)
    if (stamp > 0) writeGestureState({ testOk: Math.max(stamp, readGestureState(storage).testOk) }, storage)
  } else if (ev?.type === GESTURE_EVENTS.buttonSeen) writeGestureState({ seenAt: Number(ev.at) > 0 ? Number(ev.at) : Date.now() }, storage)
}

/**
 * Where the phone and its Apple Watch stand, for Settings → Apple Watch, so every state can say
 * what to do next. `link` is WatchBridge's status ({ activated, paired, installed, reachable }, null
 * while asking), `status` what the watch last said about itself (readWatchStatus).
 *
 *   checking   still asking the phone
 *   starting   the phone's link to the watch is not up yet (right after launch): nothing known
 *   unpaired   no Apple Watch paired with this iPhone
 *   missing    a watch is paired, openGym is not on it
 *   silent     the app is on the watch but has never checked in: it was never opened
 *   live       the watch app is there right now (open, or running a workout)
 *   away       installed and heard from before, not there right now: closed, asleep or out of reach
 */
export function watchLinkState (link, status = null) {
  if (!link) return 'checking'
  if (link.activated === false) return 'starting'
  if (!link.paired) return 'unpaired'
  if (!link.installed) return 'missing'
  if (link.reachable) return 'live'
  return Number(status?.at) > 0 ? 'away' : 'silent'
}
