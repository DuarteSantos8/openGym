import { migratedFixture, startMigratedFixture } from './test-fixtures.js'
import { coachExOf } from '../../../api/coach/core/plan-view.js'
import { planOptions } from './prescription/index.js'
import { describe, expect, it } from 'vitest'
import {
  PYRAMID_MAX, MAX_PYRAMID_SETS, isPyramid, normalizePyramid, pyramidFromFlat,
  flatFromPyramid, pyramidLabel, pyramidTargetAt, PYRAMID_PRESETS, normalizePyramidRest, pyramidRestFor,
  normalizePyramidWeight, pyramidWeightAt, maxRecordAt, maxRepsSeries,
} from './pyramid.js'
import { setsRepsOf } from './history.js'
import { buildPlanBundle as canonicalBuildPlanBundle, parsePlan as canonicalParsePlan } from './plan-share.js'
import { convertWeight } from './units.js'

// Pyramid sets (CONTEXT.md): one rep target per set, in order, a set's target being a number or
// "max". No load is prescribed and the exercise is never progressed automatically.
const LIFT = '0025'
const PYR = [12, 8, 6, PYRAMID_MAX, 12]
const pyramidCfg = (extra = {}) => ({ id: LIFT, mode: 'reps', sets: 5, reps: 12, weight: 0, pyramid: PYR, ...extra })

describe('isPyramid', () => {
  it('is true for a reps exercise with a non-empty list', () => {
    expect(isPyramid(pyramidCfg())).toBe(true)
  })
  it('is false without the list, with an empty one, or off reps mode', () => {
    expect(isPyramid({ id: LIFT, mode: 'reps', sets: 3, reps: 10 })).toBe(false)
    expect(isPyramid(pyramidCfg({ pyramid: [] }))).toBe(false)
    expect(isPyramid(pyramidCfg({ mode: 'time', sec: 45 }))).toBe(false)
    expect(isPyramid(null)).toBe(false)
  })
})

describe('normalizePyramid', () => {
  it('keeps whole positive targets and max, in order', () => {
    expect(normalizePyramid([12, 8, 6, 'max', 12])).toEqual([12, 8, 6, 'max', 12])
  })
  it('rounds typed numbers and holds them to at least one rep', () => {
    expect(normalizePyramid([7.6, 0, -3, '5'])).toEqual([8, 1, 1, 5])
  })
  it('drops what is neither a number nor max', () => {
    expect(normalizePyramid([10, 'abc', null, undefined, 'max'])).toEqual([10, 'max'])
  })
  it('rounds a per-side target up to even, leaving max alone', () => {
    expect(normalizePyramid([11, 8, 'max', 1], 2)).toEqual([12, 8, 'max', 2])
  })
  it(`caps the list at ${MAX_PYRAMID_SETS} sets`, () => {
    expect(MAX_PYRAMID_SETS).toBe(10)
    expect(normalizePyramid(Array(14).fill(8))).toHaveLength(10)
  })
  it('returns an empty list for anything that is not a list', () => {
    expect(normalizePyramid(undefined)).toEqual([])
    expect(normalizePyramid('12-8-6')).toEqual([])
  })
})

describe('switching the toggle (Q14)', () => {
  it('turning it on starts from the flat sets × reps', () => {
    expect(pyramidFromFlat({ sets: 3, reps: 10 })).toEqual([10, 10, 10])
  })
  it('turning it on holds the count to 1..10 and an empty reps to 10', () => {
    expect(pyramidFromFlat({ sets: 0, reps: 8 })).toEqual([8])
    expect(pyramidFromFlat({ sets: 20, reps: 5 })).toHaveLength(10)
    expect(pyramidFromFlat({ sets: 2 })).toEqual([10, 10])
  })
  it('turning it off gives the set count and the first numeric target', () => {
    expect(flatFromPyramid([12, 8, 6, 'max', 12])).toEqual({ sets: 5, reps: 12 })
    expect(flatFromPyramid(['max', 6, 4])).toEqual({ sets: 3, reps: 6 })
  })
  it('turning it off with only max targets falls back to 10 reps', () => {
    expect(flatFromPyramid(['max', 'max'])).toEqual({ sets: 2, reps: 10 })
  })
})

describe('pyramidLabel (Q12)', () => {
  it('reads as the targets joined by a dot', () => {
    expect(pyramidLabel(PYR)).toBe('12 · 8 · 6 · Max · 12')
  })
})

describe('pyramidTargetAt (Q16)', () => {
  it('is the set’s own target inside the list', () => {
    expect(pyramidTargetAt(PYR, 0)).toBe(12)
    expect(pyramidTargetAt(PYR, 3)).toBe('max')
  })
  it('copies the last target for an extra set past the list', () => {
    expect(pyramidTargetAt(PYR, 5)).toBe(12)
    expect(pyramidTargetAt([10, 'max'], 7)).toBe('max')
  })
})

describe('plan and history read the pyramid (Q12)', () => {
  it('setsRepsOf prints the pyramid instead of "5 × 12"', () => {
    expect(setsRepsOf(pyramidCfg())).toBe('12 · 8 · 6 · Max · 12')
  })
  it('a flat config still reads the way it did', () => {
    expect(setsRepsOf({ id: LIFT, mode: 'reps', sets: 3, reps: 10 })).toBe('3 × 10')
  })
})

describe('presets', () => {
  it('are four valid pyramids, the back-off one with a max set', () => {
    expect(PYRAMID_PRESETS).toHaveLength(4)
    for (const p of PYRAMID_PRESETS) expect(normalizePyramid(p)).toEqual(p)
    expect(PYRAMID_PRESETS.map(pyramidLabel)).toContain('12 · 8 · 6 · Max · 12')
  })
})

describe('rest per set (pyramidRest)', () => {
  it('normalizePyramidRest sizes the list and drops an all-zero one', () => {
    expect(normalizePyramidRest([90, 120], 4)).toEqual([90, 120, 0, 0])
    expect(normalizePyramidRest([90, 120, 60, 30, 15], 3)).toEqual([90, 120, 60])
    expect(normalizePyramidRest([0, 0], 2)).toEqual([])
    expect(normalizePyramidRest(undefined, 3)).toEqual([])
    expect(normalizePyramidRest([-5, 'x', 44.6], 3)).toEqual([0, 0, 45])
  })
  const target = pyramidCfg({ pyramidRest: [60, 90, 180, 120, 0] })
  const rows = [{ w: 30, r: 5, phase: 'warmup' }, { r: 12 }, { r: 8 }, { r: 6 }, { r: 0, max: true }, { r: 12 }, { r: 12 }]
  it('pyramidRestFor counts work sets only, past warm-ups', () => {
    expect(pyramidRestFor(target, rows, 1)).toBe(60)
    expect(pyramidRestFor(target, rows, 3)).toBe(180)
    expect(pyramidRestFor(target, rows, 5)).toBe(0)
  })
  it('a warm-up row and an extra set past the list', () => {
    expect(pyramidRestFor(target, rows, 0)).toBe(0)
    expect(pyramidRestFor(target, rows, 6)).toBe(0)
    expect(pyramidRestFor(pyramidCfg({ pyramidRest: [60, 90] }), [{ r: 1 }, { r: 1 }, { r: 1 }], 2)).toBe(90)
  })
  it('is 0 without a rest list or off a pyramid', () => {
    expect(pyramidRestFor(pyramidCfg(), rows, 1)).toBe(0)
    expect(pyramidRestFor({ mode: 'reps', sets: 3, reps: 10, pyramidRest: [60] }, [{ r: 10 }], 0)).toBe(0)
  })
})

describe('weight per set (pyramidWeight, #445)', () => {
  const lastTime = {
    exWeights: {},
    workouts: [{ id: 'w1', d: '2026-09-28', entries: [{ id: LIFT, sets: [
      { w: 60, r: 12, done: true }, { w: 70, r: 8, done: true }, { w: 80, r: 6, done: true },
      { w: 85, r: 9, done: true, max: true }, { w: 50, r: 12, done: true },
    ] }] }],
  }
  it('normalizePyramidWeight sizes the list, keeps decimals and drops an all-zero one', () => {
    expect(normalizePyramidWeight([40, 52.5], 4)).toEqual([40, 52.5, 0, 0])
    expect(normalizePyramidWeight([40, 50, 60, 70], 2)).toEqual([40, 50])
    expect(normalizePyramidWeight([0, 0], 2)).toEqual([])
    expect(normalizePyramidWeight(undefined, 3)).toEqual([])
    expect(normalizePyramidWeight([-5, 'x', 61.256], 3)).toEqual([0, 0, 61.26])
  })
  it('pyramidWeightAt is the set’s own weight, the last one past the list, 0 without one', () => {
    const cfg = pyramidCfg({ pyramidWeight: [40, 50, 60, 0, 40] })
    expect(pyramidWeightAt(cfg, 1)).toBe(50)
    expect(pyramidWeightAt(cfg, 3)).toBe(0)
    expect(pyramidWeightAt(cfg, 7)).toBe(40)
    expect(pyramidWeightAt(pyramidCfg(), 0)).toBe(0)
    expect(pyramidWeightAt({ mode: 'reps', sets: 3, reps: 10, pyramidWeight: [40] }, 0)).toBe(0)
  })
  it('a first session opens each set at its planned weight', () => {
    const rows = buildSets({ exWeights: {}, workouts: [] }, pyramidCfg({ pyramidWeight: [40, 50, 60, 70, 40] }))
    expect(rows.map(r => r.w)).toEqual([40, 50, 60, 70, 40])
  })
  it('a planned session uses each set’s planned weight, and last time’s for a set left at 0', () => {
    const rows = buildSets(lastTime, pyramidCfg({ pyramidWeight: [65, 0, 90, 0, 0] }), { useTarget: true, planReps: true })
    expect(rows.map(r => r.w)).toEqual([65, 70, 90, 85, 50])
  })
  it('a hidden flat weight no longer overrides last time in a planned session', () => {
    const rows = buildSets(lastTime, pyramidCfg({ weight: 100 }), { useTarget: true, planReps: true })
    expect(rows.map(r => r.w)).toEqual([60, 70, 80, 85, 50])
  })
  it('the flat weight is still the first session’s fallback', () => {
    const rows = buildSets({ exWeights: {}, workouts: [] }, pyramidCfg({ weight: 40 }), { useTarget: true, planReps: true })
    expect(rows.map(r => r.w)).toEqual([40, 40, 40, 40, 40])
  })
  it('freestyle copies what you lifted, and the plan only when there is nothing to copy', () => {
    const cfg = pyramidCfg({ pyramidWeight: [65, 75, 90, 95, 55] })
    expect(buildSets(lastTime, cfg, { preferLast: true }).map(r => r.w)).toEqual([60, 70, 80, 85, 50])
    expect(buildSets({ exWeights: {}, workouts: [] }, cfg, { preferLast: true }).map(r => r.w)).toEqual([65, 75, 90, 95, 55])
  })
  it('travels with a shared plan and converts between kg and lb', () => {
    const stateWith = ex => ({ unit: 'kg', routines: [{ id: 'r1', name: 'Legs', ex: [ex] }], week: {}, customEx: [] })
    const bundle = JSON.stringify(buildPlanBundle(stateWith(pyramidCfg({ pyramidWeight: [40, 60, 80, 0, 40] })), 'Plan'))
    expect(parsePlan(bundle, 'kg').routines[0].ex[0].pyramidWeight).toEqual([40, 60, 80, 0, 40])
    expect(parsePlan(bundle, 'lb').routines[0].ex[0].pyramidWeight)
      .toEqual([40, 60, 80, 0, 40].map(w => (w > 0 ? convertWeight(w, 'kg', 'lb') : 0)))
  })
})

describe('Max set records (Q20, Q21)', () => {
  const row = (w, r, done = true, max = true) => ({
    role: 'work', status: done ? 'completed' : 'skipped', ...(max ? { max: true } : {}),
    observations: [{ metric: 'repetitions', value: r }], resistance: w > 0 ? { kind: 'external-load', value: w, unit: 'kg' } : { kind: 'bodyweight' },
  })
  const session = (id, d, start, exerciseId, ...sets) => ({ id, d, start, exposures: [{ exposureId: id + 'x', exerciseId, performance: { sets } }] })
  const workouts = [
    session('a', '2026-09-01', 1, LIFT, row(85, 9), row(50, 12, true, false)),
    session('b', '2026-09-08', 2, LIFT, row(80, 11)),
    session('c', '2026-09-15', 3, LIFT, row(90, 20, false), row(85, 10, true, false)),
    session('d', '2026-09-22', 4, '9999', row(100, 30)),
  ]
  it('more reps on less weight is not a record', () => {
    expect(maxRecordAt(workouts, LIFT, 85)).toMatchObject({ w: 85, r: 9, d: '2026-09-01' })
  })
  it('at a lighter weight every heavier Max set counts', () => {
    expect(maxRecordAt(workouts, LIFT, 80)).toMatchObject({ w: 80, r: 11 })
  })
  it('only done Max sets of this exercise count; none heavier is no record', () => {
    expect(maxRecordAt(workouts, LIFT, 86)).toBeNull()
    expect(maxRecordAt([], LIFT, 0)).toBeNull()
  })
  it('maxRepsSeries is the most reps in a Max set per workout', () => {
    expect(maxRepsSeries(workouts, LIFT)).toEqual([
      { t: 1, y: 9, d: '2026-09-01', w: 85 },
      { t: 2, y: 11, d: '2026-09-08', w: 80 },
    ])
  })
  it('a Max set on a bodyweight exercise has no weight to beat', () => {
    expect(maxRecordAt([session('e', '2026-09-29', 5, LIFT, row(0, 15))], LIFT, 0)).toMatchObject({ w: 0, r: 15 })
  })
})

function buildSets(S, cfg, options = {}) {
  if (options.preferLast && S.workouts?.length) return S.workouts.at(-1).entries[0].sets.map(row => ({ ...row, done: false }))
  return startMigratedFixture(S, { ex: [cfg] }).entries[0].sets
}
function buildPlanBundle(S, name) { return canonicalBuildPlanBundle(migratedFixture(S), name) }
function parsePlan(...args) {
  const bundle = canonicalParsePlan(...args)
  return { ...bundle, routines: bundle.routines.map(r => ({ ...r, ex: r.ex.map(o => ({ ...coachExOf(o), pyramidWeight: planOptions(o.rule).setWeights })) })) }
}
