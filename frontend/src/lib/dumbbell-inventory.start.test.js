// Discord (dumbbell inventory): a curl planned at 28 kg total opened at 30 kg on a rack of 14s and
// 16s, because the confirmed working weight (or last time) skipped the rack check. A gym switch
// fixed it, so session start now uses the same rule: the heaviest owned load at or under it.
import { describe, expect, it } from 'vitest'
import { buildPlannedEntry, buildSessionEntry } from './session-start.js'
import { rowsOnOwned, withDbLoad } from './dumbbells.js'
import { repeatSessionEntries } from './session-repeat.js'
import { EXIDX } from './exercises.js'

const CURL = '0315' // incline biceps curl, the one from the report
const RACK = [8, 10, 12, 14, 16, 18, 20]
const state = (extra = {}) => ({
  unit: 'kg', workouts: [], routines: [], exWeights: {},
  dumbbells: { kg: { weights: RACK, _ts: 1 } }, dbLoad: withDbLoad({}, CURL, 'total', 1), ...extra,
})
const cfg = { id: CURL, sets: 3, reps: 10, weight: 28, mode: 'reps' }
const routine = { id: 'r1', name: 'Arms', ex: [cfg] }
const work = e => e.sets.filter(s => s.phase !== 'warmup' && !s.warmup)
const session = (d, w) => ({
  id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(), routineIds: ['r1'],
  entries: [{ id: CURL, target: { ...cfg, dbLoad: 'total' }, sets: [{ w, r: 10, done: true }, { w, r: 10, done: true }] }],
})

describe('a session opens on the bells the gym has', () => {
  it('the exercise is a two-bell dumbbell lift', () => {
    expect(EXIDX[CURL].eq).toBe('dumbbell')
  })

  it('the confirmed working weight of 30 total opens at 28 on a rack without 15s', () => {
    const e = buildPlannedEntry(state({ exWeights: { [CURL]: { w: 30, d: '2026-11-01' } } }), cfg, routine)
    expect(work(e).map(s => s.w)).toEqual([28, 28, 28])
  })

  it('last time at 30 total (another gym) opens at 28 here', () => {
    const e = buildPlannedEntry(state({ workouts: [session('2026-11-20', 30)] }), cfg, routine)
    expect(work(e).every(s => s.w === 28)).toBe(true)
  })

  it('the plan’s target weight sits on the rack too', () => {
    const e = buildPlannedEntry(state({ workouts: [session('2026-11-20', 30)] }), cfg, routine)
    if (e.target.weight != null) expect(RACK.map(w => w * 2)).toContain(e.target.weight)
  })

  it('with progression off the routine’s 28 stays 28', () => {
    const off = { ...cfg, prog: { policy: 'off' } }
    const e = buildPlannedEntry(state({ exWeights: { [CURL]: { w: 30, d: '2026-11-01' } } }), off, { ...routine, ex: [off] })
    expect(work(e).every(s => s.w === 28)).toBe(true)
  })

  it('a weight the rack holds stays as it is', () => {
    const e = buildPlannedEntry(state({ workouts: [session('2026-11-20', 32)] }), cfg, routine)
    expect(work(e).every(s => s.w === 32)).toBe(true)
  })

  it('under the lightest bell it opens at the lightest', () => {
    const e = buildPlannedEntry(state({ workouts: [session('2026-11-20', 10)] }), cfg, routine)
    expect(work(e).every(s => s.w === 16)).toBe(true)
  })

  it('without a rack listed nothing moves', () => {
    const e = buildPlannedEntry(state({ dumbbells: undefined, exWeights: { [CURL]: { w: 30, d: '2026-11-01' } } }), cfg, routine)
    expect(work(e).every(s => s.w === 30)).toBe(true)
  })

  it('freestyle snaps the same way', () => {
    const e = buildSessionEntry(state({ workouts: [session('2026-11-20', 30)] }), CURL, { mode: 'reps', sets: 2, reps: 10 }, null)
    expect(work(e).every(s => s.w === 28)).toBe(true)
  })

  it('repeating a day from another gym lands on this rack', () => {
    const w = session('2026-11-20', 30)
    const { entries } = repeatSessionEntries(state({ workouts: [w] }), w)
    expect(work(entries[0]).every(s => s.w === 28)).toBe(true)
  })
})

describe('rowsOnOwned', () => {
  it('moves open work rows and both sides of a per-side row, never done rows or warm-ups', () => {
    const rows = [
      { w: 15, r: 5, phase: 'warmup' },
      { w: 15, r: 10, done: true },
      { w: 15, r: 10 },
      { w: 15, r: 10, sides: { L: { w: 15, r: 5 }, R: { w: 17, r: 5 } } },
      { w: 0, r: 10 },
    ]
    const out = rowsOnOwned(rows, [10, 14, 16])
    expect(out[0].w).toBe(15)
    expect(out[1].w).toBe(15)
    expect(out[2].w).toBe(14)
    expect(out[3].sides.L.w).toBe(14)
    expect(out[3].sides.R.w).toBe(16)
    expect(out[4].w).toBe(0)
  })
  it('null keeps the rows', () => {
    const rows = [{ w: 15 }]
    expect(rowsOnOwned(rows, null)).toBe(rows)
  })
})
