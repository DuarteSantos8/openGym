import { create } from 'zustand'
import { api, setRemoteAuth } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { MOBILE, initReminderSync, nativeLoad, nativeSave, onAppActive, syncReminder, writeAutoBackup } from '../lib/mobile.js'
import { mergeStates, localExtras } from '../lib/sync-merge.js'
import { loadRemote, chooseLocal, forgetRemote, connect } from '../lib/remote.js'
import { loadCoachDevice, saveCoachDevice, coachDeviceSettings } from '../lib/coach-device.js'

import { WC_DEFAULT } from '../lib/workout-controls.js'

const KEY = 'gym_state_v1'
// Where this device stands with the server: the revision it last adopted or pushed, and its own
// `_ts` at that moment. `rev` goes back to the server as `baseRev` on every push, so a write over
// a document this device never saw is refused (409) instead of dropping another device's work;
// `ts` tells a pull whether anything changed here since. See pushState/pullState.
const SYNC_KEY = 'gym_sync'
const CHECK_MIN_MS = 3000    // rev checks closer together than this are the same event (focus + visibility)
const POLL_MS = 30000        // while the app is open and signed in, ask the server for its revision this often
export const DEF = {
  unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, soundOnSilent: false, timerFlash: false, keepAwake: true, lang: 'en',
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
  // Decimals on displayed weights: 1 by default, 2 for anyone loading quarter plates or
  // microplates (issue #139). Display only — nothing is stored or rounded differently.
  wdec: 1,
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
  // Whether the body-weight summary card is shown on Home. Off only hides that card: existing
  // entries, Stats, imports and the separate pre-workout weigh-in flow keep working.
  // Defaults on; an older profile without the key reads as on (`!== false`).
  showWeightCard: true,
  // Whether Start opens the quick weigh-in first (sheets.jsx startFlow, issue #137). Off starts
  // the session straight away; weight can still be logged from Home/Stats. Defaults on; an
  // older profile without the key reads as on (`!== false`).
  weighIn: true,
}
const clone = o => JSON.parse(JSON.stringify(o))

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
  let toldTooLarge = false
  let pushing = null       // the PUT in flight, so a second push waits for it instead of racing it
  let pushAgain = false    // a push asked for while one was in flight — run once more after it
  let pulling = null       // the GET in flight, so two resume signals make one request
  let pushPending = false  // a change made before boot's pull — pushed once boot is through
  let forceNext = false    // the next push replaces the server copy outright (import, reset)
  let lastCheck = 0
  let pollTm = null
  let offlineChanges = false   // a push failed for lack of network — the next one that lands says so

  const readSync = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null } catch { return null } }
  const writeSync = (rev, ts) => localStorage.setItem(SYNC_KEY, JSON.stringify({ rev, ts: ts || 0 }))
  // What the banner shows a signed-in user: `offline` when the server could not be reached at
  // all, `pending` while a change is still owed to it (either way, or a push the server refused).
  const setSync = patch => {
    const cur = get().sync
    const next = { ...cur, ...patch }
    if (next.offline !== cur.offline || next.pending !== cur.pending || next.lastSynced !== cur.lastSynced) set({ sync: next })
  }
  const isNetworkError = e => e && e.status == null   // fetch itself failed: no response at all

  initReminderSync(() => get().S)

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  // `_ts` is when this device last changed the data — it decides which copy wins on the next
  // pull (restoredStateFor). A copy merely adopted from the server or the file mirror keeps the
  // stamp it came with: re-stamping a read would make an unchanged copy look newer than a real
  // change made on another device, and push it over that change.
  const persist = (S, push = true, stamp = true) => {
    if (stamp) S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
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
    if (pulling) return pulling
    const sync = readSync()
    const owed = localStorage.getItem('gym_dirty') === '1' || pushTm !== null || pushPending
    if (!sync || owed) return get().pullState()
    try {
      const { rev } = await api('/api/data/rev')
      setSync({ offline: false })
      if (rev !== sync.rev) return get().pullState()
    } catch (e) {
      if (e.status === 401) return
      if (isNetworkError(e)) setSync({ offline: true })
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
  // real change this device now holds — while `ts` in the marker stays old, so a pull that
  // happens before the push lands still sees it as unsent.
  const mergeInto = (local, remote, rev) => {
    const merged = Object.assign(clone(DEF), mergeStates(local, remote))
    merged.active = local.active || null
    persist(merged, false)
    writeSync(rev, readSync()?.ts || 0)
  }
  // Take the server's copy as this device's own, timestamp and all (see persist).
  const adopt = (next, rev) => { persist(next, false, false); writeSync(rev, next._ts) }

  const doPush = async (attempt = 0) => {
    const S = get().S
    const sync = readSync()
    const force = forceNext
    const body = { state: S }
    if (!force && sync) body.baseRev = sync.rev
    try {
      const r = await api('/api/data', { method: 'PUT', body: JSON.stringify(body) })
      if (force) forceNext = false
      // A server from before revisions answers without one — then there is nothing to hold the
      // next push to, and the marker must not pretend otherwise.
      if (r.rev == null) localStorage.removeItem(SYNC_KEY)
      else writeSync(r.rev, S._ts)
      localStorage.removeItem('gym_dirty')
      toldTooLarge = false
      // Back from offline with changes that were waiting: say so once — the banner that promised
      // "syncs when you're back online" has just kept its word.
      setSync({ offline: false, pending: false, lastSynced: Date.now() })
      if (offlineChanges) {
        offlineChanges = false
        import('./useUI.js').then(({ useUI }) => useUI.getState().toast(t('Back online — synced with the server.'))).catch(() => {})
      }
    } catch (e) {
      // A session that is gone is boot's business (/api/me); the copy stays owed to the server.
      if (e.status === 401) { localStorage.setItem('gym_dirty', '1'); return }
      if (isNetworkError(e)) { localStorage.setItem('gym_dirty', '1'); offlineChanges = true; setSync({ offline: true, pending: true }); return }
      if (e.status === 409 && e.data && attempt < 2) {
        // Another device wrote since this one last read. The server sent its document along;
        // merge and push once more against that revision. A second refusal in a row leaves the
        // copy dirty and the next resume pull takes it from there.
        mergeInto(get().S, e.data.state, e.data.rev || 0)
        return doPush(attempt + 1)
      }
      localStorage.setItem('gym_dirty', '1')
      setSync({ offline: false, pending: true })
      // A 413 comes from the proxy in front of the API (nginx: client_max_body_size), which
      // caps the request body. Every later push is at least as big, so nothing reaches the
      // server until the limit is raised — said once per refusal streak; gym_dirty keeps the
      // retries going. useUI imports this store, hence the lazy import.
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
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
      syncReminder(get().S)
    }
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
    set({ user: null, S: e.newValue ? loadState() : clone(DEF) })
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered. The owner
  // goes last, after the wiped copy is written — the storage listener above relies on the order.
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(SYNC_KEY)
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
    localStorage.removeItem('gym_owner')
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,
    // Server sync as the banner sees it (components/SyncBanner.jsx). Only meaningful signed in.
    sync: { offline: false, pending: localStorage.getItem('gym_dirty') === '1', lastSynced: 0 },
    /* Instance capabilities from GET /api/config. `config.coach` is present only when the owner
       has both enabled the Coach and connected a provider — every Coach entry point in the app
       hangs off it via coachAvailable(), so an unconfigured instance renders exactly what it
       always did, and a configured one is the only place any of it appears. */
    config: null,
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
    // A replace that is meant to reach the server (backup import, reset) is a deliberate
    // overwrite, not a change to merge: the push it arms goes without a baseRev.
    replaceState(S, push = false) { if (push) forceNext = true; persist(clone(S), push) },

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
      if (u) {
        // The local copy belongs to whoever last signed in here. When a session expires or is
        // revoked elsewhere, boot() only drops the user and the data stays; a different profile
        // signing in next must not inherit it (pullState would push it into that account, and
        // carry the in-progress workout along). A proper sign-out clears the owner, so a guest's
        // data still moves into a freshly created profile.
        const owner = localStorage.getItem('gym_owner')
        if (owner && owner !== u.id) {
          localStorage.removeItem('gym_dirty')
          localStorage.removeItem(SYNC_KEY)
          localStorage.removeItem(KEY)
          persist(clone(DEF), false)
        }
        localStorage.setItem('gym_owner', u.id)
        localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest')
      } else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    // One PUT at a time: a push asked for while one is in flight runs after it (once, however
    // many asked), and the promise returned covers that follow-up too, so a caller that awaits
    // before signing out knows the last change is on the server.
    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      pushTm = null
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
      if (pulling) return pulling
      pulling = (async () => {
        try {
          if (pushTm) { clearTimeout(pushTm); pushTm = null; await get().pushState() }
          else if (pushing) await pushing
          const res = await api('/api/data')
          lastCheck = Date.now()
          setSync({ offline: false })
          const { state, rev } = res
          const S = get().S
          // Owed to the server: a push that failed, or a change made while boot was still pulling.
          const dirty = localStorage.getItem('gym_dirty') === '1' || pushPending
          const sync = readSync()
          // A server from before revisions: the old rule, newer `_ts` wins outright.
          if (rev == null) {
            localStorage.removeItem(SYNC_KEY)
            const restored = restoredStateFor(S, state, dirty)
            if (restored) persist(restored, false, false)
            else if (hasData(S)) await get().pushState()
            return
          }
          // No marker yet — first pull on this device, or a client that just learned about
          // revisions. The newer copy wins as before, except that a copy still owed to the
          // server (dirty) is merged instead of pushed over whatever is there.
          if (!sync) {
            if (dirty && state) { mergeInto(S, state, rev); pushPending = false; await get().pushState(); return }
            const restored = restoredStateFor(S, state, false)
            if (restored) adopt(restored, rev)
            else if (hasData(S)) { writeSync(rev, 0); await get().pushState() }
            else writeSync(rev, state?._ts || 0)
            return
          }
          const serverMoved = rev !== sync.rev
          const localChanged = dirty || (S._ts || 0) > (sync.ts || 0)
          if (!serverMoved) { if (localChanged) await get().pushState(); return }
          if (!state) { writeSync(rev, 0); if (hasData(S)) await get().pushState(); return }
          if (!localChanged) { adopt(Object.assign(clone(DEF), state, { active: S.active || null }), rev); return }
          mergeInto(S, state, rev)
          pushPending = false
          await get().pushState()
        } catch (e) { if (isNetworkError(e)) setSync({ offline: true }) /* keep local; the poll retries */ }
        finally { pulling = null }
      })()
      return pulling
    },

    // Sign-in (and pairing a phone) takes the server's profile as this device's copy — the
    // profile is the truth for a signed-in user, whatever the timestamps say. The only thing
    // the device may add are the entries it logged while signed out: `ask(extras)` (a dialog,
    // supplied by the caller) decides whether those workouts, weigh-ins and custom exercises
    // are added to the profile or dropped. A profile with no state yet simply takes the
    // device's data, as creating a profile always did.
    async adoptProfile(ask) {
      if (pulling) await pulling
      const res = await api('/api/data')   // a failure here is the caller's toast: sign-in needed the server anyway
      const { state, rev } = res
      const S = get().S
      setSync({ offline: false })
      if (!state) {
        localStorage.removeItem('gym_dirty')
        if (hasData(S)) { if (rev != null) writeSync(rev, 0); forceNext = true; await get().pushState() }
        else if (rev != null) writeSync(rev, 0)
        return { adopted: false, added: false }
      }
      const extras = localExtras(S, state)
      const keep = (extras.workouts || extras.bodyweight || extras.customEx) && typeof ask === 'function' ? await ask(extras) : false
      const serverCopy = Object.assign(clone(DEF), state, { active: S.active || null })
      if (keep) {
        const merged = Object.assign(clone(DEF), mergeStates(state, S, { prefer: 'a' }))
        merged.active = S.active || null
        persist(merged, false)
        if (rev != null) writeSync(rev, 0)
        else localStorage.removeItem(SYNC_KEY)
        await get().pushState()
        return { adopted: true, added: true }
      }
      localStorage.removeItem('gym_dirty')
      if (rev != null) adopt(serverCopy, rev)
      else { localStorage.removeItem(SYNC_KEY); persist(serverCopy, false, false) }
      setSync({ pending: false })
      return { adopted: true, added: false }
    },

    async signOut() {
      try { await get().pushState(); await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { /* */ }
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
    async connectToServer(url, code, ask) {
      const user = await connect(url, code)   // throws on a bad URL/expired code — caller shows it
      get().setUser(user)
      await get().refreshConfig()   // what this server offers (the Coach, guest mode) — see boot()
      await get().adoptProfile(ask)
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
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
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
            else { get().setUser(remote.user); setSync({ offline: true }) }   // offline — keep going from the last-synced local copy
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
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
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
        // Started without a network (a home-screen app reopened in the gym's basement): keep the
        // signed-in copy and say so from the first screen, not only after the first failed push.
        else if (isNetworkError(e) && get().user) setSync({ offline: true })
      }
      finishBoot()
    }
  }
})

export { hasData }