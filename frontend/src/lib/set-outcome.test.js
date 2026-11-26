import { describe, expect, test } from 'vitest'
import { setOutcome } from './set-outcome.js'

const row = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const past = (sets, d = '2026-01-01') => ({ id: 'w0', d, entries: [{ id: 'bench', sets }] })
const entry = (sets, target = { sets: 3, reps: 8 }) => ({ id: 'bench', sets, target })
const S = (...workouts) => ({ workouts })

describe('setOutcome', () => {
  test('fewer reps than planned is short', () => {
    expect(setOutcome(S(), entry([row(60, 6)]), 0)).toEqual({ outcome: 'short', moreReps: 0, last: null })
  })
  test('with a rep range, short is below the low end and beat is above the high end', () => {
    const t = { sets: 3, reps: 12, repsMin: 8 }
    expect(setOutcome(S(), entry([row(60, 7)], t), 0).outcome).toBe('short')
    expect(setOutcome(S(), entry([row(60, 8)], t), 0).outcome).toBe('hit')
    expect(setOutcome(S(), entry([row(60, 12)], t), 0).outcome).toBe('hit')
    expect(setOutcome(S(), entry([row(60, 13)], t), 0).outcome).toBe('beat')
  })
  test('a set that follows the plan with no history is a hit', () => {
    expect(setOutcome(S(), entry([row(60, 8)]), 0)).toEqual({ outcome: 'hit', moreReps: 0, last: null })
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
  test('more reps than planned beats the plan', () => {
    expect(setOutcome(S(), entry([row(60, 10)]), 0).outcome).toBe('beat')
  })
  test('more reps than the same set last time, and how many more', () => {
    const s = S(past([row(60, 7), row(60, 7)]))
    expect(setOutcome(s, entry([row(60, 8), row(60, 8)]), 1)).toEqual({ outcome: 'beat', moreReps: 1, last: { w: 60, r: 7 } })
  })
  test('more weight than last time is a beat with no extra reps', () => {
    const s = S(past([row(60, 8)]))
    expect(setOutcome(s, entry([row(62.5, 8)]), 0)).toEqual({ outcome: 'beat', moreReps: 0, last: { w: 60, r: 8 } })
  })
  test('the same as last time is a hit', () => {
    expect(setOutcome(S(past([row(60, 8)])), entry([row(60, 8)]), 0)).toEqual({ outcome: 'hit', moreReps: 0, last: { w: 60, r: 8 } })
  })
  test('work sets are counted without the warm-ups', () => {
    const s = S(past([{ w: 20, r: 10, done: true, phase: 'warmup' }, row(60, 7)]))
    const e = entry([{ w: 20, r: 10, done: true, phase: 'warmup' }, row(60, 8)])
    expect(setOutcome(s, e, 1).moreReps).toBe(1)
  })
  test('a held set is short, a hit or a beat by its seconds', () => {
    const t = { sets: 2, sec: 30, mode: 'time' }
    expect(setOutcome(S(), entry([{ sec: 25, done: true }], t), 0).outcome).toBe('short')
    expect(setOutcome(S(), entry([{ sec: 30, done: true }], t), 0).outcome).toBe('hit')
    expect(setOutcome(S(), entry([{ sec: 40, done: true }], t), 0).outcome).toBe('beat')
  })
  test('a warm-up, a set not done, and a missing row say nothing', () => {
    expect(setOutcome(S(), entry([{ w: 20, r: 10, done: true, phase: 'warmup' }]), 0)).toBeNull()
    expect(setOutcome(S(), entry([{ w: 60, r: 8, done: false }]), 0)).toBeNull()
    expect(setOutcome(S(), entry([]), 0)).toBeNull()
  })
})
