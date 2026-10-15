// @vitest-environment happy-dom
// Profile › Schedule defaults › How you train (ia-proposal §5): the row says which of the two the
// week runs on, DERIVED from the live queue (never stored), and opens Training › Schedule, where
// it is switched (Plan.rotation.test.jsx covers the switch itself).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
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
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(),
}))
vi.mock('../lib/update.js', () => ({ checkForUpdate: vi.fn(), downloadAndInstall: vi.fn() }))

import { todayISO } from '../lib/format.js'

const routines = [{ id: 'a', name: 'A', emoji: null, ex: [] }, { id: 'b', name: 'B', emoji: null, ex: [] }]
const baseS = over => ({
  unit: 'kg', lang: 'en', weekStart: 1, checkIn: true, theme: 'dark', accent: 'lime', restSec: 90,
  workoutView: 'cards', wc: {}, reminder: { on: false, time: '08:00', tz: null }, effort: null,
  routines, week: {}, dayPlan: {}, workouts: [], bodyweight: [], exWeights: {}, customEx: [],
  equipProfiles: [], activeEquipId: null, gymCards: [], favEx: [], exNotes: {}, barWeights: {},
  queue: null, rotation: null, scheduleMode: null, active: null, ...over,
})

let host, root
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.nav = vi.fn()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = over => { mocks.S = baseS(over); act(() => root.render(<Settings page="schedule" />)) }
const howRow = () => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'How you train')
const value = () => howRow().querySelector('.lrow-v')?.textContent

describe('Profile › Schedule defaults › How you train', () => {
  it('reads Fixed Week without a usable queue, Rotation with one this app manages', () => {
    mount()
    expect(value()).toBe('Fixed Week')
    mount({
      queue: { ids: ['a', 'b'], since: Date.now(), startsOn: todayISO(), label: 'Rotation', rotationId: 'r1' },
      rotation: { id: 'r1', sequence: ['a', 'b'], label: 'Rotation' },
    })
    expect(value()).toBe('Rotation')
  })

  it('a malformed queue reads Fixed Week; Rotation chosen with nothing built yet reads Rotation', () => {
    mount({ queue: { ids: ['gone'], since: Date.now() } })
    expect(value()).toBe('Fixed Week')
    mount({ scheduleMode: 'rotation' })
    expect(value()).toBe('Rotation')
  })

  it('says when a planner manages the week', () => {
    mount({ queue: { ids: ['a', 'b'], since: Date.now(), startsOn: todayISO(), label: 'US W1' } })
    expect(value()).toBe('Rotation · Externally managed')
  })

  it('has no switch of its own: it opens Training › Schedule', () => {
    mount()
    expect(howRow().querySelector('[role="switch"], .seg')).toBeNull()
    act(() => howRow().click())
    expect(mocks.nav).toHaveBeenCalledWith('/train/schedule')
    expect(mocks.S.scheduleMode).toBe(null)
  })
})
