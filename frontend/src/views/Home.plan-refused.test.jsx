// @vitest-environment happy-dom
// The plan chosen at onboarding that openGym could not set up (the hub's state: plan refused, the
// rest of the write in): Home's This week (components/HomeWeek.jsx) says so in place of the
// welcome, with Training to pick one, until a plan exists.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { _forgetPlanRefused } from '../lib/onboarding/use-plan-refused.js'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname: '/home' }) }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(), menuSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(), workoutDetailSheet: vi.fn(), logPastWorkoutSheet: vi.fn(),
}))
// The diary's cards read NutriTrace; this is about the plan only.
vi.mock('../lib/nutrition/use-diary-day.js', () => ({ useDiaryDay: () => ({ on: false }) }))
const hub = vi.hoisted(() => ({ loadOnboarding: vi.fn() }))
vi.mock('../lib/onboarding/api.js', async original => ({ ...(await original()), ...hub }))

const REFUSED = { completedAt: 1, delivery: { opengym: 'done', nutritrace: 'done' }, plan: { status: 'refused', kind: 'starter', code: 'bad-plan' } }
const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  hub.loadOnboarding.mockReset()
  _forgetPlanRefused()
  // Signed in, the other cards ask their servers; there are none here.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('no server in this test') }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, routines: [], dayPlan: {}, workouts: [], active: null, weighIn: false, week: {}, ...over },
  user: { id: 'u1', name: 'Maria' },
}))
const mount = async () => { await act(async () => { root.render(<Home />) }); await act(async () => { await Promise.resolve() }) }
const text = () => host.textContent

describe('Home — a plan the onboarding could not set up', () => {
  it('says so, in place of the welcome, and opens Training to pick one', async () => {
    hub.loadOnboarding.mockResolvedValue(REFUSED)
    setS()
    await mount()
    expect(text()).toContain('Your plan couldn’t be set up')
    expect(text()).toContain('Pick one in Training.')
    expect(text()).not.toContain('Welcome!')
    const open = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Open Training'))
    act(() => { open.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(nav).toHaveBeenCalledWith('/train')
  })

  it('goes away once a plan exists, and asks the hub nothing then', async () => {
    hub.loadOnboarding.mockResolvedValue(REFUSED)
    setS({ routines })
    await mount()
    expect(text()).not.toContain('Your plan couldn’t be set up')
    expect(hub.loadOnboarding).not.toHaveBeenCalled()
  })

  it('shows the welcome as before when no plan was refused, or the hub cannot be asked', async () => {
    hub.loadOnboarding.mockResolvedValue({ completedAt: 1, delivery: { opengym: 'done', nutritrace: 'done' }, plan: null })
    setS()
    await mount()
    expect(text()).toContain('Welcome!')
    expect(text()).not.toContain('Your plan couldn’t be set up')
    act(() => root.unmount())
    root = createRoot(host)
    _forgetPlanRefused()
    hub.loadOnboarding.mockRejectedValue(Object.assign(new Error('x'), { code: 'offline' }))
    await mount()
    expect(text()).toContain('Welcome!')
  })
})
