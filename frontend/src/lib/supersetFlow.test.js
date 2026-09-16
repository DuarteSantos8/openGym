import { describe, expect, it } from 'vitest'
import { insertionIndexAfterCurrentUnit, nextUnfinishedUnit, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor, warmupRestSecFor, restKind, restFocusIdx, restSetPhase } from './supersetFlow.js'

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

// The rest-over sound says what comes next without a look at the screen. The kind is decided
// here, beside restAfterSet, so the four places that start a rest cannot drift apart.
describe('restKind', () => {
  it('between the sets of an ordinary exercise: set', () => {
    expect(restKind({ unitDone: false, superset: false })).toBe('set')
  })

  it('after a superset round, and on a re-check inside an unfinished superset: round', () => {
    expect(restKind({ unitDone: false, superset: true })).toBe('round')
  })

  it('after the closing set of an exercise or superset when more follows: block', () => {
    expect(restKind({ unitDone: true, superset: false })).toBe('block')
    expect(restKind({ unitDone: true, superset: true })).toBe('block')
  })
})

// What the bar names and the list scrolls to while a rest runs (see RestTimer.jsx, Workout.jsx).
describe('restFocusIdx', () => {
  const entries = [entry([true, true]), entry([true, false]), entry([false, false]), entry([false])]
  const units = [[0], [1, 2], [3]]   // 1+2 are a superset

  it('set: the exercise itself', () => {
    expect(restFocusIdx(entries, units, 3, 'set')).toBe(3)
    expect(restFocusIdx(entries, units, 2, 'set')).toBe(2)
  })

  it('round: the first member of the superset, wherever the round ended', () => {
    expect(restFocusIdx(entries, units, 2, 'round')).toBe(1)
    expect(restFocusIdx(entries, units, 1, 'round')).toBe(1)
  })

  it('round: skips a partner whose sets ran out, so it never points at finished work', () => {
    // A group whose members have different set counts: 'a' had one set, 'b' has two. After b's
    // first set the round is over, but the top of the group is spent — the only work left is
    // b's own second set, and that is where the rest points.
    const uneven = [entry([true]), entry([true, false])]
    expect(restFocusIdx(uneven, [[0, 1]], 1, 'round')).toBe(1)
  })

  it('round: the whole group finished falls back to its first member', () => {
    const spent = [entry([true]), entry([true])]
    expect(restFocusIdx(spent, [[0, 1]], 1, 'round')).toBe(0)
  })

  it('block: the first member of the next unfinished unit, wrapping', () => {
    expect(restFocusIdx(entries, units, 0, 'block')).toBe(1)
    expect(restFocusIdx(entries, units, 3, 'block')).toBe(1)   // wraps past the finished first exercise
  })

  it('block with nothing left: the finished exercise itself', () => {
    const done = [entry([true]), entry([true])]
    expect(restFocusIdx(done, [[0], [1]], 1, 'block')).toBe(1)
  })

  it('no kind: the exercise itself', () => {
    expect(restFocusIdx(entries, units, 2, undefined)).toBe(2)
  })
})

// The bar tells a warm-up rest from a working rest (a routine with ramp rows rests 45 s after a
// warm-up set, then the working rest) by the set the rest leads into: the first unfinished one
// after the set just checked.
describe('restSetPhase', () => {
  const ramped = done => ({ sets: [
    { w: 60, r: 8, done: done[0], phase: 'warmup' },
    { w: 95, r: 5, done: done[1], phase: 'warmup' },
    { w: 125, r: 6, done: done[2] },
    { w: 125, r: 6, done: done[3] },
  ] })

  it('warm-up while the next set is a ramp set', () => {
    expect(restSetPhase(ramped([true, false, false, false]), 0)).toBe('warmup')
  })

  it('work once the ramp is done and working sets follow', () => {
    expect(restSetPhase(ramped([true, true, false, false]), 1)).toBe('work')
    expect(restSetPhase(ramped([true, true, true, false]), 2)).toBe('work')
  })

  it('a skipped ramp row does not turn a working rest into a warm-up one', () => {
    // ramp 2 left unticked, working set 1 just checked: the rest leads into working set 2.
    expect(restSetPhase(ramped([true, false, true, false]), 2)).toBe('work')
  })

  it('never null on an exercise that has ramp rows, even after its last set', () => {
    expect(restSetPhase(ramped([true, true, true, true]), 3)).toBe('work')
  })

  it('nothing to say for an exercise without warm-up rows, or no entry', () => {
    expect(restSetPhase({ sets: [{ done: true }, { done: false }] }, 0)).toBe(null)
    expect(restSetPhase(undefined, 0)).toBe(null)
  })

  it('reads the legacy warmup flag too', () => {
    expect(restSetPhase({ sets: [{ done: true, warmup: true }, { done: false, warmup: true }, { done: false }] }, 0)).toBe('warmup')
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

describe('warmupRestSecFor', () => {
  const ramp = (warmupRestSec, done = [false, false, false, false]) => ({
    target: { restSec: 150, ...(warmupRestSec ? { warmupRestSec } : {}) },
    sets: [
      { phase: 'warmup', w: 60, r: 8, done: done[0] },
      { phase: 'warmup', w: 95, r: 5, done: done[1] },
      { phase: 'work', w: 125, r: 6, done: done[2] },
      { phase: 'work', w: 125, r: 6, done: done[3] },
    ],
  })

  it('rests the warm-up rest between ramp sets', () => {
    expect(warmupRestSecFor(ramp(45), 0, 150)).toBe(45)
  })

  it('rests the working rest after the last ramp set, into the first work set', () => {
    expect(warmupRestSecFor(ramp(45), 1, 150)).toBe(150)
  })

  it('rests the working rest after a work set', () => {
    expect(warmupRestSecFor(ramp(45), 2, 150)).toBe(150)
    expect(warmupRestSecFor(ramp(45), 3, 150)).toBe(150)
  })

  it('without the field a ramp set rests like a work set (the pre-field behaviour)', () => {
    expect(warmupRestSecFor(ramp(null), 0, 150)).toBe(150)
    expect(warmupRestSecFor({ target: { warmupRestSec: 0 }, sets: ramp(null).sets }, 0, 90)).toBe(90)
  })

  it('looks at the next UNFINISHED set: a ramp set re-checked after the work began rests the working rest', () => {
    expect(warmupRestSecFor(ramp(45, [true, true, false, false]), 0, 150)).toBe(150)
  })

  it('is safe on a legacy warmup boolean and on missing entries', () => {
    const legacy = { target: { warmupRestSec: 45 }, sets: [{ warmup: true, done: false }, { warmup: true, done: false }, { done: false }] }
    expect(warmupRestSecFor(legacy, 0, 120)).toBe(45)
    expect(warmupRestSecFor(undefined, 0, 120)).toBe(120)
    expect(warmupRestSecFor({ target: {}, sets: [] }, 0, 120)).toBe(120)
  })
})
