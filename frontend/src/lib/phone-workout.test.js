// @vitest-environment happy-dom
// The iPhone's own workout session (#818): when it runs (AirPods heart rate, no Apple Watch taking
// the workout), how its readings become each set's heart rate, and the session's life with the
// workout (started, measured, saved once, dropped when the watch takes over).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const health = vi.hoisted(() => ({ on: true, listeners: new Set() }))
vi.mock('./health-sync.js', () => ({
  loadHealth: async () => ({ on: health.on }),
  onHealthChange: cb => { health.listeners.add(cb); return () => health.listeners.delete(cb) },
}))

import { phoneSessionPlan, liveHrPatches, noteRest, isLiveWorkout, startPhoneWorkout, liveHeartRate, _setPhonePluginForTest, FRESH_START_MS, WATCH_GRACE_MS } from './phone-workout.js'
import { applyEvents, watchClaimed, _resetWatchSync } from './watch-sync.js'
import { writeWatchStatus } from './watch-settings.js'

const now = 1_800_000_000_000
const live = (over = {}) => ({ id: 'w1', start: now - 2000, entries: [], ...over })
const plan = over => phoneSessionPlan({ supported: true, healthOn: true, S: { active: live() }, now, watch: {}, ...over })

describe('when the phone runs its own session', () => {
  it('a live workout, Apple Health on, iOS 26, no watch: yes', () => {
    expect(plan()).toEqual({ run: true, wait: 0, reason: 'run' })
  })
  it('not below iOS 26, not with Apple Health off, not without a live workout', () => {
    expect(plan({ supported: false }).reason).toBe('unsupported')
    expect(plan({ healthOn: false }).reason).toBe('health')
    expect(plan({ S: { active: null } }).reason).toBe('none')
    expect(plan({ S: { active: live({ backfill: { durationMin: 60 } }) } }).reason).toBe('none')
    expect(plan({ S: { active: live({ editingWorkoutId: 'old' }) } }).reason).toBe('none')
    expect(plan({ tourSandbox: true }).reason).toBe('none')
  })
  it('the watch has the workout: never, even with a session running (it is handed over)', () => {
    expect(plan({ watchClaimed: true }).run).toBe(false)
    expect(plan({ watchClaimed: true, running: true })).toEqual({ run: false, wait: 0, reason: 'watch' })
    const there = { linked: true, enabled: true, health: 'on', reachable: true }
    expect(plan({ watch: there, running: true }).reason).toBe('watch')
  })
  it('a watch that could take it gets a moment first, then the phone starts', () => {
    const away = { linked: true, enabled: true, health: 'on', reachable: false }
    const p = plan({ watch: away })
    expect(p.run).toBe(false)
    expect(p.reason).toBe('wait')
    expect(p.wait).toBe(WATCH_GRACE_MS - 2000)
    expect(plan({ watch: away, now: now + WATCH_GRACE_MS }).run).toBe(true)
  })
  it('a watch without Apple Health, switched off in Settings, or just paired: the phone measures', () => {
    expect(plan({ watch: { linked: true, enabled: true, health: 'off', reachable: true } }).run).toBe(true)
    expect(plan({ watch: { linked: true, enabled: false, health: 'on', reachable: true } }).run).toBe(true)
    expect(plan({ watch: { linked: true, enabled: true, health: null, reachable: false } }).run).toBe(true)
  })
  it('an old workout found at launch gets no fresh session, a running one keeps going', () => {
    const old = { active: live({ start: now - FRESH_START_MS - 1 }) }
    expect(plan({ S: old }).reason).toBe('stale')
    expect(plan({ S: old, running: true }).run).toBe(true)
  })
  it('isLiveWorkout', () => {
    expect(isLiveWorkout(live())).toBe(true)
    expect(isLiveWorkout({ entries: [] })).toBe(false)
    expect(isLiveWorkout(live(), { tourSandbox: true })).toBe(false)
  })
})

// A reading every 2 s, `bpm(t)` beats a minute, from `from` to `to`.
const readings = (from, to, bpm) => { const out = []; for (let t = from; t <= to; t += 2000) out.push([t, bpm(t)]); return out }
const s0 = now - 600e3

describe('the session\'s readings as each set\'s heart rate', () => {
  const w = () => ({
    id: 'w1',
    entries: [
      { id: 'bench', sets: [{ w: 60, r: 8, done: true, at: s0 + 60e3 }, { w: 60, r: 8, done: true, at: s0 + 200e3 }, { w: 60, r: 8 }] },
      { id: 'row', sets: [{ w: 50, r: 10, done: true, at: s0 + 330e3 }] },
    ],
  })
  // Sets at 140, rests at 100: easy to tell apart.
  const busy = [[s0 + 30e3, s0 + 60e3], [s0 + 170e3, s0 + 200e3], [s0 + 300e3, s0 + 330e3]]
  const samples = readings(s0, s0 + 400e3, t => (busy.some(([a, b]) => t > a && t <= b) ? 140 : 100))
  const rests = { '0:0': { from: s0 + 60e3, to: s0 + 150e3 }, '0:1': { from: s0 + 200e3, to: s0 + 290e3 } }

  it('a set from the end of the rest before it to its tick, a rest from the tick to its end', () => {
    const out = liveHrPatches(w(), samples, { rests, from: s0 })
    const by = Object.fromEntries(out.map(p => [`${p.where.entryIdx}:${p.where.setIdx}`, p]))
    // The first set from the session's start: some rest, then the set.
    expect(by['0:0'].fields.hr.max).toBe(140)
    expect(by['0:0'].fields.restHr).toEqual({ avg: 100, max: 100 })
    // The second set starts where the first rest ended (150 s), so 20 s of 100 and 30 s of 140.
    expect(by['0:1'].fields.hr.max).toBe(140)
    expect(by['0:1'].fields.hr.avg).toBeGreaterThan(115)
    expect(by['0:1'].fields.hr.avg).toBeLessThan(130)
    expect(by['0:1'].fields.restHr).toEqual({ avg: 100, max: 100 })
    expect(by['1:0'].where).toEqual({ wid: 'w1', exId: 'row', entryIdx: 1, setIdx: 0 })
    // The last set's rest is still open (no timer noted for it, no next set): only its own reading.
    expect(by['1:0'].fields.restHr).toBeUndefined()
    // The set not done gets nothing.
    expect(by['0:2']).toBeUndefined()
  })
  it('a rest cut short by the next tick: the set counts from the tick before it, the rest to that tick', () => {
    const cut = { '0:0': { from: s0 + 60e3 } }
    const out = liveHrPatches(w(), samples, { rests: cut, from: s0 })
    const second = out.find(p => p.where.setIdx === 1 && p.where.entryIdx === 0)
    expect(second.fields.hr.max).toBe(140)
    const first = out.find(p => p.where.setIdx === 0 && p.where.entryIdx === 0)
    expect(first.fields.restHr.max).toBe(140) // ran to the next tick, which takes in the second set
  })
  it('a set that already has a reading (the watch\'s) keeps it', () => {
    const x = w()
    x.entries[0].sets[0].hr = { avg: 120, max: 130 }
    x.entries[0].sets[0].restHr = { avg: 90, max: 95 }
    const out = liveHrPatches(x, samples, { rests, from: s0 })
    expect(out.find(p => p.where.entryIdx === 0 && p.where.setIdx === 0)).toBeUndefined()
  })
  it('the last rest closes at the workout\'s end once it is finished', () => {
    const r = { ...rests, '1:0': { from: s0 + 330e3 } }
    const out = liveHrPatches(w(), samples, { rests: r, from: s0, endedAt: s0 + 390e3 })
    expect(out.find(p => p.where.entryIdx === 1).fields.restHr).toEqual({ avg: 100, max: 100 })
  })
  it('nothing before the session started, nothing without readings, nothing implausible', () => {
    expect(liveHrPatches(w(), samples, { rests, from: s0 + 400e3 })).toEqual([])
    expect(liveHrPatches(w(), [], { rests, from: s0 })).toEqual([])
    expect(liveHrPatches(w(), readings(s0, s0 + 400e3, () => 300), { rests, from: s0 })).toEqual([])
    expect(liveHrPatches(null, samples)).toEqual([])
  })
  it('a per-side set counts to its later side\'s tick', () => {
    const x = { id: 'w1', entries: [{ id: 'lunge', sets: [{ sides: { L: { w: 20, r: 8, done: true, at: s0 + 40e3 }, R: { w: 20, r: 8, done: true, at: s0 + 60e3 } } }] }] }
    const out = liveHrPatches(x, samples, { from: s0 })
    expect(out).toHaveLength(1)
    expect(out[0].fields.hr.max).toBe(140)
  })
})

describe('the rests, from the rest timer', () => {
  const rest = (over = {}) => ({ left: 90, total: 90, endsAt: now + 90e3, forIdx: 0, forSet: 1, ...over })
  it('starts with the timer and ends when it runs out, at its end', () => {
    const r = noteRest({}, null, rest(), now)
    expect(r['0:1']).toEqual({ from: now })
    // The page noticed only later (it slept): the rest still ended at its end.
    noteRest(r, rest(), rest({ left: 0, ready: true }), now + 120e3)
    expect(r['0:1'].to).toBe(now + 90e3)
  })
  it('skipped or cut short by the next set: ends then', () => {
    const r = noteRest({}, null, rest(), now)
    noteRest(r, rest(), null, now + 30e3)
    expect(r['0:1'].to).toBe(now + 30e3)
  })
  it('+15 s after it ran out: open again', () => {
    const r = noteRest({}, null, rest(), now)
    noteRest(r, rest(), rest({ ready: true, left: 0 }), now + 90e3)
    noteRest(r, rest({ ready: true, left: 0 }), rest({ endsAt: now + 105e3, left: 15 }), now + 90e3)
    expect(r['0:1']).toEqual({ from: now })
  })
  it('the pause between two sides is no rest', () => {
    expect(noteRest({}, null, rest({ kind: 'switch' }), now)).toEqual({})
  })
})

describe('which workouts the watch has', () => {
  beforeEach(() => { localStorage.clear(); _resetWatchSync() })
  const S = () => ({ S: { active: { id: 'w1', entries: [] } } })
  it('a heart rate from the watch for it', () => {
    applyEvents([{ id: 'h1', type: 'setHr', wid: 'w1', exId: 'x', entryIdx: 0, setIdx: 0, hr: { avg: 120, max: 130 } }], S)
    expect(watchClaimed('w1')).toBe(true)
    expect(watchClaimed('w2')).toBe(false)
  })
  it('any event about it while the watch has Apple Health on, none while off', () => {
    writeWatchStatus({ health: 'off' })
    applyEvents([{ id: 'f1', type: 'finish', wid: 'w1' }], S)
    expect(watchClaimed('w1')).toBe(false)
    writeWatchStatus({ health: 'on' })
    applyEvents([{ id: 'f2', type: 'discard', wid: 'w1' }], () => ({ S: { active: null } }))
    expect(watchClaimed('w1')).toBe(true)
  })
})

/* ---------- the session with the workout ---------- */

function store(initial) {
  let st = initial
  const subs = new Set()
  return {
    getState: () => st,
    setState: patch => { const prev = st; st = { ...st, ...patch }; subs.forEach(fn => fn(st, prev)) },
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
  }
}

function fakePlugin({ recovered = {} } = {}) {
  const listeners = {}
  return {
    listeners,
    status: vi.fn(async () => ({ supported: true, running: false })),
    recover: vi.fn(async () => recovered),
    start: vi.fn(async ({ wid }) => ({ ok: true, wid, start: now })),
    samples: vi.fn(async () => ({ samples: readings(now, now + 120e3, () => 130) })),
    end: vi.fn(async () => {}),
    addListener: vi.fn((name, fn) => { listeners[name] = fn; return { remove: () => {} } }),
  }
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

describe('the session with the workout', () => {
  let p, S, UI, apply, watch, stop
  beforeEach(() => {
    localStorage.clear()
    health.on = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(now)
    p = fakePlugin()
    _setPhonePluginForTest(p)
    S = store({ ready: true, S: { active: null, workouts: [] } })
    UI = store({ timer: null })
    apply = vi.fn()
    watch = { status: async () => ({ paired: false, installed: false }), claimed: () => false, onClaim: () => () => {}, prefs: () => ({ enabled: true }), reported: () => null }
  })
  const begin = async () => { stop = await startPhoneWorkout({ useStore: S, useUI: UI, apply, watch }); await flush() }

  it('starts with a workout, measures a set after its tick, saves once at the finish', async () => {
    await begin()
    S.setState({ S: { active: { id: 'w1', start: now, entries: [{ id: 'bench', sets: [{ w: 60, r: 8 }] }] }, workouts: [] } })
    await flush()
    expect(p.start).toHaveBeenCalledWith({ wid: 'w1', type: 'strength_training' })
    // Live readout.
    p.listeners.heartRate({ bpm: 128, at: Date.now() })
    expect(liveHeartRate()).toEqual({ bpm: 128, at: now })
    // A set ticked 60 s in.
    vi.setSystemTime(now + 60e3)
    S.setState({ S: { active: { id: 'w1', start: now, entries: [{ id: 'bench', sets: [{ w: 60, r: 8, done: true, at: now + 60e3 }] }] }, workouts: [] } })
    await vi.advanceTimersByTimeAsync(3500)
    await flush()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][0][0]).toEqual({ where: { wid: 'w1', exId: 'bench', entryIdx: 0, setIdx: 0 }, fields: { hr: { avg: 130, max: 130 } } })
    // Finished: saved to Apple Health by the session, at the workout's end, with its name.
    const done = { id: 'w1', name: 'Push', start: now, end: now + 100e3, entries: [{ id: 'bench', sets: [{ w: 60, r: 8, done: true, at: now + 60e3, hr: { avg: 130, max: 130 } }] }] }
    S.setState({ S: { active: null, workouts: [done] } })
    await flush()
    expect(p.end).toHaveBeenCalledWith({ wid: 'w1', save: true, at: now + 100e3, title: 'Push' })
    expect(liveHeartRate()).toBeNull()
    stop()
  })

  it('discarded: dropped, nothing saved', async () => {
    await begin()
    S.setState({ S: { active: { id: 'w1', start: now, entries: [] }, workouts: [] } })
    await flush()
    S.setState({ S: { active: null, workouts: [] } })
    await flush()
    expect(p.end).toHaveBeenCalledWith({ wid: 'w1', save: false, discarded: true })
    expect(p.end.mock.calls.some(([a]) => a.save)).toBe(false)
    stop()
  })

  // TestFlight 1.4.4: a workout discarded on the phone still turned up in Apple Health.
  it('discarded before its session had even started: dropped once it has', async () => {
    let started
    p.start.mockImplementation(({ wid }) => new Promise(res => { started = () => res({ ok: true, wid, start: now }) }))
    await begin()
    S.setState({ S: { active: { id: 'w1', start: now, entries: [] }, workouts: [] } })
    await flush()
    S.setState({ S: { active: null, workouts: [] } })
    await flush()
    started()
    await flush()
    expect(p.end).toHaveBeenCalledWith({ wid: 'w1', save: false, discarded: true })
    expect(p.end.mock.calls.some(([a]) => a.save)).toBe(false)
    stop()
  })

  it('a session iOS handed back for a workout discarded meanwhile: dropped, never saved', async () => {
    p = fakePlugin({ recovered: { wid: 'w1', start: now - 60e3 } })
    _setPhonePluginForTest(p)
    S = store({ ready: true, S: { active: null, workouts: [] } })
    await begin()
    expect(p.end).toHaveBeenCalledWith({ wid: 'w1', save: false, discarded: true })
    expect(p.end.mock.calls.some(([a]) => a.save)).toBe(false)
    stop()
  })

  it('discarded with the next workout started straight away: the old one dropped, the new one measured', async () => {
    await begin()
    S.setState({ S: { active: { id: 'w1', start: now, entries: [] }, workouts: [] } })
    await flush()
    S.setState({ S: { active: { id: 'w2', start: now, entries: [] }, workouts: [] } })
    await flush()
    expect(p.end).toHaveBeenCalledWith({ wid: 'w1', save: false, discarded: true })
    expect(p.start.mock.calls.at(-1)[0].wid).toBe('w2')
    stop()
  })

  it('the watch taking it is no discard: the workout goes on, nothing taken out', async () => {
    let claimed = false, onClaim = null
    watch = { ...watch, claimed: () => claimed, onClaim: fn => { onClaim = fn; return () => {} } }
    await begin()
    S.setState({ S: { active: { id: 'w1', start: now, entries: [] }, workouts: [] } })
    await flush()
    claimed = true
    onClaim('w1')
    await flush()
    expect(p.end.mock.calls.map(([a]) => a)).toEqual([{ wid: 'w1', save: false }])
    stop()
  })

  it('the watch takes the workout: the phone\'s session is dropped unsaved', async () => {
    let claimed = false, onClaim = null
    watch = { ...watch, claimed: () => claimed, onClaim: fn => { onClaim = fn; return () => {} } }
    await begin()
    S.setState({ S: { active: { id: 'w1', start: now, entries: [] }, workouts: [] } })
    await flush()
    expect(p.start).toHaveBeenCalled()
    claimed = true
    onClaim('w1')
    await flush()
    expect(p.end).toHaveBeenCalledWith({ wid: 'w1', save: false })
    stop()
  })

  it('a watch with Apple Health on and its app open: no phone session at all', async () => {
    watch = { ...watch, status: async () => ({ paired: true, installed: true, reachable: true }), reported: () => ({ health: 'on' }) }
    await begin()
    S.setState({ S: { active: { id: 'w1', start: now, entries: [] }, workouts: [] } })
    await flush()
    expect(p.start).not.toHaveBeenCalled()
    stop()
  })

  it('a session iOS kept through a crash is taken up for its workout', async () => {
    p = fakePlugin({ recovered: { wid: 'w1', start: now - 20 * 60e3 } })
    _setPhonePluginForTest(p)
    S = store({ ready: true, S: { active: { id: 'w1', start: now - 20 * 60e3, entries: [] }, workouts: [] } })
    await begin()
    expect(p.recover).toHaveBeenCalled()
    expect(p.start).not.toHaveBeenCalled()
    expect(p.end).not.toHaveBeenCalled()
    stop()
  })

  it('below iOS 26: nothing at all', async () => {
    p.status.mockResolvedValue({ supported: false })
    await begin()
    S.setState({ S: { active: { id: 'w1', start: now, entries: [] }, workouts: [] } })
    await flush()
    expect(p.start).not.toHaveBeenCalled()
    expect(p.recover).not.toHaveBeenCalled()
    stop()
  })
})
