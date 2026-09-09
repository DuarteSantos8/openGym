import { describe, expect, it } from 'vitest'
import { insertionIndexAfterCurrentUnit, nextUnfinishedUnit, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor } from './supersetFlow.js'

const entry = done => ({ sets: done.map(value => ({ done: value })) })

describe('restAfterSet', () => {
  it('rests between the sets of an exercise', () => {
    expect(restAfterSet({ unitDone: false, lastUnit: false })).toBe(true)
    expect(restAfterSet({ unitDone: false, lastUnit: true })).toBe(true)
  })

  // Issue #3: a two-set exercise timed one rest instead of two, because the closing set
  // "finished quietly". The next exercise still follows it, so the rest belongs there.
  it('rests after the closing set when another exercise follows', () => {
    expect(restAfterSet({ unitDone: true, lastUnit: false })).toBe(true)
  })

  it('stays quiet only on the very last set of the session', () => {
    expect(restAfterSet({ unitDone: true, lastUnit: true })).toBe(false)
  })
})

describe('supersetFlowStep', () => {
  it('does not create navigation or rest flow for a normal singleton exercise', () => {
    const entries = [entry([true]), entry([false])]
    expect(supersetFlowStep(entries, [0], 0)).toBeNull()
  })

  it('does not count an uncheck/re-check of previously completed work as new progress', () => {
    const finished = entry([true, true, true])
    expect(setProgressHighWater(finished, 3)).toEqual({ isNew: false, highWater: 3 })
    expect(setProgressHighWater(finished, 2)).toEqual({ isNew: true, highWater: 3 })
  })

  it('skips a spent short member and uses the last member with work as the round boundary', () => {
    // A has just completed set two of three; B's only set was completed last round.
    const entries = [entry([true, true, false]), entry([true])]
    expect(supersetFlowStep(entries, [0, 1], 0)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })
  })

  it('wraps to the next member with work at a normal round boundary', () => {
    const entries = [entry([true, false, false]), entry([true])]
    expect(supersetFlowStep(entries, [0, 1], 1)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })
  })
})

describe('active workout unit ordering', () => {
  it('inserts after the whole current unit', () => {
    expect(insertionIndexAfterCurrentUnit([[0, 1], [2]], 0, 3)).toBe(2)
    expect(insertionIndexAfterCurrentUnit([[0], [1]], 1, 2)).toBe(2)
    expect(insertionIndexAfterCurrentUnit([], 0, 0)).toBe(0)
  })

  it('finds the next unfinished unit, skips completed units, and wraps once', () => {
    const entries = [entry([false]), entry([true]), entry([false]), entry([true])]
    const units = [[0], [1], [2, 3]]
    expect(nextUnfinishedUnit(entries, units, 0)).toEqual([2, 3])
    expect(nextUnfinishedUnit(entries, units, 2)).toEqual([0])
  })

  it('returns null only when every unit is complete', () => {
    const entries = [entry([true]), entry([true])]
    expect(nextUnfinishedUnit(entries, [[0], [1]], 1)).toBeNull()
  })
})

// Issue #3 has two halves. restAfterSet covers "no break after the LAST set of an exercise";
// this covers "after the first set, sometimes a break doesn't appear" — the uncheck/re-check
// that the high-water rule swallows.
describe('rest on a re-check', () => {
  it('starts the rest a swallowed re-check would otherwise cost you', () => {
    expect(restOnRecheck({ timerRunning: false, unitDone: false, lastUnit: false })).toBe(true)
  })

  it('leaves a rest that is already counting alone', () => {
    expect(restOnRecheck({ timerRunning: true, unitDone: false, lastUnit: false })).toBe(false)
  })

  it('still stays quiet on the last set of the last exercise', () => {
    expect(restOnRecheck({ timerRunning: false, unitDone: true, lastUnit: true })).toBe(false)
  })

  it('rests after closing an exercise that is not the last one', () => {
    expect(restOnRecheck({ timerRunning: false, unitDone: true, lastUnit: false })).toBe(true)
  })
})

// Issue #10: a routine can give an exercise its own rest, and the global timer stops being the
// only answer. The resolution is the whole feature — the UI just writes the number down.
describe('restSecFor', () => {
  // 0: no rest of its own, 1: 180 s, 2: 45 s — a heavy pull, a light accessory, a plain one.
  const entries = [
    { id: 'a', target: { mode: 'reps' } },
    { id: 'b', target: { mode: 'reps', restSec: 180 } },
    { id: 'c', target: { mode: 'reps', restSec: 45 } },
  ]

  it('prefers the exercise’s own rest over the global default', () => {
    expect(restSecFor(entries, [1], 90)).toBe(180)
    expect(restSecFor(entries, [2], 90)).toBe(45)
  })

  it('falls back to the global default when the exercise sets none', () => {
    expect(restSecFor(entries, [0], 90)).toBe(90)
  })

  it('gives a superset the longest rest its members asked for', () => {
    // Not the member that closed the round, and not the shortest: the group rests once, and
    // the 180 s exercise is the one still recovering when the 45 s one is ready to go again.
    expect(restSecFor(entries, [1, 2], 90)).toBe(180)
    // A member with no rest of its own pulls in the global, which can be the longest of all.
    expect(restSecFor(entries, [0, 2], 90)).toBe(90)
  })

  it('honours an explicit rest even with the global timer switched off', () => {
    expect(restSecFor(entries, [1], 0)).toBe(180)
    expect(restSecFor(entries, [0, 1], 0)).toBe(180)
  })

  it('stays off when the timer is off and nothing asked for a rest', () => {
    expect(restSecFor(entries, [0], 0)).toBe(0)
    expect(restSecFor(entries, [0, 0], 0)).toBe(0)
  })

  it('survives a missing unit or entry rather than timing NaN', () => {
    expect(restSecFor(entries, null, 90)).toBe(90)
    expect(restSecFor(entries, [], 90)).toBe(90)
    expect(restSecFor(entries, [7], 90)).toBe(90)
    expect(restSecFor(undefined, [0], undefined)).toBe(0)
  })
})
