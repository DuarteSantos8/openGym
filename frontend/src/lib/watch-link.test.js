import { beforeEach, describe, expect, it, vi } from 'vitest'

// The link to the openGym watch app, with WatchLinkPlugin.swift played in memory: what is sent to
// the watch, when nothing is, and what the phone keeps from what comes back.
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), calls: [], platform: 'ios', names: [], listeners: new Map(), adds: [],
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
  Capacitor: { getPlatform: () => h.platform },
  registerPlugin: name => {
    h.names.push(name)
    return {
      status: async () => ({ ...h.status }),
      startSession: async arg => { h.calls.push(['start', arg]); return { sent: 'message' } },
      endSession: async arg => { h.calls.push(['end', arg]); return { sent: 'message' } },
      rest: async arg => { h.calls.push(['rest', arg]) },
      clearRest: async () => { h.calls.push(['clearRest']) },
      addListener: async (event, cb) => {
        h.adds.push(event)
        h.listeners.set(event, [...(h.listeners.get(event) || []), cb])
        return { remove() {} }
      },
    }
  },
}))

const T0 = 1_790_000_000_000
const active = (over = {}) => ({ id: 'w1', name: 'Push', start: T0, entries: [], ...over })
const sent = kind => h.calls.filter(c => c[0] === kind).map(c => c[1])
const file = () => JSON.parse(h.files.get('opengym-watch.json') || 'null')
const fire = (event, data) => (h.listeners.get(event) || []).forEach(cb => cb(data))
const flush = () => new Promise(r => setTimeout(r, 0))

let wl
beforeEach(async () => {
  vi.resetModules()
  vi.useRealTimers()
  h.files.clear(); h.calls = []; h.names = []; h.listeners = new Map(); h.adds = []; h.platform = 'ios'
  h.status = { supported: true, paired: true, appInstalled: true, reachable: true }
  wl = await import('./watch-link.js')
})

describe('where there is a watch to talk to', () => {
  it('passes the status through on iOS', async () => {
    expect(await wl.watchStatus()).toEqual(h.status)
    expect(h.names).toEqual(['WatchLink'])
  })
  it('registers nothing and sends nothing on Android or the web', async () => {
    for (const platform of ['android', 'web']) {
      vi.resetModules(); h.platform = platform
      const other = await import('./watch-link.js')
      expect(await other.watchStatus()).toEqual({ supported: false, paired: false, appInstalled: false, reachable: false })
      expect(await other.watchStartSession(active())).toBeNull()
      await other.watchRest({ left: 60, total: 90, endsAt: T0 + 60000 })
    }
    expect(h.names).toEqual([])
    expect(h.calls).toEqual([])
  })
})

describe('the preference', () => {
  it('is on until the user turns it off, and remembers that', async () => {
    expect((await wl.loadWatchPref()).useWatch).toBe(true)
    await wl.setUseWatch(false)
    expect(file().useWatch).toBe(false)
    vi.resetModules()
    expect((await (await import('./watch-link.js')).loadWatchPref()).useWatch).toBe(false)
  })
})

describe('starting and ending the watch session', () => {
  it('starts it with the workout id, name and start time', async () => {
    expect(await wl.watchStartSession(active())).toEqual({ sent: 'message' })
    expect(sent('start')).toEqual([{ id: 'w1', name: 'Push', start: T0 }])
  })
  it('sends nothing while the switch is off', async () => {
    await wl.setUseWatch(false)
    expect(await wl.watchStartSession(active())).toBeNull()
    expect(sent('start')).toEqual([])
  })
  it('ends a session still pending from an earlier workout before the new start, thrown away unless saved', async () => {
    h.files.set('opengym-watch.json', JSON.stringify({ useWatch: true, held: { old: { s: 'pending', at: T0 }, kept: { s: 'pending', at: T0 } } }))
    await wl.watchStartSession(active({ id: 'w2' }), [{ id: 'kept', end: T0 + 1000 }])
    expect(sent('end')).toEqual([{ id: 'old', end: expect.any(Number), discard: true }, { id: 'kept', end: T0 + 1000, discard: false }])
    expect(sent('start')).toEqual([{ id: 'w2', name: 'Push', start: T0 }])
    expect(h.calls.map(c => c[0])).toEqual(['end', 'end', 'start'])
    expect(Object.keys(file().held).sort()).toEqual(['kept', 'w2'])
  })
  it('sends nothing without a paired watch that has the app', async () => {
    h.status = { ...h.status, appInstalled: false }
    expect(await wl.watchStartSession(active())).toBeNull()
    h.status = { ...h.status, paired: false, appInstalled: true }
    expect(await wl.watchStartSession(active())).toBeNull()
    expect(sent('start')).toEqual([])
  })
  it('leaves a past workout being logged, and a saved one being edited, alone', async () => {
    await wl.watchStartSession(active({ backfill: { d: '2026-09-01' } }))
    await wl.watchStartSession(active({ editingWorkoutId: 'w0' }))
    expect(sent('start')).toEqual([])
  })
  it('ends only a session it started, with the end time', async () => {
    vi.useFakeTimers({ now: T0 + 3600000, toFake: ['Date'] })
    expect(await wl.watchEndSession('other')).toBeNull()
    await wl.watchStartSession(active())
    await wl.watchEndSession('w1')
    expect(sent('end')).toEqual([{ id: 'w1', end: T0 + 3600000, discard: false }])
  })
  it('ends a session it started even after the switch went off', async () => {
    await wl.watchStartSession(active())
    await wl.setUseWatch(false)
    await wl.watchEndSession('w1')
    expect(sent('end')).toHaveLength(1)
  })
  it('tells the watch to throw a discarded workout away', async () => {
    await wl.watchStartSession(active())
    await wl.watchEndSession('w1', { discard: true })
    expect(sent('end')[0].discard).toBe(true)
  })
})

describe('the rest timer on the wrist', () => {
  it('mirrors a running rest, a paused one, and its end', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] })
    await wl.watchStartSession(active())
    await wl.watchRest({ left: 90, total: 90, endsAt: T0 + 90000, forIdx: 0 })
    await wl.watchRest({ left: 42, total: 90, endsAt: T0 + 90000, paused: true })
    await wl.watchRest({ left: 0, total: 90, endsAt: T0 + 90000, ready: true })
    await wl.watchRest(null)
    expect(h.calls.filter(c => c[0] === 'rest' || c[0] === 'clearRest')).toEqual([
      ['rest', { endsAt: T0 + 90000, total: 90, paused: false, left: 90, ready: false }],
      ['rest', { total: 90, paused: true, left: 42, ready: false }],
      ['clearRest'],
      ['clearRest'],
    ])
  })
  it('says when the heart rate is back down', async () => {
    await wl.watchStartSession(active())
    await wl.watchRest({ left: 30, total: 90, endsAt: T0 + 30000, hrReady: true })
    await wl.watchRest({ left: 30, total: 90, endsAt: T0 + 30000, paused: true, hrReady: true })
    expect(sent('rest')).toEqual([
      { endsAt: T0 + 30000, total: 90, paused: false, left: 30, ready: true },
      { total: 90, paused: true, left: 30, ready: true },
    ])
  })
  it('sends nothing with no workout on the watch', async () => {
    await wl.watchRest({ left: 90, total: 90, endsAt: T0 + 90000 })
    await wl.watchStartSession(active())
    await wl.watchEndSession('w1')
    await wl.watchRest({ left: 90, total: 90, endsAt: T0 + 90000 })
    expect(sent('rest')).toEqual([])
  })
})

describe('events from the watch', () => {
  it('subscribes once per event and hands each to every listener', async () => {
    const a = [], b = []
    const offA = wl.onWatchEvent((name, data) => a.push([name, data]))
    wl.onWatchEvent((name, data) => b.push([name, data]))
    await flush(); await flush()
    expect(h.adds.sort()).toEqual(['heartRate', 'reachability', 'restAction', 'watchState'])
    fire('restAction', { action: 'skip' })
    offA()
    fire('heartRate', { bpm: 120, t: T0 })
    expect(a).toEqual([['restAction', { action: 'skip' }]])
    expect(b).toEqual([['restAction', { action: 'skip' }], ['heartRate', { bpm: 120, t: T0 }]])
  })
  it('runs the store callbacks for an end, a failure and the rest buttons', async () => {
    const seen = []
    wl.initWatchLink({ onEnded: id => seen.push(['ended', id]), onFailed: id => seen.push(['failed', id]), onRestAction: a => seen.push(['rest', a]) })
    wl.initWatchLink({ onEnded: () => seen.push(['twice']) })
    await flush(); await flush()
    fire('watchState', { state: 'ended', id: 'w1' })
    fire('watchState', { state: 'failed', id: 'w2', error: 'denied' })
    fire('restAction', { action: 'add15' })
    fire('restAction', { action: 'nonsense' })
    await flush(); await flush()
    expect(seen).toEqual([['rest', 'add15'], ['ended', 'w1'], ['failed', 'w2']])
  })
})

describe('who writes the workout to Health', () => {
  const settle = async () => { for (let i = 0; i < 4; i++) await flush() }
  it('holds a workout the watch is recording, and for good once the watch saved it', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] })
    wl.initWatchLink({})
    await wl.watchStartSession(active())
    expect([...await wl.watchHeldIds()]).toEqual(['w1'])
    await settle()
    fire('watchState', { state: 'ended', id: 'w1' })
    await settle()
    vi.setSystemTime(T0 + 30 * 24 * 3600000)
    expect([...await wl.watchHeldIds()]).toEqual(['w1'])
    expect(file().held.w1.s).toBe('saved')
  })
  it('lets the phone write it when the watch failed', async () => {
    wl.initWatchLink({})
    await wl.watchStartSession(active())
    await settle()
    fire('watchState', { state: 'failed', id: 'w1' })
    await settle()
    expect([...await wl.watchHeldIds()]).toEqual([])
  })
  it('stops waiting for a watch that never answers after the end', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] })
    await wl.watchStartSession(active())
    await wl.watchEndSession('w1')
    vi.setSystemTime(T0 + wl.WATCH_WAIT_MS - 1000)
    expect((await wl.watchHeldIds()).has('w1')).toBe(true)
    vi.setSystemTime(T0 + wl.WATCH_WAIT_MS + 1000)
    expect((await wl.watchHeldIds()).has('w1')).toBe(false)
  })
  it('lets go of a discarded one at once', async () => {
    await wl.watchStartSession(active())
    await wl.watchEndSession('w1', { discard: true })
    expect([...await wl.watchHeldIds()]).toEqual([])
  })
  it('keeps the file small', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] })
    wl.initWatchLink({})
    await settle()
    for (let i = 0; i < 60; i++) {
      vi.setSystemTime(T0 + i * 1000)
      fire('watchState', { state: 'ended', id: 'w' + i })
      await settle()
    }
    const ids = Object.keys(file().held)
    expect(ids).toHaveLength(50)
    expect(ids).toContain('w59')
    expect(ids).not.toContain('w0')
  })
})

describe('the live heart rate for the workout screen', () => {
  it('is shown while the watch runs the workout and a reading is fresh', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] })
    wl.onWatchEvent(() => {})
    await flush(); await flush()
    expect(wl.watchHeartRate()).toEqual({ bpm: null, running: false })
    fire('watchState', { state: 'running', id: 'w1' })
    fire('heartRate', { bpm: 131, t: T0 })
    expect(wl.watchHeartRate()).toEqual({ bpm: 131, running: true })
    vi.setSystemTime(T0 + 16000)
    expect(wl.watchHeartRate()).toEqual({ bpm: null, running: true })
    fire('watchState', { state: 'ended', id: 'w1' })
    fire('heartRate', { bpm: 99, t: T0 + 16000 })
    expect(wl.watchHeartRate()).toEqual({ bpm: null, running: false })
  })
  it('tells its subscribers when it changes', async () => {
    let n = 0
    const off = wl.subscribeWatchHeartRate(() => n++)
    await flush(); await flush()
    fire('heartRate', { bpm: 120, t: T0 })
    fire('watchState', { state: 'running', id: 'w1' })
    off()
    fire('heartRate', { bpm: 121, t: T0 })
    expect(n).toBe(2)
  })
})

// The app was killed, or the error screen discarded the workout, before the end was sent: at
// the next launch the watch is told, so its session does not record for hours.
describe('a session left running on the watch', () => {
  it('is ended with the saved workout, or thrown away when there is none', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] })
    // Three sessions left pending at once, as an app killed mid-workout leaves them (a start by
    // itself would already have ended the earlier ones).
    h.files.set('opengym-watch.json', JSON.stringify({ useWatch: true, held: { done: { s: 'pending', at: T0 }, gone: { s: 'pending', at: T0 }, live: { s: 'pending', at: T0 } } }))
    vi.setSystemTime(T0 + 3600000)
    await wl.reconcileWatch({ active: { id: 'live' }, workouts: [{ id: 'done', start: T0, end: T0 + 1800000 }] })
    expect(sent('end')).toEqual([
      { id: 'done', end: T0 + 1800000, discard: false },
      { id: 'gone', end: T0 + 3600000, discard: true },
    ])
    await wl.reconcileWatch({ active: { id: 'live' }, workouts: [] })
    expect(sent('end')).toHaveLength(2)
  })
})
