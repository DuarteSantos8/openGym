import { beforeEach, describe, expect, it, vi } from 'vitest'

// The current set on the wrist and the set logged there, with WatchLinkPlugin.swift in memory.
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), calls: [], listeners: new Map(), adds: [],
    status: { supported: true, paired: true, appInstalled: true, reachable: true } }
})

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }) => {
      if (!h.files.has(path)) throw new Error('File does not exist')
      return { data: h.files.get(path) }
    },
    writeFile: async ({ path, data }) => { h.files.set(path, data) },
  },
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'ios' },
  registerPlugin: () => ({
    status: async () => ({ ...h.status }),
    startSession: async arg => { h.calls.push(['start', arg]); return { sent: 'message' } },
    endSession: async arg => { h.calls.push(['end', arg]); return { sent: 'message' } },
    set: async arg => { h.calls.push(['set', arg]) },
    clearSet: async () => { h.calls.push(['clearSet']) },
    addListener: async (event, cb) => {
      h.adds.push(event)
      h.listeners.set(event, [...(h.listeners.get(event) || []), cb])
      return { remove() {} }
    },
  }),
}))

const SET = { id: 'w1', entryId: '3593', name: 'Squat', idx: 0, i: 1, setNo: 2, setCount: 3, warmup: false, mode: 'reps', w: 100, r: 5, unit: 'kg', each: false, inc: 2.5, nextName: null }
const fire = (event, data) => (h.listeners.get(event) || []).forEach(cb => cb(data))
const flush = () => new Promise(r => setTimeout(r, 0))

let wl
beforeEach(async () => {
  vi.resetModules()
  h.files.clear(); h.calls = []; h.listeners = new Map(); h.adds = []
  wl = await import('./watch-link.js')
})

describe('the current set on the wrist', () => {
  it('is sent and cleared while the watch records the workout', async () => {
    await wl.watchStartSession({ id: 'w1', name: 'Legs', start: 1 })
    expect(await wl.watchSet(SET)).toBe(true)
    expect(await wl.watchSet(null)).toBe(true)
    expect(h.calls.filter(c => c[0] !== 'start')).toEqual([['set', SET], ['clearSet']])
  })

  it('sends nothing with no workout on the watch, or the switch off', async () => {
    expect(await wl.watchSet(SET)).toBe(false)
    await wl.watchStartSession({ id: 'w1', name: 'Legs', start: 1 })
    await wl.setUseWatch(false)
    expect(await wl.watchSet(SET)).toBe(false)
    expect(h.calls.filter(c => c[0] === 'set' || c[0] === 'clearSet')).toEqual([])
  })

  it('sends nothing once the session was ended', async () => {
    await wl.watchStartSession({ id: 'w1', name: 'Legs', start: 1 })
    await wl.watchEndSession('w1')
    expect(await wl.watchSet(SET)).toBe(false)
  })
})

describe('a set logged on the wrist', () => {
  it('reaches the store once it listens, and only a well-formed one', async () => {
    const seen = []
    wl.initWatchLink({ onSetDone: ev => seen.push(ev) })
    await flush(); await flush()
    expect(h.adds.filter(a => a === 'setDone')).toEqual(['setDone'])
    const ev = { type: 'set', action: 'done', id: 'w1', entryId: '3593', idx: 0, i: 1, w: 100, r: 5, at: 9 }
    fire('setDone', ev)
    fire('setDone', { id: 'w1', idx: '0', i: 1 })
    fire('setDone', null)
    expect(seen).toEqual([ev])
  })

  it('is passed to other listeners too', async () => {
    const all = []
    wl.onWatchEvent((name, data) => all.push(name))
    wl.initWatchLink({ onSetDone: () => {} })
    await flush(); await flush()
    fire('setDone', { id: 'w1', idx: 0, i: 0 })
    expect(all).toContain('setDone')
  })
})

describe('a session the watch runs', () => {
  it('tells the store, so it can send the current set at once', async () => {
    const seen = []
    wl.initWatchLink({ onRunning: id => seen.push(id) })
    await flush(); await flush()
    fire('watchState', { state: 'running', id: 'w1' })
    await flush(); await flush()
    expect(seen).toEqual(['w1'])
  })
})
