// @vitest-environment happy-dom

/* The phone's own "Confirm your name" screen (AppConfirmSheet) and the dispatcher that opens it
 * for a confirm return, mocked at the module boundary the way views/Login.oidc.test.jsx mocks its
 * own confirm screen: a mocked store and useUI, a mocked api.js appConfirm, createRoot + act.
 * oidc-app.js's own mapping is proven separately in lib/oidc-app.test.js - here it is mocked so
 * this file drives only the dispatch and the sheet. */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SENTENCE_TOAST_MS } from '../lib/oidc.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = {
    sheets: [], toasts: [], connectCalls: [], closeAllCalls: 0, appUrlOpen: null, finishAppReturn: null,
    sync: { server: 'https://gym.example.com' }
  }
  state.snapshotStore = () => ({
    connectViaProvider: (...args) => { state.connectCalls.push(args); return Promise.resolve() },
    sync: state.sync
  })
  state.requestLinkTicket = vi.fn(async () => 'a-link-ticket')
  state.requestProofTicket = vi.fn(async () => 'a-proof-ticket')
  state.takeAttempt = vi.fn()
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshotStore()) : mocks.snapshotStore())
  useStore.getState = mocks.snapshotStore
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({
    toast: (...args) => mocks.toasts.push(args),
    openSheet: render => { mocks.sheets.push(render); return {} },
    closeAll: () => { mocks.closeAllCalls += 1 }
  })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({ appConfirm: vi.fn(), appRedeem: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ onAppUrlOpen: cb => { mocks.appUrlOpen = cb } }))
vi.mock('../lib/oidc-app.js', () => ({
  beginAttempt: vi.fn(async () => ({ challenge: 'c'.repeat(43) })),
  appStartUrl: (base, mode, opts) => (mode === 'signIn'
    ? base + '/api/oidc/app/start?challenge=' + opts.challenge
    : base + '/api/oidc/app/' + mode + '/start?ticket=' + opts.ticket),
  finishAppReturn: (...args) => mocks.finishAppReturn(...args),
  takeAttempt: (...args) => mocks.takeAttempt(...args)
}))
vi.mock('../lib/oidc.js', () => ({
  SENTENCE_TOAST_MS: 6000,
  requestLinkTicket: (...args) => mocks.requestLinkTicket(...args),
  requestProofTicket: (...args) => mocks.requestProofTicket(...args)
}))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

import { appConfirm } from '../lib/api.js'
import { AppConfirmSheet, listenForProviderReturn, startProviderLink, startProviderProof, onIdentityChanged } from './AppSignIn.jsx'

const BASE = 'https://gym.example.com'

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  mocks.sheets.length = 0
  mocks.toasts.length = 0
  mocks.connectCalls.length = 0
  mocks.closeAllCalls = 0
  // Not reset to null: listenForProviderReturn registers its one listener idempotently (a
  // module-level guard), so only the first test in this file to call it ever really registers -
  // every later test that needs to dispatch a return reuses that same registered callback.
  mocks.finishAppReturn = null
  mocks.sync.server = BASE
  mocks.requestLinkTicket.mockClear().mockImplementation(async () => 'a-link-ticket')
  mocks.requestProofTicket.mockClear().mockImplementation(async () => 'a-proof-ticket')
  mocks.takeAttempt.mockClear()
  appConfirm.mockReset()
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
})

describe('AppConfirmSheet', () => {
  it('shows the heading and prefills the seeded name, with no invite field by default', () => {
    const page = mount(<AppConfirmSheet close={() => {}} base={BASE} handle="h1" name="Sam" invite={false} />)
    expect(page.textContent).toContain('Confirm your name')
    expect(page.querySelector('input').value).toBe('Sam')
    expect(page.querySelector('input[placeholder="Invite code"]')).toBeFalsy()
  })

  it('shows the invite field only when invite is true', () => {
    const page = mount(<AppConfirmSheet close={() => {}} base={BASE} handle="h1" name="Sam" invite />)
    expect(page.querySelector('input[placeholder="Invite code"]')).toBeTruthy()
  })

  it('an empty name toasts and sends nothing', () => {
    const page = mount(<AppConfirmSheet close={() => {}} base={BASE} handle="h1" name="" invite={false} />)
    act(() => button(page, 'Create profile').click())
    expect(mocks.toasts.at(-1)).toEqual(['Enter a name'])
    expect(appConfirm).not.toHaveBeenCalled()
  })

  it('invite-only with an empty code toasts and sends nothing', () => {
    const page = mount(<AppConfirmSheet close={() => {}} base={BASE} handle="h1" name="Sam" invite />)
    act(() => button(page, 'Create profile').click())
    expect(mocks.toasts.at(-1)).toEqual(['An invite code is required'])
    expect(appConfirm).not.toHaveBeenCalled()
  })

  it('a successful confirm calls appConfirm once, connects the store, closes the sheets and toasts Connected', async () => {
    appConfirm.mockResolvedValue({ token: 'TOKEN', user: { id: 'u1', name: 'Sam', admin: false } })
    const page = mount(<AppConfirmSheet close={() => {}} base={BASE} handle="h1" name="Sam" invite={false} />)
    act(() => button(page, 'Create profile').click())
    await settle()
    expect(appConfirm).toHaveBeenCalledTimes(1)
    expect(appConfirm).toHaveBeenCalledWith(BASE, { handle: 'h1', name: 'Sam', code: '' })
    expect(mocks.connectCalls.length).toBe(1)
    expect(mocks.connectCalls[0][0]).toBe(BASE)
    expect(mocks.connectCalls[0][1]).toEqual({ token: 'TOKEN', user: { id: 'u1', name: 'Sam', admin: false } })
    expect(mocks.closeAllCalls).toBe(1)
    expect(mocks.toasts.at(-1)).toEqual(['Connected'])
  })

  it('a 403 invite-invalid keeps the sheet open with the typed name, and another try with the same handle is possible', async () => {
    appConfirm.mockImplementation(async () => { const e = new Error('bad'); e.status = 403; e.data = { code: 'invite-invalid' }; throw e })
    const page = mount(<AppConfirmSheet close={() => {}} base={BASE} handle="h1" name="Sam" invite />)
    type(page.querySelector('input[placeholder="Invite code"]'), 'WRONG123')
    act(() => button(page, 'Create profile').click())
    await settle()
    expect(mocks.toasts.at(-1)).toEqual(["That invite code isn't valid anymore - try again with a current one.", SENTENCE_TOAST_MS])
    expect(mocks.closeAllCalls).toBe(0)
    expect(page.querySelector('input').value).toBe('Sam')

    appConfirm.mockResolvedValue({ token: 'T2', user: { id: 'u2', name: 'Sam', admin: false } })
    act(() => button(page, 'Create profile').click())
    await settle()
    expect(appConfirm).toHaveBeenLastCalledWith(BASE, { handle: 'h1', name: 'Sam', code: 'WRONG123' })
    expect(mocks.closeAllCalls).toBe(1)
  })

  it('a 401 state-expired closes nothing but says the attempt expired', async () => {
    appConfirm.mockImplementation(async () => { const e = new Error('bad'); e.status = 401; e.data = { code: 'state-expired' }; throw e })
    const page = mount(<AppConfirmSheet close={() => {}} base={BASE} handle="h1" name="Sam" invite={false} />)
    act(() => button(page, 'Create profile').click())
    await settle()
    expect(mocks.toasts.at(-1)).toEqual(['The sign-in attempt expired - try again.', SENTENCE_TOAST_MS])
    expect(mocks.closeAllCalls).toBe(0)
  })

  it('"This isn\'t me - go back" closes the sheet and sends nothing', () => {
    const close = vi.fn()
    const page = mount(<AppConfirmSheet close={close} base={BASE} handle="h1" name="Sam" invite={false} />)
    act(() => button(page, "This isn't me - go back").click())
    expect(close).toHaveBeenCalledTimes(1)
    expect(appConfirm).not.toHaveBeenCalled()
  })
})

describe('listenForProviderReturn: a confirm return', () => {
  it('opens AppConfirmSheet, prefilled with the seeded name and the invite field shown', async () => {
    mocks.finishAppReturn = vi.fn(async () => ({ kind: 'confirm', base: BASE, handle: 'h1', name: 'Sam', invite: true }))
    listenForProviderReturn()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'a'.repeat(20) }); await settle() })
    expect(mocks.closeAllCalls).toBe(1)
    expect(mocks.sheets.length).toBe(1)
    const page = mount(mocks.sheets[0](() => {}))
    expect(page.textContent).toContain('Confirm your name')
    expect(page.querySelector('input').value).toBe('Sam')
    expect(page.querySelector('input[placeholder="Invite code"]')).toBeTruthy()
  })
})

describe('startProviderLink', () => {
  it('begins a link attempt, buys a ticket with the proof and this phone\'s own challenge, and departs', async () => {
    const before = window.location.href
    await startProviderLink({ cid: 'c1' })
    expect(mocks.requestLinkTicket).toHaveBeenCalledWith({ cid: 'c1', challenge: 'c'.repeat(43) })
    expect(window.location.href).not.toBe(before)
    expect(window.location.href).toBe(BASE + '/api/oidc/app/link/start?ticket=a-link-ticket')
  })

  it('a refused ticket throws to the caller and takes the attempt it began back out', async () => {
    mocks.requestLinkTicket.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 409, data: { code: 'profile-linked' } }))
    await expect(startProviderLink({ cid: 'c1' })).rejects.toMatchObject({ data: { code: 'profile-linked' } })
    expect(mocks.takeAttempt).toHaveBeenCalledTimes(1)
  })

  it('without a paired server, throws the not-connected sentence and buys no ticket', async () => {
    mocks.sync.server = null
    await expect(startProviderLink({ cid: 'c1' })).rejects.toMatchObject({ message: 'This phone is not connected to a server.' })
    expect(mocks.requestLinkTicket).not.toHaveBeenCalled()
  })
})

describe('startProviderProof', () => {
  it('begins a proof attempt, buys a ticket for the act and the challenge, registers a waiter, and departs', async () => {
    const before = window.location.href
    const unsub = await startProviderProof('identity-remove', vi.fn())
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('identity-remove', 'c'.repeat(43))
    expect(window.location.href).not.toBe(before)
    expect(window.location.href).toBe(BASE + '/api/oidc/app/proof/start?ticket=a-proof-ticket')
    expect(typeof unsub).toBe('function')
  })

  it('a refused ticket throws to the caller and takes the attempt it began back out', async () => {
    mocks.requestProofTicket.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 400, data: { code: 'act-invalid' } }))
    await expect(startProviderProof('device-link', vi.fn())).rejects.toMatchObject({ data: { code: 'act-invalid' } })
    expect(mocks.takeAttempt).toHaveBeenCalledTimes(1)
  })

  it('without a paired server, throws the not-connected sentence and buys no ticket', async () => {
    mocks.sync.server = null
    await expect(startProviderProof('identity-remove', vi.fn())).rejects.toMatchObject({ message: 'This phone is not connected to a server.' })
    expect(mocks.requestProofTicket).not.toHaveBeenCalled()
  })
})

describe('listenForProviderReturn: a linked return', () => {
  it('toasts Identity linked, closes the sheets and notifies every onIdentityChanged subscriber - until unsubscribed', async () => {
    const cb = vi.fn()
    const unsub = onIdentityChanged(cb)
    mocks.finishAppReturn = vi.fn(async () => ({ kind: 'linked' }))
    listenForProviderReturn()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'a'.repeat(20) }); await settle() })
    expect(mocks.toasts.at(-1)).toEqual(['Identity linked'])
    expect(mocks.closeAllCalls).toBe(1)
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'b'.repeat(20) }); await settle() })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

describe('listenForProviderReturn: a proof return', () => {
  it('calls the waiter registered for that act exactly once, with the proof id', async () => {
    const onProof = vi.fn()
    await startProviderProof('email', onProof)
    mocks.finishAppReturn = vi.fn(async () => ({ kind: 'proof', act: 'email', proof: 'p1' }))
    listenForProviderReturn()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'a'.repeat(20) }); await settle() })
    expect(onProof).toHaveBeenCalledTimes(1)
    expect(onProof).toHaveBeenCalledWith('p1')
    // A second proof return for the same act finds the waiter already spent.
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'b'.repeat(20) }); await settle() })
    expect(onProof).toHaveBeenCalledTimes(1)
  })

  it('with no waiter held for that act - the sheet closed, or the app was restarted - toasts the expired-confirmation sentence and calls nothing', async () => {
    mocks.finishAppReturn = vi.fn(async () => ({ kind: 'proof', act: 'password-remove', proof: 'p1' }))
    listenForProviderReturn()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'a'.repeat(20) }); await settle() })
    expect(mocks.toasts.at(-1)).toEqual(['The confirmation attempt expired - try again.', 6000])
  })

  it('unmounting before it comes back removes the waiter: a later return finds nothing to call', async () => {
    const onProof = vi.fn()
    const unsub = await startProviderProof('email-remove', onProof)
    unsub()
    mocks.finishAppReturn = vi.fn(async () => ({ kind: 'proof', act: 'email-remove', proof: 'p1' }))
    listenForProviderReturn()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'a'.repeat(20) }); await settle() })
    expect(onProof).not.toHaveBeenCalled()
  })
})

describe('listenForProviderReturn: mode-specific failures', () => {
  it('a sign-in failure is worded by oidcErrorKey', async () => {
    mocks.finishAppReturn = vi.fn(async () => ({ kind: 'failed', mode: 'signIn', code: 'locked' }))
    listenForProviderReturn()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'a'.repeat(20) }); await settle() })
    expect(mocks.toasts.at(-1)).toEqual(['Too many attempts - wait a minute and try again.', 6000])
  })

  it('a link failure is worded by oidcLinkErrorKey', async () => {
    mocks.finishAppReturn = vi.fn(async () => ({ kind: 'failed', mode: 'link', code: 'identity-collision' }))
    listenForProviderReturn()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'a'.repeat(20) }); await settle() })
    expect(mocks.toasts.at(-1)).toEqual(['This identity is already linked to another profile on this instance. Sign out and sign in with it directly to reach that profile.', 6000])
  })

  it('a proof failure is worded by oidcProofErrorKey', async () => {
    mocks.finishAppReturn = vi.fn(async () => ({ kind: 'failed', mode: 'proof', code: 'identity-mismatch' }))
    listenForProviderReturn()
    await act(async () => { mocks.appUrlOpen({ url: 'opengym://oidc?code=' + 'a'.repeat(20) }); await settle() })
    expect(mocks.toasts.at(-1)).toEqual(["That wasn't the linked identity for this profile - try again with the right account.", 6000])
  })
})
