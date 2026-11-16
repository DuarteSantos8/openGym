import { describe, expect, it } from 'vitest'
import { askEffortFirst } from './effort-ask.js'

const S = { effort: 'rir', effortAsk: true }
const set = (o = {}) => ({ w: 60, r: 8, done: false, ...o })

describe('askEffortFirst', () => {
  it('asks before a working set is ticked, in the profile’s scale', () => {
    expect(askEffortFirst(S, set())).toBe('rir')
    expect(askEffortFirst({ ...S, effort: 'rpe' }, set())).toBe('rpe')
  })
  it('never asks with the choice off or no effort scale', () => {
    expect(askEffortFirst({ effort: 'rir' }, set())).toBe(null)
    expect(askEffortFirst({ effort: 'none', effortAsk: true }, set())).toBe(null)
    expect(askEffortFirst(null, set())).toBe(null)
  })
  it('lets an untick, a rated set, a warm-up, a hold and cardio through', () => {
    expect(askEffortFirst(S, set({ done: true }))).toBe(null)
    expect(askEffortFirst(S, set({ rir: 2 }))).toBe(null)
    expect(askEffortFirst(S, set({ rir: 0 }))).toBe(null)
    expect(askEffortFirst(S, set({ warmup: true }))).toBe(null)
    expect(askEffortFirst(S, set(), null, 'time')).toBe(null)
    expect(askEffortFirst(S, set(), null, 'cardio')).toBe(null)
  })
  it('asks per side, for the side being ticked', () => {
    const row = set({ sides: { L: { r: 8, done: true, rir: 2 }, R: { r: 8, done: false } } })
    expect(askEffortFirst(S, row, 'R')).toBe('rir')
    expect(askEffortFirst(S, row, 'L')).toBe(null)
  })
})
