import { describe, expect, it } from 'vitest'
import { insertionIndexAfterCurrentUnit, nextUnfinishedUnit, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor, warmupRestSecFor, sideRestFor, stepUnitIndex, advanceAfterTimedRest } from './supersetFlow.js'

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

describe('set-specific rests (Discord: rest for warm-ups and between sides)', () => {
  const ramp = target => ({ target, sets: [{ phase: 'warmup', done: false }, { phase: 'warmup', done: false }, { done: false }] })
  it('"no timer" between ramp sets is 0; the last ramp set still rests the work rest', () => {
    expect(warmupRestSecFor(ramp({ warmupRestOff: true, warmupRestSec: 45 }), 0, 150)).toBe(0)
    expect(warmupRestSecFor(ramp({ warmupRestOff: true }), 1, 150)).toBe(150)
  })
  it('anything but true is not "no timer": the old behaviour', () => {
    for (const v of [false, 'true', 1, null]) expect(warmupRestSecFor(ramp({ warmupRestOff: v }), 0, 150), String(v)).toBe(150)
  })
  it('between sides: the exercise\'s own break, else what it always was', () => {
    expect(sideRestFor({ sideRestSec: 20 }, { timed: false })).toBe(20)
    expect(sideRestFor({ sideRestSec: 20 }, { timed: true, restAfter: 0, switchSec: 10 })).toBe(20)
    // without one: reps has no break, a hold the switch pause capped at its rest, none with rest off
    expect(sideRestFor({}, { timed: false })).toBeNull()
    expect(sideRestFor(undefined, { timed: true, restAfter: 90, switchSec: 10 })).toBe(10)
    expect(sideRestFor({}, { timed: true, restAfter: 5, switchSec: 10 })).toBe(5)
    expect(sideRestFor({ sideRestSec: 0 }, { timed: true, restAfter: 0, switchSec: 10 })).toBeNull()
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

  // Discord (seals187): one warm-up rest for the whole profile, S.warmupRestSec.
  it('without its own, a ramp set rests the profile\'s warm-up rest; 0 is no timer', () => {
    expect(warmupRestSecFor(ramp(null), 0, 150, 30)).toBe(30)
    expect(warmupRestSecFor(ramp(null), 0, 150, 0)).toBe(0)
    for (const v of [undefined, null, '30', NaN]) expect(warmupRestSecFor(ramp(null), 0, 150, v), String(v)).toBe(150)
  })

  it('the exercise\'s own wins over the profile\'s, its "no timer" too', () => {
    expect(warmupRestSecFor(ramp(45), 0, 150, 30)).toBe(45)
    expect(warmupRestSecFor({ target: { warmupRestOff: true }, sets: ramp(null).sets }, 0, 150, 30)).toBe(0)
  })

  it('the profile\'s never touches the last ramp set or a work set', () => {
    expect(warmupRestSecFor(ramp(null), 1, 150, 0)).toBe(150)
    expect(warmupRestSecFor(ramp(null), 2, 150, 30)).toBe(150)
  })

  it('is safe on a legacy warmup boolean and on missing entries', () => {
    const legacy = { target: { warmupRestSec: 45 }, sets: [{ warmup: true, done: false }, { warmup: true, done: false }, { done: false }] }
    expect(warmupRestSecFor(legacy, 0, 120)).toBe(45)
    expect(warmupRestSecFor(undefined, 0, 120)).toBe(120)
    expect(warmupRestSecFor({ target: {}, sets: [] }, 0, 120)).toBe(120)
  })
})

describe('restSecFor with a pyramid set’s own rest', () => {
  const entries = [{ target: { restSec: 90 } }, { target: { restSec: 60 } }]
  it('the set’s rest stands in for its exercise’s', () => {
    expect(restSecFor(entries, [0], 120, { idx: 0, sec: 180 })).toBe(180)
    expect(restSecFor(entries, [0], 120, { idx: 0, sec: 30 })).toBe(30)
  })
  it('0 falls back to the exercise’s rest', () => {
    expect(restSecFor(entries, [0], 120, { idx: 0, sec: 0 })).toBe(90)
  })
  it('a superset still takes the longest of the group', () => {
    expect(restSecFor(entries, [0, 1], 120, { idx: 1, sec: 30 })).toBe(90)
    expect(restSecFor(entries, [0, 1], 120, { idx: 1, sec: 200 })).toBe(200)
  })
})

describe('stepUnitIndex (#523 skip completed exercises)', () => {
  const ex = (...done) => ({ sets: done.map(d => ({ done: d })) })
  const entries = [ex(true), ex(true, true), ex(false), ex(true), ex(false, true)]
  const units = [[0], [1], [2], [3], [4]]
  it('without the setting, the neighbour, -1 past either end', () => {
    expect(stepUnitIndex(entries, units, 0, 1)).toBe(1)
    expect(stepUnitIndex(entries, units, 0, -1)).toBe(-1)
    expect(stepUnitIndex(entries, units, 4, 1)).toBe(-1)
  })
  it('with it, over finished exercises both ways', () => {
    expect(stepUnitIndex(entries, units, 0, 1, true)).toBe(2)
    expect(stepUnitIndex(entries, units, 2, 1, true)).toBe(4)
    expect(stepUnitIndex(entries, units, 4, -1, true)).toBe(2)
  })
  it('everything that way finished: the neighbour after all', () => {
    expect(stepUnitIndex(entries, units, 2, -1, true)).toBe(1)
  })
  it('a superset counts as finished only when every member is', () => {
    const e2 = [ex(true), ex(true), ex(false), ex(false)]
    expect(stepUnitIndex(e2, [[0], [1, 2], [3]], 0, 1, true)).toBe(1)
  })
})

describe('advanceAfterTimedRest (#532)', () => {
  const ex = (...done) => ({ sets: done.map(d => ({ done: d })) })
  const timed = set => idx => set.includes(idx)
  it('a finished timed exercise still on screen: the next with work left', () => {
    const entries = [ex(true, true), ex(true), ex(false)]
    expect(advanceAfterTimedRest(entries, [[0], [1], [2]], 0, 0, timed([0]))).toBe(2)
  })
  it('nothing for weighted work, an unfinished one, a screen already moved on, or no work left', () => {
    const entries = [ex(true, true), ex(false)]
    const units = [[0], [1]]
    expect(advanceAfterTimedRest(entries, units, 0, 0, timed([]))).toBeNull()
    expect(advanceAfterTimedRest([ex(true, false), ex(false)], units, 0, 0, timed([0]))).toBeNull()
    expect(advanceAfterTimedRest(entries, units, 0, 1, timed([0]))).toBeNull()
    expect(advanceAfterTimedRest([ex(true), ex(true)], units, 0, 0, timed([0]))).toBeNull()
    expect(advanceAfterTimedRest(entries, units, undefined, 0, timed([0]))).toBeNull()
  })
  it('a superset only when every member is timed and done', () => {
    const entries = [ex(true), ex(true), ex(false)]
    expect(advanceAfterTimedRest(entries, [[0, 1], [2]], 1, 0, timed([0, 1]))).toBe(2)
    expect(advanceAfterTimedRest(entries, [[0, 1], [2]], 1, 0, timed([1]))).toBeNull()
  })
})

