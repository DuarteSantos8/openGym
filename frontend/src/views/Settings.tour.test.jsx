// @vitest-environment happy-dom
// Settings → About & updates → Tutorials: the app tour from the top (Show the tour again) and the
// four tutorials, from anywhere, but not over a running workout (the tour's practice session and
// the tutorials' copies would stand in for the real one).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { tourState, closeTour, markTourDone, markTutorialDone } from '../lib/tour.js'
import { searchSettings } from './settings-pages.js'

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
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const toast = mocks.toast = vi.fn()
  const snap = () => ({ toast, openSheet: vi.fn() })
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
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, workouts: [], routines: [], exWeights: {}, active: null }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  closeTour()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  closeTour()
  localStorage.clear()
})

const row = (title = 'Show the tour again') => [...host.querySelectorAll('.lrow')].find(b => b.querySelector('.lrow-t')?.textContent === title)

describe('Settings: Show the tour again', () => {
  it('starts the tour from the top, also after it was seen', () => {
    markTourDone()
    act(() => root.render(<Settings page="about" />))
    act(() => row().click())
    expect(tourState()).toEqual({ kind: 'run', at: null })
  })
  it('waits for a running workout to end', () => {
    mocks.S.active = { id: 'a', entries: [] }
    act(() => root.render(<Settings page="about" />))
    act(() => row().click())
    expect(tourState()).toBe(null)
    expect(mocks.toast).toHaveBeenCalledWith('Finish your workout first, then the tour is all yours.')
  })
})

describe('Settings: Tutorials', () => {
  it('lists the tour and the four tutorials together, under one heading', () => {
    act(() => root.render(<Settings page="about" />))
    const sect = [...host.querySelectorAll('.sect')].find(x => x.textContent.includes('Tutorials'))
    expect([...sect.querySelectorAll('.lrow-t')].map(x => x.textContent))
      .toEqual(['Show the tour again', 'Build your first plan', 'Create your own exercise', 'Edit your data', 'Export & import'])
  })
  it('each runs its own tutorial, and one seen to the end says Done', () => {
    markTutorialDone('edit')
    act(() => root.render(<Settings page="about" />))
    expect(row('Edit your data').textContent).toContain('Done')
    expect(row('Build your first plan').textContent).not.toContain('Done')
    act(() => row('Build your first plan').click())
    expect(tourState()).toEqual({ kind: 'run', at: null, flow: 'plan' })
    closeTour()
    act(() => row('Export & import').click())
    expect(tourState()).toEqual({ kind: 'run', at: null, flow: 'backup' })
  })
  it('a tutorial waits for a running workout too', () => {
    mocks.S.active = { id: 'a', entries: [] }
    act(() => root.render(<Settings page="about" />))
    act(() => row('Create your own exercise').click())
    expect(tourState()).toBe(null)
  })
  it('the search still finds the tour by its old name, and the tutorials by theirs', () => {
    const ctx = { mobile: false }
    expect(searchSettings('Show the tour again', ctx).some(h => h.title === 'Show the tour again' && h.page === 'about')).toBe(true)
    expect(searchSettings('tour', ctx).some(h => h.title === 'Show the tour again')).toBe(true)
    expect(searchSettings('tutorial', ctx).map(h => h.title)).toEqual(expect.arrayContaining(['Show the tour again', 'Build your first plan', 'Edit your data', 'Export & import']))
  })
})
