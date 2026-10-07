import { create } from 'zustand'
import { api, setRemoteAuth } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { rememberDefaultLang } from '../lib/default-lang.js'
import { guestAllowed } from '../lib/guest.js'
import { MOBILE, initReminderSync, nativeLoad, nativeSave, onAppActive, readJsonFile, syncReminder, writeAutoBackup, writeJsonFile } from '../lib/mobile.js'
import { mergeStates, localExtras, stampRoutines, stampCustomEx, inUnitOf, keepReset, resetIdsOf, mergeResetIds, entryKey } from '../lib/sync-merge.js'
import { convertStateUnit } from '../lib/units.js'
import { pendingRefCount, settleMedia, loadPending } from '../lib/media-owed.js'
import { referencedHashes } from '../lib/media-refs.js'
import { mediaStore, mediaStoreInUse } from '../lib/media-store.js'
import { countChanges, syncFingerprint } from '../lib/sync-changes.js'
import { saveWorkoutEdit, deleteEditedWorkout } from '../lib/session-edit.js'
import { appBase } from '../lib/app-base.js'
import { linkTokenFromSearch, stripLinkFromUrl } from '../lib/device-link.js'
import { loadRemote, chooseLocal, forgetRemote, connect, normalizeServerUrl, renewToken } from '../lib/remote.js'
import { loadCoachDevice, saveCoachDevice, coachDeviceSettings } from '../lib/coach-device.js'
import { RTL_LANGS } from '../lib/i18n-core.js'
import { DEFAULT_TEMPLATE_ID } from '../lib/structuralBalanceTemplates.js'

import { WC_DEFAULT } from '../lib/workout-controls.js'

const KEY = 'gym_state_v1'
// Where the saved copy stands with the server: the revision it descends from, and its own `_ts`
// at that moment. `rev` goes back to the server as `baseRev` on every push, so a write over a
// document this device never saw is refused (409) instead of dropping another device's work;
// `ts` tells a pull whether anything changed here since. Each tab keeps its own in memory (`meta`
// in the store); this marker is written beside the saved copy for whichever tab loads it next.
// See pushState/pullState.
const SYNC_KEY = 'gym_sync'
const DIRTY_KEY = 'gym_dirty'          // the saved copy owes the server a change
const SYNCED_AT_KEY = 'gym_synced_at'  // when this device and the server last held the same copy
const SYNCED_FP_KEY = 'gym_synced_fp'  // a fingerprint of that copy (lib/sync-changes.js)
// Changes a forced sign-out or disconnect kept on this device, by server and account, until it
// reaches that server as that account again. On a phone also a file beside the state mirror.
const STASH_KEY = 'gym_stash'
const STASH_FILE = 'opengym-stash.json'
// A browser sign-out whose request never reached the server. The session cookie is HttpOnly, so
// only the server's answer to /api/logout takes it out of the browser; until that answer comes,
// boot sends the logout again instead of asking /api/me, which would sign the browser straight
// back in with no passkey or password. Any sign-in replaces the cookie and clears the mark.
const LOGOUT_OWED_KEY = 'gym_logout_owed'
// A sign-in (or a phone's pairing) whose question about this device's own entries has not been
// answered yet (adoptProfile): { uid, rejoined, alwaysAsk }. Until it is, nothing syncs — the copy
// on this device may still be a guest's, and a pull or push in that window used to send it over the
// account's profile (QA, v1.3.9: a phone's one workout replaced the twelve on the server while the
// question was open). Kept in storage so an app killed with the question open asks it again on
// the next start instead of pushing the copy it still holds.
const ADOPT_KEY = 'gym_adopt'
// Reads the mark with no argument, sets or clears it with one. Storage that cannot be read owes nothing.
function logoutOwed(on) {
  try {
    if (on === undefined) return localStorage.getItem(LOGOUT_OWED_KEY) === '1'
    if (on) localStorage.setItem(LOGOUT_OWED_KEY, '1'); else localStorage.removeItem(LOGOUT_OWED_KEY)
  } catch { /* private mode with storage blocked */ }
  return false
}
// Mobile build: whose copy the file mirror (lib/mobile.js, opengym-state.json) holds, and which
// one — { owner, ts }, written after it (saveMirror). A device fact, so never inside S.
const MIRROR_OWNER_FILE = 'opengym-state-owner.json'
const CHECK_MIN_MS = 3000    // rev checks closer together than this are the same event (focus + visibility)
const POLL_MS = 30000        // while the app is open and signed in, ask the server for its revision this often
const AUTO_BACKUP_SOON_MS = 2000   // several photos picked at once make one backup
// Whether `next` has a workout photo or video that `prev` had on none of its workouts.
const workoutMediaHashes = S => (Array.isArray(S?.workouts) ? S.workouts : [])
  .flatMap(w => (Array.isArray(w?.media) ? w.media.map(m => m?.hash).filter(h => typeof h === 'string' && h) : []))
const gainedWorkoutMedia = (prev, next) => {
  const had = new Set(workoutMediaHashes(prev))
  return workoutMediaHashes(next).some(h => !had.has(h))
}
export const DEF = {
  unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, soundOnSilent: false, timerFlash: false, timedSetOvertime: false, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // Stats activity heatmap metric. Profiles without this key continue to open on time.
  heatmapMetric: 'time',
  // How the active workout is laid out — 'cards' (one exercise at a time with Prev/Next),
  // 'list' (every exercise stacked and scrollable) or 'compact' (that stack stripped to just
  // names and set rows — no media, tags, notes, last-time or progression line). Purely
  // presentational: profiles written before this setting existed overlay onto DEF and keep the
  // 'cards' behaviour. beginWorkout copies the value onto s.active, so the header ⋮ menu can
  // override it for the running session without touching this saved default.
  workoutView: 'cards',
  // Which controls the workout screen shows besides the sets themselves. The default is the
  // lean layout: one "more" button per exercise and a menu on each set number. Every switch
  // brings one of the old always-visible button groups back (Settings → During a workout).
  wc: { ...WC_DEFAULT },
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null, autoBackup: false,
  // Equipment profiles (issue: filter Library/picker/routines by what you actually own —
  // e.g. "Home" vs "Gym" — building on the session-only equipment filter from issue #6).
  equipProfiles: [], activeEquipId: null, equipFilterOn: false,
  // Standing per-exercise notes, keyed by exercise id: the gym-specific facts that are true
  // every time you do the movement ("seat 4, pin 7"). Distinct from a routine's `note`, which
  // belongs to one exercise in one plan, and from a session note, which belongs to one day.
  exNotes: {},
  // Favourite exercise ids (issue #6) — sorted to the top of the picker/Library. Personal, so
  // it syncs with the profile but is never part of a shared plan bundle (lib/favourites.js).
  favEx: [],
  // First day of the week as a getDay() index — 1 Monday, 0 Sunday. Monday is the default so
  // every profile written before this setting existed keeps the week it has been looking at.
  // See lib/format.js: nothing reads this field directly, everything goes through the helpers.
  weekStart: 1,
  // Decimals on displayed weights: 1 by default, 2 for anyone loading quarter plates or
  // microplates (issue #139). Display only — nothing is stored or rounded differently.
  wdec: 1,
  // Cardio speed shown in 'kmh' or 'mph'. null follows the weight unit (lb reads mph). Display
  // only as well: every speed is stored in km/h (lib/speed.js).
  speedUnit: null,
  // Per-exercise bar weight overrides, keyed by exercise id, in the profile unit (see
  // lib/bar.js). Personal equipment, so it syncs with the account but never travels in a
  // shared plan. Logged weights stay the total — this only feeds the plate math.
  barWeights: {},
  // Plate inventory, per unit: { lb: { 45: 1, 35: 1, …, _ts }, kg: { … } } — pairs of each size
  // you own (lib/plates.js), stamped with when the list was last changed so a sync keeps the
  // later one (lib/sync-merge.js). Kept per unit: a 45 lb plate is not a 20.4 kg one, so a unit
  // switch shows the other unit's inventory instead of converting this one. Absent for a unit,
  // or a list with no sizes = the standard set, plenty of each. Display only, like barWeights.
  plates: {},
  // How an exercise is plate-loaded when the equipment does not say, keyed by exercise id:
  // { kind: 'pairs' | 'single' | 'none' | null, _ts } (lib/plates.js loadKindFor). A plate-loaded
  // leg press is 'single'; a barbell you never load plates on is 'none'. Absent or null = derived
  // from the equipment. Stamped like the plate list, for the same reason.
  loadKind: {},
  // Whether the body-weight summary card is shown on Home. Off only hides that card: existing
  // entries, Stats, imports and the separate pre-workout weigh-in flow keep working.
  // Defaults on; an older profile without the key reads as on (`!== false`).
  showWeightCard: true,
  // Whether Start opens the quick weigh-in first (sheets.jsx startFlow, issue #137). Off starts
  // the session straight away; weight can still be logged from Home/Stats. Defaults on; an
  // older profile without the key reads as on (`!== false`).
  weighIn: true,
  // Where a planned session's reps come from (Settings → During a workout, lib/session-start.js):
  // 'plan' opens at the routine's own sets × reps and lets history and progression decide the
  // weight; 'last' carries the reps over from the last session, the way it always worked before.
  // Absent reads as 'plan' too, which is what the MCP bridge sees on a raw state file.
  startFrom: 'plan',
  // Per-language choice for translated exercise names: whether the original English name is
  // shown in parentheses next to the translation. Map { '<lang>': boolean }; a missing key
  // (any profile written before this setting existed) reads as shown.
  enParens: {},
  // Per-language choice for translated exercise names: whether the translation is replaced
  // entirely by the original English name. Independent of enParens and keyed by the same base
  // language, so e.g. Italian can keep its parens while German pins names to English. Map
  // { '<lang>': boolean }; a missing key reads as off (translation shown as usual).
  enOnly: {},
  // What the line under an exercise holds today's rows against (#173, views/Workout.jsx): 'last'
  // is the last time in that routine, 'best' the best set of the exercise ever logged. Tapping
  // the line switches it. Absent reads as 'last', the line as it always was.
  logRef: 'last',
  // Structural Balance (views/StructuralBalance.jsx): which built-in ratio template is active,
  // and per-role exercise overrides keyed by `${templateId}:${roleId}` — see
  // lib/structuralBalance.js's overrideKey(). An override (`{ id, _ts }`, `id: null` once
  // cleared) replaces that role's curated exercise-id whitelist with a single user-chosen
  // exercise id; the stamp is what lets a sync keep the choice made last (lib/sync-merge.js).
  balanceTemplate: DEFAULT_TEMPLATE_ID, balanceOverrides: {},
}
const clone = o => JSON.parse(JSON.stringify(o))

// First run on a device whose language renders right-to-left starts in that language
// rather than English; the boot script in index.html mirrors this check for the
// pre-paint direction. The choice is persisted like any other setting once the user
// picks a language.
const detectedLang = () => {
  try {
    const base = (navigator.language || '').toLowerCase().split('-')[0]
    if (RTL_LANGS.has(base)) return base
  } catch (e) { /* ignore */ }
  return 'en'
}

// A copy started from nothing on this device. `langAuto` marks its language as one nobody has
// picked yet, so the instance's DEFAULT_LANG or the browser's language may set it
// (lib/default-lang.js, #303); picking one in Settings clears it. DEF does not carry the mark:
// merged under a saved copy it would claim that every existing profile never chose.
export function freshState() {
  const s = clone(DEF)
  s.lang = detectedLang()
  s.langAuto = true
  return s
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      const s = Object.assign(clone(DEF), saved)
      if (!saved.lang) s.lang = detectedLang()
      return s
    }
  } catch (e) { /* ignore */ }
  return freshState()
}

// Whether a copy holds anything of its own worth keeping over another: workouts, routines,
// weigh-ins and custom exercises. A custom exercise is all a new guest may have made — with its
// photo or video, which the server counts as unreferenced until the state that names it lands —
// so a profile created from such a copy takes it at once, like one holding a workout.
const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length || (st.customEx || []).length)

// Decide whether a pulled account state may replace the local saved state. A local active workout
// is deliberately carried forward: the server stores completed/saved state, while the in-progress
// session belongs to the device that is currently running it.
export function restoredStateFor(local, remote, dirty = false) {
  if (!remote || (hasData(local) && (dirty || (remote._ts || 0) < (local._ts || 0)))) return null
  const next = Object.assign(clone(DEF), remote)
  if (local.active) next.active = local.active
  return next
}

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null
  let toldTooLarge = false
  let toldNoRoom = false   // the save itself was refused — said once per streak, like the above
  let pushing = null       // the PUT in flight, so a second push waits for it instead of racing it
  let pushAgain = false    // a push asked for while one was in flight — run once more after it
  let pulling = null       // the GET in flight, so two resume signals make one request
  let configFetch = null   // the /api/config in flight, so two callers make one request
  let pushPending = false  // a change made before boot's pull — pushed once boot is through
  let forceNext = false    // the next push replaces the server copy outright (import, reset)
  let lastCheck = 0
  let pollTm = null
  let offlineChanges = false   // a push failed for lack of network — the next one that lands says so
  let backupTm = null      // phone: the auto-backup after workout media changed, on its debounce
  let adoptHold = false    // a sign-in's adoption has not decided yet: no pull, no push (ADOPT_KEY)
  let adopting = null      // the adoptProfile in flight
  let rejoined = false     // the account signing in is the one this copy already belongs to (setUser)
  let pairedBase = null    // mobile build: the address of the paired server, while there is one
  let fpOf = null          // the copy the stored fingerprint was last taken of (confirmed)
  let keeping = null       // phone: the file write of what keepForPrevious set aside, until it lands
  let mirrorQ = Promise.resolve()   // phone: the file mirror's writes, one after the other (saveMirror)

  const readAdopt = () => { try { return JSON.parse(localStorage.getItem(ADOPT_KEY)) || null } catch { return null } }
  const writeAdopt = v => { try { if (v) localStorage.setItem(ADOPT_KEY, JSON.stringify(v)); else localStorage.removeItem(ADOPT_KEY) } catch { /* the hold in memory still stands */ } }
  // The adoption owed by the account signed in now, if there is one.
  const adoptOwed = () => { const m = readAdopt(); const u = get()?.user; return m && u && m.uid === u.id ? m : null }
  // Sync held or not, and the screens told (`sync.held`, status 'held').
  const setHold = on => { adoptHold = on; if (get()?.sync) setSync({ held: on }) }
  // The question is answered: sync as usual from here.
  const releaseAdopt = () => { setHold(false); writeAdopt(null) }
  const readStoredSync = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null } catch { return null } }
  const storedOwed = () => { try { return localStorage.getItem(DIRTY_KEY) === '1' } catch { return false } }

  /* Where the copy in memory stands with the server: the revision it descends from (`base`, as
     { rev, ts }) and whether it owes the server a change (`owed`). Both belong to the copy, per
     tab. The marker and the dirty flag in localStorage are shared by every tab of the browser:
     a tab left open used to quote the revision ANOTHER tab had just synced, so the server saw a
     current baseRev, took the stale copy without a 409, and the workout logged in the other tab
     was gone (#283); and a tab that owed nothing read another tab's failed push as its own,
     merged where it should have adopted, and brought back what the other tab had just deleted.
     Every copy this store puts in place records where it stands; storage is only where a copy
     loaded fresh (a new tab, a reload) learns it, which is why persist writes them beside it.
     A copy set on the store directly, not through persist, has nothing recorded yet: it takes
     what storage says the first time it is asked, and keeps that. */
  const meta = new WeakMap()
  const metaOf = (S = get().S) => {
    let m = meta.get(S)
    if (!m) { m = { base: readStoredSync(), owed: storedOwed() }; meta.set(S, m) }
    return m
  }
  const saveMarker = base => {
    try {
      if (!base) { localStorage.removeItem(SYNC_KEY); return }
      const v = JSON.stringify(base)
      // Unchanged, it is not written again: other tabs react to this key moving (see below).
      if (localStorage.getItem(SYNC_KEY) !== v) localStorage.setItem(SYNC_KEY, v)
    } catch { /* storage refused — the copy in memory still knows */ }
  }
  const saveOwed = owed => { try { if (owed) localStorage.setItem(DIRTY_KEY, '1'); else localStorage.removeItem(DIRTY_KEY) } catch { /* as above */ } }
  const writeSync = (rev, ts) => {
    const base = { rev, ts: ts || 0 }
    meta.set(get().S, { ...metaOf(), base })
    saveMarker(base)
  }
  const dropSync = () => { meta.set(get().S, { ...metaOf(), base: null }); saveMarker(null) }
  const markOwed = owed => { meta.set(get().S, { ...metaOf(), owed }); saveOwed(owed) }
  // Whether anything here is still on its way to the server: a push that failed, one waiting in
  // the debounce or in flight, a change made while boot was pulling, or a copy changed since the
  // revision it descends from.
  const localChanged = (S = get().S) => { const { base } = metaOf(S); return !!base && (S._ts || 0) > (base.ts || 0) }
  const owes = () => metaOf().owed || pushPending || pushTm !== null || !!pushing || localChanged()

  /* The connection as the screens show it (components/SyncBanner.jsx, Settings). The flags are set
     where each outcome is known; `status` is derived from them here, once, so no screen has to
     rank them:
       'local'   no server: a phone in local mode, a guest, nobody signed in
       'auth'    the server refuses this device (a 401), or the phone has lost its pairing
       'offline' the server could not be reached at all (no network, DNS, a timeout)
       'error'   it answered with a failure: 5xx, 403, 413, a page that is not openGym's
       'held'    signed in, but the question about this device's own entries is still open
       'pending' reachable, and a change is still waiting to reach it
       'ok'      this device holds what the server holds
     `pending`: a change is owed and the last attempt did not land. `lastSynced`: when this device
     and the server last held the same copy. `lastError`: { status, code } of the failure behind
     'auth', 'offline' or 'error' (status 0 without an HTTP answer). `server`: the base URL this
     device syncs with, or null on a phone that has none. */
  // 'held': a sign-in's question about this device's own entries is still open (adoptProfile), and
  // nothing syncs until it is answered — said after a failed connection, which is why it is held.
  const statusOf = (x, user) => x.auth ? 'auth' : !user ? 'local' : x.offline ? 'offline' : x.lastError ? 'error' : x.held ? 'held' : x.pending ? 'pending' : 'ok'
  const sameError = (a, b) => (a && b ? a.status === b.status && a.code === b.code : a === b)
  const setSync = patch => {
    const cur = get().sync
    const next = { ...cur, ...patch }
    next.status = statusOf(next, get().user)
    if (Object.keys(next).some(k => (k === 'lastError' ? !sameError(next[k], cur[k]) : next[k] !== cur[k]))) set({ sync: next })
  }
  const isNetworkError = e => e && e.status == null   // fetch itself failed, or gave up: no response at all
  const refused = e => e?.status === 401 || e?.code === 'not-paired'
  // The server answered: whatever was wrong with the connection is over.
  const reached = (extra = {}) => setSync({ offline: false, auth: false, lastError: null, ...extra })
  // What a failed request says about the connection. A refused token and a phone without a
  // pairing are the same thing to the person holding it — the device has to be paired or signed
  // in again, and nothing on it is lost meanwhile.
  const failed = (e, extra = {}) => {
    const lastError = { status: e?.status ?? 0, code: e?.code || (e?.status === 401 ? 'auth' : isNetworkError(e) ? 'network' : 'http') }
    if (refused(e)) setSync({ auth: true, offline: false, lastError, ...extra })
    else if (isNetworkError(e)) setSync({ offline: true, lastError, ...extra })
    else setSync({ offline: false, lastError, ...extra })
  }
  // This device and the server hold the same copy: a push landed, a pull adopted, or a check found
  // that nothing moved on either side. The fingerprint is what signing out counts changes against.
  const confirmed = S => {
    const at = Date.now()
    try {
      localStorage.setItem(SYNCED_AT_KEY, String(at))
      if (fpOf !== S) { localStorage.setItem(SYNCED_FP_KEY, JSON.stringify(syncFingerprint(S))); fpOf = S }
    } catch { /* storage refused — only the count is lost */ }
    reached({ pending: false, lastSynced: at })
  }
  const readFingerprint = () => { try { return JSON.parse(localStorage.getItem(SYNCED_FP_KEY)) } catch { return null } }

  // The server this device syncs with: the paired address on a phone, the page's own origin and
  // subpath (#238) in a browser. null on a phone without one — local mode, or a pairing lost
  // under an earlier version, which kept no address.
  const serverBase = () => {
    if (MOBILE) return pairedBase
    try { return location.origin && location.origin !== 'null' ? location.origin + appBase().replace(/\/$/, '') : null } catch { return null }
  }

  initReminderSync(() => get().S)

  // Mobile build: the file mirror, and beside it whose copy it is and which one (its `_ts`) —
  // restoreFromMirror takes the file back only for that account, and only while the two agree,
  // so a mirror write that failed, or a kill between the two writes, leaves a file that is never
  // taken. One write at a time, each of the copy in the store when its turn comes: a slow write
  // can never land after a later one.
  const saveMirror = () => (mirrorQ = mirrorQ.then(async () => {
    const S = get().S
    let owner = null
    try { owner = localStorage.getItem('gym_owner') } catch { /* unknown — the file is then nobody's */ }
    await nativeSave(S)
    await writeJsonFile(MIRROR_OWNER_FILE, { owner, ts: S._ts || 0 })
  }).catch(() => {}))
  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  // `now` skips the wait and returns the write, for a copy that replaced the last one wholesale.
  const nativePersist = (now = false) => {
    clearTimeout(saveTm)
    saveTm = null
    const write = () => { saveTm = null; syncReminder(get().S); return saveMirror() }
    if (now) return write()
    saveTm = setTimeout(write, 800)
    return null
  }

  // `_ts` is when this device last changed the data — it decides which copy wins on the next
  // pull (restoredStateFor). A copy merely adopted from the server or the file mirror keeps the
  // stamp it came with: re-stamping a read would make an unchanged copy look newer than a real
  // change made on another device, and push it over that change. A change is never stamped
  // before the revision it builds on: that stamp came from the clock of whichever device wrote
  // it, and with this clock behind, the change looked older than its own base — unchanged — and
  // a pull replaced it with the server's copy.
  const persist = (S, push = true, stamp = true) => {
    const { base, owed } = metaOf()   // the copy being replaced; the new one stands where it stood
    if (stamp) S._ts = Math.max(Date.now(), (base?.ts || 0) + 1)
    registerCustom(S.customEx)
    // A refused write used to take the change with it — Finish looked like it simply did
    // nothing. The copy is kept in memory either way and marked as owed to the server, so a
    // signed-in device still gets it there; and it is said out loud once, because a change that
    // is not on the device is the one thing the screen cannot show on its own.
    let saved = true
    try {
      // The marker goes first: a tab that loads the copy in between gets an older base than the
      // copy's, which costs one merge at worst — never a newer one, which would lose data.
      saveMarker(base)
      localStorage.setItem(KEY, JSON.stringify(S))
      toldNoRoom = false
    } catch (e) {
      saved = false
      if (!toldNoRoom) {
        toldNoRoom = true
        import('./useUI.js')
          .then(({ useUI }) => useUI.getState().toast(t('This device is out of storage: the change is not saved on it. Signed in, it still goes to the server.')))
          .catch(() => {})
      }
    }
    meta.set(S, { base, owed: owed || !saved })
    if (!saved) saveOwed(true)
    set({ S })
    // A copy that replaces the last one wholesale and keeps an older stamp — adopted from the
    // server — goes to the file at once. Until it does, the file holds the copy it replaced,
    // which looks newer, and a start in between would take that one back (restoreFromMirror).
    if (MOBILE) nativePersist(!stamp)
    if (push && get().user) {
      // Before boot has pulled, the copy in hand may be older than the server's: a push now
      // would carry it with a stale (or no) baseRev. It waits for finishBoot.
      if (!get().ready) { pushPending = true; return }
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }
  // Boot's last step: from here on changes push, and one made during boot goes now.
  const finishBoot = (extra = {}) => {
    set({ ready: true, ...extra })
    if (pushPending && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
    pushPending = false
  }

  // A signed-in device shows what the server has. Coming back — to the tab, the window, the app,
  // the network — and every half minute while open, it asks the server for its revision (one
  // small GET) and fetches the document only when the number moved; a change still owed to the
  // server is pushed on the same occasion. A phone that sat in a pocket all afternoon and a
  // desktop tab left open all week used to show, and then push, whatever they last had.
  const checkRev = async (force = false) => {
    if (!get().user || !get().ready || document.visibilityState === 'hidden') return
    if (!force && Date.now() - lastCheck < CHECK_MIN_MS) return
    lastCheck = Date.now()
    // A sign-in still deciding what becomes of this copy: no check of its own. One whose adoption
    // never ran or did not get through (no server, a pairing that failed on the way to it) runs it
    // here, question and all; one already running is left to answer.
    if (adoptHold) { if (!adopting && adoptOwed()) get().resumeAdoption(); return }
    if (pulling) return pulling
    const { base } = metaOf()
    if (!base || owes()) return get().pullState()
    try {
      const { rev } = await api('/api/data/rev')
      if (rev !== base.rev) return get().pullState()
      confirmed(get().S)   // nothing moved on either side
    } catch (e) {
      if (isNetworkError(e) || refused(e)) failed(e)
      else return get().pullState()   // a server that lacks the route (older API) — the full pull knows the old protocol
    }
  }
  const schedulePoll = () => {
    clearTimeout(pollTm)
    pollTm = setTimeout(() => { checkRev(); schedulePoll() }, POLL_MS)
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkRev() })
  window.addEventListener('focus', () => checkRev())
  window.addEventListener('pageshow', e => { if (e.persisted) checkRev() })
  window.addEventListener('online', () => checkRev(true))   // also retries a push that failed offline
  onAppActive(() => checkRev())
  schedulePoll()

  // Both copies changed: keep both sides' entries, let the newer copy decide the rest
  // (lib/sync-merge.js), and remember the server's revision so the push that follows is
  // conditional on exactly the document that was merged. The merged copy is stamped — it is a
  // real change this device now holds — while `ts` in the base stays old, so a pull that
  // happens before the push lands still sees it as unsent.
  const mergeInto = (local, remote, rev) => {
    const ts = metaOf().base?.ts || 0
    const merged = Object.assign(clone(DEF), mergeStates(local, remote))
    merged.active = carryActive(local, merged)
    persist(merged, false)
    if (rev == null) dropSync()
    else writeSync(rev, ts)
  }
  // The workout running on this device, carried from its copy into the one replacing it — in that
  // copy's unit: a merge or a pull can bring the other device's switch to lb along, and a session
  // left in kg would then log kg numbers under an lb label. A switch that only changed the label
  // (`unitSet.convert === false`) relabels the session as it relabels the history (inUnitOf).
  const carryActive = (from, to) => {
    const a = from?.active || null
    const fu = from?.unit || 'kg', tu = to?.unit || 'kg'
    return !a || fu === tu ? a : inUnitOf({ unit: fu, active: a }, to).active
  }
  // Take the server's copy as this device's own, timestamp and all (see persist).
  const adopt = (next, rev) => { persist(next, false, false); writeSync(rev, next._ts); markOwed(false) }

  const doPush = async (attempt = 0) => {
    const S = get().S
    const { base } = metaOf()
    // A forced push is one attempt. One that fails is retried as an ordinary push against the
    // revision this copy descends from: kept armed, it went out later without a baseRev and
    // replaced whatever another device had written in the meantime.
    const force = forceNext
    forceNext = false
    const body = { state: S }
    if (!force && base) body.baseRev = base.rev
    try {
      const r = await api('/api/data', { method: 'PUT', body: JSON.stringify(body) })
      // A server from before revisions answers without one — then there is nothing to hold the
      // next push to, and the marker must not pretend otherwise.
      if (r.rev == null) dropSync()
      else writeSync(r.rev, S._ts)
      markOwed(false)
      toldTooLarge = false
      confirmed(S)
      // Back from offline with changes that were waiting: say so once — the banner that promised
      // "syncs when you're back online" has just kept its word.
      if (offlineChanges) {
        offlineChanges = false
        import('./useUI.js').then(({ useUI }) => useUI.getState().toast(t('Back online — synced with the server.'))).catch(() => {})
      }
    } catch (e) {
      if (e.status === 409 && e.data && attempt < 2) {
        // Another device wrote since this one last read. The server sent its document along;
        // merge and push once more against that revision. A second refusal in a row leaves the
        // copy owed and the next resume pull takes it from there.
        mergeInto(get().S, e.data.state, e.data.rev || 0)
        return doPush(attempt + 1)
      }
      // Whatever went wrong — no network, a refused token, a phone without a pairing, a server
      // error — the copy stays owed to the server and the next check retries it.
      markOwed(true)
      if (isNetworkError(e)) offlineChanges = true
      failed(e, { pending: true })
      // A 413 comes from the proxy in front of the API (nginx: client_max_body_size), which
      // caps the request body. Every later push is at least as big, so nothing reaches the
      // server until the limit is raised — said once per refusal streak; the owed copy keeps
      // the retries going. useUI imports this store, hence the lazy import.
      if (e.status === 413 && !toldTooLarge) {
        toldTooLarge = true
        import('./useUI.js')
          .then(({ useUI }) => useUI.getState().toast(t('Sync failed: the server refused the upload as too large. Your changes have not reached the server.')))
          .catch(() => {})
      }
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  const flush = () => {
    if (MOBILE && saveTm) nativePersist(true)
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  window.addEventListener('pagehide', flush)   // Safari kills the home-screen app without a visibilitychange at times

  // The owner check in setUser only runs in the tab that signs in. Another tab of the same
  // browser still holding the previous profile would keep writing that profile's data over the
  // shared copy and push it under the new session's cookie — so it drops the profile, and
  // whoever signs in there passes the same check. The owner key is written last on both a
  // sign-in and a sign-out, so on a new owner the copy in storage is already the wiped one; with
  // no owner (a sign-out) this tab falls back to defaults rather than read the key at all — the
  // previous profile's data must not stay here whichever key's event lands first.
  window.addEventListener('storage', e => {
    if (e.key !== 'gym_owner') return
    const user = get().user
    if (!user || e.newValue === user.id) return
    clearTimeout(pushTm)
    pushTm = null
    const S = e.newValue ? loadState() : freshState()
    meta.set(S, e.newValue ? { base: readStoredSync(), owed: storedOwed() } : { base: null, owed: false })
    set({ user: null, S })
  })
  // Another tab of this browser synced — its marker moved to a revision this tab's copy does not
  // descend from. Rather than take that tab's saved copy (storage holds the copy and its marker
  // under two keys, and an event can arrive with one updated and not the other), this tab asks
  // the server, as it would on coming back to it: one small request, and a pull only if the
  // revision really moved. A hidden tab does the same when it is shown again. Its own base still
  // guards the push either way: a copy this tab has not refreshed gets a 409 and a merge.
  window.addEventListener('storage', e => {
    if (e.key !== SYNC_KEY || !e.newValue) return
    const user = get().user
    if (!user || localStorage.getItem('gym_owner') !== user.id) return
    let theirs = null
    try { theirs = JSON.parse(e.newValue) } catch { return }
    if (theirs?.rev == null || theirs.rev === metaOf().base?.rev) return
    checkRev(true)
  })

  // Before a sign-out decides anything: the pull on its way has landed, and every push asked
  // for — including one queued behind the push in flight — has run. Then the photos and videos
  // still waiting get one more try (lib/media-owed.js, at most a minute): they are owed exactly
  // like a change is.
  const settle = async () => {
    if (pulling) await pulling
    await get().pushState()   // never throws — an owed copy stays owed when it does not land
    while (pushing) await pushing
    await settleMedia(get().S)
  }

  // Forget where this device stood with the server — a different account, a sign-out. The copy
  // that replaces it descends from no revision and owes nothing.
  const forgetSync = () => {
    meta.set(get().S, { base: null, owed: false })
    offlineChanges = false   // a push the previous account owed is not this one's to announce
    try { for (const k of [SYNC_KEY, DIRTY_KEY, SYNCED_AT_KEY, SYNCED_FP_KEY]) localStorage.removeItem(k) } catch { /* nothing to keep */ }
    fpOf = null
  }

  // Everything a sign-out leaves behind on this device, whichever way it was triggered. The owner
  // goes last, after the wiped copy is written — the storage listener above relies on the order.
  const clearLocalSession = () => {
    const hadMedia = referencedHashes(get().S).size > 0
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    forgetSync()
    releaseAdopt()   // the copy it was about is gone
    localStorage.removeItem(KEY)
    // Signed out, this device is nobody's: the sign-in screen is in the instance's language.
    persist(freshState(), false)
    localStorage.removeItem('gym_owner_name')
    localStorage.removeItem('gym_owner')
    setSync({ offline: false, auth: false, lastError: null, pending: false, lastSynced: 0 })
    // On a phone the file is wiped with it, now rather than after the usual wait: a start in
    // between would open in local mode on the signed-out account's data, since that boot takes
    // the file whenever storage holds nothing.
    const wiped = MOBILE ? nativePersist(true) : null
    // The account's photos and videos go with its copy (a shared device keeps nothing of it),
    // except the ones a stash still refers to — whatever was pending is in a stash by now
    // (signOut refuses otherwise) and comes back with it. A file picked from here on is kept.
    // After the state file, which is the one write a sign-out must not be kept waiting for. Also
    // when the copy refers to no media any more: a photo removed in the last hour, or one whose
    // exercise was deleted, is still in the store until the local clean-up's grace has passed,
    // and on a shared device it must not outlast the sign-out. The app's sync opens the store at
    // start (lib/media-sync.js), so there this always runs; only a store nothing has opened is
    // left alone, since nothing can have been put into it.
    if (hadMedia || mediaStoreInUse()) {
      const since = Date.now()
      Promise.resolve(wiped).then(() => readStashes())
        .then(all => mediaStore.retainOnly(new Set(Object.values(all).flatMap(e => [...referencedHashes(e?.state)])), { keepPutAfter: since }))
        .catch(() => {})
    }
    return wiped
  }

  /* The changes a forced sign-out or disconnect keeps, so that no change is ever lost silently.
     Keyed by server and account — '' for the server of a phone whose pairing was lost with its
     address — in localStorage and, on a phone, in a file beside the state mirror, since the
     sign-out wipes the rest. */
  const stashKey = (server, uid) => (server || '') + '|' + uid
  const readStashes = async () => {
    let all = {}
    try { all = JSON.parse(localStorage.getItem(STASH_KEY)) || {} } catch { /* none */ }
    if (MOBILE) { const f = await readJsonFile(STASH_FILE); if (f && typeof f === 'object') all = { ...all, ...f } }
    return all
  }
  // True when at least one durable copy of the stashes was written.
  const writeStashes = async all => {
    const empty = !Object.keys(all).length
    let ok = false
    try { if (empty) localStorage.removeItem(STASH_KEY); else localStorage.setItem(STASH_KEY, JSON.stringify(all)); ok = true } catch { /* full */ }
    if (MOBILE) {
      await writeJsonFile(STASH_FILE, all)
      const back = await readJsonFile(STASH_FILE)
      ok = ok || (!!back && Object.keys(back).length === Object.keys(all).length)
    }
    set({ keptRev: get().keptRev + 1 })
    return ok || empty
  }
  // A different account signing in on a copy that still owes its own: the copy goes, as it always
  // has — it must not be pushed into the new account — but what it owed is kept aside first, the
  // way a forced sign-out keeps it, for when that account comes back. Written to localStorage
  // right here, since setUser wipes the copy straight after; on a phone the file follows, and
  // pairing waits for it (`keeping`) before it goes on.
  // Photos or videos that never reached that account's server count as owed on their own, even on
  // a copy with no workouts or routines yet — the custom exercise they belong to is all there is.
  const keepForPrevious = uid => {
    const S = get().S
    if (!(owes() && hasData(S)) && !pendingRefCount(S)) return
    const server = serverBase()
    const key = stashKey(server, uid)
    let all = {}
    try { all = JSON.parse(localStorage.getItem(STASH_KEY)) || {} } catch { /* none */ }
    const prev = all[key]?.state
    const state = prev ? mergeStates(S, prev) : clone(S)
    state.active = S.active || prev?.active || null
    // The name comes from beside the owner when the account is no longer signed in here (its
    // session ended), so the screens say whose changes these are rather than an id.
    let name = get().user?.id === uid ? get().user.name || '' : ''
    if (!name) { try { name = localStorage.getItem('gym_owner_name') || '' } catch { /* the id then */ } }
    const entry = { server: server || null, uid, name, at: Date.now(), state }
    all[key] = entry
    // A second full copy beside the first may not fit (a profile near the size limit): the copy
    // in storage is wiped next anyway, so it makes the room.
    const v = JSON.stringify(all)
    try { localStorage.setItem(STASH_KEY, v) }
    catch {
      try { localStorage.removeItem(KEY); localStorage.setItem(STASH_KEY, v) } catch { /* still full — the file may still take it */ }
    }
    set({ keptRev: get().keptRev + 1 })
    if (MOBILE) keeping = readStashes().then(f => writeStashes({ ...f, [key]: entry })).catch(() => {})
  }
  // What a sign-out or disconnect answers when something is owed: how many changes, and how many
  // photos or videos, when there are any.
  const owedResult = (left, extra = {}) => ({ owed: true, count: left.count, ...(left.media ? { media: left.media } : {}), ...extra })
  const stashOwed = async () => {
    const user = get().user
    if (!user) return true
    const all = await readStashes()
    const server = serverBase()
    const key = stashKey(server, user.id)
    const prev = all[key]?.state
    const state = prev ? mergeStates(get().S, prev) : clone(get().S)
    state.active = get().S.active || prev?.active || null
    all[key] = { server: server || null, uid: user.id, name: user.name || '', at: Date.now(), state }
    return writeStashes(all)
  }
  // Back on the server and account a forced sign-out or disconnect left: the kept changes are
  // merged in like a conflict (lib/sync-merge.js), marked owed and pushed, and the stash goes.
  // If the push does not land, the copy itself owes them from here and nothing wipes it.
  const applyStash = async () => {
    const user = get().user
    if (!user) return
    const all = await readStashes()
    const exact = stashKey(serverBase(), user.id)
    const keys = Object.keys(all).filter(k => k === exact || (all[k]?.uid === user.id && !all[k]?.server))
    if (!keys.length) return
    const S = get().S
    let merged = S
    for (const k of keys) merged = mergeStates(merged, all[k].state)
    merged = Object.assign(clone(DEF), merged)
    merged.active = S.active || keys.map(k => all[k].state?.active).find(Boolean) || null
    persist(merged, false)
    markOwed(true)
    if (MOBILE) await nativePersist(true)   // the durable copy holds it before the stash goes
    await get().pushState()
    for (const k of keys) delete all[k]
    await writeStashes(all)
  }

  // adoptProfile's work (see there). Every way out answers the question — releaseAdopt — before
  // the decision is written and pushed; only a server that could not be reached leaves it owed.
  const runAdopt = async (ask, { alwaysAsk = false } = {}) => {
    if (pulling) await pulling
    // An adoption resumed after a restart is the sign-in's own: whether this copy already belonged
    // to the account was decided then — boot's sign-in sees the owner that sign-in wrote.
    const owedMark = adoptOwed()
    const sameAccount = owedMark ? !!owedMark.rejoined : rejoined
    if (owedMark?.alwaysAsk) alwaysAsk = true
    let res
    try { res = await api('/api/data') }
    catch (e) {
      failed(e)
      // Nothing decided: with a sign-in that marked it, sync stays held and the next check asks
      // again (checkRev); a bare call has nothing to hold for.
      if (!owedMark) releaseAdopt()
      throw e   // the caller's toast: sign-in needed the server anyway
    }
    let { state, rev } = res
    reached()
    let asked = false
    const askAbout = async extras => {
      if (!(extras.workouts || extras.bodyweight || extras.customEx) || typeof ask !== 'function') return false
      asked = true
      return !!(await ask(extras))
    }
    // The question can stay open for minutes: what is applied is the server's copy once it
    // closes. Unreachable by then, the copy read before it stands — its revision is older than
    // the server's, so the next pull still brings in what changed.
    const reread = async () => {
      if (!asked) return
      try { const r = await api('/api/data'); if (r && r.state) ({ state, rev } = r) } catch { /* the first read */ }
    }
    const takeServer = () => {
      const copy = Object.assign(clone(DEF), state)
      copy.active = carryActive(get().S, copy)
      if (rev != null) adopt(copy, rev)
      else { dropSync(); persist(copy, false, false); markOwed(false) }
      confirmed(get().S)
    }
    const S0 = get().S
    if (!state) {
      const push = hasData(S0) && (!alwaysAsk || sameAccount || await askAbout(localExtras(S0, null)))
      releaseAdopt()
      if (hasData(get().S) && !push) {
        takeServer()
        await applyStash()
        return { adopted: true, added: false }
      }
      markOwed(false)
      if (push) { if (rev != null) writeSync(rev, 0); forceNext = true; await get().pushState() }
      else { if (rev != null) writeSync(rev, 0); confirmed(get().S) }
      await applyStash()
      return { adopted: false, added: false }
    }
    if (sameAccount) {
      // This copy already belongs to the account: a phone paired again after its token was
      // refused, a browser signed in again after its session ended. It may hold days the server
      // never saw — new workouts, but also edits to routines and settings, which the question
      // below never covered. Merged like a conflict between two devices (the union of entries,
      // the later edit of each routine, the newer copy's settings) and pushed against the
      // server's revision. Only a copy with nothing of its own since its base takes the
      // server's as it is, so an entry deleted elsewhere meanwhile stays deleted.
      releaseAdopt()
      const S = get().S
      const { base, owed } = metaOf()
      if (!hasData(S) || (!owed && base && !localChanged(S))) {
        takeServer()
        await applyStash()
        return { adopted: true, added: false, merged: false }
      }
      mergeInto(S, state, rev)
      await get().pushState()
      await applyStash()
      return { adopted: true, added: false, merged: true }
    }
    // The question is about what this copy held when the sign-in began (the marker's `pre`). What
    // was logged since — while an adoption that could not reach the server kept sync held — is
    // this account's own already: never offered as "logged while signed out", never dropped by
    // "Keep profile as is", but merged like any change of the account's.
    const pre = owedMark?.pre
    const keep = await askAbout(localExtras(pre ? splitByPre(S0, pre).before : S0, state))
    await reread()
    releaseAdopt()
    if (keep) {
      const S = get().S
      const merged = Object.assign(clone(DEF), mergeStates(state, S, { prefer: 'a' }))
      merged.active = carryActive(S, merged)
      persist(merged, false)
      if (rev != null) writeSync(rev, 0)
      else dropSync()
      await get().pushState()
      await applyStash()
      return { adopted: true, added: true }
    }
    const later = pre ? splitByPre(get().S, pre).later : null
    takeServer()
    if (later) {
      const S = get().S
      const merged = Object.assign(clone(DEF), mergeStates(S, later, { prefer: 'a' }))
      merged.active = S.active || null
      persist(merged, false)
      if (rev != null) writeSync(rev, 0)
      else dropSync()
      await get().pushState()
    }
    await applyStash()
    return { adopted: true, added: false }
  }
  // A copy's workouts, weigh-ins and custom exercises split by the names a sign-in recorded when it
  // began (`pre`, see setUser): `before` holds what was there then, `later` — null when nothing
  // is — what was logged since, with the custom exercises its workouts use, in this copy's unit.
  const ADOPT_FIELDS = ['workouts', 'bodyweight', 'customEx']
  const splitByPre = (S, pre) => {
    const before = { ...S }
    const later = { _ts: S._ts, unit: S.unit, ...(S.unitSet ? { unitSet: S.unitSet } : {}) }
    let any = false
    for (const f of ADOPT_FIELDS) {
      const had = new Set(Array.isArray(pre?.[f]) ? pre[f] : [])
      const xs = Array.isArray(S[f]) ? S[f].filter(x => x != null) : []
      before[f] = xs.filter(x => had.has(entryKey(f, x)))
      later[f] = xs.filter(x => !had.has(entryKey(f, x)))
      if (later[f].length) any = true
    }
    if (!any) return { before, later: null }
    const used = new Set(later.workouts.flatMap(w => (Array.isArray(w?.entries) ? w.entries : []).map(e => e?.id)))
    later.customEx = [...later.customEx, ...before.customEx.filter(c => used.has(c.id))]
    return { before, later }
  }
  const preOf = S => {
    const ids = resetIdsOf(S)
    return Object.fromEntries(ADOPT_FIELDS.map(f => [f, ids[f] || []]))
  }

  // The file mirror is the durable copy: WebView storage can be evicted while the files
  // directory survives. A mirror newer than what localStorage holds is a change this phone made
  // and may not have sent — it is taken, and owed. Only the paired account's own, though, and
  // only the copy the owner file says was written (saveMirror): one another account left there,
  // or one the file never finished replacing, is not this account's latest — taken, it used to
  // be pushed into whichever account was paired now. And it goes without the revision storage
  // quotes, so the pull merges it with the server's copy (its first-sync path): the file can
  // still hold a copy the server has since moved past, and a merge brings back at most what was
  // deleted meanwhile, where a push with a matching baseRev dropped the other side's work.
  const restoreFromMirror = async remote => {
    const saved = await nativeLoad()
    if (!saved || (saved._ts || 0) <= (get().S._ts || 0)) return
    const of = await readJsonFile(MIRROR_OWNER_FILE)
    const who = remote?.user?.id || null
    let owner = null
    try { owner = localStorage.getItem('gym_owner') } catch { /* evicted along with the copy */ }
    if (!who || of?.owner !== who || (owner && owner !== who) || of.ts !== (saved._ts || 0)) return
    try { if (!owner) localStorage.setItem('gym_owner', who) } catch { /* setUser writes it again */ }
    persist(Object.assign(clone(DEF), saved), false, false)
    dropSync()
    markOwed(true)
  }

  const S0 = loadState()
  registerCustom(S0.customEx)
  // Which photos and videos are still waiting for the server, known before the first sign-out
  // check has to ask (lib/media-owed.js). A copy without any leaves the media store unopened.
  if (referencedHashes(S0).size) loadPending()
  meta.set(S0, { base: readStoredSync(), owed: storedOwed() })
  const user0 = (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })()
  adoptHold = !!user0 && readAdopt()?.uid === user0.id
  const sync0 = { offline: false, pending: storedOwed(), auth: false, lastError: null, lastSynced: (() => { try { return +localStorage.getItem(SYNCED_AT_KEY) || 0 } catch { return 0 } })(), server: serverBase(), held: adoptHold }
  sync0.status = statusOf(sync0, user0)

  return {
    S: S0,
    user: user0,
    ready: false,
    // The connection as the screens show it — see statusOf above for every field.
    sync: sync0,
    /* Instance capabilities from GET /api/config. `config.coach` is present only when the owner
       has both enabled the Coach and connected a provider — every Coach entry point in the app
       hangs off it via coachAvailable(), so an unconfigured instance renders exactly what it
       always did, and a configured one is the only place any of it appears. */
    config: null,
    needsMobileOnboarding: false,   // mobile build only — set true by boot() on a genuine first launch
    // A one-time device-link code this page was opened with (?link=, #95), until it is redeemed.
    // Never persisted: the code is good for minutes and belongs to this one visit.
    linkCode: null,
    // Mobile build only: how the Coach runs on this phone — { mode: 'off'|'server'|'byok',
    // provider, model, baseUrl } from lib/coach-device.js. Never the key, never a proposal.
    coachLocal: null,
    async setCoachLocal(patch) {
      set({ coachLocal: coachDeviceSettings(await saveCoachDevice(patch)) })
    },

    // Mutate a draft of S via producer fn, then persist + schedule sync. Every routine the change
    // touched carries the time of it, for a conflict to keep the version edited last.
    update(mut, push = true) {
      const prev = get().S
      const S = clone(prev)
      mut(S)
      stampRoutines(prev.routines, S.routines)
      stampCustomEx(prev.customEx, S.customEx)
      persist(S, push)
      // A photo or video added to a workout is a change worth the day's backup too: the one
      // finishing wrote went before the finish screen's pictures (autoBackupNow). Not a removal,
      // nor a workout deleted: the day's copy then still holds what was taken off, as a backup should.
      if (MOBILE && S.autoBackup && gainedWorkoutMedia(prev, S)) {
        clearTimeout(backupTm)
        backupTm = setTimeout(() => { backupTm = null; get().autoBackupNow() }, AUTO_BACKUP_SOON_MS)
      }
    },
    // An edit of a saved workout (lib/session-edit.js) is saved or dropped like any other change:
    // the store's own sync takes it to the server, and a conflict on the way is settled by
    // mergeStates like one between two devices. A save that cannot happen throws before anything
    // is written, and the editor stays open with the edits.
    saveHistoryEdit() {
      let saved = null
      get().update(S => { saved = saveWorkoutEdit(S) })
      return saved
    },
    discardHistoryEdit() { get().update(S => { S.active = null }) },
    // An edit that took out every set deletes the workout rather than saving it empty.
    deleteHistoryEdit() {
      let removed = false
      get().update(S => { removed = deleteEditedWorkout(S) })
      return removed
    },
    // Settings → unit. `convert` walks every stored weight into the new unit (lib/units.js); off,
    // only the label changes. Either way the choice is stamped (`unitSet`), so a merge with a
    // copy still in the old unit brings that copy over rather than mixing the two (lib/sync-merge.js),
    // and a conversion goes to the server at once, as an ordinary conditional push: another device
    // still logging in the old unit meets it on its very next push, and a copy it pushed first is
    // converted before it is merged in.
    setUnit(to, { convert = true } = {}) {
      const S0 = get().S
      if ((S0.unit || 'kg') === to) return null
      const S = clone(convert ? convertStateUnit(S0, to) : { ...S0, unit: to })
      S.unitSet = { at: Date.now(), convert }
      persist(S, true)
      return convert && get().ready ? get().pushState() : null
    },
    // Settings → Reset everything: the empty copy, stamped with when (`resetAt`). Pushed as a
    // replace, and the stamp is what makes it hold: a device that has not seen the reset and
    // still pushes a change of its own gets the 409, and its merge keeps only what that device
    // made after the reset instead of bringing the whole profile back (lib/sync-merge.js).
    //
    // With it goes `resetIds`, the names of every entry the reset wiped: this copy's, the earlier
    // resets' (a copy older than those too is still judged right), and the server's once it
    // answers — it may hold entries this device never pulled. A device that has not seen the
    // reset loses exactly those, and keeps whatever else it holds, whatever its dates say.
    // Resolves once the server's names are in (or could not be had).
    resetEverything() {
      const cur = get().S
      const S = clone(DEF)
      S.resetAt = Math.max(Date.now(), (Number(cur.resetAt) || 0) + 1)
      S.resetIds = mergeResetIds(cur.resetIds, resetIdsOf(cur))
      get().replaceState(S, !!get().user)
      if (!get().user) return Promise.resolve()
      return api('/api/data').then(res => {
        const now = get().S
        if (!res?.state || now.resetAt !== S.resetAt) return
        const ids = mergeResetIds(now.resetIds, mergeResetIds(res.state.resetIds, resetIdsOf(res.state)))
        if (JSON.stringify(ids) === JSON.stringify(now.resetIds)) return
        persist(Object.assign(clone(now), { resetIds: ids }), true)
      }).catch(() => {})
    },
    // Before a backup replaces this copy (Settings → Import): the workouts the server holds that the
    // backup does not — logged since it was made, or on another device meanwhile. The import is a
    // deliberate replace and deletes them from the profile; the confirm says so and offers to merge
    // them in instead (importBackup). null when there are none, when nobody is signed in, or when
    // the server cannot be asked — the replace then goes as it always has.
    async importConflict(backup) {
      if (!get().user) return null
      let res
      try { res = await api('/api/data') } catch { return null }
      const state = res?.state
      if (!state) return null
      const key = w => entryKey('workouts', w)
      const inBackup = new Set((Array.isArray(backup?.workouts) ? backup.workouts : []).filter(Boolean).map(key))
      const server = (Array.isArray(state.workouts) ? state.workouts : []).filter(Boolean)
      const onServer = new Set(server.map(key))
      const workouts = server.filter(w => !inBackup.has(key(w))).length
      // This device's own workouts the server has not received yet go the same way, and count too.
      const mine = owes() ? (get().S.workouts || []).filter(w => w && !inBackup.has(key(w)) && !onServer.has(key(w))).length : 0
      return workouts + mine ? { workouts: workouts + mine, state, rev: res.rev, local: mine > 0 || owes() } : null
    },
    // A backup in place of this copy. With `mergeWith` — importConflict's answer — the server's copy
    // is merged in instead of replaced (with this device's changes not yet on it, when there are
    // any): the backup's settings and plan, every entry of all of them (mergeStates with the backup
    // preferred, in the backup's unit), pushed against that revision like any other change, so a
    // workout logged meanwhile elsewhere, or here, is not lost either.
    importBackup(backup, { mergeWith } = {}) {
      const next = Object.assign(clone(DEF), backup)
      if (!mergeWith?.state || !get().user) { get().replaceState(next, !!get().user); return }
      const others = mergeWith.local ? mergeStates(get().S, mergeWith.state) : mergeWith.state
      const merged = keepReset(get().S, Object.assign(clone(DEF), mergeStates(next, others, { prefer: 'a' })))
      merged.active = next.active || null
      persist(merged, true)
      if (mergeWith.rev != null) writeSync(mergeWith.rev, 0)
    },
    // A replace that is meant to reach the server (backup import, reset) is a deliberate
    // overwrite, not a change to merge: the push it arms goes without a baseRev. It never takes
    // the reset stamp back (keepReset).
    replaceState(S, push = false) { if (push) forceNext = true; persist(keepReset(get().S, clone(S)), push) },

    // Fires after the moments where losing local data would actually hurt — a workout just
    // logged, a routine just edited — not on every keystroke. No-op off mobile or with the
    // setting off; the private file mirror (nativePersist, above) already covers every change.
    autoBackupNow() {
      const S = get().S
      if (MOBILE && S.autoBackup) writeAutoBackup(S)
    },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    // Choosing to go on without a server ends whatever was said about the last one.
    setGuest(v) {
      if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest')
      set({})
      if (v) setSync({ auth: false, offline: false, lastError: null })
    },

    // Public config from /api/config (invite_only, allow_guest). null until the first successful
    // fetch — the login screen and boot both read it, so it is fetched once and cached here
    // rather than by each screen that happens to need it.
    config: null,
    async loadConfig() {
      if (get().config) return get().config
      return get().refreshConfig()
    },
    // Always asks. The cached copy is right for one boot, but an admin can switch the Coach on
    // while a paired phone sits on the setup screen — that screen wants today's answer.
    // Two callers that ask at once get one request: signing in re-asks (setUser) and the pairing
    // flow awaits a refresh of its own immediately after, and there is one answer to have.
    async refreshConfig() {
      if (configFetch) return configFetch
      configFetch = (async () => {
        try { const c = await api('/api/config'); rememberDefaultLang(c); set({ config: c }); return c }
        catch { return null }
        finally { configFetch = null }
      })()
      return configFetch
    },

    // `adopt` (a sign-in, a pairing — { alwaysAsk } for a device link): adoptProfile follows and
    // decides what becomes of this copy; until it has, nothing is pulled or pushed (ADOPT_KEY).
    setUser(u, { adopt } = {}) {
      if (u) {
        // The local copy belongs to whoever last signed in here. When a session expires or is
        // revoked elsewhere, boot() only drops the user and the data stays; a different profile
        // signing in next must not inherit it (pullState would push it into that account, and
        // carry the in-progress workout along) — what it still owed its own account is kept aside
        // for that account first (keepForPrevious). A proper sign-out clears the owner, so a guest's
        // data still moves into a freshly created profile. The same account coming back — a
        // phone paired again, a browser signed in again — is remembered for adoptProfile.
        const owner = localStorage.getItem('gym_owner')
        rejoined = owner === u.id
        const other = !!owner && owner !== u.id
        // The hold goes on before anything else can run: a poll, a resume, a debounced push.
        if (adopt) {
          adoptHold = true
          clearTimeout(pushTm)
          pushTm = null
        } else {
          // Boot signing the account back in: an adoption it still owes holds sync until it is
          // answered (resumeAdoption); one another account left behind is void.
          const m = readAdopt()
          if (m && m.uid !== u.id) writeAdopt(null)
          adoptHold = !!m && m.uid === u.id
        }
        if (other) {
          keepForPrevious(owner)
          forgetSync()
          localStorage.removeItem(KEY)
          persist(clone(DEF), false)
          setSync({ pending: false, lastSynced: 0, lastError: null })
        }
        // The mark, with the names of what this copy holds now (`pre`) — what the question is
        // about; whatever is logged later belongs to the account (runAdopt).
        if (adopt) writeAdopt({ uid: u.id, rejoined, alwaysAsk: !!adopt.alwaysAsk, pre: preOf(get().S) })
        localStorage.setItem('gym_owner_name', u.name || '')
        localStorage.setItem('gym_owner', u.id)
        localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest')
        logoutOwed(false)   // this sign-in's cookie replaced the one a failed sign-out left behind
        // The file follows at once, as the new account's: until then it holds the previous one's.
        if (other && MOBILE) nativePersist(true)
        // The server answers /api/config with a `coach` key only to a session — the block, or
        // null on an instance that has no Coach. So a copy with no key at all is one fetched
        // before this sign-in (boot's, or the login screen asking for invite_only), and every
        // Coach entry point would stay hidden until the next reload. Ask again, unawaited:
        // nothing on this path waits for the answer. A copy that has the key was made for a
        // session and is already the right answer, Coach or no Coach.
        if (get().config && !('coach' in get().config)) get().refreshConfig()
      } else { rejoined = false; adoptHold = false; localStorage.removeItem('gym_user') }
      set({ user: u })
      setSync({ held: adoptHold })
    },

    // One PUT at a time: a push asked for while one is in flight runs after it (once, however
    // many asked), and the promise returned covers that follow-up too, so a caller that awaits
    // before signing out knows the last change is on the server.
    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      pushTm = null
      if (adoptHold) return   // the sign-in has not decided what this copy is yet (adoptProfile)
      if (pushing) { pushAgain = true; return pushing.then(() => pushing) }
      pushing = doPush().finally(() => {
        pushing = null
        if (pushAgain) { pushAgain = false; get().pushState() }
      })
      return pushing
    },
    // Ask the server for its copy and settle the difference. Coalesced, and a push still waiting
    // in the debounce goes first — the server's answer is then the one that already includes it,
    // and the push itself is what catches a conflict.
    async pullState() {
      if (adoptHold) return   // as pushState: adoptProfile reads the server itself
      if (pulling) return pulling
      pulling = (async () => {
        try {
          if (pushTm) { clearTimeout(pushTm); pushTm = null; await get().pushState() }
          else if (pushing) await pushing
          const res = await api('/api/data')
          lastCheck = Date.now()
          reached()
          const { state, rev } = res
          const S = get().S
          const { base, owed } = metaOf()
          // Owed to the server: a push that failed, or a change made while boot was still pulling.
          const dirty = owed || pushPending
          // A server from before revisions: the old rule, newer `_ts` wins outright.
          if (rev == null) {
            dropSync()
            const restored = restoredStateFor(S, state, dirty)
            if (restored) { persist(restored, false, false); confirmed(get().S) }
            else if (hasData(S)) await get().pushState()
            return
          }
          // No base yet — first pull on this device, or a client that just learned about
          // revisions. The newer copy wins as before, except that a copy still owed to the
          // server (dirty) is merged instead of pushed over whatever is there.
          if (!base) {
            if (dirty && state) { mergeInto(S, state, rev); pushPending = false; await get().pushState(); return }
            const restored = restoredStateFor(S, state, false)
            if (restored) { adopt(restored, rev); confirmed(get().S) }
            else if (hasData(S)) { writeSync(rev, 0); await get().pushState() }
            else { writeSync(rev, state?._ts || 0); confirmed(get().S) }
            return
          }
          const serverMoved = rev !== base.rev
          const changed = dirty || localChanged(S)
          if (!serverMoved) { if (changed) await get().pushState(); else confirmed(S); return }
          if (!state) { writeSync(rev, 0); if (hasData(S)) await get().pushState(); return }
          if (!changed) { const next = Object.assign(clone(DEF), state); next.active = carryActive(S, next); adopt(next, rev); confirmed(get().S); return }
          mergeInto(S, state, rev)
          pushPending = false
          await get().pushState()
        } catch (e) { failed(e) /* keep local; the poll retries */ }
        finally { pulling = null }
      })()
      return pulling
    },

    // "Sync now": what is waiting goes, the server's copy is checked, and the answer is the
    // `sync` every screen reads — status 'ok' when the two agree.
    async syncNow() {
      if (!get().user) { setSync({}); return get().sync }
      // Held for a sign-in's question: "Sync now" is asking it (again), and the sync follows.
      if (adoptHold) { await get().resumeAdoption(); if (adoptHold) return get().sync }
      if (pulling) await pulling
      await get().pullState()
      return get().sync
    },

    // What this device holds that the server has not seen: `owed` when anything would be lost by
    // wiping the copy now, `count` how many workouts, weigh-ins, routines and custom exercises
    // differ from the last copy the two agreed on (plus one for settings and the plan) — null
    // when the device has no record of that copy (it last agreed with the server under an older
    // version), and then only `owed` is known.
    //
    // `media` counts the custom exercises whose photo or video the server has not confirmed
    // (lib/media-owed.js); present only when there are any, and they are owed on their own.
    unsyncedChanges() {
      if (!get().user) return { owed: false, count: 0 }
      const media = pendingRefCount(get().S)
      const withMedia = media ? { media } : {}
      if (!owes()) return { owed: media > 0, count: 0, ...withMedia }
      const count = countChanges(get().S, readFingerprint())
      return { owed: count !== 0 || media > 0, count, ...withMedia }
    },

    // The changes a forced sign-out or disconnect kept on this device, waiting for their server
    // and account: [{ server, uid, name, at }] — server null for a phone whose pairing was lost
    // with its address. The copies themselves stay inside the store. `keptRev` moves whenever
    // they change, for a screen listing them to ask again.
    keptRev: 0,
    async keptChanges() {
      const all = await readStashes()
      return Object.values(all).map(({ server, uid, name, at }) => ({ server: server || null, uid, name, at }))
    },
    // Every photo and video file the stashes refer to: they are kept on this device for as long
    // as the stash is (lib/media-sync.js localMediaGc, Reset everything).
    async stashedMediaHashes() {
      const all = await readStashes()
      return new Set(Object.values(all).flatMap(e => [...referencedHashes(e?.state)]))
    },

    // Sign-in (and pairing a phone) takes the server's profile as this device's copy — the
    // profile is the truth for a signed-in user, whatever the timestamps say. The only thing
    // the device may add are the entries it logged while signed out: `ask(extras)` (a dialog,
    // supplied by the caller) decides whether those workouts, weigh-ins and custom exercises
    // are added to the profile or dropped. A profile with no state yet simply takes the
    // device's data, as creating a profile always did. The same account signing in again is
    // different: see below.
    //
    // `alwaysAsk` is for a profile this device joins with a code from another device (#95,
    // DeviceLinkRedeemSheet). Nothing proves that profile is this person's own — whoever sends
    // the code chooses it — so what a guest logged here is not moved into it unasked, not even
    // into one with no state yet, where it would otherwise go without a word. Declined, this
    // device takes that empty profile as it is, the way it takes a profile that has state.
    //
    // Nothing syncs from the sign-in until the answer is in (setUser's `adopt`, ADOPT_KEY): a poll or
    // a resume pull in the meantime took the device's copy for a newer one of the account's and
    // pushed it over the profile. And the answer is applied to the server's copy as it is once the
    // question closes, not as it was when it opened — another device may have written meanwhile.
    // Calls made while one is running get that one.
    adoptProfile(ask, opts = {}) {
      if (adopting) return adopting
      setHold(true)
      // Whatever throws on the way (the server, the question itself): a sign-in that marked it
      // stays held, and the next check or "Sync now" runs it again; a bare call has nothing to
      // hold for and lets go.
      adopting = runAdopt(ask, opts)
        .catch(e => { if (!adoptOwed()) releaseAdopt(); throw e })
        .finally(() => { adopting = null })
      return adopting
    },
    // The adoption a sign-in still owes — the app was closed with its question open, or the server
    // could not be reached for it: asked again, with the sign-in's own question.
    async resumeAdoption(ask) {
      const m = adoptOwed()
      if (!m) { if (adoptHold && !adopting) releaseAdopt(); return null }
      if (adopting) return adopting
      try {
        if (typeof ask !== 'function') ask = (await import('../sheets.jsx')).askAddDeviceData
        const r = await get().adoptProfile(ask, { alwaysAsk: !!m.alwaysAsk })
        // A phone whose pairing ended here: what connectToServer does after its own adoption.
        if (MOBILE) { await nativePersist(true); if (get().needsMobileOnboarding) set({ needsMobileOnboarding: false }) }
        return r
      } catch { return null }
    },

    /* Signing out wipes this device's copy — never while it holds changes the server has not
       seen. After one more push, if anything is still owed, nothing is wiped and the result
       says so: { owed: true, count } (see unsyncedChanges), for the screen to offer a retry, an
       export, or going ahead anyway. `force` goes ahead: the owed copy is kept aside on this
       device (stashOwed) and comes back when it next reaches this server as this account. If
       even that cannot be written, nothing is wiped ({ owed, count, stashed: false }).
       Otherwise { owed: false } or { owed: true, count, stashed: true }, signed out. */
    async signOut({ force = false } = {}) {
      await settle()
      const left = get().unsyncedChanges()
      if (left.owed && !force) return owedResult(left)
      if (left.owed && !(await stashOwed())) return owedResult(left, { stashed: false })
      // The device is signed out either way. A request that did not get through leaves the cookie
      // behind, still valid, so the logout is owed until the server answers it (see boot).
      try { await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { if (!MOBILE) logoutOwed(true) }
      await clearLocalSession()
      return left.owed ? owedResult(left, { stashed: true }) : { owed: false }
    },

    // Mobile-only ("connect to my server" onboarding, see App.jsx's needsMobileOnboarding).
    // Picking local — even before there's any data — persists the choice so onboarding never
    // asks again.
    async chooseLocalMode() {
      await chooseLocal()
      set({ needsMobileOnboarding: false })
    },
    // Redeems the pairing code shown in the browser (Settings → "Pair the mobile app") and
    // switches this device over to that account, same as signing in on the web does — the same
    // account pairing again merges what the phone kept (adoptProfile).
    async connectToServer(url, code, ask) {
      const user = await connect(url, code)   // throws on a bad URL/expired code — caller shows it
      // The account first, the address after: a copy another account still owed is kept aside
      // for it under the server it belongs to, not the one being paired.
      get().setUser(user, { adopt: true })
      if (keeping) { await keeping; keeping = null }
      pairedBase = normalizeServerUrl(url)
      setSync({ server: pairedBase })
      await get().refreshConfig()   // what this server offers (the Coach, guest mode) — see boot()
      await get().adoptProfile(ask)
      await nativePersist(true)   // the file holds this account's copy before anything else can happen
      set({ needsMobileOnboarding: false })
    },
    // Leaves remote mode and drops back to local-only, the way signOut does: never with changes
    // the server has not seen, unless `force` keeps them aside first. Same result as signOut;
    // the phone stays paired when that comes back owed and not stashed.
    async disconnectServer(opts) {
      const r = await get().signOut(opts)
      if (r.owed && !r.stashed) return r
      await forgetRemote()
      pairedBase = null
      setSync({ server: null })
      get().setGuest(true)
      set({ ready: true })
      return r
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it, under the same rule about changes still owed. Unlike
    // signOut the request is NOT swallowed: if it fails the sessions elsewhere are all still
    // valid, and wiping this device's copy of the data would sign the user out of the one place
    // the bump didn't reach. Caller reports the error.
    async signOutAll({ force = false } = {}) {
      await settle()
      const left = get().unsyncedChanges()
      if (left.owed && !force) return owedResult(left)
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      if (left.owed && !(await stashOwed())) return owedResult(left, { stashed: false })
      await clearLocalSession()
      return left.owed ? owedResult(left, { stashed: true }) : { owed: false }
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      markOwed(false)
      persist(Object.assign(clone(DEF), buildDemoState()), false)
      // The demo's photos and videos were only ever in this browser, and the reset takes them too.
      await mediaStore.clearAll().catch(() => {})
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend by default — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in. Unless this
      // device was paired to a server ("connect to my server" mode, lib/remote.js), in which
      // case it behaves exactly like the signed-in web flow below, straight from here.
      if (MOBILE) {
        const remote = await loadRemote()
        set({ coachLocal: coachDeviceSettings(await loadCoachDevice()) })
        if (remote?.mode === 'remote') {
          setRemoteAuth(remote.base, remote.token)
          pairedBase = remote.base || null
          setSync({ server: pairedBase })
          await restoreFromMirror(remote)
          try {
            const me = await api('/api/me')   // also catches a token revoked elsewhere (sign out everywhere)
            if (!me.user?.id) throw Object.assign(new Error('no user'), { status: 200, code: 'bad-response' })
            // A token past half its life comes back renewed: kept, it never runs out on a phone
            // that is used at all.
            if (typeof me.token === 'string' && me.token) await renewToken(remote, me.token)
            get().setUser(me.user)
            // The paired server's /api/config, the same one the web boot reads: without it the
            // phone never learned whether the server offers the Coach and told everyone "your
            // server has no Coach enabled" — with the admin looking at a green test.
            await get().loadConfig()
            // Closed with the pairing's question still open: asked again, and nothing is pulled
            // or pushed until it is answered — this copy may still be the one from before pairing.
            if (adoptOwed()) {
              syncReminder(get().S)
              finishBoot()
              // The adoption applies what the pull would have (its stash included); the reminder
              // then follows the copy it settled on.
              get().resumeAdoption().then(() => syncReminder(get().S))
              return
            }
            await get().pullState()
            if (!get().sync.lastError) await applyStash()   // only once the server really answered
          } catch (e) {
            // Whatever the answer — no network, a server error, a token the server no longer
            // accepts — the pairing, this copy and the account all stay, and what is owed stays
            // owed. A refused token used to unpair the phone on the spot while it went on showing
            // the account: every change after that "synced" into the app's own files (see
            // lib/api.js) and was gone on the next Disconnect. Now the screens say the server
            // refuses this phone, and pairing it again merges what it kept.
            get().setUser(remote.user || get().user)
            failed(e, { pending: owes() })
          }
          syncReminder(get().S)
          finishBoot()
          return
        }
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false, false)
        } else if (hasData(S)) {
          nativePersist(true)   // first run after an update from a file-less version: seed the mirror
        }
        if (get().user) {
          // A phone that lost its pairing to a refused token under an earlier version: that boot
          // dropped the pairing file — address and token with it — but not the account, and every
          // push since "landed" on the WebView's own asset server. No other path leaves an
          // account in local mode (Disconnect and "keep it on this phone" both leave none), so
          // this is that phone. What it holds stays owed, and the screens say it has to be paired
          // again; the address is gone, so pairing asks for it.
          markOwed(true)
          failed({ status: 0, code: 'not-paired' }, { pending: true })
        } else get().setGuest(true)
        syncReminder(get().S)
        // Only a genuinely first launch — nothing chosen yet and nothing to lose either — offers
        // the choice. Picking local (even with no data yet) persists that choice below and this
        // never asks again.
        finishBoot({ needsMobileOnboarding: !remote && !hasData(get().S) })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        finishBoot()
        return
      }
      // Opened from a device-link QR code (#95): the code comes off the address at once — a reload,
      // a bookmark or a shared screenshot of the address bar must not carry it around — and waits
      // here for the sheet that redeems it (App.jsx, components/Passkeys.jsx).
      const linkCode = linkTokenFromSearch(window.location.search)
      if (linkCode) { stripLinkFromUrl(); set({ linkCode }) }
      // Guests never authenticate, so an instance that turned guest mode off has no request to
      // refuse — the only way the switch reaches someone already inside is here, on their next
      // boot. Ending the session needs a positive `allow_guest: false`; see lib/guest.js for why
      // an unreachable server must not be allowed to lock anyone out (#42).
      const cfg = await get().loadConfig()
      if (!guestAllowed(cfg)) get().setGuest(false)
      // A sign-out that could not reach the server: finish it first. Still unanswered, the
      // browser stays signed out rather than adopt the session it left behind.
      if (logoutOwed()) {
        try { await api('/api/logout', { method: 'POST', body: '{}' }); logoutOwed(false) } catch { /* owed until it is answered */ }
        if (logoutOwed()) { finishBoot(); return }
      }
      try {
        const me = await api('/api/me')
        if (!me.user?.id) throw Object.assign(new Error('no user'), { status: 200, code: 'bad-response' })
        get().setUser(me.user)
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const restampTz = () => {
          const tz = localTZ()
          if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
            get().update(s => { s.reminder = { ...s.reminder, tz } })
          }
        }
        // Closed with the sign-in's question still open: asked again once the app is up (see the
        // phone's boot above); the adoption applies the stash, the timezone follows its copy.
        if (adoptOwed()) {
          finishBoot()
          get().resumeAdoption().then(() => { if (!adoptHold) restampTz() })
          return
        }
        await get().pullState()
        if (!get().sync.lastError) await applyStash()   // only once the server really answered
        restampTz()
      } catch (e) {
        // The session ended (expired, revoked, signed out everywhere): back to the sign-in
        // screen, which says so. The copy stays here with its owner, and signing in again as the
        // same account merges it (adoptProfile). A later reload still says so while that copy
        // owes its account changes — the user is gone by then, the owner and the copy are not —
        // unless whoever is here chose to go on as a guest.
        if (e.status === 401) {
          const kept = !!get().user || (!get().isGuest() && !!localStorage.getItem('gym_owner') && owes())
          get().setUser(null)
          if (kept) failed(e, { pending: owes() })
        }
        // Started without a network (a home-screen app reopened in the gym's basement), or
        // behind a proxy answering for the server: keep the signed-in copy and say so from the
        // first screen, not only after the first failed push.
        else if (get().user) failed(e, { pending: owes() })
      }
      finishBoot()
    }
  }
})

export { hasData }
