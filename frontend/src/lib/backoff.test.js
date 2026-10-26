// Back-off sets (lib/backoff.js): the top set is planned and progressed, every set after it is
// one step lighter, and the sequence only moves up when every planned set reached its target.
import { describe, it, expect } from 'vitest'
import { isBackoff, backoffAt, backoffWeights, applyBackoff } from './backoff.js'
import { cascadeWeight } from './history.js'
import { isWarmupRow, makeSideSet } from './workout-model.js'

const LIFT = '0025'

describe('backoffAt / backoffWeights', () => {
  it('steps each set down by the step', () => {
    expect(backoffWeights(26, 3, 2)).toEqual([26, 24, 22])
    expect(backoffWeights(80, 4, 5)).toEqual([80, 75, 70, 65])
    expect(backoffWeights(60, 3, 2.5)).toEqual([60, 57.5, 55])
  })

  it('stays on the grid the top set is on, and steps from an off-grid top set as typed', () => {
    // one decimal, the way snapWeight and every stepper in the app show a 1.25 step
    expect(backoffWeights(62.5, 3, 1.25)).toEqual([62.5, 61.3, 60])
    expect(backoffWeights(27, 3, 2)).toEqual([27, 25, 23])        // a top set off the 2 kg grid
  })

  it('never goes below one step, and never above the top set', () => {
    expect(backoffWeights(6, 5, 2)).toEqual([6, 4, 2, 2, 2])
    expect(backoffAt(1, 3, 2)).toBe(1)
  })

  it('leaves a missing load alone', () => {
    expect(backoffAt(0, 2, 2)).toBe(0)
    expect(backoffAt(30, 2, 0)).toBe(30)
  })
})

describe('isBackoff', () => {
  it('is off unless switched on, so older plans build as before', () => {
    expect(isBackoff({ id: LIFT, sets: 3, reps: 6, weight: 26 })).toBe(false)
    expect(isBackoff({ id: LIFT, sets: 3, reps: 6, weight: 26, backoff: true })).toBe(true)
  })
  it('does not apply to a timed hold, a pyramid or a rest-pause', () => {
    expect(isBackoff({ mode: 'time', backoff: true })).toBe(false)
    expect(isBackoff({ backoff: true, pyramid: [12, 10, 8] })).toBe(false)
    expect(isBackoff({ backoff: true, intensifier: { type: 'restpause' } })).toBe(false)
    expect(isBackoff({ backoff: true, intensifier: { type: 'dropset', count: 1, pct: 20 } })).toBe(true)
  })
})

describe('applyBackoff', () => {
  it('steps the work rows from the first one and leaves warm-ups and logged rows alone', () => {
    const rows = [
      { w: 10, r: 6, phase: 'warmup', done: false },
      { w: 26, r: 6, done: false },
      { w: 26, r: 6, done: true },
      { w: 26, r: 6, done: false },
    ]
    expect(applyBackoff(rows, 2).map(r => r.w)).toEqual([10, 26, 26, 22])
  })
  it('steps both sides of a per-side row', () => {
    const rows = [makeSideSet({ w: 20, r: 12 }), makeSideSet({ w: 20, r: 12 })]
    const out = applyBackoff(rows, 2)
    expect(out[1].sides.L.w).toBe(18)
    expect(out[1].sides.R.w).toBe(18)
    expect(out[1].w).toBe(18)
  })
})

// The spec's main acceptance criterion, walked through the same builder the app uses: build a
// session, do it, save it, build the next one.


describe('editing a weight mid-session', () => {
  const rows = () => [{ w: 26, r: 6, done: false }, { w: 24, r: 6, done: false }, { w: 22, r: 6, done: false }]
  it('carries a top-set change down the sequence', () => {
    expect(cascadeWeight(rows(), 0, 28, undefined, 2).map(r => r.w)).toEqual([26, 26, 24])
  })
  it('from a back-off set, steps down from there', () => {
    expect(cascadeWeight(rows(), 1, 20, undefined, 2).map(r => r.w)).toEqual([26, 24, 18])
  })
  it('keeps the old flat cascade when the session has no back-off', () => {
    expect(cascadeWeight(rows(), 0, 28).map(r => r.w)).toEqual([26, 28, 28])
  })
  it('a logged set in between keeps its place in the sequence', () => {
    const r = rows(); r[1] = { ...r[1], done: true }
    expect(cascadeWeight(r, 0, 30, undefined, 2).map(x => x.w)).toEqual([26, 24, 26])
  })
})
