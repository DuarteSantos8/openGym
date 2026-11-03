// @vitest-environment happy-dom
// update() hands its producer a copy-on-access draft (draftOf): a field the producer reads or
// writes is a deep copy, every other field stays the previous state's own object. What it must
// keep from the old full clone: the previous state is never changed, a change lands, and what is
// saved is the same document a full clone would have saved.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))

import { draftOf, useStore } from './useStore.js'

const base = () => ({ unit: 'kg', n: 3, gone: undefined, bad: NaN, workouts: [{ id: 'w1', sets: [1, 2] }], active: { cur: 0, entries: [{ id: 'a', sets: [] }] }, week: { 1: 'r1' } })

describe('draftOf', () => {
  it('shares untouched fields, copies touched ones, and leaves the previous state alone', () => {
    const prev = base()
    const d = draftOf(prev)
    d.S.active.cur = 2
    d.S.active.entries[0].sets.push({ w: 50 })
    const S = d.done()
    expect(S.workouts).toBe(prev.workouts)
    expect(S.week).toBe(prev.week)
    expect(S.active).not.toBe(prev.active)
    expect(prev.active).toEqual({ cur: 0, entries: [{ id: 'a', sets: [] }] })
    expect(S.active.entries[0].sets).toEqual([{ w: 50 }])
  })

  it('writes the same document a full JSON clone would', () => {
    const prev = base()
    const d = draftOf(prev)
    d.S.unit = 'lb'
    d.S.workouts.push({ id: 'w2' })
    const S = d.done()
    const full = JSON.parse(JSON.stringify(prev)); full.unit = 'lb'; full.workouts.push({ id: 'w2' })
    expect(JSON.stringify(S)).toBe(JSON.stringify(full))
    expect(prev.workouts).toHaveLength(1)
    expect('gone' in S).toBe(false)
    expect(S.bad).toBeNull()
  })

  it('takes assignments and deletions of fields never read', () => {
    const prev = base()
    const d = draftOf(prev)
    d.S.week = { 2: 'r2' }
    delete d.S.workouts
    d.S.added = { x: 1 }
    const S = d.done()
    expect(S.week).toEqual({ 2: 'r2' })
    expect('workouts' in S).toBe(false)
    expect(S.added).toEqual({ x: 1 })
    expect(prev.week).toEqual({ 1: 'r1' })
    expect(Object.keys(S)).toEqual(['unit', 'n', 'bad', 'active', 'week', 'added'])
  })

  it('keeps the history of a ticked set the same object through update()', () => {
    useStore.getState().update(s => { s.workouts = [{ id: 'w1', d: '2026-10-01', exercises: [] }]; s.active = { cur: 0, entries: [] } }, false)
    const before = useStore.getState().S
    useStore.getState().update(s => { s.active.cur = 1 }, false)
    const after = useStore.getState().S
    expect(after).not.toBe(before)
    expect(after.workouts).toBe(before.workouts)
    expect(after.active.cur).toBe(1)
    expect(before.active.cur).toBe(0)
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active.cur).toBe(1)
  })
})
