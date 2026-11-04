// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SignInMethods from './SignInMethods.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings → Sign-in methods against a mocked firestore-sync module: the card lists
   what the server says the account has, offers link/add, and, the lockout guard,
   disables removing the account's last remaining way in. */
const mocks = vi.hoisted(() => {
  const state = { user: null, methods: null, sheets: [] }
  state.toast = vi.fn()
  state.fbSignInMethods = vi.fn(async () => state.methods)
  state.fbLinkGoogle = vi.fn(async () => ({ redirect: false }))
  state.fbUnlinkGoogle = vi.fn(async () => {})
  state.fbAddPasskeyLinked = vi.fn(async () => ({ ok: true, username: 'Alex' }))
  state.fbRemovePasskey = vi.fn(async () => ({ ok: true, passkeys: 0 }))
  state.fbLinkOutcome = vi.fn(async () => null)
  state.mod = {
    onFbAuthChange: fn => { fn({ user: state.user, ready: true }); return () => {} },
    fbSignInMethods: (...a) => state.fbSignInMethods(...a),
    fbLinkGoogle: (...a) => state.fbLinkGoogle(...a),
    fbUnlinkGoogle: (...a) => state.fbUnlinkGoogle(...a),
    fbAddPasskeyLinked: (...a) => state.fbAddPasskeyLinked(...a),
    fbRemovePasskey: (...a) => state.fbRemovePasskey(...a),
    fbLinkOutcome: (...a) => state.fbLinkOutcome(...a),
  }
  return state
})
vi.mock('../lib/firestore-sync.js', () => mocks.mod)
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({ confirmSheet: opts => { mocks.sheets.push(opts) } }))

const passkeyUser = { uid: 'u1', username: 'Alex', email: '', displayName: '', provider: '', providers: [] }
const googleUser = { uid: 'u2', username: '', email: 'friend@gmail.com', displayName: '', provider: 'google.com', providers: ['google.com'] }
const cred = (id, extra = {}) => ({ id, createdAt: 1730000000000, deviceType: 'multiDevice', backedUp: true, ...extra })

let host, root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = null
  mocks.methods = null
  mocks.sheets = []
  mocks.fbSignInMethods.mockImplementation(async () => mocks.methods)
  mocks.fbLinkGoogle.mockImplementation(async () => ({ redirect: false }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

async function render() {
  await act(async () => { root.render(<SignInMethods />) })
  await act(async () => {})
}
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const click = async el => { await act(async () => { el.click() }) }

describe('SignInMethods', () => {
  it('renders nothing when signed out', async () => {
    mocks.user = null
    await render()
    expect(host.textContent).toBe('')
  })

  it('a passkey account without Google: link offered, the only passkey cannot be removed', async () => {
    mocks.user = passkeyUser
    mocks.methods = { username: 'Alex', providers: [], passkeys: [cred('cred-1')] }
    await render()
    expect(host.textContent).toContain('Sign-in methods')
    expect(host.textContent).toContain('Not linked')
    expect(btn('Link Google')).toBeTruthy()
    expect(btn('Remove').disabled).toBe(true)
    expect(host.textContent).toContain('This is your only way in, so it cannot be removed.')
    expect(btn('Add a passkey')).toBeTruthy()
  })

  it('adding a passkey under the existing username runs the link ceremony and reloads', async () => {
    mocks.user = passkeyUser
    mocks.methods = { username: 'Alex', providers: [], passkeys: [cred('cred-1')] }
    await render()
    await click(btn('Add a passkey'))
    expect(mocks.fbAddPasskeyLinked).toHaveBeenCalledWith()
    expect(mocks.fbSignInMethods.mock.calls.length).toBeGreaterThan(1)
    expect(mocks.toast).toHaveBeenCalledWith('Passkey added')
  })

  it('linking Google runs and reloads the list', async () => {
    mocks.user = passkeyUser
    mocks.methods = { username: 'Alex', providers: [], passkeys: [cred('cred-1')] }
    await render()
    await click(btn('Link Google'))
    expect(mocks.fbLinkGoogle).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Google linked')
  })

  it('a Google account already in use by someone else gets the plain message, not the raw error', async () => {
    mocks.user = passkeyUser
    mocks.methods = { username: 'Alex', providers: [], passkeys: [cred('cred-1')] }
    mocks.fbLinkGoogle.mockImplementation(async () => { throw Object.assign(new Error('Firebase: Error (auth/credential-already-in-use).'), { code: 'auth/credential-already-in-use' }) })
    await render()
    await click(btn('Link Google'))
    expect(mocks.toast).toHaveBeenCalledWith('That Google account is already used by another account.')
  })

  it('a Google-first account: unlink is locked, and the first passkey asks for a username', async () => {
    mocks.user = googleUser
    mocks.methods = { username: null, providers: ['google.com'], passkeys: [] }
    await render()
    expect(host.textContent).toContain('friend@gmail.com')
    expect(btn('Unlink').disabled).toBe(true)
    await click(btn('Add a passkey'))
    const input = host.querySelector('input')
    expect(input).toBeTruthy()
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, 'NewName')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(btn('Add a passkey'))
    expect(mocks.fbAddPasskeyLinked).toHaveBeenCalledWith('NewName')
  })

  it('with two passkeys a remove is offered, confirmed, then sent to the server', async () => {
    mocks.user = passkeyUser
    mocks.methods = { username: 'Alex', providers: [], passkeys: [cred('cred-1'), cred('cred-2')] }
    await render()
    const removeBtns = [...host.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Remove')
    expect(removeBtns.length).toBe(2)
    expect(removeBtns[0].disabled).toBe(false)
    await click(removeBtns[0])
    expect(mocks.sheets.length).toBe(1)
    expect(mocks.sheets[0].title).toBe('Remove this passkey?')
    await act(async () => { await mocks.sheets[0].onConfirm() })
    expect(mocks.fbRemovePasskey).toHaveBeenCalledWith('cred-1')
  })

  it('with Google linked, the last passkey CAN be removed and Google CAN be unlinked', async () => {
    mocks.user = { ...passkeyUser, email: 'alex@example.com', providers: ['google.com'] }
    mocks.methods = { username: 'Alex', providers: ['google.com'], passkeys: [cred('cred-1')] }
    await render()
    expect(btn('Remove').disabled).toBe(false)
    expect(btn('Unlink').disabled).toBe(false)
    expect(host.textContent).not.toContain('only way in')
  })
})
