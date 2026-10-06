// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SyncBanner, { PENDING_GRACE_MS } from './SyncBanner.jsx'
import { connectionView } from './ServerSync.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The connection indicator: every way the app can be without its server gets a line that stays
   while the condition lasts — offline, an error with its HTTP code, a server that refuses this
   device, an answer that is not openGym's, no server at all — and says what to do about it.
   Never in the public demo, never during the phone's first-launch choice, and a change merely
   waiting for its push does not flash it. The store is a stand-in: its `sync` is what each test
   sets; ServerSync.jsx (the words and the actions) is the real one. */
const mocks = vi.hoisted(() => {
  const state = { MOBILE: false, DEMO: false, webauthn: true, user: null, guest: false, onboarding: false, sync: null, sheets: [], navs: [] }
  state.toast = vi.fn()
  state.syncNow = vi.fn(async () => state.sync)
  state.passkeyLogin = vi.fn(async () => ({ id: 'u1', name: 'andi' }))
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync, needsMobileOnboarding: state.onboarding,
    isGuest: () => state.guest, syncNow: state.syncNow,
    setUser: vi.fn(), adoptProfile: vi.fn(async () => ({})),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to) }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('../lib/demo.js', () => ({ get DEMO() { return mocks.DEMO } }))
vi.mock('../lib/api.js', () => ({ webauthnOK: () => mocks.webauthn, passkeyLogin: (...a) => mocks.passkeyLogin(...a) }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
// What the connect sheet was opened with is the point; its own form is tested elsewhere.
vi.mock('../views/MobileOnboarding.jsx', () => ({ ConnectSheet: props => <div className="connect" data-url={props.initialUrl ?? ''} data-again={String(!!props.again)} /> }))

const BASE = 'https://gym.example.com'
const sync = (status, extra = {}) => ({ status, offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: BASE, ...extra })

// Whether the device has a network (navigator.onLine), and the event that says it changed.
const network = on => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on })
  window.dispatchEvent(new Event(on ? 'online' : 'offline'))
}

let host, root
beforeEach(() => {
  network(true)
  Object.assign(mocks, { MOBILE: false, DEMO: false, webauthn: true, S: {}, user: { id: 'u1', name: 'andi' }, guest: false, onboarding: false, sync: sync('ok') })
  mocks.sheets.length = 0
  mocks.navs.length = 0
  mocks.toast.mockClear(); mocks.syncNow.mockClear(); mocks.passkeyLogin.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const render = () => act(() => root.render(<SyncBanner />))
const bar = () => host.querySelector('.conn-bar')
const text = () => host.querySelector('.conn-t')?.textContent || null
const button = () => host.querySelector('button.conn')
const label = () => host.querySelector('.conn-a')?.textContent || null
const conn = () => document.documentElement.style.getPropertyValue('--conn')
const openedConnect = () => { const s = mocks.sheets.at(-1); const r = document.createElement('div'); document.body.appendChild(r); const rr = createRoot(r); act(() => rr.render(s.render(() => {}))); const el = r.querySelector('.connect'); act(() => rr.unmount()); r.remove(); return el }

describe('connected and in step', () => {
  it('shows nothing, and leaves the page its full height', () => {
    render()
    expect(bar()).toBeNull()
    expect(conn()).toBe('')
  })

  // QA, v1.3.9: with nothing waiting, the line came only with the next sync attempt, some 17 s
  // after the browser said it was offline, and Settings said "All synced" until then.
  it('the device going offline is said at once, not at the next sync attempt, and goes when it is back', async () => {
    render()
    expect(bar()).toBeNull()
    act(() => network(false))
    expect(text()).toBe('Offline — showing the last copy synced with the server.')
    expect(bar().className).toContain('off')
    expect(label()).toBe('Try again')
    expect(connectionView(sync('ok'), { online: false }).line).toBe('Offline — the server cannot be reached')
    act(() => network(true))
    expect(bar()).toBeNull()
  })

  it('a change waiting while the device is offline says it is kept here, after the same grace as ever', () => {
    vi.useFakeTimers()
    network(false)
    mocks.sync = sync('pending', { pending: true })
    render()
    expect(bar()).toBeNull()
    act(() => { vi.advanceTimersByTime(PENDING_GRACE_MS) })
    expect(text()).toBe('Offline — your changes are saved on this device and sync when you are back online.')
  })
})

describe('not connected — it says so, and what to do', () => {
  it('hides the banner when disabled in Settings and restores it when enabled', () => {
    mocks.sync = sync('local')
    render()
    expect(bar()).not.toBeNull()
    mocks.S = { showConnectionBanner: false }
    render()
    expect(bar()).toBeNull()
    expect(conn()).toBe('')
    mocks.S = { showConnectionBanner: true }
    render()
    expect(bar()).not.toBeNull()
  })

  it('offline with changes waiting: kept on this device, and a retry that reports back', async () => {
    network(false)
    mocks.sync = sync('offline', { offline: true, pending: true, lastError: { status: 0, code: 'network' } })
    render()
    expect(text()).toBe('Offline — your changes are saved on this device and sync when you are back online.')
    expect(bar().className).toContain('off')
    expect(label()).toBe('Try again')
    // Its row's height is what the page and the pinned headers leave free.
    expect(conn()).not.toBe('')
    await act(async () => { button().click() })
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('Offline — the server cannot be reached')
  })

  it('offline with nothing waiting: the copy on screen is the last synced one', () => {
    network(false)
    mocks.sync = sync('offline', { offline: true, lastError: { status: 0, code: 'timeout' } })
    render()
    expect(text()).toBe('Offline — showing the last copy synced with the server.')
  })

  // A proxy answering 502 without a CORS header fails fetch exactly as no network does; the phone
  // was online and still read "Offline … sync when you are back online" (Android QA, v1.3.9).
  it('the server out of reach while the device is online is the server, not the device', async () => {
    mocks.sync = sync('offline', { offline: true, pending: true, lastError: { status: 0, code: 'network' } })
    render()
    expect(text()).toBe('Your server cannot be reached — your changes are saved on this device and sync once it answers again.')
    expect(bar().className).toContain('off')
    expect(label()).toBe('Try again')
    await act(async () => { button().click() })
    expect(mocks.toast).toHaveBeenCalledWith('The server cannot be reached')
  })

  it('with nothing waiting it shows the last copy, and the words follow the network as it goes and comes', () => {
    mocks.sync = sync('offline', { offline: true, lastError: { status: 0, code: 'network' } })
    render()
    expect(text()).toBe('Your server cannot be reached — showing the last copy synced with it.')
    act(() => network(false))
    expect(text()).toBe('Offline — showing the last copy synced with the server.')
    act(() => network(true))
    expect(text()).toBe('Your server cannot be reached — showing the last copy synced with it.')
  })

  it('a server error carries its HTTP code, for whoever runs the server', () => {
    mocks.sync = sync('error', { pending: true, lastError: { status: 502, code: 'http' } })
    render()
    expect(text()).toBe('Your server answered with an error (HTTP 502). Your changes are kept here.')
    expect(bar().className).toContain('bad')
  })

  it('an answer that is not openGym\'s (a proxy\'s login page) is named as such', () => {
    mocks.sync = sync('error', { lastError: { status: 200, code: 'bad-response' } })
    render()
    expect(text()).toBe('Your server’s address answered with something other than openGym (HTTP 200). Your changes are kept here.')
  })

  it('phone refused by its server: "Pair again" opens the connect sheet with the address it had', () => {
    mocks.MOBILE = true
    mocks.sync = sync('auth', { auth: true, pending: true, lastError: { status: 401, code: 'auth' } })
    render()
    expect(text()).toBe('Your server no longer accepts this phone. Your changes are kept here.')
    expect(label()).toBe('Pair again')
    act(() => button().click())
    const sheet = openedConnect()
    expect(sheet.dataset.url).toBe(BASE)
    expect(sheet.dataset.again).toBe('true')
  })

  it('a phone an earlier version unpaired has no address left: pairing asks for it', () => {
    mocks.MOBILE = true
    mocks.sync = sync('auth', { auth: true, pending: true, server: null, lastError: { status: 0, code: 'not-paired' } })
    render()
    expect(text()).toBe('This phone is no longer paired with your server. Your changes are kept here.')
    act(() => button().click())
    expect(openedConnect().dataset.url).toBe('')
  })

  it('browser refused mid-session: "Sign in" is the passkey, right there', async () => {
    mocks.sync = sync('auth', { auth: true, pending: true, lastError: { status: 401, code: 'auth' } })
    render()
    expect(text()).toBe('Your server no longer accepts this browser. Your changes are kept here.')
    expect(label()).toBe('Sign in')
    await act(async () => { button().click() })
    expect(mocks.passkeyLogin).toHaveBeenCalledTimes(1)
  })

  it('on the sign-in screen after the server ended the session, it says the changes are still here', () => {
    mocks.user = null
    mocks.sync = sync('auth', { auth: true, lastError: { status: 401, code: 'auth' } })
    render()
    expect(text()).toBe('Your server no longer accepts this browser. Your changes are kept here.')
  })
})

describe('no server at all', () => {
  it('a phone kept local says so quietly, with a way to connect', () => {
    mocks.MOBILE = true
    mocks.user = null
    mocks.guest = true
    mocks.sync = sync('local', { server: null })
    render()
    expect(bar().className).toContain('quiet')
    expect(text()).toBe('On this phone only — not connected to a server')
    expect(label()).toBe('Connect')
    act(() => button().click())
    expect(openedConnect().dataset.again).toBe('false')
  })

  it('a guest in a browser: "Sign in" leads to Settings, where signing in and creating a profile are', () => {
    mocks.user = null
    mocks.guest = true
    mocks.sync = sync('local')
    render()
    expect(text()).toBe('Guest mode — data lives only in this browser.')
    act(() => button().click())
    expect(mocks.navs).toEqual(['/settings'])
    expect(mocks.passkeyLogin).not.toHaveBeenCalled()
  })

  it('a browser without passkeys still hears it, with nothing to press', () => {
    mocks.user = null
    mocks.guest = true
    mocks.webauthn = false
    mocks.sync = sync('local')
    render()
    expect(text()).toBe('Guest mode — data lives only in this browser.')
    expect(button()).toBeNull()
  })

  it('the sign-in screen of a browser nobody signed in on is left alone', () => {
    mocks.user = null
    mocks.sync = sync('local')
    render()
    expect(bar()).toBeNull()
  })
})

// Review of 771184c9: while a sign-in's question held sync, the screens said nothing at all.
describe('a sign-in waiting for its question', () => {
  it('says nothing syncs until it is answered, and the tap runs Sync now, which asks it', () => {
    mocks.sync = sync('held')
    render()
    expect(text()).toBe('Nothing syncs until you say whether this device’s workouts go into your profile — tap to answer.')
    expect(connectionView(sync('held')).line).toBe('Waiting for your answer about this device’s workouts')
    act(() => { button().click() })
    expect(mocks.syncNow).toHaveBeenCalled()
  })
})

describe('where it never shows', () => {
  it('the public demo, which has no server by design', () => {
    mocks.DEMO = true
    mocks.user = null
    mocks.guest = true
    mocks.sync = sync('local')
    render()
    expect(bar()).toBeNull()
  })

  it('the phone\'s first-launch choice', () => {
    mocks.MOBILE = true
    mocks.user = null
    mocks.onboarding = true
    mocks.sync = sync('local', { server: null })
    render()
    expect(bar()).toBeNull()
  })
})

describe('a change waiting while the server is reachable', () => {
  it('does not flash: only a wait longer than the grace period is shown', () => {
    vi.useFakeTimers()
    mocks.sync = sync('pending', { pending: true })
    render()
    expect(bar()).toBeNull()
    act(() => { vi.advanceTimersByTime(PENDING_GRACE_MS - 100) })
    expect(bar()).toBeNull()
    act(() => { vi.advanceTimersByTime(200) })
    expect(text()).toBe('Not synced yet — tap to retry.')
    expect(label()).toBeNull()   // the sentence already says "tap to retry"
  })

  it('a push that lands inside the grace period never shows it at all', () => {
    vi.useFakeTimers()
    mocks.sync = sync('pending', { pending: true })
    render()
    act(() => { vi.advanceTimersByTime(PENDING_GRACE_MS / 2) })
    mocks.sync = sync('ok', { lastSynced: Date.now() })
    render()
    act(() => { vi.advanceTimersByTime(PENDING_GRACE_MS) })
    expect(bar()).toBeNull()
    expect(conn()).toBe('')
  })
})
