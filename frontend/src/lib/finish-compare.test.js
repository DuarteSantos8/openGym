import { describe, it, expect } from 'vitest'
import { finishCompare, trendOf } from './finish-compare.js'

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const routine = { id: 'r1', name: 'A', prog: 'linear', ex: [{ id: 'bench', sets: 3, reps: 5, weight: 60, mode: 'reps' }] }
const workout = (id, d, sets, more = {}) => ({ id, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'),
  entries: [{ id: 'bench', rid: 'r1', target: { ...routine.ex[0] }, sets }], ...more })

describe('last time and next time on the finish summary (#324)', () => {
  it('compares by the heaviest set, then by reps', () => {
    expect(trendOf([set(62.5, 5)], [set(60, 6)])).toBe(1)
    expect(trendOf([set(60, 5), set(60, 5)], [set(60, 5), set(60, 6)])).toBe(-1)
    expect(trendOf([set(60, 5)], [set(60, 5)])).toBe(0)
    expect(trendOf([set(60, 5)], null)).toBeNull()
  })
  it('finds the previous session of the exercise and leaves warm-ups out', () => {
    const prev = workout('w1', '2026-10-01', [set(20, 5, { phase: 'warmup' }), set(60, 5), set(60, 5), set(60, 4)])
    const now = workout('w2', '2026-10-03', [set(60, 5), set(60, 5), set(60, 5)])
    const st = { unit: 'kg', routines: [routine], workouts: [prev, now], exWeights: {} }
    const [row] = finishCompare(st, now)
    expect(row.last).toEqual([{ w: 60, r: 5 }, { w: 60, r: 5 }, { w: 60, r: 4 }])
    expect(row.trend).toBe(1)
    expect(row.next).toBeTruthy()
    expect(row.next.w).toBeGreaterThanOrEqual(60)
  })
  it('a first time has no last, and a workout out of progression has no next', () => {
    const now = workout('w1', '2026-10-03', [set(60, 5)], { noProg: true })
    const [row] = finishCompare({ unit: 'kg', routines: [routine], workouts: [now] }, now)
    expect(row.last).toBeNull()
    expect(row.trend).toBeNull()
    expect(row.next).toBeNull()
  })
  // TestFlight 11-04: "Next time: 0 kg · a bit lighter" under every lift with pyramid sets and
  // auto-progression off. The target's weight (0 on a pyramid) was read as the next weight.
  it('pyramid sets: the heaviest set Start will build, never 0 kg lighter', () => {
    const cfg = { id: 'bench', sets: 4, reps: 10, weight: 0, mode: 'reps', pyramid: [12, 10, 8, 6] }
    const pyr = { id: 'r1', name: 'A', ex: [cfg] }
    const now = workout('w2', '2026-10-03', [set(40, 12), set(45, 10), set(50, 8), set(55, 6)])
    now.entries[0].target = { ...cfg }
    const [row] = finishCompare({ unit: 'kg', routines: [pyr], workouts: [now], exWeights: {} }, now)
    expect(row.next).toMatchObject({ w: 55, r: 6, kind: 'hold' })
  })
  it('progression off: the same again, not lighter', () => {
    const off = { id: 'r1', name: 'A', prog: 'off', ex: [{ id: 'bench', sets: 3, reps: 5, weight: 0, mode: 'reps' }] }
    const now = workout('w2', '2026-10-03', [set(60, 5), set(60, 5)])
    now.entries[0].target = { ...off.ex[0] }
    const [row] = finishCompare({ unit: 'kg', routines: [off], workouts: [now], exWeights: {} }, now)
    expect(row.next?.kind).not.toBe('down')
    expect(row.next?.w).not.toBe(0)
    if (row.next) expect(row.next).toMatchObject({ w: 60, kind: 'hold' })
  })
})

// Night QA 146: "Next time: 0 kg × 13 · same again" under a band curl and a dip.
describe('next time for lifts with no weight', () => {
  const BANDS = [{ id: 'r', name: 'Red', color: '#eb5757' }, { id: 'g', name: 'Green', color: '#27ae60' }]
  it('a dip that gets one rep more: no 0 kg, and it is a step up', () => {
    const cfg = { id: '0251', sets: 2, reps: 6, weight: 0, mode: 'reps' }
    const r = { id: 'r1', name: 'A', ex: [cfg] }
    const now = { id: 'w1', d: '2026-10-03', start: 1, end: 2, entries: [{ id: '0251', rid: 'r1', target: { ...cfg }, sets: [set(0, 6), set(0, 6)] }] }
    const [row] = finishCompare({ unit: 'kg', routines: [r], workouts: [now], exWeights: {} }, now)
    expect(row.next.w).toBeNull()
    if (row.next.r > 6) expect(row.next.kind).toBe('up')
  })
  it('a band curl that climbs a band names the band and calls it a step up', () => {
    const cfg = { id: '0005', sets: 2, reps: 12, weight: 0, mode: 'reps', bands: ['r'] }
    const r = { id: 'r1', name: 'A', ex: [cfg] }
    const now = { id: 'w1', d: '2026-10-03', start: 1, end: 2, entries: [{ id: '0005', rid: 'r1', target: { ...cfg }, sets: [set(0, 12, { bands: ['r'] }), set(0, 12, { bands: ['r'] })] }] }
    const [row] = finishCompare({ unit: 'kg', bands: BANDS, routines: [r], workouts: [now], exWeights: {} }, now)
    expect(row.next).toMatchObject({ w: null, r: 12, bands: ['g'], kind: 'up' })
  })
})
