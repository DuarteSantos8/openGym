// @vitest-environment happy-dom

/* A paired phone whose server stops accepting it (Discord report, v1.3.8): a token expired or
   revoked by "sign out everywhere", a secret that did not survive a migration, a proxy in front
   refusing the Bearer header. It used to unpair itself silently on the next cold start while it
   went on showing the account; every change after that "synced" into Capacitor's own asset
   server (which answers any path, PUT included, with index.html and a 200), and Disconnect then
   wiped the week that only the phone had. Here the phone keeps its pairing, its account and its
   data, says the server refuses it, and pairing it again merges what it kept.

   Real modules: store/useStore.js, lib/api.js, lib/remote.js, lib/mobile.js. Mocked: the
   Capacitor plugins (an in-memory Directory.Data), and fetch, which plays the self-hosted server
   at BASE and Capacitor's local server for any other URL. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncFingerprint } from '../lib/sync-changes.js'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')   // lib/mobile.js: MOBILE = import.meta.env.VITE_MOBILE === '1'
  // `refuse`: file names whose writes fail, like a full disk.
  return { files: new Map(), server: null, calls: [], refuse: new Set() }
})

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path, directory }) => {
      const k = directory + '/' + path
      if (!h.files.has(k)) throw new Error('File does not exist')
      return { data: h.files.get(k) }
    },
    writeFile: async ({ path, directory, data }) => {
      if (h.refuse.has(path)) throw new Error('No space left on device')
      h.files.set(directory + '/' + path, data)
      return { uri: 'file://' + path }
    },
  },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { cancel: async () => {}, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), schedule: async () => {} },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: () => ({ remove() {} }) } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true }, registerPlugin: () => ({}) }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

const BASE = 'https://gym.example.com'
const USER = { id: 'u1', name: 'andi', admin: true }
const clone = v => JSON.parse(JSON.stringify(v))
const workout = (id, d) => ({ id, d, start: 1, entries: [] })
const routine = (id, reps) => ({ id, name: id, ex: [{ id: 'bench', sets: 2, reps }] })
const INDEX_HTML = '<!doctype html><html><head><title>openGym</title></head><body><div id="root"></div></body></html>'
const res = (status, body, type = 'application/json') => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? type : null) },
  json: async () => JSON.parse(body),
  text: async () => body,
})
const json = (status, body) => res(status, JSON.stringify(body))

function installFetch() {
  h.calls = []
  globalThis.fetch = window.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    h.calls.push({ url: String(url), method, auth: init.headers?.Authorization || null, body: init.body ? JSON.parse(init.body) : null })
    if (String(url).startsWith(BASE)) return h.server(String(url).slice(BASE.length), method, init)
    // Capacitor's WebViewLocalServer: index.html and 200 for every extension-less path, any method.
    const last = String(url).split('?')[0].split('/').pop()
    return last.includes('.') ? res(404, '') : res(200, INDEX_HTML, 'text/html')
  })
}
const refusing = () => json(401, { error: 'not signed in' })
// Refuses the pairing token at /api/me like `refusing`, but still answers GET /api/config - the
// one route a refused phone's boot reads for free, since that route is public.
const refusingButConfigured = oidc => path => (
  path === '/api/config' ? json(200, { invite_only: false, allow_guest: true, oidc }) : refusing()
)
// The paired server, as api/server.js answers: a revision per document, 409 on a stale baseRev.
function serverWith(doc) {
  const srv = { doc: clone(doc), puts: [] }
  srv.handle = (path, method, init) => {
    if (path === '/api/me') return json(200, { user: USER })
    if (path === '/api/config') return json(200, { invite_only: false, allow_guest: true })
    if (path === '/api/pair/redeem') return json(200, { token: 'TOKEN-NEW', user: USER })
    if (path === '/api/data/rev') return json(200, { rev: srv.doc._rev })
    if (path === '/api/data' && method === 'GET') return json(200, { state: clone(srv.doc), rev: srv.doc._rev })
    if (path === '/api/data' && method === 'PUT') {
      const body = JSON.parse(init.body)
      srv.puts.push(body)
      if (body.baseRev != null && body.baseRev !== srv.doc._rev) return json(409, { error: 'conflict', rev: srv.doc._rev, state: clone(srv.doc) })
      srv.doc = { ...body.state, _rev: srv.doc._rev + 1 }
      delete srv.doc.active
      return json(200, { ok: true, rev: srv.doc._rev })
    }
    if (path === '/api/logout') return json(200, { ok: true })
    return json(404, { error: 'not found' })
  }
  h.server = srv.handle
  return srv
}

const readFile = name => { const v = h.files.get('DATA/' + name); return v == null ? null : JSON.parse(v) }
const serverCalls = () => h.calls.filter(c => c.url.startsWith(BASE))
const localCalls = () => h.calls.filter(c => !c.url.startsWith(BASE))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ids = xs => (xs || []).map(x => x.id)

// Server rev 5 holds w1 and the push-day routine at 10 reps; the phone is paired and in step.
const SERVER_STATE = { _ts: 1000, _rev: 5, unit: 'kg', restSec: 90, workouts: [workout('w1', '2026-09-10')], routines: [routine('push', 10)], bodyweight: [] }
let DEF
beforeAll(async () => { DEF = (await import('./useStore.js')).DEF })
// `synced`: it last agreed with the server under this version, so it knows what that copy was.
function pairedPhone({ localStorage: withLocal = true, mirror, synced = true } = {}) {
  h.files.clear()
  localStorage.clear()
  const S = { ...clone(DEF), ...clone(SERVER_STATE) }
  delete S._rev
  h.files.set('DATA/opengym-remote.json', JSON.stringify({ mode: 'remote', base: BASE, token: 'TOKEN-OLD', user: USER }))
  h.files.set('DATA/opengym-state.json', JSON.stringify(mirror || S))
  h.files.set('DATA/opengym-state-owner.json', JSON.stringify({ owner: USER.id, ts: (mirror || S)._ts }))
  if (withLocal) {
    localStorage.setItem('gym_state_v1', JSON.stringify(S))
    localStorage.setItem('gym_user', JSON.stringify(USER))
    localStorage.setItem('gym_owner', USER.id)
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 5, ts: 1000 }))
    if (synced) localStorage.setItem('gym_synced_fp', JSON.stringify(syncFingerprint(S)))
  }
}
// What an earlier version left on a phone after the boot 401: the account, but a pairing file
// that says local, and no marker or dirty flag (the fake pushes into index.html cleared them).
function zombiePhone(local) {
  h.files.clear()
  localStorage.clear()
  localStorage.setItem('gym_user', JSON.stringify(USER))
  localStorage.setItem('gym_owner', USER.id)
  localStorage.setItem('gym_guest', '1')
  localStorage.setItem('gym_state_v1', JSON.stringify(local))
  h.files.set('DATA/opengym-remote.json', JSON.stringify({ mode: 'local' }))
  h.files.set('DATA/opengym-state.json', JSON.stringify(local))
}

// Every test boots its own store; the ones before it must not write into its files. Their
// debounced mirror write and push are flushed the way a page being hidden flushes them, then
// they are signed out so no poll of theirs runs later.
let stores = []
async function freshStore() {
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  stores.push(useStore)
  return useStore
}

beforeEach(() => { installFetch(); h.refuse.clear() })
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  await sleep(20)
  for (const s of stores) s.setState({ user: null, ready: false })
  stores = []
  localStorage.clear()
})

describe('boot when the server refuses the pairing token', () => {
  it('keeps the pairing, the account and the data, and says the server refuses this phone', async () => {
    pairedPhone()
    h.server = refusing
    const useStore = await freshStore()
    await useStore.getState().boot()
    const st = useStore.getState()

    expect(readFile('opengym-remote.json')).toEqual({ mode: 'remote', base: BASE, token: 'TOKEN-OLD', user: USER })
    expect(st.user).toEqual(USER)
    expect(st.isGuest()).toBe(false)
    expect(st.sync).toMatchObject({ status: 'auth', auth: true, lastError: { status: 401, code: 'auth' }, server: BASE })
    // The best-effort config read also got refused here (every path does): its own failure is
    // swallowed and changes nothing else about the refused path above.
    expect(st.config).toBeNull()
  })

  it('still learns whether its remembered server offers a provider, from the public GET /api/config', async () => {
    pairedPhone()
    h.server = refusingButConfigured({ name: 'Google' })
    const useStore = await freshStore()
    await useStore.getState().boot()
    const st = useStore.getState()

    expect(st.sync).toMatchObject({ status: 'auth', auth: true, lastError: { status: 401, code: 'auth' }, server: BASE })
    expect(st.config?.oidc).toEqual({ name: 'Google' })
    // The rest of the refused path's own guarantees are exactly as they are without a provider.
    expect(st.user).toEqual(USER)
    expect(readFile('opengym-remote.json')).toEqual({ mode: 'remote', base: BASE, token: 'TOKEN-OLD', user: USER })
  })

  it('a change made meanwhile goes to the paired server with the token, and stays owed', async () => {
    pairedPhone()
    h.server = refusing
    const useStore = await freshStore()
    await useStore.getState().boot()
    h.calls = []

    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().pushState()

    expect(localCalls()).toHaveLength(0)
    expect(serverCalls()).toEqual([expect.objectContaining({ url: BASE + '/api/data', method: 'PUT', auth: 'Bearer TOKEN-OLD' })])
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(useStore.getState().sync).toMatchObject({ status: 'auth', pending: true, lastSynced: 0 })
    expect(useStore.getState().unsyncedChanges()).toEqual({ owed: true, count: 1 })
  })

  it('a phone that last synced under an older version knows a change is owed, not how many', async () => {
    pairedPhone({ synced: false })
    h.server = refusing
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().pushState()
    expect(useStore.getState().unsyncedChanges()).toEqual({ owed: true, count: null })
  })

  it('the next cold start asks the server again, and heals by itself once it accepts the token', async () => {
    pairedPhone()
    h.server = refusing
    let useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().pushState()

    const srv = serverWith(SERVER_STATE)   // the proxy in front was fixed
    useStore = await freshStore()
    await useStore.getState().boot()
    expect(srv.puts.at(-1)).toMatchObject({ baseRev: 5 })
    expect(ids(srv.doc.workouts)).toEqual(['w1', 'w2'])
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    expect(useStore.getState().sync).toMatchObject({ status: 'ok', auth: false, pending: false })
    expect(useStore.getState().sync.lastSynced).toBeGreaterThan(0)
  })

  it('a 200 page that is not the server\'s answer is an error, not a sign-out', async () => {
    pairedPhone()
    h.server = () => res(200, INDEX_HTML, 'text/html')
    const useStore = await freshStore()
    await useStore.getState().boot()
    const st = useStore.getState()
    expect(st.user).toEqual(USER)
    expect(localStorage.getItem('gym_user')).not.toBeNull()
    expect(st.sync).toMatchObject({ status: 'error', lastError: { status: 200, code: 'bad-response' } })
    expect(readFile('opengym-remote.json')).toMatchObject({ mode: 'remote' })
  })

  it('mid-session, a refused push and a refused pull say so instead of passing in silence', async () => {
    pairedPhone()
    serverWith(SERVER_STATE)
    const useStore = await freshStore()
    await useStore.getState().boot()
    expect(useStore.getState().sync.status).toBe('ok')

    h.server = refusing
    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().pushState()
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(useStore.getState().sync).toMatchObject({ status: 'auth', pending: true })
    expect(await useStore.getState().syncNow()).toMatchObject({ status: 'auth', lastError: { status: 401 } })
  })
})

describe('a phone an earlier version already unpaired', () => {
  const week = () => ({ ...clone(SERVER_STATE), _ts: 3000, _rev: undefined, restSec: 60, routines: [routine('push', 15), routine('new-plan', 8)], workouts: [workout('w1', '2026-09-10'), workout('w-week', '2026-09-18')] })

  it('is recognised at boot: its data is owed, nothing goes to the app\'s own asset server, and it asks to be paired again', async () => {
    zombiePhone(week())
    const useStore = await freshStore()
    await useStore.getState().boot()
    expect(useStore.getState().user).toEqual(USER)
    expect(useStore.getState().sync).toMatchObject({ status: 'auth', lastError: { status: 0, code: 'not-paired' }, server: null, pending: true })
    expect(localStorage.getItem('gym_dirty')).toBe('1')

    useStore.getState().update(s => { s.restSec = 45 })
    await useStore.getState().pushState()
    await useStore.getState().syncNow()
    expect(h.calls).toHaveLength(0)                       // not a single request, anywhere
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(useStore.getState().sync.status).toBe('auth')
  })

  it('pairing it again with the same account merges the week, the routine edits and the settings — no question asked', async () => {
    zombiePhone(week())
    const useStore = await freshStore()
    await useStore.getState().boot()
    const srv = serverWith(SERVER_STATE)
    const ask = vi.fn(async () => false)

    await useStore.getState().connectToServer('gym.example.com', 'ABCD2345', ask)

    expect(ask).not.toHaveBeenCalled()
    const S = useStore.getState().S
    expect(ids(S.workouts)).toEqual(['w1', 'w-week'])
    expect(S.routines.find(r => r.id === 'push').ex[0].reps).toBe(15)
    expect(ids(S.routines).sort()).toEqual(['new-plan', 'push'])
    expect(S.restSec).toBe(60)
    expect(srv.puts.at(-1).baseRev).toBe(5)
    expect(ids(srv.doc.workouts)).toEqual(['w1', 'w-week'])
    expect(useStore.getState().sync).toMatchObject({ status: 'ok', server: BASE, auth: false })
    expect(readFile('opengym-remote.json')).toMatchObject({ mode: 'remote', base: BASE, token: 'TOKEN-NEW' })
  })

  it('Disconnect does not wipe the week the server never saw', async () => {
    zombiePhone(week())
    const useStore = await freshStore()
    await useStore.getState().boot()
    await sleep(900)                                      // the file mirror's debounce

    const r = await useStore.getState().disconnectServer()

    expect(r).toMatchObject({ owed: true })
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-week'])
    expect(localStorage.getItem('gym_state_v1')).toContain('w-week')
    await sleep(900)
    expect(ids(readFile('opengym-state.json').workouts)).toEqual(['w1', 'w-week'])
    expect(useStore.getState().user).toEqual(USER)
    expect(h.calls).toHaveLength(0)
  })
})

describe('Disconnect anyway keeps the owed changes for the next pairing', () => {
  it('stashes them in storage and in a file, wipes the phone, and merges them back when paired to the same server and account', async () => {
    pairedPhone()
    h.server = refusing
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().pushState()

    expect(await useStore.getState().disconnectServer()).toEqual({ owed: true, count: 1 })
    const r = await useStore.getState().disconnectServer({ force: true })
    expect(r).toEqual({ owed: true, count: 1, stashed: true })
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().S.workouts).toEqual([])
    expect(readFile('opengym-remote.json')).toEqual({ mode: 'local' })
    expect(useStore.getState().sync).toMatchObject({ status: 'local', server: null })
    const stash = readFile('opengym-stash.json')
    expect(Object.keys(stash)).toEqual([BASE + '|u1'])
    expect(ids(stash[BASE + '|u1'].state.workouts)).toEqual(['w1', 'w2'])
    expect(JSON.parse(localStorage.getItem('gym_stash'))[BASE + '|u1']).toBeTruthy()

    // localStorage lost as well: the file alone brings it back.
    localStorage.removeItem('gym_stash')
    const srv = serverWith({ ...SERVER_STATE, workouts: [...SERVER_STATE.workouts, workout('w-web', '2026-09-16')], _rev: 6 })
    await useStore.getState().connectToServer('gym.example.com', 'ABCD2345', vi.fn(async () => false))

    expect(ids(srv.doc.workouts).sort()).toEqual(['w-web', 'w1', 'w2'])
    expect(ids(useStore.getState().S.workouts).sort()).toEqual(['w-web', 'w1', 'w2'])
    expect(readFile('opengym-stash.json')).toEqual({})
    expect(localStorage.getItem('gym_stash')).toBeNull()
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  it('killed straight after, the next start is local and empty: the account\'s copy is in the stash, not back on the screen', async () => {
    pairedPhone()
    h.server = refusing
    let useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().pushState()
    await sleep(900)
    expect(await useStore.getState().disconnectServer({ force: true })).toMatchObject({ stashed: true })

    useStore = await freshStore()
    await useStore.getState().boot()
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().S.workouts).toEqual([])
    expect(ids(readFile('opengym-stash.json')[BASE + '|u1'].state.workouts)).toEqual(['w1', 'w2'])
  })

  it('a stash for another account stays where it is', async () => {
    pairedPhone()
    h.server = refusing
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().disconnectServer({ force: true })

    const srv = serverWith(SERVER_STATE)
    h.server = (path, method, init) => (path === '/api/pair/redeem' ? json(200, { token: 'T2', user: { id: 'u2', name: 'bea' } }) : srv.handle(path, method, init))
    await useStore.getState().connectToServer('gym.example.com', 'ABCD2345', vi.fn(async () => false))
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1'])
    expect(Object.keys(readFile('opengym-stash.json'))).toEqual([BASE + '|u1'])
  })
})

describe('another account paired on a phone that still owes the first', () => {
  it('keeps the first account\'s changes aside under its own server, and gives them back when it pairs again', async () => {
    pairedPhone()
    h.server = refusing
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().pushState()

    const srv = serverWith(SERVER_STATE)
    const OTHER = 'https://other.example.com'
    const bea = { id: 'u2', name: 'bea' }
    h.server = (path, method, init) => (path === '/api/pair/redeem' ? json(200, { token: 'T2', user: bea }) : srv.handle(path, method, init))
    const prevFetch = globalThis.fetch
    globalThis.fetch = window.fetch = vi.fn(async (url, init = {}) => {
      h.calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase(), auth: init.headers?.Authorization || null })
      return String(url).startsWith(OTHER) ? h.server(String(url).slice(OTHER.length), (init.method || 'GET').toUpperCase(), init) : prevFetch(url, init)
    })
    await useStore.getState().connectToServer('other.example.com', 'ABCD2345', vi.fn(async () => false))

    expect(ids(useStore.getState().S.workouts)).toEqual(['w1'])          // bea's copy is her server's
    expect(ids(srv.doc.workouts)).toEqual(['w1'])                        // and nothing of andi's went there
    const stash = readFile('opengym-stash.json')
    expect(Object.keys(stash)).toEqual([BASE + '|u1'])                   // keyed by andi's server, not bea's
    expect(ids(stash[BASE + '|u1'].state.workouts)).toEqual(['w1', 'w2'])
    expect(stash[BASE + '|u1'].name).toBe('andi')

    installFetch()
    const home = serverWith(SERVER_STATE)
    await useStore.getState().connectToServer('gym.example.com', 'ABCD2345', vi.fn(async () => false))
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w2'])
    expect(ids(home.doc.workouts)).toEqual(['w1', 'w2'])
    expect(readFile('opengym-stash.json')).toEqual({})
  })
})

describe('remote-mode boot and the durable file mirror', () => {
  it('with localStorage gone, a change only the mirror holds is merged with the server copy and pushed', async () => {
    const mirror = { ...clone(SERVER_STATE), _ts: 5000, workouts: [workout('w1', '2026-09-10'), workout('w2', '2026-09-20')] }
    delete mirror._rev
    pairedPhone({ localStorage: false, mirror })
    const srv = serverWith({ ...SERVER_STATE, workouts: [...SERVER_STATE.workouts, workout('w-web', '2026-09-19')], _rev: 6 })
    const useStore = await freshStore()
    await useStore.getState().boot()
    await sleep(900)

    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-web', 'w2'])
    expect(ids(srv.doc.workouts)).toEqual(['w1', 'w-web', 'w2'])
    expect(srv.puts.at(-1).baseRev).toBe(6)
    expect(ids(readFile('opengym-state.json').workouts)).toEqual(['w1', 'w-web', 'w2'])
  })

  it('an ordinary start, mirror and storage in step, pulls as before and pushes nothing', async () => {
    pairedPhone()
    const srv = serverWith(SERVER_STATE)
    const useStore = await freshStore()
    await useStore.getState().boot()
    expect(srv.puts).toHaveLength(0)
    expect(useStore.getState().sync).toMatchObject({ status: 'ok', pending: false })
  })

  it('with storage behind the mirror (a save it refused), the mirror\'s change is merged with the server copy, not pushed over it', async () => {
    const mirror = { ...clone(SERVER_STATE), _ts: 5000, workouts: [workout('w1', '2026-09-10'), workout('w2', '2026-09-20')] }
    delete mirror._rev
    pairedPhone({ mirror })
    const srv = serverWith({ ...SERVER_STATE, workouts: [...SERVER_STATE.workouts, workout('w-web', '2026-09-19')], _rev: 6 })
    const useStore = await freshStore()
    await useStore.getState().boot()

    expect(ids(srv.doc.workouts)).toEqual(['w1', 'w-web', 'w2'])
    expect(srv.puts.at(-1).baseRev).toBe(6)
  })
})

/* The mirror is only ever the copy of the account the phone is paired with, as it last stood.
   Whatever replaces the copy wholesale — another account paired, the server's copy adopted —
   used to reach the file only 800 ms later, and an adopted copy keeps the server's older `_ts`:
   a start in between found the file "newer", took the copy it held, and pushed it over the
   server's with a baseRev that matched. Here the app is killed straight after each of those, or
   the file cannot be written at all, and the next cold start puts nothing back. */
describe('the file mirror never brings back a copy that is not this account\'s latest', () => {
  const BEA = { id: 'u2', name: 'bea' }
  // Bea's account on the same server: her own document, and the pairing code that is hers.
  const beaServer = () => {
    const srv = serverWith({ _ts: 500, _rev: 3, unit: 'kg', workouts: [workout('b1', '2026-09-01')], routines: [], bodyweight: [] })
    h.server = (path, method, init) => (path === '/api/me' || path === '/api/pair/redeem' ? json(200, { token: 'T2', user: BEA }) : srv.handle(path, method, init))
    return srv
  }
  // Andi logs a workout on the paired phone; it reaches his server and the file.
  const andiLogged = async () => {
    pairedPhone()
    serverWith(SERVER_STATE)
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.workouts.push(workout('a-secret', '2026-09-21')) })
    await useStore.getState().pushState()
    await sleep(900)
    expect(ids(readFile('opengym-state.json').workouts)).toEqual(['w1', 'a-secret'])
    return useStore
  }

  it('another account paired, then the app killed at once: the next start keeps her copy, and nothing of his reaches her account', async () => {
    let useStore = await andiLogged()
    const bea = beaServer()
    await useStore.getState().connectToServer('gym.example.com', 'ABCD2345', vi.fn(async () => false))
    expect(ids(useStore.getState().S.workouts)).toEqual(['b1'])

    useStore = await freshStore()
    await useStore.getState().boot()
    expect(ids(useStore.getState().S.workouts)).toEqual(['b1'])
    expect(ids(bea.doc.workouts)).toEqual(['b1'])
    expect(bea.puts).toHaveLength(0)
  })

  it('another account paired while the file cannot be written: his copy left in it is never taken for hers', async () => {
    let useStore = await andiLogged()
    const bea = beaServer()
    h.refuse.add('opengym-state.json')
    await useStore.getState().connectToServer('gym.example.com', 'ABCD2345', vi.fn(async () => false))
    await sleep(900)
    expect(ids(readFile('opengym-state.json').workouts)).toEqual(['w1', 'a-secret'])

    useStore = await freshStore()
    await useStore.getState().boot()
    expect(ids(useStore.getState().S.workouts)).toEqual(['b1'])
    expect(ids(bea.doc.workouts)).toEqual(['b1'])
    expect(bea.puts).toHaveLength(0)
  })

  it('a phone that kept its own workouts out of the account does not push them in on the next start', async () => {
    h.files.clear()
    localStorage.clear()
    const local = { ...clone(DEF), _ts: Date.now(), workouts: [workout('mine', '2026-09-20')] }
    localStorage.setItem('gym_state_v1', JSON.stringify(local))
    h.files.set('DATA/opengym-remote.json', JSON.stringify({ mode: 'local' }))
    h.files.set('DATA/opengym-state.json', JSON.stringify(local))
    let useStore = await freshStore()
    await useStore.getState().boot()
    const srv = serverWith(SERVER_STATE)
    const ask = vi.fn(async () => false)
    await useStore.getState().connectToServer('gym.example.com', 'ABCD2345', ask)
    expect(ask).toHaveBeenCalled()
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1'])

    useStore = await freshStore()
    await useStore.getState().boot()
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1'])
    expect(ids(srv.doc.workouts)).toEqual(['w1'])
    expect(srv.puts).toHaveLength(0)
  })

  // The phone's clock runs ahead: its copy says 3000, while the newer revision the server holds
  // was written by a device whose clock says 2000. The pull adopts that revision as it is.
  const clockAhead = () => {
    const mine = { ...clone(DEF), ...clone(SERVER_STATE), _ts: 3000 }
    delete mine._rev
    pairedPhone({ mirror: mine })
    localStorage.setItem('gym_state_v1', JSON.stringify(mine))
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 5, ts: 3000 }))
    return serverWith({ ...SERVER_STATE, _ts: 2000, _rev: 6, workouts: [...SERVER_STATE.workouts, workout('w-other', '2026-09-19')] })
  }

  it('a copy adopted from the server with an older clock stays adopted after a kill straight after', async () => {
    const srv = clockAhead()
    let useStore = await freshStore()
    await useStore.getState().boot()
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-other'])

    useStore = await freshStore()
    await useStore.getState().boot()
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-other'])
    expect(ids(srv.doc.workouts)).toEqual(['w1', 'w-other'])
    expect(srv.puts).toHaveLength(0)
  })

  it('with the file not writable at all, the copy before the adopt is merged at most — never pushed over the other device\'s work', async () => {
    const srv = clockAhead()
    h.refuse.add('opengym-state.json')
    h.refuse.add('opengym-state-owner.json')
    let useStore = await freshStore()
    await useStore.getState().boot()

    useStore = await freshStore()
    await useStore.getState().boot()
    expect(ids(srv.doc.workouts)).toEqual(['w1', 'w-other'])
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-other'])
  })
})

describe('a token the server renews', () => {
  it('is saved to the pairing file at boot and carried by every request after it', async () => {
    pairedPhone()
    const srv = serverWith(SERVER_STATE)
    h.server = (path, method, init) => (path === '/api/me' ? json(200, { user: USER, token: 'TOKEN-RENEWED' }) : srv.handle(path, method, init))
    const useStore = await freshStore()
    await useStore.getState().boot()

    expect(readFile('opengym-remote.json')).toEqual({ mode: 'remote', base: BASE, token: 'TOKEN-RENEWED', user: USER })
    h.calls = []
    useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) })
    await useStore.getState().pushState()
    expect(serverCalls()).toEqual([expect.objectContaining({ method: 'PUT', auth: 'Bearer TOKEN-RENEWED' })])
  })

  it('an answer without one leaves the pairing as it was', async () => {
    pairedPhone()
    serverWith(SERVER_STATE)
    const useStore = await freshStore()
    await useStore.getState().boot()
    expect(readFile('opengym-remote.json')).toMatchObject({ token: 'TOKEN-OLD' })
    expect(serverCalls().every(c => c.auth === 'Bearer TOKEN-OLD')).toBe(true)
  })
})

describe('a request that never answers', () => {
  it('gives up after its timeout: the change stays owed, the phone says it is offline, and the next push goes out', async () => {
    pairedPhone()
    const srv = serverWith(SERVER_STATE)
    const useStore = await freshStore()
    await useStore.getState().boot()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      h.server = () => new Promise(() => {})   // a black-holed connection: no answer, no error
      useStore.getState().update(s => { s.workouts.push(workout('w2', '2026-09-15')) }, false)
      const push = useStore.getState().pushState()
      await vi.advanceTimersByTimeAsync(61000)
      await push
      expect(useStore.getState().sync).toMatchObject({ status: 'offline', pending: true, lastError: { status: 0, code: 'timeout' } })
      expect(localStorage.getItem('gym_dirty')).toBe('1')

      h.server = srv.handle
      await useStore.getState().pushState()
      expect(ids(srv.doc.workouts)).toEqual(['w1', 'w2'])
      expect(useStore.getState().sync.status).toBe('ok')
    } finally { vi.useRealTimers() }
  })
})
