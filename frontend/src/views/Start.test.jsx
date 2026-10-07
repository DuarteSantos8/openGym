// @vitest-environment happy-dom
// Start is the dedicated workout launch point: today's planned session, fixed
// duration presets (never a slider), an optional weigh-in, then the start.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Start, { START_PRESETS, presetExerciseCount } from './Start.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), startFlow: vi.fn(), startShortFlow: vi.fn(),
}))
import { startFlow, startShortFlow, bwSheet } from '../sheets.jsx'

const ex = n => Array.from({ length: n }, (_, i) => ({ id: 'e' + i }))
const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: ex(6) }]

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear(); startFlow.mockClear(); startShortFlow.mockClear(); bwSheet.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = (over = {}) => useStore.setState(s => ({
  S: {
    ...s.S, routines, dayPlan: {}, workouts: [], active: null, bodyweight: [], workoutLength: 35,
    week: { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }, ...over,
  },
  user: null,
}))
const mount = () => act(() => root.render(<Start />))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))

describe('Start presets', () => {
  it('offers exactly the four duration presets, not a slider', () => {
    expect(START_PRESETS).toEqual([15, 25, 35, 45])
    setS(); mount()
    expect(host.querySelector('input[type="range"], .sld')).toBeFalsy()
    for (const p of START_PRESETS) expect(button(p + ' min')).toBeTruthy()
  })

  it('maps presets onto the routine the way the old selector did', () => {
    const r = { ex: ex(6) }
    expect(presetExerciseCount(r, 15)).toBe(3)
    expect(presetExerciseCount(r, 25)).toBe(4)
    expect(presetExerciseCount(r, 35)).toBe(6)
    expect(presetExerciseCount(r, 45)).toBe(6)
    expect(presetExerciseCount(null, 25)).toBe(0)
  })

  it('picking a preset persists the preference and previews the session', () => {
    setS(); mount()
    click(button('25 min'))
    expect(useStore.getState().S.workoutLength).toBe(25)
    expect(host.querySelector('.narrow').textContent).toContain('4 exercises')
  })

  it('a short preset starts the trimmed session, a full one the whole plan', () => {
    setS(); mount()
    click(button('15 min'))
    click(button('Start Push'))
    expect(startShortFlow).toHaveBeenCalledWith('r1', ['e0', 'e1', 'e2'])
    expect(startFlow).not.toHaveBeenCalled()
    startShortFlow.mockClear()
    click(button('45 min'))
    click(button('Start Push'))
    expect(startFlow).toHaveBeenCalledWith(['r1'])
    expect(startShortFlow).not.toHaveBeenCalled()
  })

  it('the weigh-in is optional and separate from starting', () => {
    setS({ bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }] }); mount()
    click(button('Update'))
    expect(bwSheet).toHaveBeenCalled()
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('a rest day shows recovery with the secondary doors, and freestyle starts none', () => {
    setS({ week: {} }); mount()
    expect(host.querySelector('.narrow').textContent).toContain('Recovery')
    click(button('Freestyle workout'))
    expect(startFlow).toHaveBeenCalledWith([])
  })

  it('other routines and the exercise browser stay reachable', () => {
    setS({ routines: [...routines, { id: 'r2', name: 'Pull', emoji: null, ex: ex(2) }], week: {} }); mount()
    expect(host.querySelector('.narrow').textContent).toContain('Pull')
    const pullRow = [...host.querySelectorAll('.item')].find(el => el.textContent.includes('Pull'))
    click(pullRow)
    expect(startFlow).toHaveBeenCalledWith(['r2'])
    click(button('Browse exercises'))
    expect(nav).toHaveBeenCalledWith('/library')
  })

  it('a running session resumes instead of offering a new start', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    click(button('Resume workout'))
    expect(nav).toHaveBeenCalledWith('/workout')
    expect(startFlow).not.toHaveBeenCalled()
  })
})
