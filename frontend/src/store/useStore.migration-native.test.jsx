// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ files: new Map(), refuse: null, api: vi.fn() }))
vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: h.api, setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' }, Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }) => {
      if (!h.files.has(path)) throw Object.assign(new Error('File does not exist'), { code: 'ENOENT' })
      return { data: h.files.get(path) }
    },
    writeFile: async ({ path, data }) => {
      if (path === h.refuse) throw new Error('disk-full')
      h.files.set(path, data)
    }
  }
}))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { cancel: vi.fn(), checkPermissions: async () => ({ display: 'granted' }) } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }))
const FILE = 'opengym-state.json', ACTIVE = 'gym_active_v1.json'
const raw = JSON.stringify({ routines: [], workouts: [], active: { id: 'active', start: 1, entries: [] } })
let listeners
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubEnv('VITE_MOBILE', '1'); h.files.clear(); h.refuse = null; localStorage.clear()
  h.api.mockImplementation(async path => { if (path === '/api/config') return {}; throw Object.assign(new Error('signed out'), { status: 401 }) })
  listeners = []
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation((type, cb, options) => { listeners.push([target, type, cb, options]); add(type, cb, options) })
  }
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); for (const [target, ...args] of listeners) target.removeEventListener(...args); vi.restoreAllMocks(); vi.unstubAllEnvs() })
const fresh = async () => { vi.resetModules(); return (await import('./useStore.js')).useStore }
it.each(['{bad', JSON.stringify({ engineSchemaVersion: 3 }), JSON.stringify({ routines: 'bad' })])('A27: native unreadable/future copy stays untouched: %s', async text => {
  h.files.set(FILE, text)
  const store = await fresh(); await store.getState().boot()
  expect(store.getState().migration?.phase).toBe('error')
  store.getState().update(s => { s.unit = 'lb' })
  expect(h.files.get(FILE)).toBe(text)
  expect(localStorage.getItem('gym_state_v1')).toBeNull()
})
it.each(['gym_state_v1.pre-engine-v1.json', 'gym_engine_migration_pending.json', FILE, ACTIVE])('A28/A30: native failure at %s resumes after restart and browser eviction', async file => {
  h.files.set(FILE, raw)
  let store = await fresh(); await store.getState().boot()
  h.refuse = file; await store.getState().confirmMigration()
  expect(store.getState().migration?.phase).toBe('error')
  h.refuse = null; localStorage.clear()
  store = await fresh(); await store.getState().boot()
  expect(store.getState().migration?.phase).toBe('confirm')
  await store.getState().confirmMigration()
  expect(store.getState().migration).toBeNull()
  expect(JSON.parse(h.files.get(FILE)).engineSchemaVersion).toBe(2)
  expect(JSON.parse(h.files.get(ACTIVE)).id).toBe('active')
  expect(store.getState().A?.id).toBe('active')
})


it('A28/A51: a separate native v1 active copy is backed up and converted before release', async () => {
  const active = JSON.stringify({ id: 'separate', entries: [{ id: '0025', target: { sets: 1, reps: 5, weight: 60 }, sets: [] }] })
  h.files.set(FILE, raw); h.files.set(ACTIVE, active)
  const store = await fresh(); await store.getState().boot(); await store.getState().confirmMigration()
  expect(store.getState().migration).toBeNull()
  expect(h.files.get(ACTIVE + '.pre-engine-v1')).toBe(active)
  const A = store.getState().A
  expect(A.id).toBe('separate')
  expect(store.getState().S.prescriptions[A.exposures[0].prescriptionId]).toBeTruthy()
})
