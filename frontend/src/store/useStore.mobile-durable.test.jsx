// @vitest-environment happy-dom

/* Data safety on the phone (owner, 2026-10-14: "make sure data is never ever lost"). A phone in
   local mode has no server: the file mirror in the app's data directory is the copy that survives
   a WebView whose storage iOS evicted, or localStorage the WebView had not written to disk yet when
   the app was killed. Real modules: store/useStore.js, lib/mobile.js. Mocked: the Capacitor
   plugins, with an in-memory Directory.Data. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map() }
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
    rename: async ({ from, to, directory }) => { h.files.set(directory + '/' + to, h.files.get(directory + '/' + from)); h.files.delete(directory + '/' + from) },
  },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { cancel: async () => {}, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), schedule: async () => {} },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: () => ({ remove() {} }) } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios', isNativePlatform: () => true }, registerPlugin: () => ({}) }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

const readFile = name => { const v = h.files.get('DATA/' + name); return v == null ? null : JSON.parse(v) }
const tick = () => new Promise(r => setTimeout(r, 20))
const workout = id => ({ id, d: '2026-10-10', start: 1, end: 2, entries: [] })

let stores = []
async function freshStore() {
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  stores.push(useStore)
  return useStore
}
// A phone in local mode with a history and a workout running, in localStorage and in the file.
async function localPhone() {
  const { DEF } = await import('./useStore.js')
  const S = { ...JSON.parse(JSON.stringify(DEF)), _ts: 5000, workouts: [workout('w1'), workout('w2')],
    active: { id: 'run', d: '2026-10-14', start: 4000, cur: 0, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }] } }
  h.files.clear()
  localStorage.clear()
  h.files.set('DATA/opengym-remote.json', JSON.stringify({ mode: 'local' }))
  h.files.set('DATA/opengym-state.json', JSON.stringify(S))
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_guest', '1')
  return S
}

afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  await tick()
  for (const s of stores) s.setState({ user: null, ready: false })
  stores = []
  localStorage.clear()
})

// Each test loads the store afresh: slow on a busy machine, so a longer limit than the default.
describe('a phone with no server', { timeout: 30000 }, () => {
  beforeEach(() => { h.files.clear() })

  it('a ticked set is in the file at once, not after the usual wait', async () => {
    await localPhone()
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.active.entries[0].sets[0].done = true })
    await tick()                                    // far less than the 800 ms of other changes
    expect(readFile('opengym-state.json').active.entries[0].sets.map(x => x.done)).toEqual([true, false])
    expect(h.files.has('DATA/opengym-state.next.json')).toBe(false)
  })

  it('a finished workout is in the file at once too', async () => {
    await localPhone()
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.workouts.push({ ...s.active, end: 9000 }); s.active = null })
    await tick()
    const file = readFile('opengym-state.json')
    expect(file.active).toBeNull()
    expect(file.workouts.map(w => w.id)).toEqual(['w1', 'w2', 'run'])
  })

  it('storage evicted: the file brings everything back, and the store says ready only then', async () => {
    await localPhone()
    localStorage.clear()
    const useStore = await freshStore()
    expect(useStore.getState().ready).toBe(false)
    expect(useStore.getState().S.workouts).toEqual([])
    await useStore.getState().boot()
    expect(useStore.getState().ready).toBe(true)
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
    expect(useStore.getState().S.active.id).toBe('run')
  })

  it('saveNow writes the copy to the file without waiting', async () => {
    await localPhone()
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.restSec = 75 })
    expect(readFile('opengym-state.json').restSec).not.toBe(75)
    await useStore.getState().saveNow()
    expect(readFile('opengym-state.json').restSec).toBe(75)
  })

  it('going to the background (Capacitor\'s pause) writes a change still waiting', async () => {
    await localPhone()
    const useStore = await freshStore()
    await useStore.getState().boot()
    useStore.getState().update(s => { s.restSec = 80 })
    document.dispatchEvent(new Event('pause'))
    await tick()
    expect(readFile('opengym-state.json').restSec).toBe(80)
  })
})
