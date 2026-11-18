// @vitest-environment happy-dom
// Settings → Modules on Home: a module switched off takes its cards with it, and brings them
// back when it is on again. Visibility only; what the cards do is their own tests'.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { presetModules } from '../lib/modules.js'
import Home from './Home.jsx'

const mocks = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.nav.mockClear()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const today = new Date().toISOString().slice(0, 10)
const mountWith = (modules, extra = {}) => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [{ id: 'r1', name: 'Push', ex: [] }], workouts: [{ id: 'w1', d: today, start: Date.now() - 4e6, end: Date.now() - 3e6, entries: [{ id: '0025', sets: [{ w: 20, r: 8, done: true }] }] }],
      bodyweight: [{ d: today, w: 80, t: Date.now() }], dayPlan: {}, week: {}, active: null, modules, homeMuscleSets: false, ...extra },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const heads = () => [...host.querySelectorAll('.card-head-title')].map(el => el.textContent)

describe('Home follows the modules', () => {
  it('Everything: the weight card, the check-in and the streak are there', () => {
    mountWith(undefined)
    expect(heads()).toContain('Body weight')
    expect(heads()).toContain('Check in')
    expect(heads().some(h => /week streak/.test(h))).toBe(true)
  })

  it('Just training: none of them, and the week strip and today row stay', () => {
    mountWith(presetModules('training'))
    expect(heads()).not.toContain('Body weight')
    expect(heads()).not.toContain('Check in')
    expect(heads().some(h => /week streak/.test(h))).toBe(false)
    expect(host.querySelector('[data-tour="today"]')).toBeTruthy()
    expect(host.querySelector('.week')).toBeTruthy()
  })

  it('one module at a time, and back on brings it back', () => {
    mountWith({ body: false })
    expect(heads()).not.toContain('Body weight')
    expect(heads()).toContain('Check in')
    mountWith({ body: true, checkin: false })
    expect(heads()).toContain('Body weight')
    expect(heads()).not.toContain('Check in')
  })

  it('the old check-in switch still hides its card until Modules decides', () => {
    mountWith(undefined, { checkIn: false })
    expect(heads()).not.toContain('Check in')
    mountWith({ checkin: true }, { checkIn: false })
    expect(heads()).toContain('Check in')
  })

  it.each([undefined, { motivation: false }])('weekly muscle links reveal logged analytics with modules %j', modules => {
    mountWith(modules, { homeMuscleSets: true })
    const link = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Most room this week'))
    expect(link).toBeTruthy()
    act(() => link.click())
    expect(mocks.nav).toHaveBeenCalledWith('/stats?focus=weekly-muscle')
  })
})
