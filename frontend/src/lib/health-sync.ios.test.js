import { beforeEach, describe, expect, it, vi } from 'vitest'

// The iOS app keeping Apple Health in step with the log: the same orchestration as Health
// Connect (health-sync.test.js), with HealthKitPlugin.swift played in memory.
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), calls: [], platform: 'ios', names: [], status: { status: 'available', granted: false }, grant: true, fail: null }
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
  registerPlugin: name => {
    h.names.push(name)
    return {
      status: async () => ({ ...h.status }),
      // HealthKit does not tell a denial from a grant: the native side answers granted once asked.
      requestPermissions: async () => { h.calls.push(['request']); h.status.granted = h.grant; return { granted: h.grant } },
      write: async arg => {
        h.calls.push(['write', arg])
        if (h.fail) throw Object.assign(new Error('refused'), { code: h.fail })
      },
      remove: async arg => { h.calls.push(['remove', arg]) },
      openSettings: async arg => { h.calls.push(['settings', arg]) },
    }
  },
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
  h.files.clear(); h.calls = []; h.names = []; h.platform = 'ios'
  h.status = { status: 'available', granted: false }; h.grant = true; h.fail = null
  hs = await import('./health-sync.js')
})

describe('the plugin and its name', () => {
  it('talks to the HealthKit plugin on iOS', async () => {
    expect(await hs.healthStatus()).toEqual({ status: 'available', granted: false })
    expect(h.names).toEqual(['HealthKit'])
  })
  it('names the store for the card', async () => {
    expect(await hs.healthPlatformName()).toBe('Apple Health')
    vi.resetModules(); h.platform = 'android'
    expect(await (await import('./health-sync.js')).healthPlatformName()).toBe('Health Connect')
    vi.resetModules(); h.platform = 'web'
    expect(await (await import('./health-sync.js')).healthPlatformName()).toBeNull()
  })
  it('is unsupported where Health is not (an iPad)', async () => {
    h.status = { status: 'unsupported', granted: false }
    expect(await hs.enableHealth(state([]))).toEqual({ ok: false, reason: 'unsupported' })
  })
  it('opens the settings for the permission, or the Health app itself', async () => {
    await hs.openHealthConnect()
    await hs.openHealthConnect('health')
    expect(h.calls).toEqual([['settings', {}], ['settings', { target: 'health' }]])
  })
})

describe('turning it on', () => {
  it('asks for the permissions, then writes the whole log once', async () => {
    const r = await hs.enableHealth(state([workout('w1', 17)], [{ d: '2026-09-17', w: 80, t: at(17, 7) }]))
    expect(r.ok).toBe(true)
    expect(h.calls[0]).toEqual(['request'])
    expect(writes()).toHaveLength(1)
    expect(writes()[0].sessions.map(s => [s.id, s.type])).toEqual([['opengym-w-w1', 'strength_training']])
    expect(writes()[0].weights.map(s => s.id)).toEqual(['opengym-bw-2026-09-17'])
    expect(file().on).toBe(true)
  })
  it('takes the native answer to the request as it is', async () => {
    h.grant = false
    expect(await hs.enableHealth(state([workout('w1', 17)]))).toEqual({ ok: false, reason: 'denied' })
    expect(writes()).toEqual([])
  })
})

describe('keeping in step', () => {
  it('writes only what is new, and removes what was deleted', async () => {
    await hs.enableHealth(state([workout('w1', 17)]))
    h.calls = []
    await hs.syncHealth(state([workout('w1', 17), workout('w2', 18)]))
    expect(writes().map(w => w.sessions.map(s => s.id))).toEqual([['opengym-w-w2']])
    h.calls = []
    await hs.syncHealth(state([workout('w2', 18)]))
    expect(writes()).toEqual([])
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1'], weights: [] }])
  })
  it('remembers a refused write as a withdrawn permission', async () => {
    await hs.enableHealth(state([workout('w1', 17)]))
    h.fail = 'permission'
    await hs.syncHealth(state([workout('w1', 17), workout('w2', 18)]))
    expect(file().error).toBe('permission')
    expect(Object.keys(file().written)).toEqual(['opengym-w-w1'])
    h.fail = null
    await hs.syncHealth(state([workout('w1', 17), workout('w2', 18)]))
    expect(file().error).toBeNull()
  })
  it('can remove exactly what it wrote when turned off', async () => {
    await hs.enableHealth(state([workout('w1', 17)], [{ d: '2026-09-17', w: 80, t: at(17, 7) }]))
    await hs.disableHealth({ removeWritten: true })
    expect(removes()).toEqual([{ sessions: ['opengym-w-w1'], weights: ['opengym-bw-2026-09-17'] }])
    expect(file()).toMatchObject({ on: false, written: {} })
  })
})
