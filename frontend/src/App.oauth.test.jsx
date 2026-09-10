// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  boot: vi.fn(() => Promise.resolve()),
  state: {
    S: { theme: 'dark', accent: 'lime', active: null, checkIn: true },
    user: { id: 'stale-local-user' }, ready: false, needsMobileOnboarding: false,
    isGuest: () => true
  }
}))
vi.mock('./store/useStore.js', () => {
  const snapshot = { ...mocks.state, boot: mocks.boot }
  const useStore = selector => selector ? selector(snapshot) : snapshot
  useStore.getState = () => snapshot
  return { useStore }
})
vi.mock('./store/useUI.js', () => ({ useUI: {} }))
vi.mock('./components/ui.jsx', () => ({ bindUI: vi.fn() }))
vi.mock('./lib/format.js', () => ({ ACCENTS: { lime: true } }))
vi.mock('./lib/i18n.js', () => ({ setLang: vi.fn(), useLang: () => 0 }))
vi.mock('./lib/nav.js', () => ({ setNav: vi.fn() }))
vi.mock('./lib/back.js', () => ({ initBackButton: vi.fn(() => Promise.resolve(() => {})) }))
vi.mock('./lib/wakelock.js', () => ({ useWakeLock: vi.fn() }))
vi.mock('./lib/viewport-guard.js', () => ({ installViewportGuard: vi.fn(() => () => {}) }))
vi.mock('./sheets.jsx', () => ({ startFlow: vi.fn() }))
vi.mock('./components/Icon.jsx', () => ({ default: () => <span /> }))
vi.mock('./components/TabBar.jsx', () => ({ default: () => <div data-testid="tabbar" /> }))
vi.mock('./components/ErrorBoundary.jsx', () => ({ default: ({ children }) => <>{children}</> }))
vi.mock('./components/Modals.jsx', () => ({ default: () => null }))
vi.mock('./components/Toast.jsx', () => ({ default: () => null }))
vi.mock('./components/RestTimer.jsx', () => ({ default: () => null }))
vi.mock('./components/TimerFlash.jsx', () => ({ default: () => null }))
vi.mock('./views/Login.jsx', () => ({ default: () => <div data-testid="login" /> }))
vi.mock('./views/MobileOnboarding.jsx', () => ({ default: () => null }))
vi.mock('./views/Home.jsx', () => ({ default: () => null }))
vi.mock('./views/CheckIn.jsx', () => ({ default: () => null }))
vi.mock('./views/Plan.jsx', () => ({ default: () => null }))
vi.mock('./views/RoutineEdit.jsx', () => ({ default: () => null }))
vi.mock('./views/Workout.jsx', () => ({ default: () => null }))
vi.mock('./views/Stats.jsx', () => ({ default: () => null }))
vi.mock('./views/History.jsx', () => ({ default: () => null }))
vi.mock('./views/Library.jsx', () => ({ default: () => null }))
vi.mock('./views/Stretching.jsx', () => ({ default: () => null }))
vi.mock('./views/Muscles.jsx', () => ({ default: () => null }))
vi.mock('./views/Settings.jsx', () => ({ default: () => null }))
vi.mock('./views/Admin.jsx', () => ({ default: () => null }))
vi.mock('./views/CoachChat.jsx', () => ({ default: () => null }))
vi.mock('./views/CoachIntake.jsx', () => ({ default: () => null }))
vi.mock('./views/CoachSetup.jsx', () => ({ default: () => null }))

let host, root
beforeEach(() => {
  history.replaceState(null, '', '/?oauth_return=' + encodeURIComponent('/oauth/authorize?client_id=client&state=abc'))
  mocks.boot.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); history.replaceState(null, '', '/')
})

describe('App OAuth continuation boot gate', () => {
  it('does not boot or hydrate a stale user/guest and keeps OAuth login reachable', async () => {
    await act(async () => { root.render(<App />); await Promise.resolve() })
    expect(mocks.boot).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="login"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="tabbar"]')).toBeNull()
  })
})
