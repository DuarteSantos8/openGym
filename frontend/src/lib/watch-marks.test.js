import { describe, expect, it } from 'vitest'
import { applyWatchMark } from './watch-marks.js'

const S = sets => ({ unit: 'kg', routines: [], active: { id: 'w', cur: 0, entries: [{ id: '0025', target: { sets: 3, reps: 8, weight: 80 }, sets }] } })
const sets = () => [{ w: 80, r: 8, done: false }, { w: 80, r: 8, done: false }, { w: 80, r: 8, done: false }]
const rows = s => s.active.entries[0].sets

describe('the watch\'s marks on the phone', () => {
  it('failure on and off', () => {
    const s = S(sets())
    expect(applyWatchMark(s, 0, 1, { failure: true })).toBe(true)
    expect(rows(s)[1].failure).toBe(true)
    expect(applyWatchMark(s, 0, 1, { failure: true })).toBe(false)
    applyWatchMark(s, 0, 1, { failure: false })
    expect(rows(s)[1].failure).toBeUndefined()
  })
  it('drop on adds one drop; off removes it; off with two is a no-op', () => {
    const s = S(sets())
    applyWatchMark(s, 0, 0, { drop: true })
    expect(rows(s)[0].type).toBe('dropset')
    expect(rows(s)[0].drops).toHaveLength(1)
    expect(applyWatchMark(s, 0, 0, { drop: true })).toBe(false)
    rows(s)[0].drops.push({ w: 30, r: 5 })
    expect(applyWatchMark(s, 0, 0, { drop: false })).toBe(false)
    expect(rows(s)[0].drops).toHaveLength(2)
    rows(s)[0].drops.pop()
    applyWatchMark(s, 0, 0, { drop: false })
    expect(rows(s)[0].type).toBe('straight')
  })
  it('warm-up on the last work set is a no-op; on another set it moves the row to the front', () => {
    const one = S([{ w: 80, r: 8, done: false }])
    expect(applyWatchMark(one, 0, 0, { warmup: true })).toBe(false)
    const s = S(sets())
    expect(applyWatchMark(s, 0, 2, { warmup: true })).toBe(true)
    expect(rows(s)[0].phase).toBe('warmup')
    expect(applyWatchMark(s, 0, 0, { warmup: false })).toBe(true)
    expect(rows(s).some(r => r.phase === 'warmup')).toBe(false)
  })
  it('a done set can be made a warm-up and back, still done', () => {
    const s = S([{ w: 80, r: 8, done: true }, { w: 80, r: 8, done: false }])
    expect(applyWatchMark(s, 0, 0, { warmup: true })).toBe(true)
    expect(rows(s)[0]).toMatchObject({ phase: 'warmup', w: 80, r: 8, done: true })
    expect(applyWatchMark(s, 0, 0, { warmup: false })).toBe(true)
    expect(rows(s)[0]).toMatchObject({ w: 80, r: 8, done: true })
    expect(rows(s)[0].phase).toBeUndefined()
  })
  it('no drop or failure on a warm-up, and a missing set is ignored', () => {
    const s = S([{ w: 40, r: 10, done: false, phase: 'warmup' }, { w: 80, r: 8, done: false }])
    expect(applyWatchMark(s, 0, 0, { drop: true })).toBe(false)
    expect(applyWatchMark(s, 0, 0, { failure: true })).toBe(false)
    expect(applyWatchMark(s, 0, 9, { failure: true })).toBe(false)
  })
})
