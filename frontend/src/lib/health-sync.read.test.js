import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// v1.4.3 (#544, #127): reading heart rate and weigh-ins back from Health Connect / Apple Health.
// The native plugin and the app's data directory are played in memory, the store by a plain
// object and an `apply` that runs the change on it (as useStore's update does).
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), calls: [], platform: 'android', granted: { heartRate: true, weight: true }, hr: [], weights: [], fail: null }
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
  registerPlugin: () => ({
    status: async () => ({ status: 'available', granted: false, read: { ...h.granted } }),
    requestPermissions: async arg => {
      h.calls.push(['request', arg])
      return h.platform === 'ios' ? { granted: false } : { granted: false, read: { ...h.granted } }
    },
    readHeartRate: async arg => {
      h.calls.push(['readHeartRate', arg])
      if (h.fail) throw Object.assign(new Error('no'), { code: h.fail })
      return { samples: h.hr.filter(([t]) => t >= arg.from && t <= arg.to), origins: ['com.garmin.android.apps.connectmobile'] }
    },
    readWeights: async arg => {
      h.calls.push(['readWeights', arg])
      if (h.fail) throw Object.assign(new Error('no'), { code: h.fail })
      return { records: h.weights.filter(r => r.t >= arg.since) }
    },
    write: async () => { h.calls.push(['write']) },
    remove: async () => {},
    openSettings: async () => {},
    setEnabled: async () => {},
  }),
}))

const NOW = Date.UTC(2026, 9, 15, 20, 0, 0)
const s = sec => NOW - 3600e3 + sec * 1000
const dense = (from, to, bpm) => { const out = []; for (let x = from; x <= to; x++) out.push([s(x), bpm]); return out }
const workout = (id, endSec = 600, extra = {}) => ({ id, d: '2026-10-15', name: 'Push', start: s(0), end: s(endSec), entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true, at: s(100) }] }], ...extra })
const reads = kind => h.calls.filter(c => c[0] === kind)
const file = () => JSON.parse(h.files.get('opengym-health.json') || 'null')

let hs, S, applied
const getState = () => S
const apply = fn => { applied++; const next = JSON.parse(JSON.stringify(S)); fn(next); S = next }
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.resetModules()
  h.files.clear(); h.calls = []; h.platform = 'android'; h.granted = { heartRate: true, weight: true }; h.hr = []; h.weights = []; h.fail = null
  S = { unit: 'kg', workouts: [workout('w1')], bodyweight: [] }
  applied = 0
  hs = await import('./health-sync.js')
})

afterEach(() => { vi.useRealTimers() })

describe('switched off (the default)', () => {
  it('reads nothing at all', async () => {
    await hs.loadHealth()
    h.hr = dense(0, 600, 130)
    await hs.readHealth(getState, { force: true, now: NOW, apply })
    expect(h.calls).toEqual([])
    expect(applied).toBe(0)
  })
})

describe('heart rate', () => {
  it('asks for that read permission only, then fills the workout just finished', async () => {
    h.hr = dense(0, 600, 130)
    const r = await hs.enableRead('hr', getState, { apply })
    expect(r.ok).toBe(true)
    expect(h.calls[0]).toEqual(['request', { read: ['heartRate'], write: [] }])
    expect(reads('readHeartRate')).toHaveLength(1)
    expect(S.workouts[0].entries[0].sets[0].hr).toEqual({ avg: 130, max: 130 })
    expect(S.workouts[0].hr).toMatchObject({ src: 'hc', avg: 130 })
    expect(file()).toMatchObject({ readHr: true, readWeight: false, on: false })
    expect(reads('write')).toEqual([])
  })

  it('stays off when the permission is not granted', async () => {
    h.granted.heartRate = false
    expect(await hs.enableRead('hr', getState, { apply })).toEqual({ ok: false, reason: 'denied' })
    expect(reads('readHeartRate')).toEqual([])
    expect(file()).toBeNull()
  })

  it('looks only at workouts of the last 24 hours, and not more than every few minutes', async () => {
    S.workouts.push({ ...workout('old'), start: NOW - 30 * 3600e3, end: NOW - 29 * 3600e3 })
    await hs.enableRead('hr', getState, { apply })
    expect(reads('readHeartRate').map(c => c[1].from)).toEqual([s(0)])
    // Nothing yet (the watch has not synced): tried again later, not right away.
    await hs.readHealth(getState, { now: NOW + 60e3, apply })
    expect(reads('readHeartRate')).toHaveLength(1)
    h.hr = dense(0, 600, 125)
    await hs.readHealth(getState, { now: NOW + 11 * 60e3, apply })
    expect(reads('readHeartRate')).toHaveLength(2)
    expect(S.workouts[0].hr.avg).toBe(125)
    // A day later it stops looking.
    await hs.readHealth(getState, { force: true, now: NOW + 25 * 3600e3, apply })
    expect(reads('readHeartRate')).toHaveLength(2)
  })

  it('never touches the Apple Watch’s own reading on the iPhone', async () => {
    vi.resetModules(); h.platform = 'ios'; hs = await import('./health-sync.js')
    const watch = { avg: 111, max: 140 }
    S.workouts[0].entries[0].sets[0].hr = watch
    S.workouts[0].hr = { avg: 110, max: 140, src: 'watch', n: 600 }
    h.hr = dense(0, 600, 150)
    await hs.enableRead('hr', getState, { apply })
    expect(S.workouts[0].entries[0].sets[0].hr).toEqual(watch)
    expect(S.workouts[0].hr.src).toBe('watch')
  })

  it('a withdrawn permission is remembered, for Settings to offer asking again', async () => {
    await hs.enableRead('hr', getState, { apply })
    h.fail = 'permission'
    await hs.readHealth(getState, { force: true, now: NOW + 3 * 60e3, apply })
    expect(file().readError).toBe('permission')
  })

  it('turning it off stops the reads and keeps what came in', async () => {
    h.hr = dense(0, 600, 130)
    await hs.enableRead('hr', getState, { apply })
    await hs.disableRead('hr')
    S.workouts.push(workout('w2'))
    await hs.readHealth(getState, { force: true, now: NOW + 3 * 60e3, apply })
    expect(reads('readHeartRate')).toHaveLength(1)
    expect(S.workouts[0].hr.src).toBe('hc')
  })
})

describe('weigh-ins', () => {
  const rec = (hAgo, kg, extra = {}) => ({ t: NOW - hAgo * 3600e3, kg, id: 'r' + hAgo, origin: 'com.withings.wiscale2', clientId: null, ...extra })

  it('reads the last 30 days the first time, then from the newest seen', async () => {
    h.weights = [rec(2, 80.4), rec(26, 81, { clientId: 'opengym-bw-2026-10-14' })]
    await hs.enableRead('weight', getState, { apply })
    expect(h.calls[0]).toEqual(['request', { read: ['weight'], write: [] }])
    expect(reads('readWeights')[0][1].since).toBe(NOW - 30 * 24 * 3600e3)
    expect(S.bodyweight).toEqual([{ d: '2026-10-15', w: 80.4, t: NOW - 2 * 3600e3, src: 'hc' }])
    expect(file().wCursor).toBe(NOW - 2 * 3600e3)
    await hs.readHealth(getState, { force: true, now: NOW + 3 * 60e3, apply })
    expect(reads('readWeights')[1][1].since).toBe(NOW - 2 * 3600e3 - 2 * 24 * 3600e3)
  })

  it('changes nothing on a second read of the same records', async () => {
    h.weights = [rec(2, 80.4)]
    await hs.enableRead('weight', getState, { apply })
    expect(applied).toBe(1)
    await hs.readHealth(getState, { force: true, now: NOW + 3 * 60e3, apply })
    expect(applied).toBe(1)
  })

  it('leaves a day with a weigh-in typed into openGym alone', async () => {
    S.bodyweight = [{ d: '2026-10-15', w: 82, t: NOW - 10 * 3600e3 }]
    h.weights = [rec(2, 80.4)]
    await hs.enableRead('weight', getState, { apply })
    expect(applied).toBe(0)
    expect(S.bodyweight).toEqual([{ d: '2026-10-15', w: 82, t: NOW - 10 * 3600e3 }])
  })

  it('on the iPhone, where Apple Health never says whether reading is allowed, just reads', async () => {
    vi.resetModules(); h.platform = 'ios'; hs = await import('./health-sync.js')
    h.weights = [rec(2, 80.4)]
    expect((await hs.enableRead('weight', getState, { apply })).ok).toBe(true)
    expect(S.bodyweight[0].src).toBe('ah')
  })
})

// Idea from #801 (antoni-heredia): Health Connect's history permission lets the first read of
// weigh-ins go further back than the 30 days before the grant.
describe('weigh-ins with the history permission', () => {
  const rec = (dAgo, kg) => ({ t: NOW - dAgo * 24 * 3600e3, kg, id: 'd' + dAgo, origin: 'com.withings.wiscale2', clientId: null })
  const withHistory = async (granted, platform = 'android') => {
    vi.resetModules()
    h.platform = platform
    h.granted = { heartRate: true, weight: true, history: granted }
    const core = await import('@capacitor/core')
    const hc = core.registerPlugin()
    vi.spyOn(core, 'registerPlugin').mockReturnValue({ ...hc, status: async () => ({ status: 'available', granted: false, read: { ...h.granted }, history: true }) })
    hs = await import('./health-sync.js')
  }

  it('asks for it with the weight and then reads a year back', async () => {
    await withHistory(true)
    h.weights = [rec(200, 84), rec(1, 80)]
    await hs.enableRead('weight', getState, { apply })
    expect(h.calls[0]).toEqual(['request', { read: ['weight', 'history'], write: [] }])
    expect(reads('readWeights')[0][1].since).toBe(NOW - 365 * 24 * 3600e3)
    expect(S.bodyweight.map(b => b.w)).toEqual([84, 80])
    expect(file().wHistory).toBe(true)
  })

  it('refused, it still reads the 30 days', async () => {
    await withHistory(false)
    h.weights = [rec(200, 84), rec(1, 80)]
    expect((await hs.enableRead('weight', getState, { apply })).ok).toBe(true)
    expect(reads('readWeights')[0][1].since).toBe(NOW - 30 * 24 * 3600e3)
    expect(S.bodyweight.map(b => b.w)).toEqual([80])
    expect(file().wHistory).toBe(false)
  })

  it('taken back later, the read falls back to 30 days instead of failing', async () => {
    await withHistory(true)
    await hs.enableRead('weight', getState, { apply })
    h.calls = []
    const core = await import('@capacitor/core')
    const plugin = core.registerPlugin()
    let first = true
    const readWeights = plugin.readWeights
    plugin.readWeights = async arg => {
      if (first) { first = false; h.calls.push(['readWeights', arg]); throw Object.assign(new Error('no'), { code: 'permission' }) }
      return readWeights(arg)
    }
    h.weights = [rec(1, 79.5)]
    await hs.readHealth(getState, { force: true, now: NOW + 3 * 60e3, apply })
    expect(reads('readWeights').map(c => c[1].since)).toEqual([NOW + 3 * 60e3 - 365 * 24 * 3600e3, NOW + 3 * 60e3 - 30 * 24 * 3600e3])
    expect(file().wHistory).toBe(false)
    expect(file().readError).toBe(null)
  })

  it('heart rate and the iPhone never ask for it', async () => {
    await withHistory(true)
    await hs.enableRead('hr', getState, { apply })
    expect(h.calls[0]).toEqual(['request', { read: ['heartRate'], write: [] }])
    await withHistory(true, 'ios')
    h.calls = []
    await hs.enableRead('weight', getState, { apply })
    expect(h.calls[0]).toEqual(['request', { read: ['weight'], write: [] }])
  })
})
