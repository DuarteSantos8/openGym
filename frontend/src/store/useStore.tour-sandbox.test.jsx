// @vitest-environment happy-dom

/* The tour's practice workout (enterTourSandbox): the store shows a copy with a sample session
   in it, and nothing of that copy is ever saved or synced. Leaving hands back the real copy as it
   was, and a push that was waiting goes then. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const sample = s => {
  s.routines = [...s.routines, { id: 'tour-sample', name: 'Practice', ex: [{ id: '0025', sets: 3, reps: 8, weight: 20 }] }]
  s.active = { id: 'tour-run', d: '2026-10-26', start: 1, routineIds: ['tour-sample'], name: 'Practice', cur: 0, entries: [], tour: true }
}

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  api.mockResolvedValue({ rev: 1 })
  useStore.setState({ S: clone(DEF), user: { id: 'user-1' }, ready: true })
})
afterEach(() => {
  useStore.getState().leaveTourSandbox()
  vi.useRealTimers()
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('tour sandbox', () => {
  it('shows the sample session, writes none of it, and gives the real copy back untouched', async () => {
    useStore.getState().update(s => { s.routines = [{ id: 'r1', name: 'Mine', ex: [] }] }, false)
    const real = useStore.getState().S
    const saved = localStorage.getItem('gym_state_v1')
    api.mockClear()

    useStore.getState().enterTourSandbox(sample)
    expect(useStore.getState().tourSandbox).toBe(true)
    expect(useStore.getState().S.active.tour).toBe(true)
    // the screens edit it like any session: ticking a set, renaming, finishing
    useStore.getState().update(s => { s.active.name = 'Renamed'; s.workouts.push({ id: 'w-tour', d: '2026-10-26', entries: [] }) })
    await useStore.getState().pushState()
    await useStore.getState().pullState()

    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
    expect(api).not.toHaveBeenCalled()

    useStore.getState().leaveTourSandbox()
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S).toBe(real)
    expect(useStore.getState().S.active).toBeFalsy()
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['r1'])
  })

  it('a push that was waiting when the tour began goes after it, with the real copy', async () => {
    vi.useFakeTimers()
    useStore.getState().update(s => { s.routines = [{ id: 'r1', name: 'Mine', ex: [] }] })
    useStore.getState().enterTourSandbox(sample)
    vi.advanceTimersByTime(5000)
    expect(api.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0)

    useStore.getState().leaveTourSandbox()
    vi.advanceTimersByTime(2000)
    await vi.runOnlyPendingTimersAsync()
    const puts = api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
    expect(puts.length).toBeGreaterThan(0)
    const body = puts.at(-1)
    const state = body.state || body
    expect(state.active ?? null).toBe(null)
    expect(state.routines.map(r => r.id)).toEqual(['r1'])
  })

  it('entering twice keeps the first real copy', () => {
    const real = useStore.getState().S
    useStore.getState().enterTourSandbox(sample)
    useStore.getState().enterTourSandbox(s => { s.active = null })
    expect(useStore.getState().S.active.tour).toBe(true)
    useStore.getState().leaveTourSandbox()
    expect(useStore.getState().S).toBe(real)
  })
})
