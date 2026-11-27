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
// Apple Health on the watch is not a choice of its own: it follows the phone's Apple Health switch
// (Settings → Data, lib/health-sync.js), which the watch gets as `settings.health`. An older build's
// `health` field in the stored prefs is left alone and not read.
export const WATCH_PREFS_KEY = 'gym_watch_v1'
export const WATCH_STATUS_KEY = 'gym_watch_status_v1'
// Whether the phone's watch link last found a Garmin or a Huawei watch with the openGym app
// (WatchBridge status `garmin` or `huawei`, docs/GARMIN.md, docs/HUAWEI_WATCH.md; the key's name is
// from when only Garmin had one). Settings → Modules asks before Watch goes off while one is there.
export const GARMIN_LINK_KEY = 'gym_garmin_link_v1'
// Set once a status has found the watch app installed: from then on the Devices sheet names a watch
// that goes missing ("Not found"), where a phone that never had one shows no watch row.
export const WATCH_SEEN_KEY = 'gym_watch_seen_v1'
export const SHOW_DEFAULTS = Object.freeze({ clip: true, hr: true, last: true, kcal: true, next: true, zones: true, rest: 'ring' })
export const WATCH_DEFAULTS = Object.freeze({ enabled: true, autoShow: true, restHaptics: true, crown: 'reps', show: SHOW_DEFAULTS })

const showOf = v => {
  const o = v && typeof v === 'object' ? v : {}
  const out = {}
  for (const k of ['clip', 'hr', 'last', 'kcal', 'next', 'zones']) out[k] = typeof o[k] === 'boolean' ? o[k] : SHOW_DEFAULTS[k]
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

export const readWatchSeen = (storage = globalThis.localStorage) => read(WATCH_SEEN_KEY, storage) === true
export function markWatchSeen(storage = globalThis.localStorage) {
  try { storage?.setItem(WATCH_SEEN_KEY, 'true') } catch { /* seen again next time */ }
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
  // The routines the watch shows (hash of its file, '' for the snapshot's own list; and how many): an older watch app says neither.
  if (typeof ev?.routinesHash === 'string') next.routinesHash = ev.routinesHash.slice(0, 40)
  if (Number.isFinite(ev?.routinesCount)) next.routinesCount = Math.max(0, Math.floor(ev.routinesCount))
  try { storage?.setItem(WATCH_STATUS_KEY, JSON.stringify(next)) } catch { /* shown again next time */ }
  emit()
  return next
}

// The newest thing a watch did that reached this phone (#1151): the time of its newest event that
// was applied here, on the phone's clock (lib/watch-sync.js). Not when the page got round to it,
// which can be much later than when it reached the phone: the time it happened at the wrist, so
// "last heard" never says more recent than it was.
const WATCH_HEARD_KEY = 'gym_watch_heard'
export function readWatchHeard (storage = globalThis.localStorage) {
  const v = Number(read(WATCH_HEARD_KEY, storage))
  return Number.isFinite(v) && v > 0 ? v : 0
}
/** A watch's event made at `at` was applied here: remembered when it is the newest (never in the future). */
export function noteWatchHeard (at, now = Date.now(), storage = globalThis.localStorage) {
  const t = Math.min(Number(at) || 0, now)
  if (!(t > 0) || t <= readWatchHeard(storage)) return
  try { storage?.setItem(WATCH_HEARD_KEY, JSON.stringify(t)) } catch { /* shown again next time */ }
  emit()
}
/** When the watch was last heard from: its status (sent at each launch) or its newest event, whichever is later. */
export const lastHeardAt = (status = readWatchStatus(), storage = globalThis.localStorage) => Math.max(Number(status?.at) || 0, readWatchHeard(storage))

/** The choices as the watch reads them (WatchCore Model.swift WatchSettings); `health` is the phone's Apple Health switch. */
export const settingsForWatch = (p = readWatchPrefs(), health = false) => ({ health: !!health, restHaptics: p.restHaptics, crown: p.crown, show: { ...p.show } })

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

// What the phone last sent the watch as its routines (lib/watch-sync.js): the file's hash and how
// many routines it lists. In memory: the next snapshot sets it again after a launch. No emit():
// the link sends again on onWatchPrefs, so each send would set off the next; the Settings pages
// read it again with every look at the watch (every few seconds).
let routinesSent = null
export const noteRoutinesSent = v => { routinesSent = v }
export const readRoutinesSent = () => routinesSent

/**
 * Whether the watch has the phone's routines, for Settings → Apple Watch. `phone` is what the
 * phone sent (readRoutinesSent), `status` what the watch reported (readWatchStatus).
 *
 *   off      nothing to say: the watch is off, not paired, without the app, or there is nothing to send
 *   unknown  a watch app that does not report its routines (an older one)
 *   synced   it shows the file the phone sent, with all of its routines
 *   sending  anything else: the file is on its way, or the watch has not checked in yet
 */
export function routinesSync ({ link, phone, status, enabled = true }) {
  if (!enabled || !link?.paired || !link.installed || !phone?.hash) return 'off'
  if (status && status.routinesHash === undefined) return 'unknown'
  return status && status.routinesHash === phone.hash && status.routinesCount === phone.count ? 'synced' : 'sending'
}

const CHIP = { synced: 'ok', sending: 'sync', unknown: 'warn', off: 'idle' }
/**
 * The status pill on top of Settings → Apple Watch and → Wear OS watch (components/WatchPill.jsx),
 * from the page's link state (watchLinkState's words) and routinesSync's answer: its tone ('ok',
 * 'busy', 'warn', 'idle'), its one word, and three marks: paired, openGym on the watch, the routines.
 */
export function watchPill (link, routines) {
  const r = CHIP[routines] || 'idle'
  if (link === 'unpaired') return { tone: 'warn', word: 'setup', chips: ['warn', 'idle', 'idle'] }
  if (link === 'missing') return { tone: 'warn', word: 'setup', chips: ['ok', 'warn', 'idle'] }
  if (link === 'away' || link === 'silent') return { tone: 'warn', word: 'away', chips: ['ok', 'ok', r] }
  if (link !== 'live') return { tone: 'idle', word: 'checking', chips: ['idle', 'idle', 'idle'] }
  if (routines === 'unknown') return { tone: 'warn', word: 'update', chips: ['ok', 'ok', 'warn'] }
  if (routines === 'sending') return { tone: 'busy', word: 'syncing', chips: ['ok', 'ok', 'sync'] }
  return { tone: 'ok', word: 'connected', chips: ['ok', 'ok', r] }
}
