// @vitest-environment happy-dom
// Plan → Programmes (#159): the list, a starter added, a programme started and ended, the week sheet.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [], navs: [], confirm: null, toasts: [], params: {} }
  state.snapshot = () => ({
    S: state.S,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const api = { openSheet: render => { mocks.sheets.push(render) }, toast: m => mocks.toasts.push(m) }
  const useUI = sel => (sel ? sel(api) : api)
  useUI.getState = () => api
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to), useParams: () => mocks.params }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: o => { mocks.confirm = o }, exportProgrammeFile: vi.fn() }))

const { default: Programmes, ProgrammeEdit } = await import('./Programmes.jsx')

// A fixed clock (only Date is faked): Monday 00:30 local, the first minutes of a week, right after
// the EU clock change, where a UTC date would still say Sunday.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 26, 0, 30)) })
afterAll(() => { vi.useRealTimers() })

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', weekStart: 1, workouts: [], exWeights: {}, dayPlan: {}, programmes: {}, programme: null,
    week: { 1: ['r1'] }, routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }],
  }
  mocks.sheets = []; mocks.navs = []; mocks.confirm = null; mocks.toasts = []; mocks.params = {}
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = el => act(() => root.render(el))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const click = el => act(() => el.click())

describe('the programme list', () => {
  it('adds a starter programme with its own routines and opens it', () => {
    render(<Programmes />)
    expect(host.textContent).toContain('No programmes yet.')
    click(button('Strength block, 4 weeks'))
    const [p] = Object.values(mocks.S.programmes)
    expect(p).toMatchObject({ src: 'strength-4', name: 'Strength block, 4 weeks' })
    expect(p.weeks).toHaveLength(4)
    expect(mocks.S.routines).toHaveLength(4)
    expect(mocks.S.week).toEqual({ 1: ['r1'] })
    expect(mocks.navs.at(-1)).toBe('/plan/prog/' + p.id)
  })

  it('makes a new one from the plan you have', () => {
    render(<Programmes />)
    click(button('New programme'))
    const [p] = Object.values(mocks.S.programmes)
    expect(p.days).toEqual({ 1: ['r1'] })
    expect(p.weeks).toHaveLength(4)
  })
})

describe('a programme', () => {
  const seed = () => {
    mocks.S.routines.push({ id: 'r2', name: 'Legs', ex: [] })
    mocks.S.programmes = { P: { id: 'P', name: 'Block', at: 1, days: { 3: ['r2'] }, weeks: [{ rpe: 7 }, {}] } }
    mocks.params = { id: 'P' }
  }

  it('starts after a confirm, shows where it stands, and ends with the plan back', () => {
    seed()
    render(<ProgrammeEdit />)
    expect(host.textContent).toContain('We Legs')
    click(button('Start programme'))
    act(() => mocks.confirm.onConfirm())
    expect(mocks.S.week).toEqual({ 3: ['r2'] })
    render(<ProgrammeEdit />)
    expect(host.textContent).toContain('Week 1 of 2')
    click(button('End programme'))
    act(() => mocks.confirm.onConfirm())
    expect(mocks.S.week).toEqual({ 1: ['r1'] })
    expect(mocks.S.programme).toBeNull()
  })

  it('changes its length with the stepper', () => {
    seed()
    render(<ProgrammeEdit />)
    click(host.querySelector('.prog-weeks button[aria-label="Increase Weeks"]'))
    expect(mocks.S.programmes.P.weeks).toEqual([{ rpe: 7 }, {}, {}])
  })

  it('the week sheet sets a deload and an RPE', () => {
    seed()
    mocks.S.programmes.P.days = { 1: ['r1'] }
    render(<ProgrammeEdit />)
    click([...host.querySelectorAll('.lrow.tap')].find(r => r.textContent.startsWith('Week 2')))
    const sheet = mocks.sheets.at(-1)
    const close = vi.fn()
    render(sheet(close))
    click(host.querySelector('[role="switch"]'))
    expect(mocks.S.programmes.P.weeks[1]).toEqual({ deload: true })
    render(sheet(close))
    click(button('RPE 8.5'))
    expect(mocks.S.programmes.P.weeks[1]).toEqual({ deload: true, rpe: 8.5 })
    // The lift of its routine is there to get a %1RM.
    expect(host.querySelector('.prog-pct input')).not.toBeNull()
    render(sheet(close))
    click(button('Same as last week, a bit heavier'))
    expect(mocks.S.programmes.P.weeks[1]).toEqual({ rpe: 7 })
  })

  it('delete asks first, and ends it when running', () => {
    seed()
    mocks.S.programme = { id: 'P', startedOn: '2026-10-19', cycle: 1, bump: 0, saved: { week: { 1: ['r1'] }, scheduleMode: null, rotation: null, pass: false } }
    render(<ProgrammeEdit />)
    click(button('Delete programme'))
    act(() => mocks.confirm.onConfirm())
    expect(mocks.S.programmes).toEqual({})
    expect(mocks.S.programme).toBeNull()
    expect(mocks.S.week).toEqual({ 1: ['r1'] })
  })
})
