// @vitest-environment happy-dom
// Sync robustness of the Firestore transport: (1) a failed push is owed and
// retried when the window comes back online (plus one backoff retry), a failed
// initial load leaves the wake triggers armed so attach re-runs, and a snapshot
// error is logged and marked for a wake re-check; (2) fbSignOut flushes a push
// still inside its debounce window BEFORE the sign-out itself, while the
// client is still authenticated (the fake Firestore refuses unauthenticated
// writes, as the real rules do); (3) the cached
// passkey username is scoped to the uid, never served to another account;
// (4) a push larger than one Firestore batch lands in chunks. Everything runs
// against an in-memory fake Firestore: no Firebase SDK, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  docs: new Map(), authCb: null, commits: 0, batchSizes: [],
  failCommits: 0, // next N batch commits throw
  failReads: false, // getDoc/getDocs throw (initial load cannot complete)
  getDocCalls: 0,
  snapErrs: [], // the error callbacks handed to onSnapshot, per registration
  authedUid: null, // the uid the fake Firestore currently treats as signed in
}))

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  setPersistence: async () => {},
  browserLocalPersistence: {},
  onAuthStateChanged: (auth, cb) => { h.authCb = cb; return () => {} },
  getRedirectResult: async () => null,
  // Firebase clears the auth before it fires the listener: from this line on
  // the fake Firestore refuses writes, exactly as the real rules do.
  signOut: async () => { h.authedUid = null; if (h.authCb) h.authCb(null) },
}))
vi.mock('firebase/firestore', () => {
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
  const ref = path => ({ path })
  return {
    initializeFirestore: () => ({}),
    getFirestore: () => ({}),
    persistentLocalCache: () => ({}),
    persistentMultipleTabManager: () => ({}),
    doc: (a, ...seg) => ref([a?.path, ...seg].filter(x => x != null && x !== '').join('/')),
    collection: (db, ...seg) => ref(seg.join('/')),
    serverTimestamp: () => 424242,
    getDoc: async r => {
      h.getDocCalls++
      if (h.failReads) throw new Error('read failed')
      return { exists: () => h.docs.has(r.path), data: () => clone(h.docs.get(r.path)) }
    },
    getDocs: async c => {
      if (h.failReads) throw new Error('read failed')
      return {
        forEach(cb) {
          for (const [p, v] of h.docs) {
            if (!p.startsWith(c.path + '/')) continue
            const id = p.slice(c.path.length + 1)
            if (id.includes('/')) continue
            cb({ id, data: () => clone(v) })
          }
        },
      }
    },
    writeBatch: () => {
      const ops = []
      return {
        set: (r, v) => ops.push(['set', r.path, clone(v)]),
        delete: r => ops.push(['del', r.path]),
        commit: async () => {
          if (!h.authedUid) throw new Error('permission-denied')
          if (h.failCommits > 0) { h.failCommits--; throw new Error('commit failed') }
          if (ops.length > 500) throw new Error('batch over 500 operations')
          h.commits++
          h.batchSizes.push(ops.length)
          for (const [op, p, v] of ops) { if (op === 'set') h.docs.set(p, v); else h.docs.delete(p) }
        },
      }
    },
    onSnapshot: (r, cb, err) => { h.snapErrs.push(err); return () => {} },
  }
})
vi.mock('./firebase-config.js', () => ({ firebaseConfig: { apiKey: 'x' }, firebaseEnabled: true }))

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await tick(5) }
// Poll for a condition instead of sleeping a fixed span: fixed sleeps starve
// under a loaded full-suite run, a condition is met as soon as it is true.
const waitFor = async (fn, ms = 15000) => {
  const t0 = Date.now()
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('waitFor timed out'); await tick(25) }
}

const baseS = (over = {}) => ({
  unit: 'kg', week: {}, dayPlan: {}, exWeights: {}, workouts: [], routines: [],
  customEx: [], bodyweight: [], measurements: [], active: null, ...over,
})

function fakeStore(S) {
  const listeners = new Set()
  const state = {
    S,
    replaceState(next) { state.S = next; for (const fn of [...listeners]) fn() },
  }
  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    setS(next) { state.S = next; for (const fn of [...listeners]) fn() },
    state,
  }
}

let store, mod
async function signIn(S, uid = 'u1') {
  vi.resetModules()
  h.docs = new Map(h.docs)
  mod = await import('./firestore-sync.js')
  store = fakeStore(S)
  mod.startFirestoreSync(store)
  await flush()
  h.authCb({ uid, email: '', displayName: '', providerData: [] })
  h.authedUid = uid
  await flush(30)
  return store
}

beforeEach(() => {
  localStorage.clear()
  h.docs = new Map(); h.commits = 0; h.batchSizes = []; h.authCb = null
  h.failCommits = 0; h.failReads = false; h.getDocCalls = 0; h.snapErrs = []; h.authedUid = null
})
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('firestore-sync retry triggers', { timeout: 60000 }, () => {
  it('a failed debounced push is owed and lands when the window comes back online', async () => {
    await signIn(baseS())
    h.failCommits = 1 // the debounced push's commit throws
    store.setS(baseS({ routines: [{ id: 'r-fail', name: 'Retry Day' }] }))
    // Wait until the ~800 ms debounce has fired and the failing commit was attempted:
    // the push failed, the edit is owed, sync would once have died here.
    await waitFor(() => h.failCommits === 0, 20000)
    expect(h.docs.has('users/u1/routines/r-fail')).toBe(false)
    window.dispatchEvent(new Event('online'))
    await waitFor(() => h.docs.has('users/u1/routines/r-fail'), 20000)
    expect(h.docs.get('users/u1/routines/r-fail')).toMatchObject({ name: 'Retry Day' })
  }, 60000) // first test in the file carries the cold module import on a loaded machine

  it('an initial-load failure is re-run on online: attach completes and a later edit pushes', async () => {
    h.failReads = true
    await signIn(baseS({ routines: [{ id: 'r-revive', name: 'Back Again' }] }))
    // The load threw before listeners/subscription were installed: nothing uploaded.
    expect(h.docs.has('users/u1')).toBe(false)
    h.failReads = false
    window.dispatchEvent(new Event('online'))
    await flush(40)
    expect(h.docs.get('users/u1/routines/r-revive')).toMatchObject({ name: 'Back Again' })
    // The re-run attach installed the store subscription: a later edit pushes normally.
    store.setS(baseS({ routines: [{ id: 'r-revive', name: 'Back Again' }, { id: 'r-after', name: 'After' }] }))
    await tick(1000)
    expect(h.docs.get('users/u1/routines/r-after')).toMatchObject({ name: 'After' })
  }, 20000)

  it('a snapshot error is logged (not silent) and the next online event re-checks by re-attaching', async () => {
    await signIn(baseS())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errCb = h.snapErrs.at(-1)
    expect(typeof errCb).toBe('function')
    errCb(new Error('listener died'))
    expect(warn.mock.calls.some(c => String(c[0]).includes('snapshot'))).toBe(true)
    warn.mockRestore()
    h.getDocCalls = 0
    window.dispatchEvent(new Event('online'))
    await flush(40)
    expect(h.getDocCalls).toBeGreaterThan(0) // a fresh attach re-read the account
  }, 20000)
})

describe('firestore-sync sign-out flush', { timeout: 30000 }, () => {
  it('fbSignOut flushes a push still inside its debounce window, before signing out', async () => {
    await signIn(baseS())
    store.setS(baseS({ routines: [{ id: 'r-bye', name: 'Last Seconds' }] }))
    // Sign out NOW, well inside the ~800 ms debounce. The flush has to land
    // while the client is still authenticated: the fake refuses writes once
    // signOut clears the auth (as the real rules do), so a flush riding the
    // auth-state callback in detach would be rejected with permission-denied.
    await mod.fbSignOut()
    await flush(20)
    expect(h.docs.get('users/u1/routines/r-bye')).toMatchObject({ name: 'Last Seconds' })
    // The cleared debounce does not fire a second, resurrecting push afterwards.
    const commitsAfterFlush = h.commits
    await tick(1000)
    expect(h.commits).toBe(commitsAfterFlush)
  }, 20000)
})

describe('firestore-sync username cache scoping', { timeout: 30000 }, () => {
  it('a name cached for uid A is not applied to uid B; uid A still gets its name', async () => {
    // The scoped key the module writes (gym_fb_username:<uid>), plus the legacy
    // device-global key a pre-fix build may have left behind: neither may leak to B.
    localStorage.setItem('gym_fb_username:uA', 'AliceA')
    localStorage.setItem('gym_fb_username', 'AliceA')
    await signIn(baseS(), 'uB')
    expect(mod.currentFbUser()?.uid).toBe('uB')
    expect(mod.currentFbUser()?.username).toBe('')
    h.authCb({ uid: 'uA', email: '', displayName: '', providerData: [] })
    h.authedUid = 'uA'
    await flush(30)
    expect(mod.currentFbUser()?.uid).toBe('uA')
    expect(mod.currentFbUser()?.username).toBe('AliceA')
  }, 20000)
})

describe('firestore-sync chunked pushes', { timeout: 30000 }, () => {
  it('a first sync of 600 workouts lands in batches under the 500-operation limit', async () => {
    const workouts = Array.from({ length: 600 }, (_, i) => ({ id: `w${i}`, d: '2026-10-20', start: 1000 + i, entries: [] }))
    await signIn(baseS({ workouts }))
    await waitFor(() => [...h.docs.keys()].filter(p => p.startsWith('users/u1/workouts/')).length === 600, 20000)
    const landed = [...h.docs.keys()].filter(p => p.startsWith('users/u1/workouts/')).length
    expect(landed).toBe(600)
    expect(h.batchSizes.length).toBeGreaterThan(1)
    expect(Math.max(...h.batchSizes)).toBeLessThanOrEqual(500)
  }, 20000)
})
