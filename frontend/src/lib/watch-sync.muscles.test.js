// The watch's Muscles page: the phone sends what each exercise of the running workout trains, with
// its own weights, and the muscles' names in the app's language; the watch adds up the sets.
import { describe, expect, it } from 'vitest'
import { buildSnapshot, buildReady, fitSnapshot } from './watch-sync.js'
import { EXIDX } from './exercises.js'
import { musclesOf, MUSCLES, MUSCLE_NAME } from './muscles.js'

const ID = '1173' // a barbell bench press
const state = () => ({ unit: 'kg', restSec: 90, active: { id: 'w1', name: 'Push', start: 1, cur: 0, entries: [{ id: ID, sets: [{ w: 60, r: 8 }] }] } })

describe('muscles on the watch', () => {
  it('sends the phone\'s weights per exercise and a name for each muscle', () => {
    const snap = buildSnapshot(state())
    const want = musclesOf(EXIDX[ID])
    const m = snap.active.entries[0].muscles
    expect(Object.keys(m).sort()).toEqual(Object.keys(want).sort())
    for (const k in m) expect(m[k]).toBeCloseTo(want[k], 2)
    for (const k in m) expect(snap.active.muscleNames[k]).toBe(MUSCLE_NAME[k])
  })

  it('an exercise it knows nothing about sends no muscles', () => {
    const s = state()
    s.active.entries = [{ id: 'my-own', target: { name: 'Mystery' }, sets: [] }]
    expect(buildSnapshot(s).active.entries[0].muscles).toBeUndefined()
  })

  it('the same exercise twice and a superset: every entry carries its own muscles, the names once', () => {
    const s = state()
    s.active.entries = [
      { id: ID, sets: [{ w: 60, r: 8, done: true }] },
      { id: '0001', sg: 'a', sets: [{ r: 10 }] },
      { id: ID, sg: 'a', sets: [{ w: 50, r: 10 }] },
    ]
    const snap = buildSnapshot(s)
    const [a, b, c] = snap.active.entries
    expect(c.group).toBe('a')
    expect(a.muscles).toEqual(c.muscles)
    expect(Object.keys(b.muscles || {}).length).toBeGreaterThan(0)
    const slugs = new Set([...Object.keys(a.muscles), ...Object.keys(b.muscles)])
    expect(Object.keys(snap.active.muscleNames).sort()).toEqual([...slugs].sort())
  })

  it('a burpee sends only the muscles the map draws, no "cardiovascular system" row', () => {
    const s = state()
    s.active.entries = [{ id: '1160', sets: [{ r: 10 }] }] // burpee: its main target is the cardiovascular system
    const snap = buildSnapshot(s)
    const m = snap.active.entries[0].muscles
    expect(Object.keys(m).length).toBeGreaterThan(0)
    for (const k of Object.keys(m)) expect(MUSCLES.includes(k) || k === 'deltoids').toBe(true)
    expect(m['cardiovascular system']).toBeUndefined()
    expect(snap.active.muscleNames['cardiovascular system']).toBeUndefined()
  })

  it('a snapshot too big drops the muscles before the records of the running workout', () => {
    const snap = buildSnapshot(state())
    snap.active.entries[0].best = { w: 100, r: 1 }
    const small = fitSnapshot(snap, JSON.stringify({ ...snap, active: { ...snap.active, muscleNames: undefined, entries: [{ ...snap.active.entries[0], muscles: undefined }] }, ready: null }).length + 5)
    expect(small.active.entries[0].muscles).toBeUndefined()
    expect(small.active.entries[0].best).toBeDefined()
  })

  it('a snapshot too big drops the muscles before the last-time lines', () => {
    const snap = buildSnapshot(state())
    snap.active.entries[0].last = '60 kg × 8'
    const small = fitSnapshot(snap, JSON.stringify({ ...snap, active: { ...snap.active, muscleNames: undefined, entries: [{ ...snap.active.entries[0], muscles: undefined }] } }).length + 5)
    expect(small.active.entries[0].muscles).toBeUndefined()
    expect(small.active.entries[0].last).toBe('60 kg × 8')
  })

  it('too big, the other routines\' muscles go before the running workout\'s', () => {
    const S = { unit: 'kg', restSec: 90, workouts: [], week: { 2: 'r0' }, dayPlan: {},
      routines: Array.from({ length: 4 }, (_, k) => ({ id: 'r' + k, name: 'R' + k, ex: [{ id: ID, sets: 3, reps: 8 }] })),
      active: state().active }
    const snap = buildSnapshot(S, { ready: buildReady(S, '2026-10-13') })
    expect(snap.ready.others.length).toBeGreaterThan(0)
    expect(snap.ready.others[0].entries[0].muscles).toBeDefined()
    const lean = JSON.parse(JSON.stringify(snap))
    for (const r of lean.ready.others) { for (const e of r.entries) delete e.muscles; delete r.muscleNames }
    const small = fitSnapshot(snap, JSON.stringify(lean).length + 5)
    for (const r of small.ready.others) expect(r.entries[0].muscles).toBeUndefined()
    expect(small.active.entries[0].muscles).toBeDefined()
    expect(small.active.muscleNames).toBeDefined()
    expect(small.ready.others.length).toBe(snap.ready.others.length)
  })

  it('a session the watch can start offline carries its muscles and their names', () => {
    const S = { unit: 'kg', workouts: [], routines: [{ id: 'r', name: 'Push', ex: [{ id: ID, sets: 3, reps: 8 }] }], week: { 2: 'r' }, dayPlan: {} }
    const today = buildReady(S, '2026-10-13').today // a Tuesday
    expect(Object.keys(today.entries[0].muscles).sort()).toEqual(Object.keys(musclesOf(EXIDX[ID])).sort())
    for (const k in today.entries[0].muscles) expect(today.muscleNames[k]).toBe(MUSCLE_NAME[k])
  })
})
