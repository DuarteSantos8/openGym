import { describe, it, expect } from 'vitest'
import { setTypeOf, setTypeAt, canTypeWarmupAt } from './history.js'
import { isWarmupRow } from './workout-model.js'

const work = (w, r, extra = {}) => ({ w, r, done: false, ...extra })
const warm = (w, r) => ({ w, r, done: false, phase: 'warmup', warmup: true })

describe('set type', () => {
  it('reads W, F or a plain number off a row', () => {
    expect(setTypeOf(warm(20, 10))).toBe('warmup')
    expect(setTypeOf(work(60, 8, { failure: true }))).toBe('failure')
    expect(setTypeOf(work(60, 8))).toBe('normal')
  })

  it('marks a work set as taken to failure and back, leaving the others alone', () => {
    const rows = [work(60, 8), work(60, 8)]
    const f = setTypeAt(rows, 1, 'failure')
    expect(f[1].failure).toBe(true)
    expect(f[0]).toBe(rows[0])
    const back = setTypeAt(f, 1, 'normal')
    expect('failure' in back[1]).toBe(false)
  })

  it('turns a work set into a warm-up in front of the work sets, dropping its failure mark', () => {
    const rows = [warm(20, 10), work(60, 8), work(70, 6, { failure: true })]
    const out = setTypeAt(rows, 2, 'warmup')
    expect(out.map(isWarmupRow)).toEqual([true, true, false])
    expect(out[1]).toEqual({ w: 70, r: 6, done: false, phase: 'warmup', warmup: true })
  })

  it('takes a warm-up straight to a failure set, as the first work set', () => {
    const rows = [warm(20, 10), warm(40, 8), work(60, 8)]
    const out = setTypeAt(rows, 0, 'failure')
    expect(out.map(isWarmupRow)).toEqual([true, false, false])
    expect(out[1]).toEqual({ w: 20, r: 10, done: false, failure: true })
    expect(out[2].failure).toBeUndefined()
  })

  it('changes nothing when the set already is that type', () => {
    const rows = [work(60, 8)]
    expect(setTypeAt(rows, 0, 'normal')).toBe(rows)
    expect(setTypeAt(rows, 5, 'failure')).toBe(rows)
  })

  it('marks both halves of a timed per-side pair', () => {
    const rows = [{ t: 30, side: 'L', done: false }, { t: 30, side: 'R', done: false }]
    const out = setTypeAt(rows, 1, 'failure')
    expect(out.every(x => x.failure === true)).toBe(true)
  })

  it('never lets the last work set, a drop set or a timed set become a warm-up', () => {
    expect(canTypeWarmupAt([warm(20, 10), work(60, 8)], 1, 'reps')).toBe(false)
    expect(canTypeWarmupAt([work(60, 8), work(60, 8)], 1, 'reps')).toBe(true)
    expect(canTypeWarmupAt([work(60, 8), work(60, 8)], 1, 'time')).toBe(false)
    expect(canTypeWarmupAt([work(60, 8), work(60, 8, { type: 'dropset', drops: [{ w: 50, r: 6 }] })], 1, 'reps')).toBe(false)
  })
})
