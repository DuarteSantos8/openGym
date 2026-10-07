// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { bindUI } from '../components/ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The missed-workout nudge lives under the workout-day reminder in Settings → Notifications: a
// switch, and once it is on, a tone. Both the self-hosted card (web push) and the mobile card
// (native notifications) carry it, and only while the reminder itself is on.
const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: false }
  state.snapshot = () => ({
    S: state.S,
    user: { id: 'u1', name: 'One' },
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
  return { useStore, DEF: { reminder: { on: false, time: '08:00', tz: null, nudge: false, tone: 'friendly' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({
  pushSupported: () => true, syncPushSubscription: () => Promise.resolve(true),
  enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn(),
}))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({
  get MOBILE() { return mocks.MOBILE }, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(),
  syncReminder: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let sheet = null
bindUI({ getState: () => ({ openSheet: render => { sheet = render; return { close: () => {} } } }) })

let host, root
beforeEach(() => {
  sheet = null
  mocks.MOBILE = false
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
    reminder: { on: true, time: '08:00', tz: 'Europe/Zurich' },
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = async () => { await act(async () => { root.render(<Settings page="reminders" />) }) }
const row = text => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(text))
const nudgeRow = () => row('Nudge me when I skip a planned workout')
const toneRow = () => row('Nudge tone')
const toggleNudge = async () => {
  const sw = nudgeRow().querySelector('input[type=checkbox], button, [role=switch]')
  await act(async () => { sw.click() })
  await mount()
}
const choose = async label => {
  act(() => { toneRow().click() })
  expect(sheet).toBeTypeOf('function')
  const box = document.createElement('div')
  document.body.appendChild(box)
  const sheetRoot = createRoot(box)
  act(() => sheetRoot.render(sheet(() => {})))
  const option = [...box.querySelectorAll('button.lrow')].find(b => b.querySelector('.lrow-t')?.textContent === label)
  expect(option).toBeTruthy()
  act(() => { option.click() })
  act(() => sheetRoot.unmount())
  box.remove()
  await mount()
}

describe.each([['self-hosted (web push)', false], ['mobile (native)', true]])('Settings — missed-workout nudge, %s', (_, mobile) => {
  beforeEach(() => { mocks.MOBILE = mobile })

  it('is off by default, under the reminder, with no tone until it is on', async () => {
    await mount()
    expect(nudgeRow()).toBeTruthy()
    expect(toneRow()).toBeFalsy()
    expect(host.textContent).not.toContain('After 3 missed days in a row')
  })

  it('switches on, keeps the reminder as it was, and offers the three tones', async () => {
    await mount()
    await toggleNudge()
    expect(mocks.S.reminder).toMatchObject({ on: true, time: '08:00', nudge: true })
    expect(toneRow().textContent).toContain('Friendly')
    expect(host.textContent).toContain('After 3 missed days in a row it goes quiet until your next workout.')
    await choose('Drill sergeant')
    expect(mocks.S.reminder.tone).toBe('drill')
    expect(toneRow().textContent).toContain('Drill sergeant')
    await choose('Guilt trip')
    expect(mocks.S.reminder.tone).toBe('guilt')
    await toggleNudge()
    expect(mocks.S.reminder.nudge).toBe(false)
    expect(toneRow()).toBeFalsy()
  })

  it('is not offered while the reminder is off', async () => {
    mocks.S.reminder = { on: false, time: '08:00', nudge: true }
    await mount()
    expect(nudgeRow()).toBeFalsy()
  })
})
