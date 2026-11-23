// @vitest-environment happy-dom
// Home's "Build my own plan" lands on the Schedule. With no routines it said "Make one, or grab the
// starter plan" and only offered the starter plan: the way to make one was a tab away (QA 1.4.5).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { menuSheet } from '../sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a) => mocks.nav(...a) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({ starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), menuSheet: vi.fn() }))

let host, root
beforeEach(() => {
  mocks.nav = vi.fn()
  mocks.S = { unit: 'kg', workouts: [], exWeights: {}, week: {}, dayPlan: {}, routines: [] }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Plan with no routines', () => {
  it('offers New routine right in the empty state, and it opens the new routine\'s editor', () => {
    act(() => root.render(<Plan />))
    const empty = host.querySelector('.plan-empty')
    const labels = [...empty.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(labels).toEqual(['Load starter plan', 'New routine'])
    act(() => [...empty.querySelectorAll('button')][1].click())
    expect(mocks.S.routines.length).toBe(1)
    expect(mocks.S.routines[0].ex).toEqual([])
    expect(mocks.nav).toHaveBeenCalledWith('/plan/r/' + mocks.S.routines[0].id)
  })
})

describe('Plan new routine colour', () => {
  it('gives a new routine a colour the loose routines do not use (New in the pill)', () => {
    mocks.S.routines = [{ id: 'a', name: 'A', ex: [], color: 'blue' }]
    localStorage.setItem('gym_plan_view', 'routines')
    act(() => root.render(<Plan />))
    act(() => host.querySelector('.plan-pill-new').click())
    act(() => menuSheet.mock.lastCall[0].items[0].onClick())
    const made = mocks.S.routines.find(r => r.id !== 'a')
    expect(made.color).toBeTruthy()
    expect(made.color).not.toBe('blue')
  })
})

describe('Routines tab with no routines', () => {
  it('shows the empty state and still has New in the pill', () => {
    localStorage.setItem('gym_plan_view', 'routines')
    act(() => root.render(<Plan />))
    expect(host.textContent).toContain('No routines yet.')
    expect(host.querySelector('.plan-pill-new')).toBeTruthy()
  })
})
