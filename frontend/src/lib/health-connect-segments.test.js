import { describe, expect, it } from 'vitest'
import { EXDB, canonicalExId } from './exercises.js'
import { EXALIAS } from './exercises-data.js'
import { exerciseSegments, SEGMENT_EXERCISES } from './health-connect-segments.js'

const start = new Date(2026, 8, 17, 18).getTime()
const at = min => start + min * 60000
const set = (min, r = 8, extra = {}) => ({ at: at(min), r, w: 60, done: true, ...extra })
const entry = (id, sets, mode = 'reps') => ({ id, sets, target: { mode } })
const workout = entries => ({ start, end: at(60), entries })
const segments = entries => exerciseSegments(workout(entries), 'strength_training')

describe('Health Connect exercise segments', () => {
  it('exports multiple exercises and keeps each set of the same exercise separate', () => {
    expect(segments([
      entry('0025', [set(3), set(6, 7)]),
      entry('0043', [set(12, 5), set(16, 5)]),
    ])).toEqual([
      { start, end: at(3), type: 'bench_press', repetitions: 8 },
      { start: at(3), end: at(6), type: 'bench_press', repetitions: 7 },
      { start: at(6), end: at(12), type: 'squat', repetitions: 5 },
      { start: at(12), end: at(16), type: 'squat', repetitions: 5 },
    ])
  })

  it('orders supersets by completion instead of grouping exercise entries in time', () => {
    const entries = [entry('0025', [set(3), set(9)]), entry('0652', [set(6), set(12)])]
    entries[0].sg = entries[1].sg = 'superset'
    expect(segments(entries).map(s => [s.start, s.end, s.type])).toEqual([
      [start, at(3), 'bench_press'], [at(3), at(6), 'pull_up'],
      [at(6), at(9), 'bench_press'], [at(9), at(12), 'pull_up'],
    ])
  })

  it('uses UNKNOWN for unsupported movements and custom names, preserving their reps', () => {
    const entries = ['0662', '0594', '1350', 'custom-bench', 'toString'].map((id, i) => ({
      ...entry(id, [set(i + 1, 10)]), n: 'barbell bench press',
    }))
    expect(segments(entries).map(s => [s.type, s.repetitions])).toEqual(
      entries.map(() => ['unknown', 10]))
  })

  it('maps a bodyweight pull-up without requiring a positive external load', () => {
    expect(segments([entry('0652', [set(2, 12, { w: 0 })])])[0]).toMatchObject({ type: 'pull_up', repetitions: 12 })
  })

  it('includes completed warm-ups, sums drop reps, and never adds rest-pause clusters twice', () => {
    expect(segments([entry('0025', [
      set(1, 10, { phase: 'warmup' }),
      set(2, 8, { warmup: true }),
      set(4, 6, { type: 'dropset', drops: [{ w: 40, r: 5 }, { w: 30, r: 4 }] }),
      set(6, 12, { type: 'restpause', clusters: [{ r: 6 }, { r: 3 }, { r: 2 }, { r: 1 }] }),
      set(8, 20, { done: false }),
    ])]).map(s => s.repetitions)).toEqual([10, 8, 15, 12])
  })

  it('counts only completed sides, including their own drops and rest-pause totals', () => {
    const sides = (L, R) => ({ sides: { L, R }, r: 99, done: false })
    const done = extra => ({ done: true, r: 8, w: 20, ...extra })
    expect(segments([entry('0293', [
      set(2, 99, sides(done({ type: 'dropset', drops: [{ r: 3 }] }), { done: false, r: 50 })),
      set(4, 99, sides(done({ type: 'restpause', r: 12, clusters: [{ r: 6 }, { r: 6 }] }), done({ r: 7 }))),
    ])]).map(s => s.repetitions)).toEqual([11, 19])
  })

  it('uses logged duration for timed holds, without interpreting seconds as reps', () => {
    expect(segments([entry('0463', [set(2, 99, { sec: 45 })], 'time')])).toEqual([
      { start: at(2) - 45000, end: at(2), type: 'plank', repetitions: 0 },
    ])
  })

  it('keeps cardio in mixed strength sessions compatible using UNKNOWN and its logged minutes', () => {
    const entries = [entry('3666', [set(10, 99, { min: 8 })], 'cardio'), entry('0025', [set(15)])]
    expect(segments(entries)[0]).toEqual({ start: at(2), end: at(10), type: 'unknown', repetitions: 0 })
    expect(exerciseSegments(workout(entries.slice(0, 1)), 'walking')).toEqual([])
    expect(exerciseSegments(workout(entries), 'other_workout')).toEqual([])
  })

  it('leaves missing, invalid, outside-session and duplicate ticks out', () => {
    const bad = [undefined, null, NaN, Infinity, at(-1), start, at(61), at(2) + 0.5]
    expect(segments([entry('0025', bad.map(at => ({ r: 8, done: true, at })))])).toEqual([])
    expect(segments([entry('0025', [set(2), set(2), set(4)])])).toEqual([
      { start: at(2), end: at(4), type: 'bench_press', repetitions: 8 },
    ])
  })

  it('does not squeeze an overlapping hold or a duration that cannot fit into a shorter interval', () => {
    expect(segments([
      entry('0025', [set(2)]),
      entry('0463', [set(3, 0, { sec: 90 }), set(5, 0, { sec: 30 })], 'time'),
    ])).toEqual([
      { start, end: at(2), type: 'bench_press', repetitions: 8 },
      { start: at(5) - 30000, end: at(5), type: 'plank', repetitions: 0 },
    ])
    for (const sec of [undefined, 0, -1, Infinity, NaN, 0.0001]) {
      expect(segments([entry('0463', [set(2, 0, { sec })], 'time')])).toEqual([])
    }
  })

  it('does not mutate or reorder the workout and allows touching segment boundaries', () => {
    const w = workout([entry('0025', [set(60), set(2), set(4)])])
    const before = JSON.stringify(w)
    const out = exerciseSegments(w, 'strength_training')
    expect(JSON.stringify(w)).toBe(before)
    expect(out.map(s => s.end)).toEqual([at(2), at(4), at(60)])
    expect(out.every((s, i) => s.start >= start && s.end <= w.end && s.start < s.end && (!i || s.start >= out[i - 1].end))).toBe(true)
  })

  it('never sends fractional, negative, non-finite or overflowing repetitions to Android', () => {
    for (const r of [-1, 1.5, Infinity, NaN, undefined, 2147483648]) {
      expect(segments([entry('0025', [set(2, 8, { r })])])[0].repetitions).toBe(0)
    }
    expect(segments([entry('0025', [set(2, 2147483647)])])[0].repetitions).toBe(2147483647)
    expect(segments([entry('0025', [set(2, 2147483647, { type: 'dropset', drops: [{ r: 1 }] })])])[0].repetitions).toBe(0)
  })
})

describe('reviewed catalogue mapping', () => {
  it('references existing catalogue exercises only, with no id mapped twice', () => {
    const ids = Object.values(SEGMENT_EXERCISES).flat()
    const catalogue = new Set(EXDB.map(e => e.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter(id => !catalogue.has(id))).toEqual([])
    for (const [type, ids] of Object.entries(SEGMENT_EXERCISES)) {
      for (const id of ids) expect(segments([entry(id, [set(2)])])[0].type).toBe(type)
    }
  })

  it('resolves alternate drawing ids through the existing catalogue aliases', () => {
    const pair = Object.entries(EXALIAS).find(([, id]) => Object.values(SEGMENT_EXERCISES).flat().includes(id))
    expect(pair).toBeDefined()
    const [alias, id] = pair
    expect(canonicalExId(alias)).toBe(id)
    expect(segments([entry(alias, [set(2)])])).toEqual(segments([entry(id, [set(2)])]))
  })
})
