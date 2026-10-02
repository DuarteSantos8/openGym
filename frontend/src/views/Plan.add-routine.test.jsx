// @vitest-environment happy-dom
// #276: a full-width "＋ Add routine" under every planned weekday made the week read as a list of
// buttons. A populated day now offers the same action as a small ＋ in its header; an empty day
// is still one tappable row that picks its first routine.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { dayAddRoutineSheet, dayAssignSheet } from '../sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, week: { 1: ['r1'] }, dayPlan: {},
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [] }, { id: 'r2', name: 'Pull', emoji: null, ex: [] }],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Plan />))
const dayItem = day => [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === day)

describe('Plan — adding a routine to a day that already has one (#276)', () => {
  it('offers a compact ＋ in the day header instead of a full-width text button', () => {
    mount()
    const monday = dayItem('Monday')
    expect(monday.textContent).not.toContain('Add routine')
    const plus = monday.querySelector('button[aria-label="Add routine"]')
    expect(plus).toBeTruthy()
    // It sits in the header row with the count, not under the routine rows.
    expect(plus.closest('.row.between')?.querySelector('.tt')?.textContent).toBe('Monday')
    act(() => plus.click())
    expect(dayAddRoutineSheet).toHaveBeenCalledWith(1)
  })

  it('leaves an empty day as one row that picks its first routine', () => {
    mount()
    const tuesday = dayItem('Tuesday')
    expect(tuesday.querySelector('button[aria-label="Add routine"]')).toBeNull()
    act(() => tuesday.click())
    expect(dayAssignSheet).toHaveBeenCalledWith(2)
  })
})
