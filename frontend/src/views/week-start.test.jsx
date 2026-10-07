// @vitest-environment happy-dom
// The setting is only worth anything if the screens actually follow it: the toggle has to
// write the field, and the Plan list has to draw the week in that order.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import Plan from './Plan.jsx'

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
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {}, week: {}, dayPlan: {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const segButton = label => [...host.querySelectorAll('.seg button')].find(b => b.textContent === label)
const dayRows = () => [...host.querySelectorAll('.item .tt')].map(e => e.textContent)

describe('Settings — week starts on', () => {
  const mount = () => act(() => root.render(<Settings page="plan" />))

  it('offers Monday and Sunday and writes the getDay() index', () => {
    mount()
    expect(segButton('Monday').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('Sunday').click() })
    expect(mocks.S.weekStart).toBe(0)
    mount()
    expect(segButton('Sunday').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('Monday').click() })
    expect(mocks.S.weekStart).toBe(1)
  })

  it('shows a profile written before the setting existed as Monday', () => {
    delete mocks.S.weekStart
    mount()
    expect(segButton('Monday').getAttribute('aria-pressed')).toBe('true')
    expect(segButton('Sunday').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Plan — the week schedule follows the setting', () => {
  const mount = () => act(() => root.render(<Plan />))
  const planDays = () => [...host.querySelectorAll('.plan-day')].map(e => e.getAttribute('aria-label'))

  it('runs Monday to Sunday by default', () => {
    mount()
    expect(planDays()).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  })

  it('runs Sunday to Saturday for a Sunday profile', () => {
    mocks.S.weekStart = 0
    mount()
    expect(planDays()).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
  })

  it('keeps a routine attached to its day, not to its position in the list', () => {
    mocks.S.routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [] }]
    mocks.S.week = { 0: 'r1' }        // Sunday
    mocks.S.weekStart = 0
    mount()
    const rows = [...host.querySelectorAll('.plan-day')]
    expect(rows[0].getAttribute('aria-label')).toBe('Sunday')
    expect(rows[0].querySelector('.tt').textContent).toBe('Push')
    expect(rows[1].textContent).not.toContain('Push')
  })
})

describe('Plan — a combined day (combine routines)', () => {
  const mount = () => act(() => root.render(<Plan />))
  const day = name => [...host.querySelectorAll('.plan-day')].find(el => el.getAttribute('aria-label') === name)

  beforeEach(() => {
    mocks.S.routines = [
      { id: 'r1', name: 'Push', emoji: null, ex: [{ id: 'a' }, { id: 'b' }] },
      { id: 'r2', name: 'Core', emoji: null, ex: [{ id: 'c' }] },
    ]
  })

  it('reads as one session with both names and the routine count', () => {
    mocks.S.week = { 1: ['r1', 'r2'] }
    mount()
    const mon = day('Monday')
    expect(mon.querySelector('.tt').textContent).toBe('Push + Core')
    expect(mon.querySelector('.ss').textContent).toBe('2 routines')
  })

  it('an empty day is a rest day, one tappable row', () => {
    mocks.S.week = {}
    mount()
    const tue = day('Tuesday')
    expect(tue.querySelector('.tt').textContent).toBe('Rest day')
    expect(tue.getAttribute('role')).toBe('button')
    expect(tue.querySelectorAll('button').length).toBe(0)
  })
})
