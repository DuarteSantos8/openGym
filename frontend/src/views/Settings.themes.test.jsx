// @vitest-environment happy-dom
// Settings → Look & Home → Seasonal themes (v1.4.3): Halloween's Auto / On / Off, its opt-in
// colours, and the line under it that says when it is back.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { bindUI } from '../components/ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: false, user: null }
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
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
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE }, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

// SelectRow opens its choices through the bound UI store; capture the sheet to render it here.
let sheet = null
bindUI({ getState: () => ({ openSheet: render => { sheet = render; return { close: () => {} } } }) })

let host, root
beforeEach(() => {
  sheet = null
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.MOBILE = false
  mocks.user = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = (page = 'themes') => act(() => root.render(<Settings page={page} />))
const rowOf = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const pressed = () => [...rowOf('Halloween').querySelectorAll('.seg button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent
const press = label => act(() => { [...rowOf('Halloween').querySelectorAll('.seg button')].find(b => b.textContent === label).click() })
const footer = () => host.querySelector('.sect-f')?.textContent
const at = (y, m, d) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(y, m - 1, d, 12)) }
afterEach(() => vi.useRealTimers())

describe('Seasonal themes', () => {
  it('Look & Home opens the page, and names the theme that shows right now', () => {
    at(2026, 10, 25)
    mount('look')
    expect(rowOf('Seasonal themes').querySelector('.lrow-v').textContent).toBe('Halloween')
    act(() => root.unmount()); root = createRoot(host)
    at(2026, 11, 2)
    mount('look')
    expect(rowOf('Seasonal themes').querySelector('.lrow-v')).toBeNull()
  })

  it('reads as Auto when never chosen, in season says what it brings', () => {
    at(2026, 10, 25)
    mount()
    expect(pressed()).toBe('Auto')
    expect(footer()).toMatch(/^Spiders, bats and one shy pumpkin/)
  })

  it('out of season, Auto says it is back next October', () => {
    at(2027, 3, 14)
    mount()
    expect(footer()).toBe('Back next October. The spiders are on holiday.')
  })

  it('On and Off are stored with the profile, beside the colours', () => {
    at(2026, 10, 25)
    mocks.S.seasonal = { halloweenColors: true }
    mount()
    press('Off')
    expect(mocks.S.seasonal).toEqual({ halloween: 'off', halloweenColors: true })
    mount()
    expect(pressed()).toBe('Off')
    expect(footer()).toBe('Off, even in season. Fair enough.')
    press('On')
    expect(mocks.S.seasonal.halloween).toBe('on')
  })

  it('Spooky colors is off until switched on', () => {
    mount()
    const sw = rowOf('Spooky colors').querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => sw.click())
    expect(mocks.S.seasonal).toEqual({ halloweenColors: true })
  })

  it('Also during workouts is on until switched off, and then stored', () => {
    mount()
    const sw = rowOf('Also during workouts').querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    act(() => sw.click())
    expect(mocks.S.seasonal).toEqual({ halloweenWorkout: false })
  })
})
