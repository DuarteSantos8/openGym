// @vitest-environment happy-dom
// Settings → Modules on Home: a module switched off takes its cards with it, and brings them
// back when it is on again. Visibility only; what the cards do is their own tests'.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { presetModules } from '../lib/modules.js'
import Home from './Home.jsx'
import { todayISO } from '../lib/format.js'

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

// The app's own local date: the UTC date is a day ahead on an evening west of Greenwich, and on
// a Sunday that put this workout in next week.
const today = todayISO()
const mountWith = (modules, extra = {}, session = {}) => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [{ id: 'r1', name: 'Push', ex: [] }], workouts: [{ id: 'w1', d: today, start: Date.now() - 4e6, end: Date.now() - 3e6, entries: [{ id: '0025', sets: [{ w: 20, r: 8, done: true }] }] }],
      bodyweight: [{ d: today, w: 80, t: Date.now() }], dayPlan: {}, week: {}, active: null, modules, homeMuscleSets: false, ...extra },
    user: null, ...session,
  }))
  act(() => root.render(<Home />))
}
const heads = () => [...host.querySelectorAll('.card-head-title')].map(el => el.textContent)

describe('Home follows the modules', () => {
  it('offers the beginner Coach card after today only when the server enables it', () => {
    const session = { user: { id: 'test' }, config: { coach: { enabled: true } } }
    mountWith({}, { experience: 'beginner' }, session)
    const today = host.querySelector('[data-tour="today"]').closest('.card')
    expect(today.nextElementSibling?.textContent).toContain('Ask your Coach')
    mountWith({ coach: false }, { experience: 'beginner' }, session)
    expect(host.textContent).not.toContain('Ask your Coach')
    mountWith({}, { experience: 'intermediate' }, session)
    expect(host.textContent).not.toContain('Ask your Coach')
  })

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

  // Ironvane's body picker: on by default and in every preset; switched off, Home is as it was.
  it('the body picker follows its module, and off leaves the rest of Home unchanged', () => {
    mountWith(undefined)
    expect(heads()).toContain('Tap where you want to get stronger')
    const withPicker = heads().filter(h => h !== 'Tap where you want to get stronger')
    mountWith(presetModules('training'))
    expect(heads()).toContain('Tap where you want to get stronger')
    mountWith({ bodyfocus: false })
    expect(heads()).not.toContain('Tap where you want to get stronger')
    expect(host.querySelector('.bf-card')).toBe(null)
    expect(heads()).toEqual(withPicker)
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
