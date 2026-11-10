import { describe, it, expect } from 'vitest'
import { autoRungs, rungRows, warmupSource, warmupBlock, isCompoundEx, ownRowsFromSession, cleanOwnRow, ownRowsOf, withWarmupBlock, warmupAutoOf } from './warmup-ramp.js'
import { snapDown, rungWeight } from './warmup-snap.js'
import { liveReramp, rerampWarmups } from './history.js'
import { buildPlannedEntry, buildSessionEntries, buildSessionEntry } from './session-start.js'
import { isWarmupRow } from './workout-model.js'
import { dropGrid } from './plates.js'

const SQUAT = '0043', BENCH = '0025', CURL = '0294', RAISE = '0334', PULLUP = '0652', WPULL = '0841', LEGEXT = '0585', ASSISTED = '0017', LUNGE = '0336'
const warm = rows => rows.filter(isWarmupRow)
const pairs = rows => warm(rows).map(r => [r.w, r.r])
const state = extra => ({ unit: 'kg', exWeights: {}, routines: [], workouts: [], week: {}, dayPlan: {}, ...extra })
const routine = (...ex) => ({ id: 'R', name: 'R', ex })
const cfg = (id, extra) => ({ id, sets: 3, reps: 5, weight: 100, prog: 'off', mode: 'reps', ...extra })
const planned = (S, c) => buildPlannedEntry(S, c, S.routines.find(r => r.ex.includes(c)) || routine(c))

describe('compound or isolation', () => {
  it('reads the name: squats, presses and rows are compounds, curls, raises and extensions are not', () => {
    expect(isCompoundEx(SQUAT)).toBe(true)
    expect(isCompoundEx(BENCH)).toBe(true)
    expect(isCompoundEx(PULLUP)).toBe(true)
    expect(isCompoundEx(CURL)).toBe(false)
    expect(isCompoundEx(RAISE)).toBe(false)
    expect(isCompoundEx(LEGEXT)).toBe(false)
  })
})

describe('the ramp by load', () => {
  it('heavy compound: bar x 10, 40% x 5, 60% x 3, 80% x 1', () => {
    expect(autoRungs({ work: 140, kg: 140, bar: 20, compound: true })).toEqual([{ wb: true, r: 10 }, { wp: 40, r: 5 }, { wp: 60, r: 3 }, { wp: 80, r: 1 }])
  })
  it('a medium compound gets two rungs, a light one one', () => {
    expect(autoRungs({ work: 50, kg: 50, bar: 20, compound: true })).toEqual([{ wb: true, r: 10 }, { wp: 70, r: 3 }])
    expect(autoRungs({ work: 24, kg: 24, bar: 0, compound: true })).toEqual([{ wp: 50, r: 8 }])
  })
  it('isolation gets fewer, and a light one none', () => {
    expect(autoRungs({ work: 60, kg: 60 })).toEqual([{ wp: 50, r: 10 }, { wp: 75, r: 4 }])
    expect(autoRungs({ work: 14, kg: 14 })).toEqual([{ wp: 50, r: 10 }])
    expect(autoRungs({ work: 8, kg: 8 })).toEqual([])
  })
  it('bodyweight only once it is loaded, assistance never', () => {
    expect(autoRungs({ work: 0, kg: 0, bw: true, compound: true })).toEqual([])
    expect(autoRungs({ work: 20, kg: 20, bw: true, compound: true })).toEqual([{ wp: 0, r: 5 }, { wp: 60, r: 3 }])
    expect(autoRungs({ work: 40, kg: 40, assisted: true })).toEqual([])
  })
  it('thresholds are a lifter’s, so 135 lb is a heavy squat', () => {
    const S = state({ unit: 'lb', warmupAuto: 'compounds' })
    const rows = planned(S, cfg(SQUAT, { weight: 135 }))
    expect(pairs(rows.sets)).toEqual([[45, 10], [50, 5], [80, 3], [100, 1]])
  })
})

describe('rounding to what the gym can load', () => {
  it('snaps down on the step, the owned list and the plates', () => {
    expect(snapDown(57, 2.5)).toBe(55)
    expect(snapDown(57, [10, 20, 30, 40, 50, 60])).toBe(50)
    expect(snapDown(57, x => Math.floor(x / 10) * 10)).toBe(50)
  })
  it('never under the bar, never at or above the work weight', () => {
    expect(rungWeight({ wp: 40 }, 40, 2.5, 20)).toBe(20)
    expect(rungRows([{ wp: 40, r: 5 }, { wp: 95, r: 1 }, { wp: 99, r: 1 }], { work: 40, grid: 2.5, floor: 20 }).map(r => r.w)).toEqual([20, 37.5])
  })
  it('drops a rung that lands on the one before it', () => {
    // 50 kg bench: bar, then 70% = 35. A 30 kg bench: bar (20) and 70% = 21 → 20, one rung.
    expect(rungRows([{ wb: true, r: 10 }, { wp: 70, r: 3 }], { work: 30, grid: 2.5, floor: 20 }).map(r => [r.w, r.r])).toEqual([[20, 10]])
  })
  it('a home gym with one pair of 20s and a pair of 5s: every rung is a load those plates make', () => {
    const S = state({ warmupAuto: 'all', plates: { kg: { 20: 1, 5: 1 } } })
    const c = cfg(SQUAT, { weight: 70 })
    const grid = dropGrid(S, c)
    const rows = planned(S, c).sets
    // bar 20; 40% = 28 → 20+5+5 = 30? no: 28 rounds DOWN to bar 20 → dropped; 60% = 42 → 30; 80% = 56 → 30 (dup) … loads only 20, 30, 60, 70
    for (const r of warm(rows)) expect([20, 30, 60, 70]).toContain(grid(r.w) === r.w ? r.w : NaN)
    expect(pairs(rows)[0]).toEqual([20, 10])
  })
  it('dumbbells land on the bells you own', () => {
    const S = state({ warmupAuto: 'all', dumbbells: { kg: { weights: [4, 8, 12, 16, 20, 24], _ts: 1 } } })
    const rows = planned(S, cfg(CURL, { weight: 24, reps: 10 })).sets
    expect(pairs(rows)).toEqual([[12, 10]])
  })
})

describe('where the warm-ups come from', () => {
  it('off by default: nothing changes for anyone', () => {
    expect(warmupAutoOf({})).toBe('off')
    const rows = planned(state(), cfg(SQUAT)).sets
    expect(warm(rows)).toEqual([])
  })
  it('auto for compounds leaves the curl alone; auto for all does not', () => {
    const S = state({ warmupAuto: 'compounds' })
    expect(warm(planned(S, cfg(SQUAT)).sets).length).toBe(4)
    expect(warm(planned(S, cfg(LEGEXT, { weight: 60 })).sets)).toEqual([])
    expect(pairs(planned({ ...S, warmupAuto: 'all' }, cfg(LEGEXT, { weight: 60 })).sets)).toEqual([[30, 10], [45, 4]])
  })
  it('a slot’s own number of ramp sets keeps the old halving ramp', () => {
    const S = state({ warmupAuto: 'all' })
    expect(warmupSource(S, cfg(SQUAT, { warmupSets: 2 })).kind).toBe('count')
    expect(pairs(planned(S, cfg(SQUAT, { warmupSets: 2 })).sets).map(p => p[0])).toEqual([50, 75])
  })
  it('per exercise: none wins over the setting, auto works with the setting off', () => {
    expect(warm(planned(state({ warmupAuto: 'all' }), cfg(SQUAT, { warmup: 'none' })).sets)).toEqual([])
    expect(warm(planned(state(), cfg(SQUAT, { warmup: 'auto' })).sets).length).toBe(4)
  })
  it('my own: the saved rows, scaled to today’s work weight', () => {
    const c = cfg(BENCH, { weight: 60, warmup: 'own', warmupRows: [{ wb: true, r: 12 }, { wp: 50, r: 8 }, { wp: 67, r: 5 }] })
    expect(pairs(planned(state(), c).sets)).toEqual([[20, 12], [30, 8], [40, 5]])
    expect(pairs(planned(state(), { ...c, weight: 80 }).sets)).toEqual([[20, 12], [40, 8], [52.5, 5]])
  })
  it('my own with no rows saved is no warm-ups, not the generator', () => {
    expect(warmupSource(state({ warmupAuto: 'all' }), cfg(SQUAT, { warmup: 'own' })).kind).toBe('none')
  })
  it('cardio, timed holds and rest-pause never get a generated block', () => {
    const S = state({ warmupAuto: 'all' })
    expect(warmupSource(S, cfg(SQUAT, { intensifier: { type: 'restpause' } })).kind).toBe('none')
    expect(warmupSource(S, { id: PULLUP, mode: 'time', sec: 30 }).kind).toBe('none')
  })
  it('bodyweight: none unloaded, the body alone first once loaded', () => {
    const S = state({ warmupAuto: 'all' })
    expect(warm(planned(S, cfg(PULLUP, { weight: 0, reps: 8 })).sets)).toEqual([])
    expect(pairs(planned(S, cfg(WPULL, { weight: 20, reps: 5 })).sets)).toEqual([[0, 5], [10, 3]])
    expect(warm(planned(S, cfg(ASSISTED, { weight: 40, reps: 8 })).sets)).toEqual([])
  })
  it('per side: each side gets the rung’s reps', () => {
    const S = state({ warmupAuto: 'all' })
    const rows = warm(planned(S, cfg(LUNGE, { weight: 40, reps: 20, side: true })).sets)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].sides.L.r).toBe(rows[0].sides.R.r)
    expect(rows[0].sides.L.r).toBe(8)
  })
  it('a whole session builds with it, and a freestyle add too', () => {
    const r = routine(cfg(SQUAT), cfg(CURL, { weight: 8 }))
    const S = state({ warmupAuto: 'compounds', routines: [r] })
    const [squat, curl] = buildSessionEntries(S, r)
    expect(warm(squat.sets).length).toBe(4)
    expect(warm(curl.sets)).toEqual([])
    const free = buildSessionEntry(S, BENCH, { sets: 3, reps: 5, weight: 100 }, null, null)
    expect(warm(free.sets).length).toBe(4)
  })
  it('a saved block wins over "Your last session" carrying edited warm-ups', () => {
    const c = cfg(BENCH, { weight: 60, prog: 'linear', warmup: 'own', warmupRows: [{ wp: 50, r: 8 }] })
    const r = routine(c)
    const S = state({ startFrom: 'last', routines: [r], workouts: [{ id: 'w', d: '2026-09-01', routineIds: ['R'], entries: [{ id: BENCH, rid: 'R', target: { sets: 3, reps: 5, weight: 60 }, sets: [{ w: 25, r: 15, done: true, phase: 'warmup', warmup: true, edited: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }] }] })
    const rows = warm(buildSessionEntries(S, r)[0].sets)
    expect(rows.map(x => x.r)).toEqual([8])
  })
})

describe('live re-ramp', () => {
  const block = () => withWarmupBlock(state({ warmupAuto: 'all' }), cfg(SQUAT), [{ w: 100, r: 5, done: false }, { w: 100, r: 5, done: false }], { grid: 2.5, floor: 20 })
  it('moves the open rungs when the first work set goes from 100 to 110', () => {
    const rows = block()
    rows[4] = { ...rows[4], w: 110 }
    expect(pairs(liveReramp(rows, 2.5, 20))).toEqual([[20, 10], [42.5, 5], [65, 3], [87.5, 1]])
  })
  it('keeps the rungs already done and the ones you typed', () => {
    const rows = block()
    rows[0] = { ...rows[0], done: true }
    rows[1] = { ...rows[1], w: 45, edited: true }
    rows[4] = { ...rows[4], w: 120 }
    expect(pairs(liveReramp(rows, 2.5, 20))).toEqual([[20, 10], [45, 5], [70, 3], [95, 1]])
  })
  it('the old halving ramp re-aims too, and a deload keeps every rung under the work weight', () => {
    const rows = [{ w: 50, r: 5, done: false, warmup: true, phase: 'warmup' }, { w: 75, r: 5, done: false, warmup: true, phase: 'warmup' }, { w: 60, r: 5 }]
    expect(pairs(rerampWarmups(rows, 2.5, 20))).toEqual([[30, 5], [45, 5]])
  })
})

describe('saving today’s warm-ups as your own', () => {
  it('turns them into percents of the work weight, the bare bar kept as the bar', () => {
    const rows = [
      { w: 20, r: 12, done: true, warmup: true, phase: 'warmup' },
      { w: 30, r: 8, done: true, warmup: true, phase: 'warmup' },
      { w: 40, r: 5, done: true, warmup: true, phase: 'warmup' },
      { w: 60, r: 5, done: true },
    ]
    expect(ownRowsFromSession(rows, 20)).toEqual([{ wb: true, r: 12 }, { wp: 50, r: 8 }, { wp: 67, r: 5 }])
  })
  it('nothing to keep without warm-ups or a work weight', () => {
    expect(ownRowsFromSession([{ w: 60, r: 5 }], 20)).toBeNull()
    expect(ownRowsFromSession([{ w: 0, r: 5, warmup: true, phase: 'warmup' }, { w: 0, r: 8 }])).toBeNull()
  })
  it('cleans what a synced profile may hold', () => {
    expect(cleanOwnRow({ wp: 140, r: 3 })).toEqual({ wp: 95, r: 3 })
    expect(cleanOwnRow({ wp: 'x', r: 3 })).toBeNull()
    expect(cleanOwnRow({ wb: true, r: 99 })).toEqual({ wb: true, r: 30 })
    expect(ownRowsOf({ warmupRows: Array.from({ length: 9 }, () => ({ wp: 50, r: 5 })) })).toHaveLength(5)
  })
  it('a block of your own with nothing to warm up toward is empty', () => {
    expect(warmupBlock(state(), cfg(BENCH, { weight: 0, warmup: 'own', warmupRows: [{ wp: 50, r: 5 }] }), [{ w: 0, r: 5 }], { grid: 2.5 })).toEqual([])
  })
})
