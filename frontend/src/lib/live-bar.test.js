import { describe, expect, it } from 'vitest'
import { liveBarShows, liveBarState } from './live-bar.js'

// The live workout bar: when it shows and what it says, worked out from the session (lib/live-bar.js).
const set = (over = {}) => ({ w: 60, r: 8, done: false, ...over })
const entry = (id, sets, over = {}) => ({ id, target: { mode: 'reps', name: id.toUpperCase(), restSec: 120 }, sets, ...over })
const S = (active, over = {}) => ({ unit: 'kg', restSec: 90, active, ...over })
const lifting = (over = {}) => ({ id: 'w1', name: 'Push day', start: 1000, cur: 0, entries: [entry('bench', [set({ done: true }), set(), set(), set()])], ...over })

describe('liveBarShows', () => {
  it('is true for a started workout away from the workout screen', () => {
    expect(liveBarShows(S(lifting()), '/home')).toBe(true)
  })
  it('is false on the workout screen, when editing, backfilling, not started, or with no workout', () => {
    expect(liveBarShows(S(lifting()), '/workout')).toBe(false)
    expect(liveBarShows(S(lifting({ editingWorkoutId: 'x' })), '/home')).toBe(false)
    expect(liveBarShows(S(lifting({ backfill: true })), '/home')).toBe(false)
    expect(liveBarShows(S(lifting({ start: 0 })), '/home')).toBe(false)
    expect(liveBarShows(S(null), '/home')).toBe(false)
  })
})

describe('liveBarState', () => {
  it('is null without a workout', () => {
    expect(liveBarState(S(null))).toBeNull()
  })
  it('lifting: the exercise, the next set, no rest, progress by sets done', () => {
    const b = liveBarState(S(lifting()))
    expect(b).toMatchObject({ routine: 'Push day', exercise: 'BENCH', set: { n: 2, of: 4 }, allDone: false, rest: null, done: 1, total: 4, progress: 0.25, start: 1000, pausedAt: 0 })
  })
  it('rest counting: the countdown, progress by time left, and what is next', () => {
    const b = liveBarState(S(lifting()), { timer: { left: 72, total: 90, endsAt: 5000, forIdx: 0 } })
    expect(b.rest).toEqual({ left: 72 })
    expect(b.progress).toBe(0.8)
    expect(b.next).toBe('BENCH')
  })
  it('a paused workout keeps its stop time, and a paused rest keeps its time left', () => {
    const b = liveBarState(S(lifting({ pausedAt: 4000 })), { timer: { left: 72, total: 90, endsAt: 5000, forIdx: 0, paused: true } })
    expect(b.rest.left).toBe(72)
    expect(b.pausedAt).toBe(4000)
  })
  it('no exercises and no name: fallbacks, never NaN', () => {
    const b = liveBarState(S(lifting({ entries: [], name: '' })))
    expect(b).toMatchObject({ routine: '', exercise: '', set: null, allDone: false, progress: 0, done: 0, total: 0 })
  })
  it('every set done: all done, no exercise line', () => {
    const b = liveBarState(S(lifting({ entries: [entry('bench', [set({ done: true }), set({ done: true })])] })))
    expect(b).toMatchObject({ allDone: true, exercise: '', set: null, progress: 1 })
  })
  it('a rest that ran out (ready, or left 0) is no rest', () => {
    expect(liveBarState(S(lifting()), { timer: { left: 30, total: 90, endsAt: 5000, forIdx: 0, ready: true } }).rest).toBeNull()
    const b = liveBarState(S(lifting()), { timer: { left: 0, total: 90, endsAt: 5000, forIdx: 0 } })
    expect(b.rest).toBeNull()
    expect(b.progress).toBe(0.25)
  })
  it('a superset: during rest the next exercise is the other one', () => {
    const A = lifting({ entries: [entry('a', [set({ done: true }), set()], { sg: 'g' }), entry('b', [set(), set()], { sg: 'g' })] })
    const b = liveBarState(S(A), { timer: { left: 60, total: 90, endsAt: 5000, forIdx: 0 } })
    expect(b.next).toBe('B')
    expect(b.exercise).toBe('B')
  })
  it('a warm-up set has no set number', () => {
    const A = lifting({ entries: [entry('bench', [set({ warmup: true }), set(), set()])] })
    const b = liveBarState(S(A))
    expect(b.set).toBeNull()
    expect(b.exercise).toBe('BENCH')
  })

  describe('pulse and watch', () => {
    const watch = state => ({ rows: [{ id: 'watch', kind: 'apple', state }] })
    it('a live reading gives the bpm', () => {
      const b = liveBarState(S(lifting()), { live: { bpm: 132 } })
      expect(b.bpm).toBe(132)
      expect(b.pulseSlot).toBe(true)
    })
    it('no reading and no watch: no slot, no device', () => {
      expect(liveBarState(S(lifting()))).toMatchObject({ bpm: null, pulseSlot: false, device: null })
    })
    it('a linked watch with no reading reserves the slot', () => {
      expect(liveBarState(S(lifting()), watch('live'))).toMatchObject({ bpm: null, pulseSlot: true, device: 'linked' })
    })
    it('maps every watch state', () => {
      const dev = st => liveBarState(S(lifting()), watch(st)).device
      expect(dev('live')).toBe('linked')
      expect(dev('delayed')).toBe('relinking')
      expect(dev('notAnswering')).toBe('relinking')
      expect(dev('offline')).toBe('none')
      expect(dev('notFound')).toBe('none')
    })
    it('checking with no watch row', () => {
      expect(liveBarState(S(lifting()), { checking: true }).device).toBe('checking')
    })
  })
})
