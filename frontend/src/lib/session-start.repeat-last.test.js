// A routine set to repeat its last workout (`startFromLast`): "Your last session" and no
// progression rule, for that routine alone, with the profile left on "Your plan".
import { describe, it, expect } from 'vitest'
import { buildPlannedEntry, buildSessionEntries, opensFromLast, repeatsLast } from './session-start.js'
import { finishCompare } from './finish-compare.js'
import { isWarmupRow } from './workout-model.js'

const BENCH = '0025'   // barbell bench press, loaded, 2.5 kg step
const work = e => e.sets.filter(s => !isWarmupRow(s))
const warmups = e => e.sets.filter(isWarmupRow)
const routineOf = (extra = {}, cfg = {}) => ({ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50, prog: 'linear', mode: 'reps', ...cfg }], ...extra })
// One past session of the routine, saved the shape the finish path saves it.
const lastWorkout = (routine, sets) => ({
  id: 'prior', d: '2026-09-01', routineIds: [routine.id],
  entries: [{
    id: BENCH, rid: routine.id,
    target: { sets: 2, reps: 10, weight: 50, mode: 'reps' },
    planned: { sets: 2, reps: 10, weight: 50 },
    sets,
  }],
})
const state = (routine, sets = [], extra = {}) => ({
  unit: 'kg', exWeights: {}, routines: [routine], workouts: sets.length ? [lastWorkout(routine, sets)] : [], week: {}, dayPlan: {}, ...extra,
})
const done = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const warm = (w, r) => ({ w, r, done: true, phase: 'warmup', warmup: true, edited: true })
const LAST = [warm(30, 8), done(60, 7), done(57.5, 6)]
const entryOf = st => buildSessionEntries(st, st.routines[0])[0]

describe('repeatsLast / opensFromLast', () => {
  it('is the routine switch, unless the routine is kept out of progression', () => {
    expect(repeatsLast({ startFromLast: true })).toBe(true)
    expect(repeatsLast({})).toBe(false)
    expect(repeatsLast(null)).toBe(false)
    expect(repeatsLast({ startFromLast: true, excludeFromProgression: true })).toBe(false)
  })

  it('is the profile\'s choice or the routine\'s', () => {
    expect(opensFromLast({ startFrom: 'last' }, null)).toBe(true)
    expect(opensFromLast({ startFrom: 'plan' }, { startFromLast: true })).toBe(true)
    expect(opensFromLast({ startFrom: 'plan' }, {})).toBe(false)
    expect(opensFromLast({}, { startFromLast: true, excludeFromProgression: true })).toBe(false)
  })
})

describe('a routine that repeats its last workout, with the profile on "Your plan"', () => {
  it('opens every set at last time\'s weight and reps, with no prescription', () => {
    const st = state(routineOf({ startFromLast: true }), LAST)
    const e = entryOf(st)
    expect(e.plan.kind).toBe('off')
    expect(work(e).map(s => [s.w, s.r])).toEqual([[60, 7], [57.5, 6]])
    expect(e.target.weight).toBe(50)
    expect(e.target.reps).toBe(10)
    expect(e.carried).toBe(true)
  })

  it('carries the warm-ups set by hand', () => {
    const e = entryOf(state(routineOf({ startFromLast: true }), LAST))
    expect(warmups(e).map(s => [s.w, s.r, s.done])).toEqual([[30, 8, false]])
  })

  it('builds the same through buildPlannedEntry, which a swap or a settings edit uses', () => {
    const st = state(routineOf({ startFromLast: true }), LAST)
    const e = buildPlannedEntry(st, st.routines[0].ex[0], st.routines[0])
    expect(e.plan.kind).toBe('off')
    expect(work(e).map(s => [s.w, s.r])).toEqual([[60, 7], [57.5, 6]])
  })

  it('opens at the routine\'s own numbers the first time, with nothing to repeat', () => {
    const e = entryOf(state(routineOf({ startFromLast: true })))
    expect(e.plan.kind).toBe('off')
    expect(work(e).map(s => [s.w, s.r])).toEqual([[50, 10], [50, 10]])
    expect(e.carried).toBeUndefined()
  })

  it('leaves a routine without the switch to its rule', () => {
    const e = entryOf(state(routineOf(), LAST))
    expect(e.plan.kind).not.toBe('off')
    expect(warmups(e).map(s => s.edited)).not.toContain(true)
    expect(work(e).map(s => s.r)).toEqual([10, 10])
  })

  it('keeps a deload routine at its own numbers, the switch notwithstanding', () => {
    const st = state(routineOf({ startFromLast: true, excludeFromProgression: true }), LAST)
    const e = entryOf(st)
    expect(e.noProg).toBe(true)
    expect(work(e).map(s => [s.w, s.r])).toEqual([[50, 10], [50, 10]])
  })

  it('forecasts last time\'s numbers in the finish summary, not a raise', () => {
    const routine = routineOf({ startFromLast: true })
    const st = state(routine, [done(60, 10), done(60, 10)])
    const [row] = finishCompare(st, st.workouts[0])
    expect(row.next).toMatchObject({ w: 60, r: 10, kind: 'hold' })
    // Without the switch the same clean session forecasts the rule's raise.
    const ruled = state(routineOf(), [done(60, 10), done(60, 10)])
    expect(finishCompare(ruled, ruled.workouts[0])[0].next).toMatchObject({ w: 62.5, kind: 'up' })
  })
})
