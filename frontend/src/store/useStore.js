import { create } from 'zustand'
import { api, setRemoteAuth } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder, writeAutoBackup } from '../lib/mobile.js'
import * as mobileApi from '../lib/mobile.js'
import { loadRemote, chooseLocal, forgetRemote, connect } from '../lib/remote.js'
import { loadSyncMeta, saveSyncMeta, loadSyncBase, saveSyncBase, mergePendingState, generationChanged } from '../lib/sync.js'
import { loadCoachDevice, saveCoachDevice, coachDeviceSettings } from '../lib/coach-device.js'

import { WC_DEFAULT } from '../lib/workout-controls.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, timerFlash: false, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
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
  // Per-exercise bar weight overrides, keyed by exercise id, in the profile unit (see
  // lib/bar.js). Personal equipment, so it syncs with the account but never travels in a
  // shared plan. Logged weights stay the total — this only feeds the plate math.
  barWeights: {},
  // Gym check-in cards (see views/CheckIn.jsx). Each is a membership
  // code shown as a QR/barcode at the gym's turnstile — added by typing it, importing a photo
  // of the card, or scanning it. We only ever keep the code's VALUE, never a photo: the image
  // is regenerated from `value` every time it's shown (lib/qr.js). `fmt` is the barcode symbology
  // ('qrcode' | 'ean13' | 'code128' | … — lower-cased BarcodeFormat) so it renders as the same
  // kind of code the gym issued. Just data, so it syncs and backs up like everything else.
  //   [{ id, label, value, fmt }]
  gymCards: [],
  // The card the check-in screen last settled on, so it reopens where you left it (handy when
  // you have more than one gym). Holds a gymCards id, or null before any card exists / is chosen;
  // a stale id (card since removed) is simply ignored by the view.
  lastGymCardId: null,
  // Whether the check-in feature is on at all (Settings toggle). Off hides the Home
  // card and the /checkin route; the saved gymCards stay so turning it back on restores them.
  // Defaults on; an older profile without the key reads as on (`!== false`).
  checkIn: true,
}
const clone = o => JSON.parse(JSON.stringify(o))

const markDirty = () => {
  try { localStorage.setItem('gym_dirty', '1') } catch { /* a broken store is reported below */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return Object.assign(clone(DEF), JSON.parse(raw))
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

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
  let pushRun = null
  let stateGeneration = 0
  let syncMeta = loadSyncMeta()
  let syncBase = loadSyncBase()

  const reportPersistenceError = kind => {
    set({ persistenceError: kind })
    try {
      globalThis.dispatchEvent(new CustomEvent('opengym:persistence-error', { detail: { kind } }))
    } catch { /* non-browser test/runtime */ }
  }

  try {
    const init = mobileApi.initReminderSync
    if (typeof init === 'function') init(() => get().S)
  } catch { /* older/test mobile adapters may not expose the optional listener */ }

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(async () => {
      saveTm = null
      try {
        const saved = await nativeSave(get().S)
        if (saved === false) { markDirty(); reportPersistenceError('native_persistence_failed') }
      } catch {
        markDirty(); reportPersistenceError('native_persistence_failed')
      }
      try { await syncReminder(get().S) } catch { /* reminder failure must not hide data failure */ }
    }, 800)
  }

  const persist = (S, push = true) => {
    stateGeneration++
    S._ts = Date.now()
    registerCustom(S.customEx)
    // Publish the new copy first. A quota error is a durability failure, not permission to throw
    // away the user's edit: in-memory state remains visible and a dirty marker keeps sync/backup
    // paths from treating the failed local write as acknowledged.
    set({ S, persistenceError: null })
    try { localStorage.setItem(KEY, JSON.stringify(S)) }
    catch { markDirty(); reportPersistenceError('local_storage_write_failed') }
    if (MOBILE) nativePersist()
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      Promise.resolve(nativeSave(get().S)).then(saved => {
        if (saved === false) { markDirty(); reportPersistenceError('native_persistence_failed') }
      }).catch(() => { markDirty(); reportPersistenceError('native_persistence_failed') })
      Promise.resolve(syncReminder(get().S)).catch(() => {})
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    syncMeta = { revision: '"0"' }; syncBase = null
    saveSyncMeta(syncMeta); saveSyncBase(null)
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,
    persistenceError: null,
    needsMobileOnboarding: false,   // mobile build only — set true by boot() on a genuine first launch
    // Mobile build only: how the Coach runs on this phone — { mode: 'off'|'server'|'byok',
    // provider, model, baseUrl } from lib/coach-device.js. Never the key, never a proposal.
    coachLocal: null,
    async setCoachLocal(patch) {
      set({ coachLocal: coachDeviceSettings(await saveCoachDevice(patch)) })
    },

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    // Fires after the moments where losing local data would actually hurt — a workout just
    // logged, a routine just edited — not on every keystroke. No-op off mobile or with the
    // setting off; the private file mirror (nativePersist, above) already covers every change.
    autoBackupNow() {
      const S = get().S
      if (MOBILE && S.autoBackup) writeAutoBackup(S)
    },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

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
    async refreshConfig() {
      try { const c = await api('/api/config'); set({ config: c }); return c }
      catch { return null }
    },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    async pushState() {
      if (!get().user) return false
      clearTimeout(pushTm)
      if (pushRun) return pushRun
      const run = (async () => {
        const payload = clone(get().S)
        const generation = stateGeneration
        // Persist the mutation id before sending. If the response is lost, the next attempt
        // replays the exact request and the API's durable receipt turns it into a no-op.
        const mutation = syncMeta.mutation || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        syncMeta = { ...syncMeta, mutation }
        saveSyncMeta(syncMeta)
        try {
          const result = await api('/api/data', {
            method: 'PUT',
            headers: { 'If-Match': syncMeta.revision || '"0"', 'Idempotency-Key': mutation },
            body: JSON.stringify({ state: payload })
          })
          const newerLocalEdit = generationChanged(generation, stateGeneration)
          syncMeta = { ...syncMeta, revision: result.revision || syncMeta.revision, mutation: undefined }
          syncBase = clone(payload); delete syncBase.active
          saveSyncMeta(syncMeta); saveSyncBase(syncBase)
          if (newerLocalEdit) {
            // A keystroke/workout landed while the request was in flight. Keep the newer local
            // state dirty and schedule a second generation with a fresh idempotency receipt.
            markDirty()
            clearTimeout(pushTm); pushTm = setTimeout(() => get().pushState(), 0)
            return false
          }
          localStorage.removeItem('gym_dirty')
          return true
        } catch (e) {
          if (e.status === 412) {
            // Pull the current revision, merge against the last acknowledged snapshot, then
            // retry once. The local state remains untouched until the merge is complete, so an
            // offline/conflicted device never loses its pending workout or routine edit.
            try {
              const current = await api('/api/data')
              if (current.state) {
                // The request snapshot may be stale by the time the 412 response arrives. Read
                // the latest store copy so edits made while the conflict fetch was in flight are
                // merged as pending work instead of being replaced by the old payload.
                const latestLocal = clone(get().S)
                const merged = mergePendingState(syncBase, latestLocal, current.state)
                syncMeta = { ...syncMeta, revision: current.revision || syncMeta.revision }
                syncBase = clone(current.state)
                saveSyncMeta(syncMeta); saveSyncBase(syncBase)
                persist(merged, false)
                pushRun = null
                return await get().pushState()
              }
            } catch { /* keep the pending local copy and dirty marker below */ }
          }
          if (e.status === 409) {
            // A lost response can leave the durable receipt tied to the previous payload. Read
            // the acknowledged server copy, merge it with the latest local edits, rotate the
            // mutation id, and retry instead of overwriting another device's work.
            try {
              const current = await api('/api/data')
              if (current.state) {
                const latestLocal = clone(get().S)
                const merged = mergePendingState(syncBase, latestLocal, current.state)
                syncMeta = { ...syncMeta, revision: current.revision || syncMeta.revision, mutation: undefined }
                syncBase = clone(current.state); saveSyncMeta(syncMeta); saveSyncBase(syncBase)
                persist(merged, false)
                markDirty()
                clearTimeout(pushTm); pushTm = setTimeout(() => get().pushState(), 0)
                return false
              }
            } catch { /* leave the pending local copy and dirty marker below */ }
          }
          markDirty()
          return false
        }
      })()
      pushRun = run
      try { return await run } finally { if (pushRun === run) pushRun = null }
    },
    async pullState() {
      try {
        // Re-read the persisted sync markers for each pull. Besides surviving a reload, this
        // prevents a cleared local session from inheriting an in-memory base from an earlier
        // account or test instance.
        syncMeta = loadSyncMeta(); syncBase = loadSyncBase()
        const result = await api('/api/data')
        const { state } = result
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        if (state && !hasData(S)) {
          const active = S.active
          const next = Object.assign(clone(DEF), state)
          if (active) next.active = active
          syncMeta = { ...syncMeta, revision: result.revision || syncMeta.revision }
          syncBase = clone(state)
          saveSyncMeta(syncMeta); saveSyncBase(syncBase)
          persist(next, false)
        } else if (state && hasData(S)) {
          const localNewer = (S._ts || 0) > (state._ts || 0)
          const preserveLocal = dirty || localNewer
          const hadBase = !!syncBase
          // With no acknowledged base, a dirty/newer device owns its local profile wholesale;
          // merging two unrelated snapshots would turn a deliberate replacement into a union.
          // Once a base exists, merge only the fields changed on each side so pending phone edits
          // and remote additions survive a 412.
          const merged = hadBase ? mergePendingState(syncBase, S, state) : (preserveLocal ? S : state)
          const active = S.active
          if (active) merged.active = active
          syncMeta = { ...syncMeta, revision: result.revision || syncMeta.revision }
          syncBase = clone(state)
          saveSyncMeta(syncMeta); saveSyncBase(syncBase)
          persist(merged, false)
          if (preserveLocal || hadBase) await get().pushState()
        } else if (hasData(S)) {
          syncMeta = { ...syncMeta, revision: result.revision || '"0"' }
          syncBase = null; saveSyncMeta(syncMeta); saveSyncBase(null)
          await get().pushState()
        } else {
          syncMeta = { ...syncMeta, revision: result.revision || '"0"' }
          syncBase = state ? clone(state) : null; saveSyncMeta(syncMeta); saveSyncBase(syncBase)
        }
      } catch (e) { /* offline — keep local */ }
    },

    async signOut() {
      const pushed = await get().pushState()
      if (!pushed || localStorage.getItem('gym_dirty') === '1') throw new Error('pending local changes could not be synced')
      await api('/api/logout', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Mobile-only ("connect to my server" onboarding, see App.jsx's needsMobileOnboarding).
    // Picking local — even before there's any data — persists the choice so onboarding never
    // asks again.
    async chooseLocalMode() {
      await chooseLocal()
      set({ needsMobileOnboarding: false })
    },
    // Redeems the pairing code shown in the browser (Settings → "Pair the mobile app") and
    // switches this device over to that account, same as signing in on the web does.
    async connectToServer(url, code) {
      const user = await connect(url, code)   // throws on a bad URL/expired code — caller shows it
      get().setUser(user)
      await get().refreshConfig()   // what this server offers (the Coach, guest mode) — see boot()
      await get().pullState()
      syncReminder(get().S)
      set({ needsMobileOnboarding: false })
    },
    // Leaves remote mode and drops cleanly back to local-only, without losing whatever was last
    // synced (signOut() already pushes before it clears).
    async disconnectServer() {
      await get().signOut()
      await forgetRemote()
      get().setGuest(true)
      set({ ready: true })
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      const pushed = await get().pushState()
      if (!pushed || localStorage.getItem('gym_dirty') === '1') throw new Error('pending local changes could not be synced')
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
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
          try {
            const me = await api('/api/me')   // also catches a token revoked elsewhere (sign out everywhere)
            get().setUser(me.user)
            // The paired server's /api/config, the same one the web boot reads: without it the
            // phone never learned whether the server offers the Coach and told everyone "your
            // server has no Coach enabled" — with the admin looking at a green test.
            await get().loadConfig()
            await get().pullState()
          } catch (e) {
            if (e.status === 401) { await forgetRemote(); get().setGuest(true) }
            else get().setUser(remote.user)   // offline — keep going from the last-synced local copy
          }
          syncReminder(get().S)
          set({ ready: true })
          return
        }
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          Promise.resolve(nativeSave(S)).then(saved => {
            if (saved === false) { markDirty(); reportPersistenceError('native_persistence_failed') }
          }).catch(() => { markDirty(); reportPersistenceError('native_persistence_failed') })
        }
        get().setGuest(true)
        syncReminder(get().S)
        // Only a genuinely first launch — nothing chosen yet and nothing to lose either — offers
        // the choice. Picking local (even with no data yet) persists that choice below and this
        // never asks again.
        set({ ready: true, needsMobileOnboarding: !remote && !hasData(get().S) })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      // Guests never authenticate, so an instance that turned guest mode off has no request to
      // refuse — the only way the switch reaches someone already inside is here, on their next
      // boot. Ending the session needs a positive `allow_guest: false`; see lib/guest.js for why
      // an unreachable server must not be allowed to lock anyone out (#42).
      const cfg = await get().loadConfig()
      if (!guestAllowed(cfg)) get().setGuest(false)
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }
