// @vitest-environment happy-dom

/* The phone half of GHSA-656w-p99j-x8hf: a read sent to the server the phone was paired with,
   answered after it was paired with another one. The same account id on both (a server moved to
   a new address, a restored data directory) makes no difference: the answer belongs to the
   first server, and it must neither enter the copy nor travel on to the second.

   Real modules: store/useStore.js, lib/api.js, lib/remote.js, lib/mobile.js. Mocked: the
   Capacitor plugins (an in-memory Directory.Data) and fetch, which plays both servers; one
   request to the first server is held until the test lets it go. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), servers: {}, calls: [], hold: null }
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
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => false }))

const ONE = 'https://one.example.com'
const TWO = 'https://two.example.com'
const USER = { id: 'u1', name: 'andi' }
const clone = v => JSON.parse(JSON.stringify(v))
const workout = (id, d) => ({ id, d, start: 1, end: 2, entries: [] })
const ids = xs => (xs || []).map(x => x.id)
const res = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => JSON.parse(body),
  text: async () => body,
})
const json = (status, body) => res(status, JSON.stringify(body))
const sleep = ms => vi.advanceTimersByTimeAsync(ms)

function serverAt(base, doc) {
  const srv = { doc: clone(doc), puts: [] }
  h.servers[base] = (path, method, init) => {
    if (path === '/api/me') return json(200, { user: USER })
    if (path === '/api/config') return json(200, { invite_only: false, allow_guest: true })
    if (path === '/api/pair/redeem') return json(200, { token: 'TOKEN-' + base, user: USER })
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
function installFetch() {
  h.calls = []
  globalThis.fetch = window.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    const base = Object.keys(h.servers).find(b => u.startsWith(b))
    h.calls.push({ base, path: base ? u.slice(base.length) : u, method })
    if (!base) return res(404, '{}')
    const answer = () => h.servers[base](u.slice(base.length), method, init)
    if (h.hold && h.hold.base === base && h.hold.method === method && u.slice(base.length) === h.hold.path) {
      const held = h.hold
      h.hold = null
      return new Promise(resolve => { held.release = () => resolve(answer()) })
    }
    return answer()
  })
}

const { DEF } = await import('./useStore.js')
let stores = []
async function freshStore() {
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  stores.push(useStore)
  return useStore
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); h.servers = {}; h.hold = null; installFetch() })
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  await sleep(20)
  for (const s of stores) s.setState({ user: null, ready: false })
  stores = []
  localStorage.clear()
  h.files.clear()
  vi.useRealTimers()
})

describe('paired with another server while a read from the first is on its way', () => {
  it('the first server\'s answer stays out of the copy and out of what goes to the second', async () => {
    localStorage.clear()
    h.files.clear()
    h.files.set('DATA/opengym-remote.json', JSON.stringify({ mode: 'local' }))
    const one = serverAt(ONE, { ...clone(DEF), _ts: 100, _rev: 3, workouts: [workout('one-1', '2026-10-01')] })
    const two = serverAt(TWO, { ...clone(DEF), _ts: 200, _rev: 8, workouts: [workout('two-1', '2026-10-02')] })
    const useStore = await freshStore()
    await useStore.getState().boot()
    await useStore.getState().connectToServer('one.example.com', 'ABCD2345', async () => false)
    expect(ids(useStore.getState().S.workouts)).toEqual(['one-1'])

    // Meanwhile the first server gained a workout; the phone's pull of it is held.
    one.doc = { ...one.doc, _rev: 4, workouts: [...one.doc.workouts, workout('one-late', '2026-10-03')] }
    // A change of the phone's own, not pushed yet: the copy has something to merge.
    useStore.getState().update(s => { s.workouts.push(workout('phone-new', '2026-10-04')) }, false)
    const held = { base: ONE, method: 'GET', path: '/api/data' }
    h.hold = held
    const pull = useStore.getState().pullState()
    await sleep(5)
    expect(held.release).toBeTypeOf('function')   // the request went out and waits

    // The phone is paired with the second server, and only then does the first one answer.
    const pairing = useStore.getState().connectToServer('two.example.com', 'WXYZ6789', async () => false)
    await sleep(5)
    held.release()
    await pairing
    await pull
    await sleep(2000)   // a push on its debounce, the file mirror

    const S = useStore.getState().S
    expect(ids(S.workouts)).not.toContain('one-late')
    expect(ids(S.workouts)).toContain('two-1')
    expect(ids(S.workouts)).toContain('phone-new')   // the phone's own change is not lost
    expect(JSON.parse(localStorage.getItem('gym_sync')).rev).toBeGreaterThanOrEqual(8)
    for (const body of two.puts) expect(ids(body.state.workouts)).not.toContain('one-late')
    expect(ids(two.doc.workouts)).not.toContain('one-late')
    expect(useStore.getState().sync.server).toBe(TWO)
  })
})
