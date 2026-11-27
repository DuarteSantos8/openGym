// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { startOrPreview } from '../components/StartSheets.jsx'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null, coach: false }
  state.snapshot = () => ({
    S: state.S, user: null, config: {}, coachLocal: { mode: 'off' },
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...args) => mocks.nav(...args) }))
vi.mock('../components/StartSheets.jsx', () => ({ startOrPreview: vi.fn() }))
vi.mock('../lib/coach.js', () => ({ coachAvailable: () => mocks.coach }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false }))
vi.mock('../lib/demo.js', () => ({ DEMO: false }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(), exerciseDetailSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))

const mounted = []
const routine = (id, name) => ({ id, name, emoji: null, ex: [{ id: '0025' }] })
const base = () => ({
  unit: 'kg', active: null, workouts: [], exWeights: {}, dayPlan: {}, week: {}, weekStart: 1,
  routines: [routine('r1', 'Push'), routine('r2', 'Pull'), routine('r3', 'Legs')],
  queue: null, rotation: null, scheduleMode: 'week',
})
function render(over = {}) {
  mocks.S = { ...base(), ...over }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Plan />))
  return host
}
const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const primary = host => host.querySelector('.iv-plan-start .btn')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.removeItem('gym_plan_view')
  document.body.innerHTML = ''
  mocks.nav = vi.fn()
  mocks.coach = false
  useUI.setState({ planMoreOpen: false, planAdvancedOpen: false })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('approved Plan layout', () => {
  it('summarizes today and starts the same effective routine through one primary action', () => {
    const today = new Date().getDay()
    const host = render({ week: { [today]: ['r1'] } })
    expect(host.querySelector('h1').textContent).toBe('Plan')
    expect(host.querySelector('#iv-plan-today-heading').textContent).toBe('Today · Exercises')
    expect(host.querySelectorAll('.iv-plan-today-ex')).toHaveLength(1)
    expect(host.querySelector('.iv-plan-today-ex .tt').textContent.length).toBeGreaterThan(0)
    expect(host.querySelectorAll('.iv-plan-start .btn')).toHaveLength(1)
    // in the page under today's session, not floating: the tab bar's Start is the floating one
    expect(primary(host).closest('.iv-plan-today')).not.toBeNull()
    expect(host.querySelector('.iv-plan-primary')).toBeNull()
    expect(primary(host).textContent).toBe('Start today’s workout')
    expect(primary(host).disabled).toBe(false)
    expect(host.querySelector('.iv-plan-more').textContent).toContain('Plan options')
    click(primary(host))
    expect(startOrPreview).toHaveBeenCalledWith(['r1'])
  })

  it('on a day trained separately, starts the next session not done yet, like the tab bar', () => {
    const today = new Date().getDay()
    const apart = { week: { [today]: ['r1', 'r2'] }, weekApart: { [today]: true } }
    let host = render(apart)
    click(primary(host))
    expect(startOrPreview).toHaveBeenLastCalledWith(['r1'])
    expect(host.querySelector('.iv-plan-done')).toBeNull()
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })

    host = render({ ...apart, workouts: [{ id: 'w1', d: todayISO(), routineIds: ['r1'], ex: [] }] })
    click(primary(host))
    expect(startOrPreview).toHaveBeenLastCalledWith(['r2'])
    expect(host.querySelectorAll('.iv-plan-done')).toHaveLength(1)
    expect(host.querySelector('.iv-plan-done').closest('.iv-plan-today-group').textContent).toContain('Push')
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })

    vi.mocked(startOrPreview).mockClear()
    host = render({ ...apart, workouts: [{ id: 'w1', d: todayISO(), routineIds: ['r1'], ex: [] }, { id: 'w2', d: todayISO(), routineIds: ['r2'], ex: [] }] })
    expect(primary(host)).toBeNull()
    expect(startOrPreview).not.toHaveBeenCalled()
  })

  it('on a combined day, still starts every routine of the day together', () => {
    const today = new Date().getDay()
    const host = render({ week: { [today]: ['r1', 'r2'] } })
    click(primary(host))
    expect(startOrPreview).toHaveBeenCalledWith(['r1', 'r2'])
  })

  it('resumes an active session instead of replacing it', () => {
    const host = render({ active: { id: 'live', start: 1 } })
    expect(primary(host).textContent).toBe('Resume workout')
    expect(primary(host).disabled).toBe(false)
    click(primary(host))
    expect(mocks.nav).toHaveBeenCalledWith('/workout')
    expect(startOrPreview).not.toHaveBeenCalled()
  })

  it('shows a rest day and never starts a nonexistent session', () => {
    const host = render({ week: { [(new Date().getDay() + 1) % 7]: ['r1'] } })
    expect(host.querySelector('.iv-plan-rest').textContent).toBe('Rest day')
    expect(primary(host)).toBeNull()
    expect(startOrPreview).not.toHaveBeenCalled()
  })

  it('names today’s exercises in the catalogue’s casing, with their sets and the day’s rough length', () => {
    const today = new Date().getDay()
    const host = render({ routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025', sets: 4, reps: 8, restSec: 120 }, { id: '0025', sets: 3, reps: 10 }] }], week: { [today]: ['r1'] } })
    const names = [...host.querySelectorAll('.iv-plan-today-ex .tt')]
    expect(names).toHaveLength(2)
    for (const n of names) expect(n.classList.contains('capitalize')).toBe(true)
    expect([...host.querySelectorAll('.iv-plan-today-ex .ss')].map(n => n.textContent)).toEqual(['4 sets', '3 sets'])
    expect(host.querySelector('.iv-plan-today-sum').textContent).toMatch(/^7 sets · \d+ min$/)
  })

  it('opens an exercise’s details from today’s list', async () => {
    const { exerciseDetailSheet } = await import('../sheets.jsx')
    const today = new Date().getDay()
    const host = render({ week: { [today]: ['r1'] } })
    click(host.querySelector('button.iv-plan-today-ex'))
    expect(exerciseDetailSheet).toHaveBeenCalledWith(expect.objectContaining({ id: '0025' }))
  })

  it('offers visible Move buttons and a labelled Delete in routine edit mode', () => {
    localStorage.setItem('gym_plan_view', 'routines')
    const host = render()
    click(host.querySelector('.plan-routines-bar .plan-textbtn'))
    expect(host.querySelector('.plan-minus').textContent).toBe('Delete')
    expect(host.querySelector('.plan-handle').textContent).toBe('Move')
    const down = host.querySelector('button[aria-label="Move down: Push"]')
    expect(down.textContent).toBe('Move down')
    click(down)
    expect(mocks.S.routines.map(r => r.name)).toEqual(['Pull', 'Push', 'Legs'])
  })

  it('uses the same visible Move controls for a rotation and keeps Remove labelled', () => {
    const host = render({
      scheduleMode: 'rotation', rotation: { id: 'rot', sequence: ['r1', 'r2'], label: 'Loop' },
    })
    click(host.querySelector('.rotation .plan-textbtn'))
    expect(host.querySelector('.rotation .plan-minus').textContent).toBe('Remove')
    click(host.querySelector('button[aria-label="Move down: Push"]'))
    expect(mocks.S.rotation.sequence).toEqual(['r2', 'r1'])
  })
})
