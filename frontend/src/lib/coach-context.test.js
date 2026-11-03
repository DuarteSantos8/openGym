import { describe, expect, it } from 'vitest'
import { todayForCoach } from './coach-context.js'

const set = (w, r, done = true) => ({ w, r, done })
const active = {
  id: 'w1', d: '2026-10-13', start: 1, name: 'Tuesday', cur: 0,
  entries: [{ id: 'legext', rid: 'tue', extra: true, target: { sets: 3, reps: 10 }, note: 'secret', media: [{ hash: 'x' }],
    sets: [{ ...set(45, 12), phase: 'warmup' }, set(45, 12)] }],
}

describe('the running session the Coach is given', () => {
  it('carries the numbers and the extra mark, nothing else', () => {
    const today = todayForCoach({ active }, 1 + 25 * 60000)
    expect(today.minutes).toBe(25)
    expect(today.entries[0]).toEqual({ id: 'legext', extra: true, target: { sets: 3, reps: 10, sec: undefined, weight: undefined }, sets: [{ done: true, warmup: true, w: 45, r: 12 }, { done: true, w: 45, r: 12 }] })
    expect(JSON.stringify(today)).not.toContain('secret')
  })
  it('nothing when there is no session, or it is an edit of a past one', () => {
    expect(todayForCoach({})).toBeNull()
    expect(todayForCoach({ active: { ...active, editingWorkoutId: 'w0' } })).toBeNull()
  })
})
