import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// #200: the Android app keeping Health Connect in step with the log, and the iOS app Apple Health
// the same way. The native plugin (HealthConnectPlugin.java / AppleHealthPlugin.swift) and the
// app's data directory are played in memory.
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), calls: [], status: { status: 'available', granted: false }, grant: true, fail: null, platform: 'android', registered: [], samples: [], anchorOut: 'A1', readFail: null }
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
vi.mock('@capacitor/app', () => ({ App: { addListener: () => ({ remove() {} }) } }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform },
  registerPlugin: name => (h.registered.push(name), {
    status: async () => ({ ...h.status }),
    requestPermissions: async () => { h.calls.push(['request']); h.status.granted = h.grant; return { granted: h.grant } },
    write: async arg => {
      h.calls.push(['write', arg])
      if (h.fail) throw Object.assign(new Error('refused'), { code: h.fail })
    },
    remove: async arg => { h.calls.push(['remove', arg]) },
    readWeights: async arg => {
      h.calls.push(['read', arg])
      if (h.readFail) throw Object.assign(new Error('refused'), { code: h.readFail })
      return { samples: h.samples, anchor: h.anchorOut }
    },
    openSettings: async () => {},
  }),
}))

const at = (d, hh) => new Date(2026, 8, d, hh).getTime()
const workout = (id, d) => ({ id, d: `2026-09-${d}`, start: at(d, 18), end: at(d, 19), name: 'Push',
  entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true }] }] })
const state = (workouts, bodyweight = []) => ({ unit: 'kg', workouts, bodyweight })
const writes = () => h.calls.filter(c => c[0] === 'write').map(c => c[1])
const removes = () => h.calls.filter(c => c[0] === 'remove').map(c => c[1])
const file = () => JSON.parse(h.files.get('opengym-health.json') || 'null')

let hs
beforeEach(async () => {
  vi.resetModules()
  h.files.clear(); h.calls = []; h.status = { status: 'available', granted: false }; h.grant = true; h.fail = null; h.platform = 'android'; h.registered = []; h.samples = []; h.anchorOut = 'A1'; h.readFail = null
  hs = await import('./health-sync.js')
})

describe('off (the default)', () => {
  it('writes nothing and asks for nothing, even after the file is read', async () => {
    await hs.loadHealth()
    await hs.syncHealth(state([workout('w1', 17)]))
    expect(h.calls).toEqual([])
    expect(h.files.has('opengym-health.json')).toBe(false)
  })
})

describe('turning it on', () => {
  it('asks for the permissions, then writes the whole log once', async () => {
    const r = await hs.enableHealth(state([workout('w1', 17)], [{ d: '2026-09-17', w: 80, t: at(17, 7) }]))
    expect(r.ok).toBe(true)
    expect(h.calls[0]).toEqual(['request'])
    expect(writes()).toHaveLength(1)
    expect(writes()[0].sessions.map(s => s.id)).toEqual(['opengym-w-w1'])
    expect(writes()[0].weights.map(s => s.id)).toEqual(['opengym-bw-2026-09-17'])
    expect(file().on).toBe(true)
    expect(Object.keys(file().written)).toEqual(['opengym-w-w1', 'opengym-bw-2026-09-17'])
  })
  it('stays off when the permissions are not granted', async () => {
    h.grant = false
    const r = await hs.enableHealth(state([workout('w1', 17)]))
    expect(r).toEqual({ ok: false, reason: 'denied' })
    expect(writes()).toEqual([])
    expect(file()).toBeNull()
  })
  it('does not ask again when they were granted before', async () => {
    h.status.granted = true
    await hs.enableHealth(state([]))
    expect(h.calls.find(c => c[0] === 'request')).toBeUndefined()
  })
  it('says so when Health Connect is not there', async () => {
    h.status = { status: 'missing', granted: false }
    expect(await hs.enableHealth(state([]))).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('keeping in step', () => {
  it('writes only what is new, and removes what was deleted', async () => {
    await hs.enableHealth(state([workout('w1', 17)]))
    h.calls = []
    await hs.syncHealth(state([workout('w1', 17)]))
    expect(h.calls).toEqual([])

    await hs.syncHealth(state([workout('w1', 17), workout('w2', 18)]))
    expect(writes().map(w => w.sessions.map(s => s.id))).toEqual([['opengym-w-w2']])

    h.calls = []
    await hs.syncHealth(state([workout('w2', 18)]))
    expect(writes()).toEqual([])
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1'], weights: [] }])
    expect(Object.keys(file().written)).toEqual(['opengym-w-w2'])
  })
  it('remembers a refused permission, keeps what it has, and clears it once allowed again', async () => {
    await hs.enableHealth(state([workout('w1', 17)]))
    h.fail = 'permission'
    await hs.syncHealth(state([workout('w1', 17), workout('w2', 18)]))
    expect(file().error).toBe('permission')
    expect(Object.keys(file().written)).toEqual(['opengym-w-w1'])

    h.fail = null
    await hs.syncHealth(state([workout('w1', 17), workout('w2', 18)]))
    expect(file().error).toBeNull()
    expect(Object.keys(file().written)).toEqual(['opengym-w-w1', 'opengym-w-w2'])
  })
  it('runs one sync at a time and follows it with the newest state', async () => {
    await hs.enableHealth(state([]))
    h.calls = []
    const a = hs.syncHealth(state([workout('w1', 17)]))
    const b = hs.syncHealth(state([workout('w1', 17), workout('w2', 18)]))
    const c = hs.syncHealth(state([workout('w1', 17), workout('w2', 18), workout('w3', 19)]))
    await Promise.all([a, b, c])
    // The second call is overtaken by the third before it runs: two writes, not three.
    expect(writes().map(w => w.sessions.map(s => s.id))).toEqual([['opengym-w-w1'], ['opengym-w-w2', 'opengym-w-w3']])
  })
})

describe('turning it off', () => {
  it('can leave what it wrote in Health Connect', async () => {
    await hs.enableHealth(state([workout('w1', 17)]))
    h.calls = []
    await hs.disableHealth({ removeWritten: false })
    expect(removes()).toEqual([])
    expect(file().on).toBe(false)
    await hs.syncHealth(state([workout('w1', 17), workout('w2', 18)]))
    expect(writes()).toEqual([])
  })
  it('or remove exactly what it wrote', async () => {
    await hs.enableHealth(state([workout('w1', 17)], [{ d: '2026-09-17', w: 80, t: at(17, 7) }]))
    await hs.disableHealth({ removeWritten: true })
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1'], weights: ['opengym-bw-2026-09-17'] }])
    expect(file()).toMatchObject({ on: false, written: {} })
  })
})

describe('which store', () => {
  it('is Health Connect in the Android app', async () => {
    expect(await hs.healthStatus()).toEqual({ status: 'available', granted: false, store: 'health-connect' })
    expect(h.registered).toEqual(['HealthConnect'])
  })
  it('is Apple Health in the iOS app, written the same way', async () => {
    h.platform = 'ios'
    expect((await hs.healthStatus()).store).toBe('apple-health')
    expect(h.registered).toEqual(['AppleHealth'])
    const r = await hs.enableHealth(state([workout('w1', 17)]))
    expect(r.ok).toBe(true)
    expect(writes()[0].sessions.map(s => s.id)).toEqual(['opengym-w-w1'])
  })
  it('says unsupported, naming no store, off the phone app', async () => {
    h.platform = 'web'
    expect(await hs.healthStatus()).toEqual({ status: 'unsupported', granted: false, store: null })
    expect(h.registered).toEqual([])
  })
})

describe('weigh-ins from Apple Health (iOS)', () => {
  let S, added
  const reads = () => h.calls.filter(c => c[0] === 'read').map(c => c[1])
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })   // initHealthSync's launch pass stays out of the way
    h.platform = 'ios'
    S = { unit: 'kg', workouts: [], bodyweight: [] }
    added = []
    hs.initHealthSync(() => S, { addWeights: list => { added.push(...list); return list.length } })
  })
  afterEach(() => { vi.useRealTimers() })

  it('reads nothing until switched on', async () => {
    await hs.loadHealth()
    expect(await hs.readHealth()).toBeNull()
    expect(reads()).toEqual([])
  })
  it('switched on: asks to read, takes everything once, and keeps the anchor', async () => {
    h.samples = [{ t: new Date(2026, 8, 17, 7).getTime(), kg: 80 }]
    const r = await hs.enableHealthRead()
    expect(r).toMatchObject({ ok: true, added: 1 })
    expect(h.calls[0]).toEqual(['request'])
    expect(reads()).toEqual([{ anchor: null }])
    expect(added.map(b => [b.d, b.w, b.src])).toEqual([['2026-09-17', 80, 'apple-health']])
    expect(file()).toMatchObject({ read: true, anchor: 'A1' })
  })
  it('then reads on from the anchor only', async () => {
    await hs.enableHealthRead()
    h.samples = []
    h.anchorOut = 'A2'
    await hs.readHealth()
    expect(reads().at(-1)).toEqual({ anchor: 'A1' })
    expect(file().anchor).toBe('A2')
  })
  it('converts to the unit of the log', async () => {
    S.unit = 'lb'
    h.samples = [{ t: new Date(2026, 8, 17, 7).getTime(), kg: 80 }]
    await hs.enableHealthRead()
    expect(added[0].w).toBe(176.4)
  })
  it('keeps the anchor when a read fails, and says so', async () => {
    await hs.enableHealthRead()
    h.readFail = 'permission'
    await hs.readHealth()
    expect(file()).toMatchObject({ anchor: 'A1', readError: 'permission' })
  })
  it('switched off: stops reading and forgets the anchor, keeping what it took', async () => {
    h.samples = [{ t: new Date(2026, 8, 17, 7).getTime(), kg: 80 }]
    await hs.enableHealthRead()
    await hs.disableHealthRead()
    expect(file()).toMatchObject({ read: false, anchor: null })
    expect(await hs.readHealth()).toBeNull()
    expect(added).toHaveLength(1)
  })
  it('is not there in the Android app', async () => {
    h.platform = 'android'
    vi.resetModules()
    hs = await import('./health-sync.js')
    expect(await hs.enableHealthRead()).toEqual({ ok: false, reason: 'unsupported' })
    expect(reads()).toEqual([])
  })
})
