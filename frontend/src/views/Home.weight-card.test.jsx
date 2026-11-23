// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'
import { initWeighInSource } from '../lib/weigh-in-source.js'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '',
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mountWith = showWeightCard => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, showWeightCard },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const weightHeading = () => [...host.querySelectorAll('.card-head-title')].find(el => el.textContent === 'Body weight')

describe('Home body-weight card preference', () => {
  it('shows the card for legacy profiles without the preference', () => {
    mountWith(undefined)
    expect(weightHeading()).toBeTruthy()
  })

  it('shows the card when enabled', () => {
    mountWith(true)
    expect(weightHeading()).toBeTruthy()
  })

  // #1088: weigh-ins read from the health store are the only ones, so the card offers no Log.
  it('offers Log unless weigh-ins are read from the health store', async () => {
    let tell
    await initWeighInSource(async () => ({ readWeight: false }), cb => { tell = cb })
    const log = () => [...host.querySelectorAll('.bw-head button')].some(b => b.textContent === 'Log')
    mountWith(true)
    expect(log()).toBe(true)
    expect(host.textContent).toContain('No weigh-ins yet.')
    act(() => tell({ readWeight: true }))
    expect(log()).toBe(false)
    expect(weightHeading()).toBeTruthy()
    // the empty card says where weigh-ins come from instead of asking to log one
    expect(host.textContent).toContain('Weigh-ins come from Health Connect only.')
    expect(host.textContent).not.toContain('No weigh-ins yet.')
    act(() => tell({ readWeight: false }))
    expect(log()).toBe(true)
  })

  it('hides only the Home card when disabled', () => {
    mountWith(false)
    expect(weightHeading()).toBeFalsy()
  })
})