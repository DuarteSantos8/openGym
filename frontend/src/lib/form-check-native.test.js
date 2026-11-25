// The page's side of Form check against a stand-in FormCheck plugin: it is offered only on the
// iPhone with the plugin saying yes, poses become a drill's reps said aloud, the status line is only
// updated when it changes, and the result arrives when the native view closes.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { platform: 'ios', available: true, listeners: {}, calls: [], said: [], sayOpts: [], startFails: null }
})

const plugin = {
  available: async () => ({ available: h.available }),
  start: async args => { h.calls.push(['start', args]); if (h.startFails) throw h.startFails },
  stop: async () => { h.calls.push(['stop']) },
  setStatus: async args => { h.calls.push(['setStatus', args]) },
  feedback: async args => { h.calls.push(['feedback', args]) },
  addListener: (name, fn) => { h.listeners[name] = fn; return Promise.resolve({ remove: async () => { delete h.listeners[name] } }) },
}
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform, isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}))
vi.mock('./speech.js', () => ({ speak: vi.fn(async (text, opts) => { h.said.push(text); h.sayOpts.push(opts); return true }) }))

const { formCheckAvailable, runFormCheck, missedHint, MISS_SHOW_MS, _resetFormCheck } = await import('./form-check-native.js')
const { drillById } = await import('./form-drills/index.js')
const { squatSet } = await import('./form-drills/test-kit.js')
const SQUAT = drillById('squat')

// `mins`: each rep's bottom knee angle, or a count of full (50°) reps. 95° stops above parallel.
// Filmed side-on unless `yaw` says otherwise (form-drills/test-kit.js).
function squats(mins, { rest = 10, yaw = 0 } = {}) {
  const list = typeof mins === 'number' ? Array(mins).fill(50) : mins
  return squatSet(list.map(min => ({ min, down: 1.7, up: 1 })), { yaw, stand: rest / 15 })
}
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  _resetFormCheck()
  h.platform = 'ios'; h.available = true; h.listeners = {}; h.calls = []; h.said = []; h.sayOpts = []; h.startFails = null
})

describe('formCheckAvailable', () => {
  it('is true on the iPhone when the plugin says it can run', async () => {
    expect(await formCheckAvailable()).toBe(true)
  })
  it('is false when the plugin says no (the simulator has no camera)', async () => {
    h.available = false
    expect(await formCheckAvailable()).toBe(false)
  })
  it('is false on Android', async () => {
    h.platform = 'android'
    expect(await formCheckAvailable()).toBe(false)
  })
})

describe('runFormCheck', () => {
  it('counts the reps aloud, updates the status line on change only, and resolves on close', async () => {
    const updates = []
    const run = runFormCheck({ drill: 'squat', camera: 'front', onUpdate: u => updates.push(u), voice: { rate: 1.2 } })
    await flush(); await flush()
    expect(h.calls[0]).toEqual(['start', { camera: 'front', labels: { done: 'Done', flip: 'Switch camera' } }])
    const frames = squats(3)
    for (const f of frames) h.listeners.pose(f)
    expect(h.said).toEqual(['1', '2', '3'])
    expect(h.sayOpts[0]).toMatchObject({ rate: 1.2, onSilent: true, queue: false })
    const statuses = h.calls.filter(c => c[0] === 'setStatus')
    expect(statuses.length).toBeLessThan(20)
    expect(statuses.at(-1)[1]).toEqual({ text: '', reps: 3, highlight: [], quiet: false })
    expect(h.calls.filter(c => c[0] === 'feedback').map(c => c[1].kind)).toEqual(['counted', 'counted', 'counted'])
    expect(updates).toHaveLength(frames.length)
    h.listeners.closed({})
    const res = await run
    expect(res).toMatchObject({ count: 3, drill: 'squat', kind: 'reps' })
    await flush()
    expect(h.listeners.pose).toBeUndefined()
  })

  it('says why the pose cannot be judged yet', async () => {
    runFormCheck({ drill: 'squat' })
    await flush(); await flush()
    h.listeners.pose({ t: 0, joints: {} })
    expect(h.calls.find(c => c[0] === 'setStatus')[1]).toEqual({ text: 'Step into the frame', reps: 0, highlight: [], quiet: false })
  })

  it('says a no-rep at once, queued behind any number, flashes it and shows why for about 2 s', async () => {
    const run = runFormCheck({ drill: 'squat', voice: { rate: 1 } })
    await flush(); await flush()
    // Full, shallow, full under the default standard (parallel), standing 2.6 s between.
    const frames = squats([50, 95, 50], { rest: 40 })
    let missedAt = null
    const lineAt = {}
    for (const f of frames) {
      const before = h.calls.length
      h.listeners.pose(f)
      for (const c of h.calls.slice(before)) {
        if (c[0] === 'feedback' && c[1].kind === 'missed') missedAt = f.t
        if (c[0] === 'setStatus') lineAt[f.t] = c[1]
      }
    }
    expect(h.said).toEqual(['1', 'Too shallow', '2'])
    expect(h.sayOpts[1]).toMatchObject({ onSilent: true, queue: true })
    const fb = h.calls.filter(c => c[0] === 'feedback').map(c => c[1])
    expect(fb).toEqual([{ kind: 'counted' }, { kind: 'missed', text: missedHint(SQUAT, 'shallow') }, { kind: 'counted' }])
    // The reason goes up with the miss, the count stays, and the line clears after MISS_SHOW_MS.
    expect(lineAt[missedAt]).toEqual({ text: missedHint(SQUAT, 'shallow'), reps: 1, highlight: [], quiet: false })
    const cleared = Object.keys(lineAt).map(Number).find(t => t > missedAt && lineAt[t].text !== missedHint(SQUAT, 'shallow'))
    expect(cleared - missedAt).toBeGreaterThanOrEqual(MISS_SHOW_MS)
    expect(cleared - missedAt).toBeLessThan(MISS_SHOW_MS + 200)
    h.listeners.closed({})
    const res = await run
    expect(res).toMatchObject({ count: 2, missed: 1, standard: 'parallel' })
  })

  it('counts from the standard it is given, and lights the hips once it is reached mid-rep, from the front too', async () => {
    const run = runFormCheck({ drill: 'squat', standard: 'any' })
    await flush(); await flush()
    for (const f of squats([95, 50], { yaw: 90 })) h.listeners.pose(f)
    expect(h.said).toEqual(['1', '2'])
    const reached = h.calls.filter(c => c[0] === 'setStatus').map(c => c[1].highlight.join(',') === 'leftHip,rightHip')
    // Off, on during each rep, off again once it is counted.
    expect(reached.filter((v, i) => v !== reached[i - 1])).toEqual([false, true, false, true, false])
    h.listeners.closed({})
    expect((await run).standard).toBe('any')
  })

  it('times a hold quietly: the seconds on screen, only the milestones said, as seconds, and read to VoiceOver', async () => {
    // The plank's own tracker is stood in for: one second held per frame, a milestone every 10.
    const plank = drillById('plank')
    const create = vi.spyOn(plank, 'create').mockImplementation(() => {
      let n = 0
      return {
        push: () => { n++; return { count: n, inFrame: true, hint: '', justCounted: n % 10 === 0, justMissed: false, reason: null, reached: true, highlight: [] } },
        result: () => ({ count: n, missed: 0, reps: [], tiles: [], cue: '', cueId: 'steady', details: [] }),
      }
    })
    try {
      const run = runFormCheck({ drill: 'plank' })
      await flush(); await flush()
      for (let i = 0; i < 25; i++) h.listeners.pose({ t: i * 1000, aspect: 0.75, joints: {} })
      expect(h.said).toEqual(['10 seconds', '20 seconds'])
      const statuses = h.calls.filter(c => c[0] === 'setStatus').map(c => c[1])
      expect(statuses).toHaveLength(25)
      expect(statuses.every(x => x.quiet === true)).toBe(true)
      expect(h.calls.filter(c => c[0] === 'feedback').map(c => c[1])).toEqual([{ kind: 'counted', text: '10 seconds' }, { kind: 'counted', text: '20 seconds' }])
      h.listeners.closed({})
      expect(await run).toMatchObject({ count: 25, drill: 'plank', kind: 'hold' })
    } finally { create.mockRestore() }
  })

  it('rejects when the camera view cannot open', async () => {
    h.startFails = Object.assign(new Error('Camera access is off'), { code: 'denied' })
    await expect(runFormCheck({ drill: 'squat' })).rejects.toThrow('Camera access is off')
  })

  it('rejects a drill it does not know, before opening anything', async () => {
    await expect(runFormCheck({ drill: 'bench' })).rejects.toThrow('unknown drill: bench')
    expect(h.calls).toEqual([])
  })

  it('says a reason the drill does not name as plainly not counted', () => {
    expect(missedHint(SQUAT, 'wobbly')).toBe('Not counted')
    expect(missedHint(null, 'shallow')).toBe('Not counted')
  })
})
