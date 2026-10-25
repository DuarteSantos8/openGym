import { afterEach, describe, expect, it } from 'vitest'
import { CATALOGUE, canonicalExId, registerCustom } from './exercises.js'
import { EXALIAS } from './exercises-data.js'
import { exerciseSegments, repetitionsOf, segmentWeightKg } from './health-connect-segments.js'
import { mappingCoverage, segmentTypeFor, SEGMENT_EXERCISES } from './health-connect-mapping.js'
import { sessionRecord } from './health-connect.js'

const start = new Date(2026, 8, 17, 18).getTime()
const at = min => start + min * 60000
const set = (min, r = 8, extra = {}) => ({ at: at(min), r, w: 60, done: true, ...extra })
const entry = (id, sets, mode = 'reps', target = {}) => ({ id, sets, target: { mode, ...target } })
const workout = entries => ({ id: 'w', start, end: at(60), entries })
const segments = (entries, options) => exerciseSegments(workout(entries), 'other_workout', options)
const byName = name => {
  const ex = CATALOGUE.find(e => e.n === name)
  expect(ex, name).toBeDefined()
  return ex.id
}
afterEach(() => registerCustom([]))

describe('catalogue movement classes', () => {
  it.each([
    ['barbell bench press', 'bench_press'],
    ['barbell incline bench press', 'bench_press'],
    ['barbell decline bench press', 'bench_press'],
    ['dumbbell bench press', 'bench_press'],
    ['lever chest press', 'bench_press'],
    ['barbell full squat', 'squat'],
    ['barbell deadlift', 'deadlift'],
    ['dumbbell bent over row', 'dumbbell_row'],
    ['dumbbell biceps curl', 'arm_curl'],
  ])('%s maps to %s', (name, type) => expect(segmentTypeFor({ id: byName(name) })).toBe(type))

  it.each([
    ['0025', 'bench_press'], ['0043', 'squat'], ['0032', 'deadlift'],
    ['0197', 'lat_pull_down'], ['0652', 'pull_up'], ['0585', 'leg_extension'],
    ['0586', 'leg_curl'], ['0334', 'lateral_raise'], ['0404', 'shoulder_press'],
    ['0274', 'crunch'], ['0463', 'plank'], ['0549', 'kettlebell_swing'],
    ['1160', 'burpee'], ['2138', 'biking_stationary'], ['2197', 'running_treadmill'],
    ['1161', 'rowing_machine'], ['3666', 'walking'], ['2141', 'elliptical'],
    ['2311', 'stair_climbing_machine'], ['6944', 'swimming_freestyle'],
  ])('%s maps deterministically to %s', (id, type) => expect(segmentTypeFor({ id })).toBe(type))

  it('covers complete movement families across equipment while avoiding misleading specializations', () => {
    const check = (pattern, type, predicate = () => true) => {
      const xs = CATALOGUE.filter(e => pattern.test(e.n) && predicate(e))
      expect(xs.length).toBeGreaterThan(0)
      for (const ex of xs) expect(segmentTypeFor({ id: ex.id }), ex.n).toBe(type)
    }
    check(/leg press/, 'leg_press', e => e.cat === 'strength' && !/calf/.test(e.n))
    check(/triceps pushdown/, 'double_arm_triceps_extension', e => !/one arm|single arm/.test(e.n))
    check(/hip thrust/, 'hip_thrust', e => e.cat === 'strength')
    check(/calf raise/, 'weightlifting', e => e.cat === 'strength' && !/squat/.test(e.n))
    check(/rear delt fly/, 'weightlifting', e => e.cat === 'strength')
  })

  it('uses catalogue categories for yoga, pilates, mobility and general bodyweight movements', () => {
    for (const [cat, type] of [['yoga', 'yoga'], ['pilates', 'pilates'], ['mobility', 'stretching'], ['stretching', 'stretching']]) {
      for (const ex of CATALOGUE.filter(e => e.cat === cat)) expect(segmentTypeFor({ id: ex.id }), ex.n).toBe(type)
    }
    expect(segmentTypeFor({ id: '0662' })).toBe('other_workout') // push-up has no HC-specific type
  })

  it('never parses custom/translated names, but uses confident structured metadata', () => {
    registerCustom([
      { id: 'custom', n: 'Bench Press', eq: 'cable', cat: 'strength' },
      { id: 'y', n: 'anything', cat: 'yoga' },
      { id: 'bike', n: 'anything', eq: 'stationary bike' },
    ])
    expect(segmentTypeFor({ id: 'custom' }, 'reps')).toBe('weightlifting')
    expect(segmentTypeFor({ id: 'y' })).toBe('yoga')
    expect(segmentTypeFor({ id: 'bike' })).toBe('biking_stationary')
    expect(segmentTypeFor({ id: 'missing', n: 'barbell bench press' })).toBe('unknown')
    expect(segmentTypeFor({ id: 'toString' })).toBe('unknown')
  })

  it('has reviewed overrides and resolves every drawing alias without changing its class', () => {
    const ids = Object.values(SEGMENT_EXERCISES).flat()
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(CATALOGUE.some(e => e.id === id)).toBe(true)
    for (const [alias, id] of Object.entries(EXALIAS)) {
      expect(canonicalExId(alias)).toBe(id)
      expect(segmentTypeFor({ id: alias })).toBe(segmentTypeFor({ id }))
    }
  })

  it('keeps full catalogue coverage visible without calling generic fallbacks specific mappings', () => {
    const c = mappingCoverage()
    expect(c.total).toBe(CATALOGUE.length)
    expect(c.specific).toBeGreaterThan(2000)
    expect(c.specific + c.resistance + c.general + c.unknown).toBe(c.total)
    expect(c.unknownExercises).toEqual([])
    expect(c.coverage).toBe(100)
  })
})

describe('per-set fields and timestamps', () => {
  it('exports ordered supersets with 1 ms technical intervals, not preceding rest duration', () => {
    const xs = segments([entry('0025', [set(3), set(9)]), entry('0652', [set(6), set(12)])])
    expect(xs.map(s => [s.type, s.setIndex])).toEqual([['bench_press', 0], ['pull_up', 0], ['bench_press', 1], ['pull_up', 1]])
    expect(xs.every(s => s.end - s.start === 1)).toBe(true)
    expect(xs.map(s => s.end)).toEqual([at(3), at(6), at(9), at(12)])
  })

  it('retains original set indices including warmups and skipped rows', () => {
    const xs = segments([entry('0025', [set(1, 10, { phase: 'warmup' }), set(2, 8, { done: false }), set(3, 6)])])
    expect(xs.map(s => [s.setIndex, s.repetitions])).toEqual([[0, 10], [2, 6]])
  })

  it('counts drops, rest-pause totals and completed sides once', () => {
    const side = (r, extra = {}) => ({ r, w: 20, done: true, ...extra })
    expect(repetitionsOf(set(1, 6, { type: 'dropset', drops: [{ w: 40, r: 5 }, { w: 30, r: 4 }] }))).toBe(15)
    expect(repetitionsOf(set(1, 12, { type: 'restpause', clusters: [{ r: 6 }, { r: 3 }] }))).toBe(12)
    const sides = { L: side(8, { type: 'dropset', drops: [{ w: 10, r: 3 }] }), R: side(50, { done: false }) }
    expect(repetitionsOf({ sides, r: 99 })).toBe(11)
    expect(repetitionsOf({ sides: { L: side(8), R: side(7) }, r: 99 })).toBe(15)
  })

  it('preserves explicit RPE and zero, but does not convert RIR or failure to Borg RPE', () => {
    const xs = segments([entry('0025', [set(1, 8, { rpe: 8.5 }), set(2, 8, { rir: 2 }), set(3, 8, { failure: true }), set(4, 8, { rpe: 0 })])])
    expect(xs.map(s => s.rpe)).toEqual([8.5, undefined, undefined, 0])
    for (const rpe of [-1, 11, Infinity, NaN, null, '']) expect(segments([entry('0025', [set(1, 8, { rpe })])])[0]).not.toHaveProperty('rpe')
    const sides = { L: { done: true, r: 8, rpe: 7 }, R: { done: true, r: 8, rpe: 9 } }
    expect(segments([entry('0293', [set(1, 16, { sides, rpe: 9 })])])[0]).not.toHaveProperty('rpe')
  })

  it('uses measured timed/cardio duration and never divides a session among untimed history', () => {
    const xs = segments([entry('0463', [set(2, 99, { sec: 45 })], 'time'), entry('3666', [set(12, 0, { min: 8 })], 'cardio')])
    expect(xs.map(s => [s.type, s.end - s.start, s.repetitions])).toEqual([['plank', 45000, 0], ['walking', 480000, 0]])
    expect(segments([entry('0025', [{ r: 8, done: true }])])).toEqual([])
  })

  it('handles duplicate ticks deterministically, preserves boundaries, and skips invalid times', () => {
    const xs = segments([entry('0025', [set(2), set(2), set(4)])])
    expect(xs.map(s => [s.start, s.end])).toEqual([[at(2) - 2, at(2) - 1], [at(2) - 1, at(2)], [at(4) - 1, at(4)]])
    const bad = [undefined, null, NaN, Infinity, at(-1), start, at(61), at(2) + 0.5]
    expect(segments([entry('0025', bad.map(at => ({ r: 8, done: true, at })))])).toEqual([])
    expect(segments([entry('0025', [set(2)]), entry('0463', [set(3, 0, { sec: 90 })], 'time')])).toHaveLength(1)
  })

  it('does not mutate state and keeps repetitions valid for signed Android Int', () => {
    const w = workout([entry('0025', [set(3), set(1)])])
    const before = structuredClone(w)
    exerciseSegments(w, 'strength_training')
    expect(w).toEqual(before)
    for (const r of [-1, 1.5, Infinity, NaN, undefined, null, 2147483648]) expect(repetitionsOf({ done: true, r })).toBe(0)
    expect(repetitionsOf({ done: true, r: 2147483647 })).toBe(2147483647)
  })

  it('retains base segments on older Health Connect and enriches only supported fields', () => {
    const e = entry('0025', [set(2, 8, { rpe: 8 })])
    const old = segments([e], { extended: false })[0]
    expect(old).toEqual({ start: at(2) - 1, end: at(2), type: 'bench_press', repetitions: 8 })
    expect(segments([e])[0]).toMatchObject({ weightKg: 60, setIndex: 0, rpe: 8 })
  })

  it('uses a universal mixed session and real cardio/strength types', () => {
    const w = workout([entry('0025', [set(2)]), entry('0685', [set(12, 0, { min: 5 })], 'cardio')])
    const rec = sessionRecord(w, { unit: 'kg', nameOf: e => e.id })
    expect(rec.type).toBe('other_workout')
    expect(rec.segments.map(s => s.type)).toEqual(['bench_press', 'running'])
    expect(sessionRecord(workout([w.entries[1]]), { unit: 'kg', nameOf: e => e.id }).type).toBe('running')
  })
})

describe('load semantics', () => {
  const kg = (id, row = {}, target = {}, unit = 'kg') =>
    segmentWeightKg(entry(id, [], 'reps', target), set(1, 8, row), {}, unit)
  it('converts conventional loads, respects explicit unit stamps and does not round to plates', () => {
    expect(kg('0025')).toBe(60)
    expect(kg('0025', { w: 100 }, {}, 'lb')).toBeCloseTo(45.359237)
    expect(kg('0025', { w: 10, unit: 'kg' }, {}, 'lb')).toBe(10)
    expect(kg('0585', { w: 40 })).toBe(40) // machine stack is external load
    for (const w of [-1, null, '', Infinity, 2501]) expect(kg('0025', { w })).toBeNull()
  })
  it('exports explicit dumbbell totals or each-bell totals, not ambiguous legacy two-bell loads', () => {
    expect(kg('0289', { w: 20 })).toBeNull()
    expect(kg('0289', { w: 20 }, { dbLoad: 'each' })).toBe(40)
    expect(kg('0289', { w: 40 }, { dbLoad: 'total' })).toBe(40)
    expect(kg('0293', { w: 20 }, { dbLoad: 'each', side: true })).toBe(20)
    const sides = { L: { done: true, w: 20, r: 8 }, R: { done: true, w: 20, r: 7 } }
    expect(kg('0293', { sides }, { dbLoad: 'each', side: true })).toBe(20)
    sides.R.w = 15
    expect(kg('0293', { sides }, { dbLoad: 'each', side: true })).toBeNull()
  })
  it('omits varying drop loads instead of reporting only the heaviest load for all reps', () => {
    expect(kg('0025', { type: 'dropset', drops: [{ w: 40, r: 5 }] })).toBeNull()
    expect(kg('0025', { type: 'restpause', r: 12, clusters: [{ r: 4 }] })).toBe(60)
  })
  it('exports added bodyweight load, never athlete mass or assistance as lifted mass', () => {
    expect(kg('0652', { w: 0 })).toBeNull()
    expect(kg('0652', { w: 10 })).toBe(10)
    expect(kg('0017', { w: 30 })).toBeNull() // assisted pull-up
    registerCustom([{ id: 'band', n: 'custom', eq: 'band', cat: 'strength' }])
    expect(kg('band', { w: 20 })).toBeNull()
  })
})
