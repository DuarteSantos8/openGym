import { beforeEach, describe, expect, it, vi } from 'vitest'

// #200: the Android app keeping Health Connect in step with the log. The native plugin
// (HealthConnectPlugin.java) and the app's data directory are played in memory.
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), calls: [], status: { status: 'available', granted: false }, grant: true, fail: null, platform: 'android', plugins: [] }
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
  registerPlugin: name => (h.plugins.push(name), {
    status: async () => ({ ...h.status }),
    requestPermissions: async () => { h.calls.push(['request']); h.status.granted = h.grant; return { granted: h.grant } },
    write: async arg => {
      h.calls.push(['write', arg])
      if (h.fail) throw Object.assign(new Error('refused'), { code: h.fail })
    },
    remove: async arg => {
      h.calls.push(['remove', arg])
      if (h.removeFail) throw Object.assign(new Error('refused'), { code: h.removeFail })
      return h.left ? { left: h.left } : undefined
    },
    openSettings: async () => {},
    setEnabled: async ({ on }) => { h.calls.push(['setEnabled', on]) },
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
  h.files.clear(); h.calls = []; h.status = { status: 'available', granted: false }; h.grant = true; h.fail = null; h.removeFail = null; h.left = null; h.platform = 'android'; h.plugins = []
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
    await hs.syncHealth({ ...state([workout('w2', 18)]), deleted: { workouts: { w1: at(20, 9) } } })
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

// The owner, TestFlight: a workout or a weigh-in deleted in openGym goes from Apple Health too,
// wherever the deletion was made, and nothing else ever does.
describe('deleting in openGym', () => {
  const bw = (d, w) => ({ d: `2026-09-${d}`, w, t: at(d, 7) })
  it('takes a deleted workout and a removed weigh-in out, and rewrites an edited one', async () => {
    await hs.enableHealth(state([workout('w1', 17), workout('w2', 18)], [bw(17, 80), bw(18, 79)]))
    h.calls = []
    const edited = { ...workout('w2', 18), name: 'Push, heavier' }
    await hs.syncHealth({ ...state([edited], [bw(18, 79)]), deleted: { workouts: { w1: at(20, 9) }, bodyweight: { '2026-09-17': at(20, 9) } } })
    expect(writes().map(w => w.sessions.map(s => s.title))).toEqual([['Push, heavier']])
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1'], weights: ['opengym-bw-2026-09-17'] }])
    expect(Object.keys(file().written).sort()).toEqual(['opengym-bw-2026-09-18', 'opengym-w-w2'])
  })

  it('a copy that merely lacks them (signed out, not loaded yet) removes nothing', async () => {
    await hs.enableHealth(state([workout('w1', 17)], [bw(17, 80)]))
    h.calls = []
    await hs.syncHealth(state([], []))
    expect(removes()).toEqual([])
    expect(Object.keys(file().written).sort()).toEqual(['opengym-bw-2026-09-17', 'opengym-w-w1'])
    // …and back with them, nothing is written twice.
    await hs.syncHealth(state([workout('w1', 17)], [bw(17, 80)]))
    expect(h.calls).toEqual([])
  })

  it('a deletion made on another device goes when it syncs in, even after a copy without the workout', async () => {
    await hs.enableHealth(state([workout('w1', 17), workout('w2', 18)]))
    await hs.syncHealth(state([workout('w2', 18)]))              // the merge has not brought the record yet
    expect(removes()).toEqual([])
    await hs.syncHealth({ ...state([workout('w2', 18)]), deleted: { workouts: { w1: at(21, 9) } } })
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1'], weights: [] }])
  })

  it('a deletion while it was off goes once it is on again', async () => {
    await hs.enableHealth(state([workout('w1', 17)]))
    await hs.disableHealth({ removeWritten: false })
    h.calls = []
    const after = { ...state([]), deleted: { workouts: { w1: at(21, 9) } } }
    await hs.syncHealth(after)
    expect(h.calls.filter(c => c[0] === 'remove')).toEqual([])
    await hs.enableHealth(after)
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1'], weights: [] }])
    expect(file().written).toEqual({})
  })

  it('an add-back (a negative stamp) is not a deletion, and an entry this phone never wrote is skipped', async () => {
    await hs.enableHealth(state([workout('w1', 17)]))
    h.calls = []
    await hs.syncHealth({ ...state([]), deleted: { workouts: { w1: -at(21, 9), old: at(21, 9) } } })
    expect(removes()).toEqual([])
  })

  it('"Reset everything" takes out what it wiped', async () => {
    await hs.enableHealth(state([workout('w1', 17)], [bw(17, 80)]))
    h.calls = []
    await hs.syncHealth({ ...state([]), resetAt: at(22, 9), resetIds: { workouts: ['w1'], bodyweight: ['2026-09-17|' + at(17, 7)] } })
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1'], weights: ['opengym-bw-2026-09-17'] }])
  })

  it('a refused removal is tried again on the next sync, and one Apple Health kept is not forgotten', async () => {
    await hs.enableHealth(state([workout('w1', 17), workout('w2', 18)]))
    const gone = { ...state([]), deleted: { workouts: { w1: at(21, 9), w2: at(21, 9) } } }
    h.removeFail = 'permission'
    await hs.syncHealth(gone)
    expect(file().error).toBe('permission')
    expect(Object.keys(file().written).sort()).toEqual(['opengym-w-w1', 'opengym-w-w2'])
    h.removeFail = null
    h.left = ['opengym-w-w2']                                   // say the watch's copy stayed
    h.calls = []
    await hs.syncHealth(gone)
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1', 'opengym-w-w2'], weights: [] }])
    expect(Object.keys(file().written)).toEqual(['opengym-w-w2'])
    expect(file().error).toBeNull()
    h.left = null
    h.calls = []
    await hs.syncHealth(gone)
    expect(removes()).toEqual([{ sessions: ['opengym-w-w2'], weights: [] }])
    expect(file().written).toEqual({})
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

// The iPhone app: the same switch, the same records and file, through Apple Health
// (AppleHealthPlugin.swift), which also tells the Apple Watch app whether it is on.
describe('on the iPhone', () => {
  beforeEach(async () => {
    vi.resetModules()
    h.platform = 'ios'
    hs = await import('./health-sync.js')
  })
  it('talks to Apple Health and says which one it is', async () => {
    expect(await hs.healthStatus()).toMatchObject({ status: 'available', platform: 'ios' })
    expect(h.plugins).toEqual(['AppleHealth'])
  })
  it('writes the same records, and tells the watch when it goes on and off', async () => {
    await hs.enableHealth(state([workout('w1', 17)]))
    expect(writes()[0].sessions.map(r => r.id)).toEqual(['opengym-w-w1'])
    expect(h.calls.filter(c => c[0] === 'setEnabled')).toEqual([['setEnabled', true]])
    await hs.disableHealth({ removeWritten: false })
    expect(h.calls.filter(c => c[0] === 'setEnabled')).toEqual([['setEnabled', true], ['setEnabled', false]])
  })
  it('tells the watch nothing when asking was refused', async () => {
    h.grant = false
    expect(await hs.enableHealth(state([]))).toMatchObject({ ok: false, reason: 'denied' })
    expect(h.calls.filter(c => c[0] === 'setEnabled')).toEqual([])
  })
  it('Android has no watch to tell', async () => {
    vi.resetModules()
    h.platform = 'android'
    hs = await import('./health-sync.js')
    await hs.enableHealth(state([workout('w1', 17)]))
    expect(h.calls.filter(c => c[0] === 'setEnabled')).toEqual([])
    expect((await hs.healthStatus()).platform).toBe('android')
  })
})
