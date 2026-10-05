// @vitest-environment happy-dom

/* The connect sheet's behavior once a typed server's GET /api/config reports a provider: "Sign in
 * with {name}" becomes the one primary action, pairing moves under a divider as the secondary
 * path, and a browser left without finishing leaves only a quiet note - never a blocking wait. A
 * server with no provider (or one still being looked up) renders exactly as the sheet always has.
 * lib/oidc-app.js's own attempt storage runs for real here (peekAttempt/takeAttempt); only the
 * server lookup, the provider departure call and the surrounding app wiring are mocked. */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ oidc: null, connectCalls: [], toasts: [], onActive: null, onActiveRemoved: false }))

vi.mock('../lib/api.js', () => ({
  serverConfig: vi.fn(async () => (mocks.oidc ? { oidc: mocks.oidc } : {})),
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: true,
  // Mirrors the real onAppActive's contract: a caller gets back the unsubscribe that removes
  // the listener, which useAttemptUnfinished's effect cleanup must call on unmount.
  onAppActive: cb => { mocks.onActive = cb; mocks.onActiveRemoved = false; return () => { mocks.onActiveRemoved = true } },
  onAppUrlOpen: () => () => {},
}))
vi.mock('../components/AppSignIn.jsx', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, startProviderSignIn: vi.fn(actual.startProviderSignIn) }
})
vi.mock('../store/useStore.js', () => ({
  useStore: () => ({ connectToServer: (...args) => { mocks.connectCalls.push(args); return Promise.resolve() } }),
}))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...args) => mocks.toasts.push(args), openSheet: () => {} })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

import { serverConfig } from '../lib/api.js'
import { startProviderSignIn } from '../components/AppSignIn.jsx'
import { peekAttempt, takeAttempt } from '../lib/oidc-app.js'
import { ConnectSheet } from './MobileOnboarding.jsx'

const BASE = 'https://gym.example.com'
const DEBOUNCE_MS = 450
const GRACE_MS = 1500

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const buttons = host => [...host.querySelectorAll('button')].map(b => b.textContent)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const primaries = host => [...host.querySelectorAll('.btn.primary')].map(b => b.textContent)
const addressInput = host => host.querySelector('input[placeholder^="Server address"]')
function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function settle(ms) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
async function typeAndSettle(host, url) {
  type(addressInput(host), url)
  await settle(DEBOUNCE_MS)
}
// startProviderSignIn awaits beginAttempt's WebCrypto digest before writing the attempt record.
// The digest settles on the platform's own schedule, which fake timers do not control and a busy
// test run can stretch past any fixed number of microtask turns, so wait for the call itself.
async function clickProvider(host, text = 'Sign in with Google') {
  act(() => button(host, text).click())
  await act(async () => { await startProviderSignIn.mock.results.at(-1)?.value })
}

beforeEach(() => {
  mocks.oidc = null
  mocks.connectCalls.length = 0
  mocks.toasts.length = 0
  mocks.onActive = null
  mocks.onActiveRemoved = false
  serverConfig.mockClear()
  startProviderSignIn.mockClear()
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
  vi.useRealTimers()
})

describe('ConnectSheet - a server with no provider', () => {
  it('renders exactly as before: one primary button, labelled Connect, no provider UI at all', async () => {
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    expect(buttons(host).some(b => /^Sign in with /.test(b))).toBe(false)
    expect(host.textContent).not.toContain('or pair with a code')
    expect(host.textContent).not.toContain('Sign-in was not finished')
    expect(primaries(host)).toEqual(['Connect'])
  })
})

describe('ConnectSheet - a server with a provider', () => {
  it('leads with "Sign in with Google" as the only primary action, pairing secondary under a divider', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    expect(primaries(host)).toEqual(['Sign in with Google'])
    expect(host.textContent).toContain('or pair with a code')
    expect(button(host, 'Connect')).toBeTruthy()
  })

  it('reads "Sign in again with Google" when opened as pair-again for a server with a provider', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} initialUrl={BASE} again />)
    await settle(DEBOUNCE_MS)
    expect(button(host, 'Sign in again with Google')).toBeTruthy()
  })

  it('tapping the provider button starts an attempt for the typed server, and the sheet stays open and fully enabled', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    await clickProvider(host)
    expect(startProviderSignIn).toHaveBeenCalledWith(BASE)
    const attempt = peekAttempt()
    expect(attempt?.mode).toBe('signIn')
    expect(document.body.contains(host)).toBe(true)
    expect(button(host, 'Sign in with Google').disabled).toBeFalsy()
    expect(button(host, 'Connect').disabled).toBeFalsy()
  })

  it('shows "Sign-in was not finished" once the app returns to the foreground past the grace period with the attempt unhandled, and the button still works', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    await clickProvider(host)
    expect(typeof mocks.onActive).toBe('function')
    act(() => mocks.onActive())
    await settle(GRACE_MS)
    expect(host.textContent).toContain('Sign-in was not finished')
    expect(button(host, 'Sign in with Google').disabled).toBeFalsy()
  })

  it('shows no note when the return is handled within the grace period', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    await clickProvider(host)
    act(() => mocks.onActive())
    takeAttempt()   // stands in for a redeem completing before the grace period elapses
    await settle(GRACE_MS)
    expect(host.textContent).not.toContain('Sign-in was not finished')
  })

  it('starting a second attempt replaces the first attempt\'s record, and the note disappears', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    await clickProvider(host)
    act(() => mocks.onActive())
    await settle(GRACE_MS)
    expect(host.textContent).toContain('Sign-in was not finished')

    await clickProvider(host)
    expect(host.textContent).not.toContain('Sign-in was not finished')
    expect(startProviderSignIn).toHaveBeenCalledTimes(2)
  })

  it('typing a different address after a lookup drops the old answer - a provider is never shown for an address it was not reported for', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    expect(button(host, 'Sign in with Google')).toBeTruthy()

    mocks.oidc = null
    await typeAndSettle(host, 'https://other.example.com')
    expect(button(host, 'Sign in with Google')).toBeFalsy()
  })

  it('disables the provider button for the one departure in flight, and re-enables it once that call settles', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    act(() => button(host, 'Sign in with Google').click())
    // Not yet awaited: the departure's own promise (beginAttempt's WebCrypto digest) is still in
    // flight, and the button must already read as disabled from this render alone. The shared
    // `busy` state also renames the pairing button's label, same as go() already does.
    expect(button(host, 'Sign in with Google').disabled).toBe(true)
    expect(button(host, 'Connecting…').disabled).toBe(true)
    await act(async () => { await startProviderSignIn.mock.results.at(-1)?.value })
    expect(button(host, 'Sign in with Google').disabled).toBeFalsy()
    expect(button(host, 'Connect').disabled).toBeFalsy()
  })

  it('a rapid double-tap begins only one attempt', async () => {
    mocks.oidc = { name: 'Google' }
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    // Two taps issued back to back, each flushed by its own act() the way two real, separate
    // click events would be - the second must find the button already disabled (or the guard
    // itself must refuse it) rather than starting a second, independent attempt.
    act(() => button(host, 'Sign in with Google').click())
    act(() => { button(host, 'Sign in with Google')?.click() })
    await act(async () => { await startProviderSignIn.mock.results.at(-1)?.value })
    expect(startProviderSignIn).toHaveBeenCalledTimes(1)
    const attempt = peekAttempt()
    expect(attempt?.mode).toBe('signIn')
  })

  it('unmounting the sheet releases the foreground listener and lets no timer fire into it afterwards', async () => {
    mocks.oidc = { name: 'Google' }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = mount(<ConnectSheet close={() => {}} />)
    await typeAndSettle(host, BASE)
    await clickProvider(host)
    expect(typeof mocks.onActive).toBe('function')
    act(() => mocks.onActive())   // the app returns to the foreground - the grace timer starts
    act(() => { mounted.pop().root.unmount(); host.remove() })
    expect(mocks.onActiveRemoved).toBe(true)
    await settle(GRACE_MS)   // the grace period elapses after the sheet is gone
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
