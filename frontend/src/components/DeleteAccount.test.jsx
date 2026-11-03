// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteAccountSheet, DeleteAccountRow, deleteAccountError } from './DeleteAccount.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* "Delete my account" on screen: the backup export is offered first, nothing goes on until the
   account's name is typed back, then the owner's proof (ProveOwner, the same step the other
   changes to a way in ask) carries the delete; on the phone, for a profile with no password, the
   phone's own screen lock comes first and the pairing carries it. The server's refusals are said
   in the UI language. The store and the API are stand-ins; what the sheet sends and says is the point. */
const mocks = vi.hoisted(() => {
  const state = { sheets: [], MOBILE: false, webauthn: true, proofs: { passkeys: [{ id: 'k1' }], password: true } }
  state.toast = vi.fn()
  state.deleteAccount = vi.fn(async () => {})
  state.passkeyAssertion = vi.fn(async () => ({ cid: 'c1', credential: { id: 'k1' } }))
  state.api = vi.fn(async path => { if (path === '/api/account/passkeys') return state.proofs; return {} })
  state.snapshot = () => ({ user: { id: 'u1', name: 'Mallory' }, deleteAccount: state.deleteAccount })
  state.lock = 'set'
  state.deviceLock = vi.fn(async () => state.lock)
  state.confirmDeviceOwner = vi.fn(async () => 'ok')
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a),
  webauthnOK: () => mocks.webauthn,
  passkeyAssertion: (...a) => mocks.passkeyAssertion(...a),
  passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
vi.mock('../lib/device-auth.js', () => ({
  deviceLock: (...a) => mocks.deviceLock(...a),
  confirmDeviceOwner: (...a) => mocks.confirmDeviceOwner(...a),
}))

const fail = (status, data) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
function type(el, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const submit = async host => { act(() => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle() }
const alertText = host => host.querySelector('[role="alert"]')?.textContent || null
const field = host => host.querySelector('input[placeholder="Account name"]')
const password = host => host.querySelector('input[placeholder="Current password"]')
// Past the name: typed, and "Continue".
async function toProof(host, name = 'Mallory') {
  await settle()   // what can prove it, read as the sheet opens
  type(field(host), name)
  await submit(host)
}

function sheet(props = {}) {
  const p = { close: vi.fn(), exportBackup: vi.fn(), exportBackupZip: vi.fn(), done: vi.fn(), hasMedia: false, ...props }
  return { p, host: mount(<DeleteAccountSheet {...p} />) }
}

beforeEach(() => {
  mocks.MOBILE = false
  mocks.webauthn = true
  mocks.proofs = { passkeys: [{ id: 'k1' }], password: true }
  mocks.api.mockClear()
  mocks.lock = 'set'
  mocks.deviceLock.mockClear()
  mocks.confirmDeviceOwner.mockReset()
  mocks.confirmDeviceOwner.mockImplementation(async () => 'ok')
  mocks.passkeyAssertion.mockClear()
  mocks.sheets.length = 0
  mocks.toast.mockClear()
  mocks.deleteAccount.mockReset()
  mocks.deleteAccount.mockImplementation(async () => {})
})
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove() }
})

describe('DeleteAccountSheet', () => {
  it('offers the backup export first: the JSON one, or the zip when there are photos and videos', () => {
    const plain = sheet()
    act(() => button(plain.host, 'Export backup (JSON)').click())
    expect(plain.p.exportBackup).toHaveBeenCalledTimes(1)
    expect(button(plain.host, 'Export with photos & videos (.zip)')).toBeUndefined()

    const media = sheet({ hasMedia: true })
    act(() => button(media.host, 'Export with photos & videos (.zip)').click())
    expect(media.p.exportBackupZip).toHaveBeenCalledTimes(1)
  })

  it('goes nowhere until the account name is typed back', async () => {
    const { host } = sheet()
    await settle()
    expect(host.textContent).toContain('Type Mallory to confirm.')
    expect(button(host, 'Continue').disabled).toBe(true)
    type(field(host), 'mallory')
    expect(button(host, 'Continue').disabled).toBe(true)
    await submit(host)
    expect(host.textContent).not.toContain('First confirm that it is you.')
    type(field(host), 'Mallory ')
    expect(button(host, 'Continue').disabled).toBe(false)
    await submit(host)
    expect(host.textContent).toContain('First confirm that it is you.')
    expect(mocks.deleteAccount).not.toHaveBeenCalled()   // the name alone deletes nothing
  })

  it('the passkey proves it and carries the delete; then it closes, says goodbye and hands over', async () => {
    const { p, host } = sheet()
    await toProof(host, ' Mallory')
    await act(async () => { button(host, 'Confirm with a passkey').click() })
    await settle()
    expect(mocks.passkeyAssertion).toHaveBeenCalled()
    expect(mocks.deleteAccount).toHaveBeenCalledWith('Mallory', { cid: 'c1', credential: { id: 'k1' } })
    expect(p.close).toHaveBeenCalled()
    expect(p.done).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Your account is gone. Thanks for every rep.')
  })

  it('or the current password, where it counts', async () => {
    const { host } = sheet()
    await toProof(host)
    type(password(host), 'correct horse battery staple')
    await submit(host)
    expect(mocks.deleteAccount).toHaveBeenCalledWith('Mallory', { current: 'correct horse battery staple' })
  })

  it('a wrong password is said, and nothing is gone', async () => {
    mocks.deleteAccount.mockRejectedValue(fail(403, { error: 'your current password is not right', code: 'current-wrong' }))
    const { p, host } = sheet()
    await toProof(host)
    type(password(host), 'nope nope nope')
    await submit(host)
    expect(alertText(host)).toBe('Your current password is not right.')
    expect(p.close).not.toHaveBeenCalled()
    expect(p.done).not.toHaveBeenCalled()
  })

  it('the last admin hears why, and the sheet stays open', async () => {
    mocks.deleteAccount.mockRejectedValue(fail(409, { error: 'the last admin cannot leave while other profiles remain', code: 'last-admin' }))
    const { p, host } = sheet()
    await toProof(host)
    type(password(host), 'correct horse battery staple')
    await submit(host)
    expect(alertText(host)).toBe('You’re the only admin here, and other profiles still use this server. Make someone else an admin first.')
    expect(p.close).not.toHaveBeenCalled()
  })

  it('the last admin hears why before typing the name or answering a prompt (QA v1.4.2)', async () => {
    mocks.proofs = { passkeys: [{ id: 'k1' }], password: true, deleteBlocked: 'last-admin' }
    const { p, host } = sheet()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(alertText(host)).toBe('You’re the only admin here, and other profiles still use this server. Make someone else an admin first.')
    expect(host.querySelector('#delete-account-name')).toBeNull()
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).not.toContain('Continue')
    expect(mocks.passkeyAssertion).not.toHaveBeenCalled()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(p.close).not.toHaveBeenCalled()
  })

  it('the phone app offers no passkey, which it cannot hold for the server, only the password', async () => {
    mocks.MOBILE = true
    const { host } = sheet()
    await toProof(host)
    expect(button(host, 'Confirm with a passkey')).toBeUndefined()
    expect(password(host)).toBeTruthy()
  })

  it('a phone with no password: its own lock is asked, then the pairing carries the delete', async () => {
    mocks.MOBILE = true
    mocks.proofs = { passkeys: [{ id: 'k1' }], password: false }
    const { p, host } = sheet()
    await toProof(host)
    expect(host.textContent).toContain('Your phone checks that it’s you (face, fingerprint or passcode), then the account is deleted.')
    expect(password(host)).toBeNull()
    await act(async () => { button(host, 'Delete forever').click() })
    await settle()
    expect(mocks.confirmDeviceOwner).toHaveBeenCalledWith('Confirm it’s you to delete your openGym account')
    expect(mocks.deleteAccount).toHaveBeenCalledWith('Mallory', {})
    expect(mocks.confirmDeviceOwner.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteAccount.mock.invocationCallOrder[0])
    expect(p.done).toHaveBeenCalled()
  })

  it('backed out of the phone’s lock, or failed: nothing is sent and the sheet stays', async () => {
    mocks.MOBILE = true
    mocks.proofs = { passkeys: [], password: false }
    const { p, host } = sheet()
    await toProof(host)
    for (const answer of ['cancelled', 'failed']) {
      mocks.confirmDeviceOwner.mockResolvedValueOnce(answer)
      await act(async () => { button(host, 'Delete forever').click() })
      await settle()
      expect(alertText(host)).toBe('Not confirmed on this phone. Nothing was deleted.')
    }
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(p.close).not.toHaveBeenCalled()
  })

  it('a phone with no screen lock says the typed name is the only check, and goes ahead', async () => {
    mocks.MOBILE = true
    mocks.lock = 'none'
    mocks.proofs = { passkeys: [], password: false }
    mocks.confirmDeviceOwner.mockResolvedValue('none')
    const { host } = sheet()
    await toProof(host)
    expect(host.textContent).toContain('This phone has no screen lock, so the name you typed is the only check.')
    await act(async () => { button(host, 'Delete forever').click() })
    await settle()
    expect(mocks.deleteAccount).toHaveBeenCalledWith('Mallory', {})
  })

  it('the web build never asks the phone’s lock', async () => {
    mocks.proofs = { passkeys: [], password: true }
    const { host } = sheet()
    await toProof(host)
    type(password(host), 'correct horse battery staple')
    await submit(host)
    expect(mocks.deleteAccount).toHaveBeenCalled()
    expect(mocks.deviceLock).not.toHaveBeenCalled()
    expect(mocks.confirmDeviceOwner).not.toHaveBeenCalled()
  })
})

describe('deleteAccountError', () => {
  it('words each refusal, and anything else as nothing removed', () => {
    expect(deleteAccountError(fail(400, { code: 'confirm-name' }))).toBe('That is not your account name.')
    expect(deleteAccountError(fail(409, { code: 'last-admin' }))).toMatch(/only admin/)
    expect(deleteAccountError(fail(403, { code: 'passkey' }))).toBe('Your passkey could not be confirmed.')
    expect(deleteAccountError(Object.assign(new Error('x'), { name: 'SecurityError' }))).toBe('Your passkey could not be confirmed.')
    expect(deleteAccountError(fail(500, {}))).toBe('Couldn’t delete the account. Nothing was removed.')
    expect(deleteAccountError(new TypeError('Failed to fetch'))).toBe('Couldn’t delete the account. Nothing was removed.')
  })
})

describe('DeleteAccountRow', () => {
  it('opens the sheet with what Settings hands it', () => {
    const exportBackup = vi.fn()
    const host = mount(<DeleteAccountRow exportBackup={exportBackup} hasMedia={false} />)
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Delete my account')).click())
    expect(mocks.sheets).toHaveLength(1)
    const inner = mount(mocks.sheets[0].render(() => {}))
    act(() => button(inner, 'Export backup (JSON)').click())
    expect(exportBackup).toHaveBeenCalled()
  })
})
