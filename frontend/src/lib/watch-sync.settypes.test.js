// @vitest-environment happy-dom
// Every kind of set reaches the watch with what it needs, and comes back right: bodyweight,
// per-side (two sides, each ticked on its own), holds (seconds), supersets (group), warm-ups,
// the best set before today (the watch's PRs) and the workout's start (its summary).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withExUnit } from './ex-unit.js'
import { buildSnapshot, applyEvents, bindWatchActions, bindWatchAppActions, patchSetIn, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

const sideRow = (Ld = false) => ({ w: 20, r: 16, done: false, sides: { L: { w: 20, r: 8, done: Ld }, R: { w: 20, r: 8, done: false } } })

const S = () => ({
  unit: 'kg', restSec: 90, routines: [],
  workouts: [{ id: 'old', d: '2026-10-01', start: 1, entries: [
    { id: '0025', target: { sets: 1, reps: 8 }, sets: [{ w: 80, r: 5, done: true }, { w: 85, r: 3, done: true }] },
    { id: 'plank', target: { mode: 'time', sec: 30 }, sets: [{ sec: 50, done: true }] },
  ] }],
  active: {
    id: 'w-1', name: 'Mixed', cur: 0, d: '2026-10-14', start: 1_800_000_000_000,
    entries: [
      { id: '0025', target: { sets: 2, reps: 8, weight: 80 }, sets: [{ w: 40, r: 10, done: false, phase: 'warmup' }, { w: 80, r: 6, done: false }] },
      { id: 'plank', target: { mode: 'time', sec: 45 }, sets: [{ sec: 45, done: false }] },
      { id: 'pull', target: { sets: 1, reps: 8, bodyweight: true }, sets: [{ w: 0, r: 8, done: false }] },
      { id: 'split', target: { sets: 1, reps: 16, side: true }, sets: [sideRow(true)] },
      { id: 'curl', sg: 'g1', target: { sets: 1, reps: 10 }, sets: [{ w: 12, r: 10, done: false }] },
      { id: 'push', sg: 'g1', target: { sets: 1, reps: 12 }, sets: [{ w: 25, r: 12, done: false }] },
      { id: '1431', target: { sets: 1, reps: 8 }, sets: [{ w: 30, r: 8, done: false }] },
    ],
  },
})

describe('the snapshot carries every kind of set', () => {
  const snap = buildSnapshot(S())
  const [bench, plank, pull, split, curl, push, assisted] = snap.active.entries

  it('the workout\'s start, for the summary', () => { expect(snap.active.start).toBe(1_800_000_000_000) })
  it('warm-ups marked, and the best set before today', () => {
    expect(bench.sets[0].warmup).toBe(true)
    expect(bench.sets[1].warmup).toBe(false)
    expect(bench.best).toEqual({ w: 85, r: 3 })
  })
  it('holds with their seconds and their longest one', () => {
    expect(plank.mode).toBe('time')
    expect(plank.sets[0].sec).toBe(45)
    expect(plank.best).toEqual({ sec: 50, w: null })
  })
  it('bodyweight', () => { expect(pull.bodyweight).toBe(true); expect(bench.bodyweight).toBeUndefined() })
  it('per-side sets with both sides', () => {
    expect(split.perSide).toBe(true)
    expect(split.sets[0].sides).toEqual({ L: { w: 20, r: 8, done: true }, R: { w: 20, r: 8, done: false } })
    expect(bench.sets[1].sides).toBeUndefined()
  })
  it('supersets by their group, only where there is one', () => {
    expect(curl.group).toBe('g1')
    expect(push.group).toBe('g1')
    expect(bench.group).toBeUndefined()
  })
  it('assisted exercises, where lighter is better', () => {
    expect(assisted.assisted).toBe(true)
    expect(bench.assisted).toBeUndefined()
  })
  it('no best for an exercise never done before', () => { expect(curl.best).toBeUndefined() })
  it('the weight step each exercise moves in, as on the phone (its own, else the default)', () => {
    expect(bench.step).toBeGreaterThan(0)
    expect(plank.step).toBeUndefined()
    const S2 = S()
    S2.active.entries[0].target.inc = 1.25
    expect(buildSnapshot(S2).active.entries[0].step).toBe(1.25)
  })
})

describe('ticks of every kind', () => {
  it('a per-side tick for a workout the phone already saved goes into that side', () => {
    const s = { active: null, workouts: [{ id: 'w-old', entries: [{ id: 'split', sets: [sideRow()] }] }] }
    const stamp = vi.fn()
    expect(patchSetIn(s, { wid: 'w-old', exId: 'split', entryIdx: 0, setIdx: 0, side: 'L' }, { done: true, w: 22.5, r: 8, at: 5 }, stamp)).toBe(true)
    const row = s.workouts[0].entries[0].sets[0]
    expect(row.sides.L).toMatchObject({ w: 22.5, r: 8, done: true })
    expect(row).toMatchObject({ done: false, r: 16, w: 22.5, at: 5 })
    patchSetIn(s, { wid: 'w-old', exId: 'split', entryIdx: 0, setIdx: 0, side: 'R' }, { done: true, w: 20, r: 7, at: 6 }, stamp)
    expect(s.workouts[0].entries[0].sets[0]).toMatchObject({ done: true, r: 15 })
    expect(stamp).toHaveBeenCalledTimes(2)
  })

  it('side and seconds reach the app\'s handler for a saved workout, and nothing extra for a plain set', () => {
    const patchSet = vi.fn()
    bindWatchAppActions({ start: vi.fn(), patchSet })
    const getState = () => ({ S: { active: null, workouts: [{ id: 'w-old', entries: [] }] } })
    applyEvents([
      { id: 'a', type: 'setDone', wid: 'w-old', exId: 'split', entryIdx: 0, setIdx: 0, side: 'L', w: 20, r: 8, at: 1 },
      { id: 'b', type: 'setDone', wid: 'w-old', exId: 'plank', entryIdx: 1, setIdx: 0, sec: 40, at: 2 },
      { id: 'c', type: 'setDone', wid: 'w-old', exId: '0025', entryIdx: 2, setIdx: 0, w: 60, r: 8, side: 'X', at: 3 },
    ], getState)
    expect(patchSet.mock.calls[0][0]).toMatchObject({ side: 'L' })
    expect(patchSet.mock.calls[1][1]).toMatchObject({ sec: 40, done: true })
    expect(patchSet.mock.calls[2][0].side).toBeUndefined()
  })
})

describe('a snapshot too big for the application context', () => {
  const entry = (i, sets = 4) => ({ id: 'e' + i, name: 'Exercise ' + i, mode: 'reps', restSec: 90, last: 'x'.repeat(300), best: { w: 100, r: 5 },
    sets: Array.from({ length: sets }, () => ({ w: 60, r: 8, sec: null, done: false, warmup: false })) })
  const session = n => ({ routineIds: ['r'], name: 'Routine', entries: Array.from({ length: n }, (_, i) => entry(i)) })
  const big = () => ({ v: 1, unit: 'kg', restSec: 90, settings: { health: true },
    active: { id: 'w', name: 'Big', unit: 'kg', cur: 0, restSec: 90, entries: Array.from({ length: 12 }, (_, i) => entry(i)) },
    ready: { today: session(12), others: Array.from({ length: 8 }, () => session(12)) } })
  const size = v => new TextEncoder().encode(JSON.stringify(v)).length

  it('is left alone when it fits', async () => {
    const { fitSnapshot } = await import('./watch-sync.js')
    const small = { v: 1, active: null, ready: null }
    expect(fitSnapshot(small)).toBe(small)
  })

  it('loses what matters least first, never the running sets, and fits', async () => {
    const { fitSnapshot, SNAPSHOT_MAX_BYTES } = await import('./watch-sync.js')
    const snap = big()
    expect(size(snap)).toBeGreaterThan(SNAPSHOT_MAX_BYTES)
    const fit = fitSnapshot(snap)
    expect(size(fit)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES)
    expect(fit.active.entries).toHaveLength(12)
    expect(fit.active.entries.every(e => e.sets.length === 4)).toBe(true)
    expect(fit.settings).toEqual({ health: true })
    expect(snap.ready.others).toHaveLength(8)   // the original is not touched
  })

  it('keeps today\'s routine when cutting the others is enough', async () => {
    const { fitSnapshot } = await import('./watch-sync.js')
    const snap = big()
    const fit = fitSnapshot(snap, size({ ...snap, ready: { today: snap.ready.today, others: [] } }) + 10)
    expect(fit.ready.today.entries).toHaveLength(12)
    expect(fit.active.entries[0].last).toBeTruthy()
  })
})

describe('the weigh-in from the watch', () => {
  it('goes to the app as a weigh-in, and rides on the start as the session\'s body weight', () => {
    const weighIn = vi.fn(), start = vi.fn()
    bindWatchAppActions({ start, patchSet: vi.fn(), weighIn })
    applyEvents([
      { id: 'b1', type: 'weighIn', w: 81.4, at: 1000 },
      { id: 's1', type: 'start', wid: 'watch-1', routineIds: ['r1'], at: 1000, bw: 81.4 },
      { id: 'b2', type: 'weighIn', w: -3, at: 1000 },
    ], () => ({ S: { active: null } }))
    expect(weighIn).toHaveBeenCalledTimes(1)
    expect(weighIn).toHaveBeenCalledWith({ w: 81.4, at: 1000 })
    expect(start).toHaveBeenCalledWith(['r1'], { id: 'watch-1', start: 1000, bw: 81.4 })
    // once each
    applyEvents([{ id: 'b1', type: 'weighIn', w: 81.4, at: 1000 }], () => ({ S: { active: null } }))
    expect(weighIn).toHaveBeenCalledTimes(1)
  })

  it('is logged on its day, beside that day\'s (#859)', async () => {
    const { logWeighIn } = await import('./bodyweight.js')
    const at = new Date('2026-10-14T08:00:00').getTime()
    const s = { bodyweight: [{ d: '2026-10-13', w: 82, t: 1 }, { d: '2026-10-14', w: 81, t: 2 }] }
    expect(logWeighIn(s, 80.96, at)).toBe(true)
    expect(s.bodyweight[0]).toEqual({ d: '2026-10-13', w: 82, t: 1 })
    expect(s.bodyweight[1].ins.map(r => [r.at, r.w])).toEqual([[null, 81], ['08:00', 81]])
    expect(s.bodyweight[1]).toMatchObject({ d: '2026-10-14', w: 81, t: at })
    expect(logWeighIn(s, 0, at)).toBe(false)
  })

  it('the watch is told the app\'s language, whether to ask, and the last weight', async () => {
    const { watchExtras } = await import('./watch-sync.js')
    expect(watchExtras({ weighIn: false, bodyweight: [{ d: '2026-10-01', w: 80 }, { d: '2026-10-10', w: 79.5 }] }))
      .toEqual({ lang: 'en', weighIn: false, lastBw: 79.5, accent: '#30d158', onAccent: '#000000' })
    expect(watchExtras({})).toEqual({ lang: 'en', weighIn: true, accent: '#30d158', onAccent: '#000000' })
  })
})

describe('workouts deleted in openGym, for the watch\'s own copies in Apple Health', () => {
  it('names the deleted workouts newest first, leaves add-backs out, and caps the list', async () => {
    const { healthGoneFor } = await import('./watch-sync.js')
    const S = { deleted: { workouts: { a: 100, b: 300, c: -5, d: 200 }, bodyweight: { '2026-10-01': 50 } } }
    expect(healthGoneFor(S)).toEqual(['opengym-w-b', 'opengym-w-d', 'opengym-w-a'])
    expect(healthGoneFor(S, 2)).toEqual(['opengym-w-b', 'opengym-w-d'])
    expect(healthGoneFor({})).toEqual([])
  })

  it('the watch saying it removed them makes the phone sync Health again, once', () => {
    const healthDeleted = vi.fn()
    bindWatchAppActions({ start: vi.fn(), patchSet: vi.fn(), healthDeleted })
    const ev = { id: 'hd1', type: 'healthDeleted', ids: ['opengym-w-b', 7] }
    applyEvents([ev, ev], () => ({ S: { active: null } }))
    expect(healthDeleted).toHaveBeenCalledTimes(1)
    expect(healthDeleted).toHaveBeenCalledWith(['opengym-w-b'])
  })
})

describe('set marks on the watch', () => {
  const setsOf = (sets, extra = {}) => buildSnapshot({
    unit: 'kg', restSec: 90, routines: [], ...extra,
    active: { id: 'w-1', name: 'x', cur: 0, d: '2026-10-14', start: 1, entries: [{ id: '0025', target: { sets: 1, reps: 6 }, sets }] },
  }).active.entries[0].sets

  it('a set taken to failure says so; a warm-up never does', () => {
    const [a, b] = setsOf([{ w: 80, r: 6, failure: true }, { w: 40, r: 6, failure: true, phase: 'warmup' }])
    expect(a.failure).toBe(true)
    expect('failure' in b).toBe(false)
  })

  it('a drop set sends its first drop weight and how many drops', () => {
    const [d, p] = setsOf([{ w: 80, r: 6, type: 'dropset', drops: [{ w: 60, r: 6 }, { w: 50, r: 6 }] }, { w: 80, r: 6 }])
    expect([d.drop, d.drops]).toEqual([60, 2])
    expect('drop' in p || 'drops' in p).toBe(false)
  })

  it('a per-side drop set sends the drops of its sides (review 2026-11-12)', () => {
    const side = { w: 20, r: 8, done: false, type: 'dropset', drops: [{ w: 15, r: 6 }, { w: 10, r: 6 }] }
    const [d] = setsOf([{ w: 20, r: 16, done: false, type: 'dropset', sides: { L: side, R: { ...side } } }])
    expect([d.drop, d.drops]).toEqual([15, 2])
  })

  it('the halves of a timed per-side pair say which side they are', () => {
    const [l, r, p] = setsOf([{ sec: 30, side: 'L' }, { sec: 30, side: 'R' }, { sec: 30 }])
    expect([l.side, r.side, 'side' in p]).toEqual(['L', 'R', false])
  })

  it('rest-pause and cluster sets are flagged so the watch offers no drop', () => {
    const [r, c, p] = setsOf([{ w: 80, r: 6, type: 'restpause', clusters: [{ r: 3 }] }, { w: 80, r: 9, type: 'restpause', cluster: true, clusters: [{ r: 3 }] }, { w: 80, r: 6 }])
    expect(r.rp).toBe(true)
    expect(c.rp).toBe(true)
    expect('rp' in p).toBe(false)
  })

  it('an exercise in its own unit sends the drop weight in that unit', () => {
    const [d] = setsOf([{ w: 63.5029, r: 5, type: 'dropset', drops: [{ w: 45.3592, r: 5 }] }], { exUnit: withExUnit({}, '0025', 'lb', 1) })
    expect(d.w).toBe(140)
    expect(d.drop).toBe(100)
  })
})

describe('set menu events from the watch', () => {
  const st = (over = {}) => ({ S: { unit: 'kg', workouts: [], active: { id: 'w-1', entries: [{ id: '0025', sets: [{ w: 40, r: 10, done: false }, { w: 80, r: 6, done: false }] }] }, ...over } })
  const mark = (id, o = {}) => ({ id, type: 'setMark', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 1, w: 80, r: 6, done: false, failure: true, at: 1, ...o })

  it('a mark goes to the workout screen once', () => {
    const setMark = vi.fn()
    bindWatchActions({ setMark })
    expect(applyEvents([mark('a'), mark('a')], () => st())).toEqual(['a', 'a'])
    expect(setMark).toHaveBeenCalledTimes(1)
    expect(setMark).toHaveBeenCalledWith(0, 1, { failure: true })
  })

  it('add set and remove set go to the workout screen', () => {
    const addSet = vi.fn(), removeSet = vi.fn()
    bindWatchActions({ addSet, removeSet })
    expect(applyEvents([{ id: 'p', type: 'addSet', wid: 'w-1', exId: '0025', entryIdx: 0 }, mark('q', { type: 'removeSet', failure: undefined })], () => st())).toEqual(['p', 'q'])
    expect(addSet).toHaveBeenCalledWith(0)
    expect(removeSet).toHaveBeenCalledWith(0, 1)
  })

  it('a mark on a set the phone changed meanwhile does nothing and is acked', () => {
    const setMark = vi.fn()
    bindWatchActions({ setMark })
    expect(applyEvents([mark('a', { w: 75 })], () => st())).toEqual(['a'])
    expect(setMark).not.toHaveBeenCalled()
  })

  it("the guard compares in the exercise's own unit", () => {
    const setMark = vi.fn()
    bindWatchActions({ setMark })
    const S = st({ exUnit: withExUnit({}, '0025', 'lb', 1) })
    S.S.active.entries[0].sets[1].w = 63.5029
    expect(applyEvents([mark('a', { w: 140 }), mark('b', { w: 63.5 })], () => S)).toEqual(['a', 'b'])
    expect(setMark).toHaveBeenCalledTimes(1)
  })

  it('without the workout screen they wait and open it', () => {
    const openWorkout = vi.fn()
    bindWatchAppActions({ openWorkout })
    expect(applyEvents([mark('a')], () => st())).toEqual([])
    expect(openWorkout).toHaveBeenCalled()
  })

  it('for a watch-started workout whose start is not here yet they wait', () => {
    const setMark = vi.fn()
    bindWatchActions({ setMark })
    expect(applyEvents([mark('a', { wid: 'watch-9', at: Date.now() })], () => st())).toEqual([])
    expect(setMark).not.toHaveBeenCalled()
  })

  it('on a workout already saved they are acked and dropped', () => {
    const setMark = vi.fn()
    bindWatchActions({ setMark })
    const S = st({ active: null, workouts: [{ id: 'w-1', entries: [] }] })
    expect(applyEvents([mark('a')], () => S)).toEqual(['a'])
    expect(setMark).not.toHaveBeenCalled()
  })

  it('an older phone: an unknown type is acked, never blocks the queue', () => {
    bindWatchActions({})
    expect(applyEvents([{ id: 'u', type: 'somethingNew', wid: 'w-1' }, mark('a')], () => st())).toEqual(['u', 'a'])
  })
})
