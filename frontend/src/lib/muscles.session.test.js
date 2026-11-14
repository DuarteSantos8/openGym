import { describe, it, expect } from 'vitest'
import { EXIDX } from './exercises.js'
import { MUSCLES, musclesOf, sessionLoad, sessionLevels, loadOfWorkouts } from './muscles.js'

// #670: the live workout's map. `done` is what the ticked sets hit, `planned` the whole session.
const SQUAT = '0043'
const BENCH = '0289'
const top = id => Object.entries(musclesOf(EXIDX[id])).sort((a, b) => b[1] - a[1])[0][0]
const set = (done, extra = {}) => ({ w: 20, r: 8, done, ...extra })

describe('sessionLoad', () => {
  it('counts ticked working sets as done and every working set as planned, never warm-ups', () => {
    const entries = [
      { id: BENCH, sets: [set(true, { warmup: true }), set(true), set(false), set(false)] },
      { id: SQUAT, sets: [set(false), set(false)] },
    ]
    const { done, planned } = sessionLoad(entries)
    const chest = top(BENCH)
    const quads = top(SQUAT)
    expect(done[chest]).toBeCloseTo(musclesOf(EXIDX[BENCH])[chest] * 1)
    expect(planned[chest]).toBeCloseTo(musclesOf(EXIDX[BENCH])[chest] * 3)
    expect(done[quads] || 0).toBe(0)
    expect(planned[quads]).toBeGreaterThan(0)
  })

  it('a session with every set ticked matches its finished workout map', () => {
    const entries = [{ id: BENCH, sets: [set(true, { warmup: true }), set(true), set(true)] }, { id: SQUAT, sets: [set(true)] }]
    const { done, planned } = sessionLoad(entries)
    expect(done).toEqual(loadOfWorkouts([{ entries }]))
    expect(planned).toEqual(done)
  })

  it('copes with no session at all', () => {
    expect(sessionLoad(undefined)).toEqual({ done: {}, planned: {} })
  })
})

describe('sessionLevels', () => {
  it('shows what is still to come faintly and what is done brighter', () => {
    const chest = top(BENCH)
    const quads = top(SQUAT)
    const fresh = sessionLevels(sessionLoad([{ id: BENCH, sets: [set(false), set(false)] }, { id: SQUAT, sets: [set(false), set(false)] }]))
    expect(fresh[chest]).toBe(1)
    expect(fresh[quads]).toBe(1)
    const unplanned = MUSCLES.find(m => !musclesOf(EXIDX[BENCH])[m] && !musclesOf(EXIDX[SQUAT])[m])
    expect(fresh[unplanned]).toBe(0)

    // one set of four: worked, but not yet the full accent
    const oneSet = sessionLevels(sessionLoad([{ id: BENCH, sets: [set(true), set(false), set(false), set(false)] }, { id: SQUAT, sets: [set(false), set(false)] }]))
    expect(oneSet[chest]).toBe(3)
    expect(oneSet[quads]).toBe(1)

    const finished = sessionLevels(sessionLoad([{ id: BENCH, sets: [set(true), set(true), set(true), set(true)] }, { id: SQUAT, sets: [set(false), set(false)] }]))
    expect(finished[chest]).toBe(4)
    expect(finished[quads]).toBe(1)
  })
})
