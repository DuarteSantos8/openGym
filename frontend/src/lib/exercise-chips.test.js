import { describe, expect, it } from 'vitest'
import { entryProgress, exerciseChips } from './exercise-chips.js'

const ex = (sets, extra = {}) => ({ id: 'x', sets: sets.map(done => ({ w: 60, r: 5, done })), ...extra })

describe('exercise chips (#323)', () => {
  it('reads an exercise as waiting, started or finished', () => {
    expect(entryProgress(ex([false, false]))).toBe('todo')
    expect(entryProgress(ex([true, false]))).toBe('partial')
    expect(entryProgress(ex([true, true]))).toBe('done')
    expect(entryProgress(ex([]))).toBe('todo')
    expect(entryProgress(undefined)).toBe('todo')
  })

  it('calls an exercise finished once its work sets are, whatever a skipped warm-up says', () => {
    const e = { id: 'x', sets: [{ w: 20, r: 8, phase: 'warmup', done: false }, { w: 60, r: 5, done: true }] }
    expect(entryProgress(e)).toBe('done')
    // a ticked warm-up alone is a start
    expect(entryProgress({ id: 'x', sets: [{ w: 20, r: 8, phase: 'warmup', done: true }, { w: 60, r: 5, done: false }] })).toBe('partial')
  })

  it('counts one side of a per-side set as a start', () => {
    const e = { id: 'x', sets: [{ done: false, w: 10, r: 16, sides: { L: { w: 10, r: 8, done: true }, R: { w: 10, r: 8, done: false } } }] }
    expect(entryProgress(e)).toBe('partial')
  })

  it('gives a superset one chip, done only when every member is, and marks the current unit', () => {
    const entries = [ex([true]), ex([true], { sg: 'a' }), ex([false], { sg: 'a' }), ex([false])]
    const chips = exerciseChips(entries, 2)
    expect(chips.map(c => [c.key, c.n, c.state, c.current])).toEqual([
      ['0', 1, 'done', false],
      ['1-2', 2, 'partial', true],
      ['3', 3, 'todo', false],
    ])
    expect(exerciseChips([ex([true], { sg: 'a' }), ex([true], { sg: 'a' })], 0)[0].state).toBe('done')
    expect(exerciseChips(null, 0)).toEqual([])
  })
})
