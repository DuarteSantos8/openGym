// @vitest-environment happy-dom

/* QA, v1.3.9 (Android): a phone in local mode, one workout on it, paired with an account that
   has twelve. While "Add this device's workouts?" was open, the poll pulled, took the phone's
   newer copy for the account's and pushed it: the server held one workout. "Keep profile as is"
   then adopted the copy read before the question, with its old revision, and the eleven were
   gone for good; closing the app with the question open did the same on the next start.

   Now nothing syncs between the pairing and the answer, the answer is applied to the server's
   copy as it is when the question closes, and a start with the question still open asks it again.

   Real modules: store/useStore.js, lib/api.js, lib/remote.js, lib/mobile.js. Mocked: the Capacitor
   plugins (an in-memory Directory.Data), the question sheet, and fetch, which plays the server. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), server: null, calls: [], ask: null }
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
    writeFile: async ({ path, directory, data }) => { h.files.set(directory + '/' + path, data); return { uri: 'file://' + path } },
  },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { cancel: async () => {}, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), schedule: async () => {} },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: () => ({ remove() {} }) } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true }, registerPlugin: () => ({}) }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))
// The question a resumed adoption asks (useStore resumeAdoption): the sign-in's own sheet.
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: extras => h.ask(extras) }))

const BASE = 'https://gym.example.com'
const USER = { id: 'u1', name: 'andi' }
const clone = v => JSON.parse(JSON.stringify(v))
const workout = (id, d) => ({ id, d, start: 1, end: 2, entries: [] })
const res = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => JSON.parse(body),
  text: async () => body,
})
const json = (status, body) => res(status, JSON.stringify(body))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ids = xs => (xs || []).map(x => x.id)
const deferred = () => { let resolve; const p = new Promise(r => { resolve = r }); return { p, resolve } }

function installFetch() {
  h.calls = []
  globalThis.fetch = window.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    h.calls.push({ url: String(url), method })
    if (String(url).startsWith(BASE)) return h.server(String(url).slice(BASE.length), method, init)
    return res(404, '{}')
  })
}
function serverWith(doc) {
  const srv = { doc: clone(doc), puts: [] }
  h.server = (path, method, init) => {
    if (path === '/api/me') return json(200, { user: USER })
    if (path === '/api/config') return json(200, { invite_only: false, allow_guest: true })
    if (path === '/api/pair/redeem') return json(200, { token: 'TOKEN', user: USER })
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
    return json(404, { error: 'not found' })
  }
  return srv
}

// The account: twelve workouts at rev 5. The phone: local mode, one workout of its own, newer.
const TWELVE = Array.from({ length: 12 }, (_, i) => workout('s' + i, `2026-09-${String(i + 1).padStart(2, '0')}`))
const SERVER = { _ts: 1000, _rev: 5, unit: 'kg', workouts: TWELVE, routines: [], bodyweight: [] }
let DEF
beforeAll(async () => { DEF = (await import('./useStore.js')).DEF })
function localPhone() {
  h.files.clear()
  localStorage.clear()
  const S = { ...clone(DEF), _ts: 5000, workouts: [workout('phone-1', '2026-09-20')] }
  h.files.set('DATA/opengym-remote.json', JSON.stringify({ mode: 'local' }))
  h.files.set('DATA/opengym-state.json', JSON.stringify(S))
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_guest', '1')
}

let stores = []
async function freshStore() {
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  stores.push(useStore)
  return useStore
}
// Everything that used to start a sync while the question was open: the poll's check on a
// resume, a pull, a push, a change on its debounce.
async function everySyncTrigger(useStore) {
  window.dispatchEvent(new Event('focus'))
  await useStore.getState().pullState()
  await useStore.getState().pushState()
  useStore.getState().update(s => { s.restSec = 75 })
  await sleep(1700)
}

beforeEach(() => { installFetch(); h.ask = null })
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  await sleep(20)
  for (const s of stores) s.setState({ user: null, ready: false })
  stores = []
  localStorage.clear()
})

describe('pairing a phone: nothing syncs while the question is open', () => {
  it('a pull, a push, the poll and a debounced change in the window write nothing, and Keep leaves all twelve', async () => {
    localPhone()
    const srv = serverWith(SERVER)
    const useStore = await freshStore()
    await useStore.getState().boot()
    const answer = deferred()
    const ask = vi.fn(() => answer.p)
    const pairing = useStore.getState().connectToServer('gym.example.com', 'ABCD2345', ask)
    while (!ask.mock.calls.length) await sleep(5)

    await everySyncTrigger(useStore)
    expect(srv.puts).toHaveLength(0)
    expect(ids(srv.doc.workouts)).toHaveLength(12)

    answer.resolve(false)   // Keep profile as is
    await pairing
    expect(srv.puts).toHaveLength(0)
    expect(ids(srv.doc.workouts)).toHaveLength(12)
    expect(ids(useStore.getState().S.workouts)).toEqual(ids(TWELVE))
    expect(localStorage.getItem('gym_adopt')).toBeNull()
    // and sync is back: the next change goes to the server as usual
    useStore.getState().update(s => { s.workouts.push(workout('after', '2026-09-25')) })
    await useStore.getState().pushState()
    expect(srv.puts.at(-1).baseRev).toBe(5)
    expect(ids(srv.doc.workouts)).toHaveLength(13)
  })

  it('Keep takes the server\'s copy as it is when the question closes, not as it was when it opened', async () => {
    localPhone()
    const srv = serverWith(SERVER)
    const useStore = await freshStore()
    await useStore.getState().boot()
    const answer = deferred()
    const ask = vi.fn(() => answer.p)
    const pairing = useStore.getState().connectToServer('gym.example.com', 'ABCD2345', ask)
    while (!ask.mock.calls.length) await sleep(5)
    // another device logs a workout meanwhile
    srv.doc = { ...srv.doc, workouts: [...srv.doc.workouts, workout('web-new', '2026-09-26')], _ts: 6000, _rev: 6 }

    answer.resolve(false)
    await pairing
    expect(ids(useStore.getState().S.workouts)).toContain('web-new')
    expect(JSON.parse(localStorage.getItem('gym_sync')).rev).toBe(6)
    expect(srv.puts).toHaveLength(0)
  })

  it('Add them merges into the server\'s current copy and pushes against its revision', async () => {
    localPhone()
    const srv = serverWith(SERVER)
    const useStore = await freshStore()
    await useStore.getState().boot()
    const answer = deferred()
    const ask = vi.fn(() => answer.p)
    const pairing = useStore.getState().connectToServer('gym.example.com', 'ABCD2345', ask)
    while (!ask.mock.calls.length) await sleep(5)
    srv.doc = { ...srv.doc, workouts: [...srv.doc.workouts, workout('web-new', '2026-09-26')], _ts: 6000, _rev: 6 }

    answer.resolve(true)
    await pairing
    expect(srv.puts).toHaveLength(1)
    expect(srv.puts[0].baseRev).toBe(6)
    expect(ids(srv.doc.workouts).sort()).toEqual([...ids(TWELVE), 'phone-1', 'web-new'].sort())
  })

  it('closed with the question open, the next start asks again and pushes nothing before the answer', async () => {
    localPhone()
    const srv = serverWith(SERVER)
    let useStore = await freshStore()
    await useStore.getState().boot()
    const first = vi.fn(() => new Promise(() => {}))   // never answered: the app is killed
    useStore.getState().connectToServer('gym.example.com', 'ABCD2345', first)
    while (!first.mock.calls.length) await sleep(5)
    await sleep(900)   // the file mirror's debounce, as on a phone that stayed open a moment
    for (const s of stores) s.setState({ user: null, ready: false })

    const answer = deferred()
    h.ask = vi.fn(() => answer.p)
    useStore = await freshStore()
    await useStore.getState().boot()
    while (!h.ask.mock.calls.length) await sleep(5)
    expect(h.ask).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1 }))
    await everySyncTrigger(useStore)
    expect(srv.puts).toHaveLength(0)

    answer.resolve(false)
    while (localStorage.getItem('gym_adopt')) await sleep(5)
    await sleep(20)
    expect(srv.puts).toHaveLength(0)
    expect(ids(srv.doc.workouts)).toHaveLength(12)
    expect(ids(useStore.getState().S.workouts)).toEqual(ids(TWELVE))
  })
})
