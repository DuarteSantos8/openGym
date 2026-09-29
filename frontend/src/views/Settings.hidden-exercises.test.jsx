// @vitest-environment happy-dom
// Settings → Data → "Manage hidden exercises" (issue #199, Task 3): restoring a built-in
// that was hidden via sheets.jsx's Hide action. The row/sheet reads S.deletedEx, resolves
// each id against the pristine EXDB (not the effective/filtered catalogue, which would drop
// a hidden id), and mutates only S.deletedEx — customEx is never touched.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { EXDB } from '../lib/exercises.js'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, coachLocal: null }
  state.replaceState = vi.fn()
  state.confirmSheet = vi.fn()
  state.forgetCoach = vi.fn(() => Promise.resolve({ ok: true }))
  state.api = vi.fn(() => Promise.resolve({ ok: true }))
  state.toast = vi.fn()
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    coachLocal: state.coachLocal,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: state.replaceState, setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' }, workouts: [] }, hasData: () => false }
})
// Unlike Settings.reset.test.jsx, useUI is the REAL store here — the sheet has to be reactive
// to S.deletedEx changing, and only the real openSheet/sheets machinery makes renderTop() work.
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../lib/coach-api.js', () => ({ forgetCoach: (...a) => mocks.forgetCoach(...a) }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(), askAddDeviceData: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {}, customEx: [], deletedEx: [],
  }
  mocks.user = null
  mocks.coachLocal = null
  mocks.replaceState.mockClear()
  mocks.confirmSheet.mockClear()
  mocks.forgetCoach.mockClear()
  mocks.api.mockClear()
  mocks.toast.mockClear()
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings />))
// Renders whatever sheet is on top and returns its host element — mirrors sheets.favourites.test.jsx.
const renderTop = () => {
  const sheet = useUI.getState().sheets.at(-1)
  const h = document.createElement('div')
  document.body.appendChild(h)
  const r = createRoot(h)
  act(() => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return h
}
const manageRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Manage hidden exercises'))

describe('Settings — manage hidden exercises', () => {
  it('is absent when there are no hidden built-ins', () => {
    mount()
    expect(manageRow()).toBeUndefined()
  })

  it('lists hidden built-ins and restores one or all without touching custom exercises', () => {
    mocks.S = { ...mocks.S, customEx: [{ id: 'c1', n: 'Custom', custom: true }], deletedEx: [EXDB[0].id, EXDB[1].id] }
    mount()
    expect(manageRow()).toBeDefined()
    act(() => { manageRow().click() })
    const sheet = renderTop()
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Restore' && b.closest('.item').textContent.includes(EXDB[0].n)).click())
    expect(mocks.S.deletedEx).toEqual([EXDB[1].id])
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Restore all').click())
    expect(mocks.S.deletedEx).toEqual([])
    expect(mocks.S.customEx).toEqual([{ id: 'c1', n: 'Custom', custom: true }])
  })

  // Cross-task interaction (Task 2 overrides + Task 3 hide/restore): hiding and overriding a
  // built-in are independent — restoring only ever touches deletedEx, never exOverrides.
  it('restoring a hidden built-in leaves its override untouched', () => {
    mocks.S = {
      ...mocks.S,
      deletedEx: [EXDB[0].id],
      exOverrides: { [EXDB[0].id]: { n: 'My renamed exercise' } },
    }
    mount()
    act(() => { manageRow().click() })
    const sheet = renderTop()
    // The row itself resolves against the pristine EXDB (see the comment above
    // HiddenExercisesSheet), not the override — so it's found by the pristine name.
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Restore' && b.closest('.item').textContent.includes(EXDB[0].n)).click())
    expect(mocks.S.deletedEx).toEqual([])
    expect(mocks.S.exOverrides).toEqual({ [EXDB[0].id]: { n: 'My renamed exercise' } })
  })

  it('falls back to the raw id for a stale id no longer in EXDB', () => {
    mocks.S = { ...mocks.S, deletedEx: ['not-a-real-id'] }
    mount()
    act(() => { manageRow().click() })
    const sheet = renderTop()
    expect(sheet.textContent).toContain('not-a-real-id')
  })
})
