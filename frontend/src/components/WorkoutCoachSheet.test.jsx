// @vitest-environment happy-dom
// "Ask the Coach" on an exercise mid-workout: the question goes out with the exercise and the
// reason, and the answer comes back as cards that change only this workout when applied.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const m = { S: null, pending: null, job: null, last: null, toast: vi.fn(), refresh: vi.fn() }
  m.store = () => ({ S: m.S, update: fn => { fn(m.S) } })
  m.ui = () => ({ toast: m.toast, stopWork: vi.fn(), timer: null })
  return m
})
vi.mock('../store/useStore.js', () => {
  const useStore = sel => sel(mocks.store())
  useStore.getState = mocks.store
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = sel => (sel ? sel(mocks.ui()) : mocks.ui())
  useUI.getState = mocks.ui
  useUI.setState = vi.fn()
  return { useUI }
})
vi.mock('../lib/coach-api.js', () => ({
  useCoachStatus: () => ({ pending: mocks.pending, job: mocks.job, last: mocks.last, lastError: null, refresh: mocks.refresh }),
  requestAdapt: vi.fn(() => Promise.resolve({ job: { id: 'j1' } })),
  resolvePending: vi.fn(() => Promise.resolve({})),
  jobErrorText: c => 'error ' + c,
  isDeclined: e => e?.code === 'declined',
}))
vi.mock('../coach.css', () => ({}))

const api = await import('../lib/coach-api.js')
const { default: WorkoutCoachSheet, AdaptProposal } = await import('./WorkoutCoachSheet.jsx')

const BENCH = '0025', CURL = '0294'
const state = () => ({
  unit: 'kg', exWeights: {}, workouts: [], routines: [{ id: 'push', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 80 }, { id: CURL, sets: 3, reps: 10, weight: 14 }] }],
  coach: { log: [], snapshots: [] },
  active: { id: 'act-1', cur: 0, entries: [
    { id: BENCH, rid: 'push', target: { sets: 3, reps: 5, weight: 80 }, sets: [{ w: 80, r: 5, done: true }, { w: 80, r: 5, done: false }, { w: 80, r: 5, done: false }] },
    { id: CURL, rid: 'push', target: { sets: 3, reps: 10, weight: 14 }, sets: [{ w: 14, r: 10, done: false }, { w: 14, r: 10, done: false }] },
  ] },
})
const adapt = (extra = {}) => ({
  id: 'p1', kind: 'adapt', activeId: 'act-1', summary: 'Short on time: trim the curls.', focus: { entry: 1, exId: CURL, reason: 'short' },
  changes: [
    { id: 'a0', type: 'sets', entry: 1, exId: CURL, sets: 1, before: 2, why: 'One good set is enough today.' },
    { id: 'a1', type: 'rest', entry: 0, exId: BENCH, rest: 120, why: 'A longer break keeps the bench sets clean.' },
  ],
  ...extra,
})

let root, host
const render = el => { act(() => root.render(el)) }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.S = state(); mocks.pending = null; mocks.job = null; mocks.last = null
  vi.clearAllMocks()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Ask the Coach mid-workout', () => {
  it('asks with the exercise and the reason picked', async () => {
    render(<WorkoutCoachSheet entryIdx={1} close={() => {}} />)
    expect(host.textContent).toContain('Dumbbell Biceps Curl')
    const send = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Ask the Coach'))
    expect(send.disabled).toBe(true)
    act(() => { [...host.querySelectorAll('.adapt-reasons button')].find(b => b.textContent.includes('Short on time')).click() })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.includes('Ask the Coach')).click() })
    expect(api.requestAdapt).toHaveBeenCalledWith({ entry: 1, reason: 'short', text: '' })
  })

  it('applies only the ticked cards, to this workout, and says so', () => {
    const close = vi.fn()
    mocks.pending = adapt()
    render(<WorkoutCoachSheet entryIdx={1} close={close} />)
    expect(host.querySelectorAll('.pcard-chg')).toHaveLength(2)
    // Untick the rest change, keep the sets one.
    act(() => { host.querySelectorAll('.pcard-chg')[1].querySelector('input, button, [role="checkbox"]').click() })
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent.includes('Apply 1 change')).click() })
    expect(mocks.S.active.entries[1].sets).toHaveLength(1)
    expect(mocks.S.active.entries[0].target.restSec).toBeUndefined()
    expect(mocks.S.coach.log[0]).toMatchObject({ kind: 'adapt', proposalId: 'p1' })
    expect(api.resolvePending).toHaveBeenCalledWith({ accepted: ['a0'], rejected: ['a1'] })
    expect(close).toHaveBeenCalled()
  })

  it('a proposal for a workout that has ended can only be dismissed', () => {
    mocks.S.active = null
    render(<AdaptProposal p={adapt()} onDone={() => {}} />)
    expect(host.textContent).toContain('That workout is over')
    expect([...host.querySelectorAll('button')].some(b => b.textContent.includes('Apply'))).toBe(false)
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent.includes('Dismiss')).click() })
    expect(api.resolvePending).toHaveBeenCalledWith({ dismissed: true })
  })

  it('says so when the Coach sees nothing to change', () => {
    mocks.last = { id: 'j1', kind: 'adapt', outcome: 'nochange', reading: 'Looks fine, carry on.' }
    render(<WorkoutCoachSheet entryIdx={1} close={() => {}} />)
    // Nothing sent from this sheet yet, so an older outcome is not shown as this answer.
    expect(host.textContent).not.toContain('Looks fine')
  })
})
