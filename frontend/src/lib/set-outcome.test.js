import { describe, expect, test } from 'vitest'
import { setOutcome } from './set-outcome.js'

const row = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const past = (sets, d = '2026-01-01') => ({ id: 'w0', d, entries: [{ id: 'bench', sets }] })
const entry = (sets, target = { sets: 3, reps: 8 }) => ({ id: 'bench', sets, target })
const S = (...workouts) => ({ workouts })

describe('setOutcome', () => {
  test('fewer reps than planned is short', () => {
    expect(setOutcome(S(), entry([row(60, 6)]), 0)).toEqual({ outcome: 'short', beat: null })
  })
  test('with a rep range, short is below the low end and beat is above the high end', () => {
    const t = { sets: 3, reps: 12, repsMin: 8 }
    expect(setOutcome(S(), entry([row(60, 7)], t), 0).outcome).toBe('short')
    expect(setOutcome(S(), entry([row(60, 8)], t), 0).outcome).toBe('hit')
    expect(setOutcome(S(), entry([row(60, 12)], t), 0).outcome).toBe('hit')
    expect(setOutcome(S(), entry([row(60, 13)], t), 0).outcome).toBe('beat')
  })
  test('a set that follows the plan with no history is a hit', () => {
    expect(setOutcome(S(), entry([row(60, 8)]), 0)).toEqual({ outcome: 'hit', beat: null })
  })
  test('rated RIR 0 or RPE 10 is hard; unrated never is', () => {
    expect(setOutcome(S(), entry([row(60, 8, { rir: 0 })]), 0).outcome).toBe('hard')
    expect(setOutcome(S(), entry([row(60, 8, { rpe: 10 })]), 0).outcome).toBe('hard')
    expect(setOutcome(S(), entry([row(60, 8)]), 0).outcome).toBe('hit')
    expect(setOutcome(S(), entry([row(60, 8, { rir: 2 })]), 0).outcome).toBe('hit')
  })
  test('a failure set rated RIR 0 is not hard', () => {
    expect(setOutcome(S(), entry([row(60, 8, { rir: 0, failure: true })]), 0).outcome).toBe('hit')
  })
  test('short beats hard', () => {
    expect(setOutcome(S(), entry([row(60, 5, { rir: 0 })]), 0).outcome).toBe('short')
  })
  test('more reps than planned beats the plan, when there is no last time', () => {
    expect(setOutcome(S(), entry([row(60, 10)]), 0)).toEqual({ outcome: 'beat', beat: { kind: 'plan' } })
  })
  test('more reps than the same set last time, and how many more', () => {
    const s = S(past([row(60, 7), row(60, 7)]))
    expect(setOutcome(s, entry([row(60, 8), row(60, 8)]), 1)).toEqual({ outcome: 'beat', beat: { kind: 'reps', n: 1, side: false } })
  })
  test('more weight than last time is a beat by that weight, not by the plan', () => {
    const s = S(past([row(60, 8)]))
    expect(setOutcome(s, entry([row(62.5, 8)]), 0)).toEqual({ outcome: 'beat', beat: { kind: 'weight', n: 2.5 } })
  })
  test('the same as last time is a hit', () => {
    expect(setOutcome(S(past([row(60, 8)])), entry([row(60, 8)]), 0)).toEqual({ outcome: 'hit', beat: null })
  })
  test('work sets are counted without the warm-ups', () => {
    const s = S(past([{ w: 20, r: 10, done: true, phase: 'warmup' }, row(60, 7)]))
    const e = entry([{ w: 20, r: 10, done: true, phase: 'warmup' }, row(60, 8)])
    expect(setOutcome(s, e, 1).beat).toEqual({ kind: 'reps', n: 1, side: false })
  })
  test('a held set is short, a hit or a beat by its seconds', () => {
    const t = { sets: 2, sec: 30, mode: 'time' }
    expect(setOutcome(S(), entry([{ sec: 25, done: true }], t), 0).outcome).toBe('short')
    expect(setOutcome(S(), entry([{ sec: 30, done: true }], t), 0).outcome).toBe('hit')
    expect(setOutcome(S(), entry([{ sec: 40, done: true }], t), 0)).toEqual({ outcome: 'beat', beat: { kind: 'plan' } })
  })
  test('a hold longer than last time is a beat in seconds', () => {
    const t = { sets: 1, sec: 30, mode: 'time' }
    const s = S({ id: 'w0', d: '2026-01-01', entries: [{ id: 'bench', sets: [{ sec: 30, done: true }] }] })
    expect(setOutcome(s, entry([{ sec: 35, done: true }], t), 0)).toEqual({ outcome: 'beat', beat: { kind: 'sec', n: 5 } })
  })
  test('a warm-up, a set not done, and a missing row say nothing', () => {
    expect(setOutcome(S(), entry([{ w: 20, r: 10, done: true, phase: 'warmup' }]), 0)).toBeNull()
    expect(setOutcome(S(), entry([{ w: 60, r: 8, done: false }]), 0)).toBeNull()
    expect(setOutcome(S(), entry([]), 0)).toBeNull()
  })

  // #1393 review: what the lifter hears must be what happened, in the app's own comparison.
  test('a progression step to the planned reps is a beat by weight, never "more than the plan"', () => {
    const s = S(past([row(80, 5)]))
    expect(setOutcome(s, entry([row(82.5, 5)], { sets: 3, reps: 5 }), 0)).toEqual({ outcome: 'beat', beat: { kind: 'weight', n: 2.5 } })
  })
  test('weight above the plan alone is not news', () => {
    expect(setOutcome(S(), entry([row(100, 8)]), 0)).toEqual({ outcome: 'hit', beat: null })
  })
  test('it agrees with the arrow: a heavier set that lowers the estimated 1RM is no beat', () => {
    // 70 x 10 after 80 x 8 shows a down arrow (e1RM); 90 x 3 after 80 x 8 too.
    const s = S(past([row(80, 8)]))
    expect(setOutcome(s, entry([row(70, 10)], { sets: 1, reps: 10 }), 0)).toEqual({ outcome: 'hit', beat: null })
    expect(setOutcome(s, entry([row(90, 3)], { sets: 1 }), 0)).toEqual({ outcome: 'hit', beat: null })
  })
  test('on an assisted machine less help is not said, more reps still are', () => {
    const t = { sets: 1, reps: 8, assisted: true }
    const s = S(past([row(40, 8)]))
    expect(setOutcome(s, entry([row(35, 8)], t), 0)).toEqual({ outcome: 'hit', beat: null })
    expect(setOutcome(s, entry([row(35, 9)], t), 0)).toEqual({ outcome: 'beat', beat: { kind: 'reps', n: 1, side: false } })
  })
  test('last time in the unit the exercise is shown in', () => {
    const s = { ...S(past([row(80, 8)])), unit: 'kg', exUnit: { bench: { unit: 'lb', _ts: 1 } } }
    const { beat } = setOutcome(s, entry([row(82.5, 8)]), 0)
    expect(beat.kind).toBe('weight')
    expect(beat.n).toBeCloseTo(5.51, 1)
  })
  test('a per-side set compares reps per side, not both sides added up', () => {
    const side = (l, r) => ({ w: 20, r: l + r, done: true, sides: { L: { w: 20, r: l, done: true }, R: { w: 20, r: r, done: true } } })
    const s = S(past([side(8, 8)]))
    expect(setOutcome(s, entry([side(9, 9)], { sets: 1, reps: 9 }), 0)).toEqual({ outcome: 'beat', beat: { kind: 'reps', n: 1, side: true } })
    // one side up, the weaker side the same: nothing to say that is true of both
    expect(setOutcome(s, entry([side(9, 8)], { sets: 1, reps: 8 }), 0)).toEqual({ outcome: 'hit', beat: null })
  })
  test('the plan for a row (triple progression) is the reps of that row', () => {
    expect(setOutcome(S(), entry([row(60, 8), row(60, 9)], { sets: 2, reps: 8, rowReps: [10, 8] }), 1)).toEqual({ outcome: 'beat', beat: { kind: 'plan' } })
  })
  test('a workout logged into the past is held against the day before it', () => {
    const early = { id: 'w1', d: '2026-01-01', start: 1, entries: [{ id: 'bench', sets: [row(60, 7)] }] }
    const later = { id: 'w2', d: '2026-01-10', start: 1, entries: [{ id: 'bench', sets: [row(60, 9)] }] }
    const s = { workouts: [early, later], active: { backfill: {}, d: '2026-01-05', start: 5 } }
    expect(setOutcome(s, entry([row(60, 8)]), 0)).toEqual({ outcome: 'beat', beat: { kind: 'reps', n: 1, side: false } })
  })
})
