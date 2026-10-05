// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddPasskeySheet, RemovePasskeySheet, DeviceLinkSheet, resumePasskeyProof, passkeysState } from './Passkeys.jsx'
import { PasswordSheet, EmailSheet, resumePasswordProof, passwordStatus } from './PasswordAuth.jsx'
import { RemoveIdentitySheet, resumeIdentityProof, reopenAfterProof } from './Identity.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Every "confirm it is you" sheet offers the provider for its own change: the six existing
   call sites (Passkeys.jsx, PasswordAuth.jsx) and the identity removal sheet (Identity.jsx), each
   with the exact act its server route takes, and each reopenable already past its proof step once
   a provider round trip proved it. Linking has no proof step of its own to resume - the option
   only ever renders once an identity is already linked, which is covered by Identity.test.jsx and
   PasswordAuth.provider.test.jsx already. What each sheet sends the provider proof for, and how
   the one dispatcher (reopenAfterProof) routes a remembered change back to the sheet that made it,
   is the point here. */
const mocks = vi.hoisted(() => {
  const state = { webauthn: true, config: { password_login: true }, sheets: [], answers: {}, calls: [] }
  state.toast = vi.fn()
  state.passkeyAssertion = vi.fn(async () => ({ cid: 'c1', credential: { id: 'k1' } }))
  state.createPasskey = vi.fn(async () => ({ id: 'new-key', response: {} }))
  state.copyText = vi.fn(async () => true)
  state.requestProofTicket = vi.fn(async () => 'a-proof-ticket')
  state.oidcProofStartUrl = vi.fn(ticket => '/api/oidc/proof/start?ticket=' + ticket)
  state.requestLinkTicket = vi.fn(async () => 'a-link-ticket')
  state.removeIdentity = vi.fn(async () => ({}))
  state.api = vi.fn(async (path, init) => {
    const method = init?.method || 'GET'
    state.calls.push({ path, method, body: init?.body ? JSON.parse(init.body) : null })
    const a = state.answers[method + ' ' + path.split('?')[0]]
    if (a instanceof Error) throw a
    return typeof a === 'function' ? a() : a ?? {}
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: { id: 'u1', name: 'Ana' }, config: mocks.config })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
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
  createPasskey: (...a) => mocks.createPasskey(...a),
  passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/oidc.js', () => ({
  requestProofTicket: (...a) => mocks.requestProofTicket(...a),
  oidcProofStartUrl: (...a) => mocks.oidcProofStartUrl(...a),
  requestLinkTicket: (...a) => mocks.requestLinkTicket(...a),
  oidcLinkStartUrl: ticket => '/api/oidc/link/start?ticket=' + ticket,
  removeIdentity: (...a) => mocks.removeIdentity(...a),
  SENTENCE_TOAST_MS: 6000,
}))
vi.mock('../lib/clipboard.js', () => ({ copyText: (...a) => mocks.copyText(...a) }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
vi.mock('./QrCanvas.jsx', () => ({ default: ({ value }) => <canvas data-qr={value} /> }))

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
const byPlaceholder = (host, p) => host.querySelector(`input[placeholder="${p}"]`)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const click = async (host, text) => { act(() => button(host, text).click()); await settle() }
const submit = async host => { act(() => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle() }
// The sheet a tap (or a resume opener) opened, mounted on its own.
const openedSheet = (i = mocks.sheets.length - 1) => { const close = vi.fn(); return { host: mount(mocks.sheets[i].render(close)), close } }

beforeEach(() => {
  mocks.webauthn = true
  mocks.config = { password_login: true, oidc: { name: 'Example ID' } }
  mocks.sheets.length = 0
  mocks.answers = {}
  mocks.calls.length = 0
  mocks.toast.mockClear()
  mocks.passkeyAssertion.mockClear()
  mocks.createPasskey.mockClear()
  mocks.copyText.mockClear()
  mocks.requestProofTicket.mockClear().mockResolvedValue('a-proof-ticket')
  mocks.oidcProofStartUrl.mockClear()
  mocks.requestLinkTicket.mockClear().mockResolvedValue('a-link-ticket')
  mocks.removeIdentity.mockClear().mockResolvedValue({})
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const PASSKEY = { id: 'k1', name: 'Laptop', created: null, lastUsed: null, transports: [] }
const LINKED = { providerName: 'Example ID', email: null, linkedAt: '2026-01-01T00:00:00.000Z', usable: true }
const LIST_WITH_IDENTITY = { passkeys: [PASSKEY], password: false, identity: LINKED, lastWayIn: false }
const STATUS_WITH_IDENTITY = { set: true, setAt: null, passkeys: 0, name: 'Ana', nameTaken: false, email: null, identity: true }

describe('every proof-gated sheet offers the provider for its own act', () => {
  it('RemovePasskeySheet: passkey-remove', async () => {
    const host = mount(<RemovePasskeySheet passkey={PASSKEY} title="Laptop" state={LIST_WITH_IDENTITY} close={() => {}} done={() => {}} />)
    expect(host.textContent).toContain('or confirm with Example ID')
    await click(host, 'Confirm with Example ID')
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('passkey-remove')
    expect(mocks.oidcProofStartUrl).toHaveBeenCalledWith('a-proof-ticket')
  })

  it('AddPasskeySheet: passkey-add', async () => {
    const host = mount(<AddPasskeySheet state={LIST_WITH_IDENTITY} close={() => {}} done={() => {}} />)
    await click(host, 'Confirm with Example ID')
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('passkey-add')
  })

  it('DeviceLinkSheet: device-link', async () => {
    mocks.answers['GET /api/account/passkeys'] = LIST_WITH_IDENTITY
    const host = mount(<DeviceLinkSheet close={() => {}} />)
    await settle()
    await click(host, 'Confirm with Example ID')
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('device-link')
  })

  it('RemovePasswordSheet (via PasswordSheet): password-remove', async () => {
    const host = mount(<PasswordSheet status={STATUS_WITH_IDENTITY} close={() => {}} done={() => {}} />)
    // No passkey, but a linked identity remains: "Remove password" is offered.
    await click(host, 'Remove password')
    const { host: sheet } = openedSheet()
    await click(sheet, 'Confirm with Example ID')
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('password-remove')
  })

  it('EmailSheet at the confirm step: email', async () => {
    const host = mount(<EmailSheet status={STATUS_WITH_IDENTITY} close={() => {}} done={() => {}} />)
    type(byPlaceholder(host, 'E-mail address'), 'ana@example.com')
    await submit(host)
    await click(host, 'Confirm with Example ID')
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('email')
  })

  it('RemoveEmailSheet (via EmailSheet): email-remove', async () => {
    const host = mount(<EmailSheet status={{ ...STATUS_WITH_IDENTITY, email: 'ana@example.com' }} close={() => {}} done={() => {}} />)
    await click(host, 'Remove e-mail')
    const { host: sheet } = openedSheet()
    await click(sheet, 'Confirm with Example ID')
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('email-remove')
  })

  it('RemoveIdentitySheet: identity-remove', async () => {
    const host = mount(<RemoveIdentitySheet close={() => {}} state={LIST_WITH_IDENTITY} done={() => {}} />)
    await click(host, 'Confirm with Example ID')
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('identity-remove')
  })
})

describe('an identity that no longer signs in is never offered as a proof', () => {
  const STALE = { ...LIST_WITH_IDENTITY, identity: { ...LINKED, providerName: null, usable: false } }

  it('RemovePasskeySheet, AddPasskeySheet and DeviceLinkSheet offer only the passkey', async () => {
    mocks.answers['GET /api/account/passkeys'] = STALE
    for (const el of [
      <RemovePasskeySheet passkey={PASSKEY} title="Laptop" state={STALE} close={() => {}} done={() => {}} />,
      <AddPasskeySheet state={STALE} close={() => {}} done={() => {}} />,
      <DeviceLinkSheet close={() => {}} />
    ]) {
      const host = mount(el)
      await settle()
      expect(button(host, 'Confirm with a passkey')).toBeTruthy()
      expect(host.textContent).not.toMatch(/Confirm with Example ID|or confirm with/)
    }
  })

  it('RemoveIdentitySheet says it no longer signs in, and asks for the passkey instead', async () => {
    const host = mount(<RemoveIdentitySheet close={() => {}} state={STALE} done={() => {}} />)
    expect(host.textContent).toContain('This identity can no longer sign in - its provider is not set up on this instance any more.')
    expect(host.textContent).not.toMatch(/Confirm with Example ID|or confirm with/)
    await click(host, 'Confirm with a passkey')
    expect(mocks.removeIdentity).toHaveBeenCalledWith({ cid: 'c1', credential: { id: 'k1' } })
  })

  it('resumeIdentityProof does not reopen a removal for it', () => {
    expect(resumeIdentityProof('identity-remove', undefined, { state: STALE, done: vi.fn() })).toBe(false)
  })
})

describe('PasswordSheet: "Remove password" follows the one way-in count the server reports', () => {
  it('offered with a linked identity and no passkey', () => {
    const host = mount(<PasswordSheet status={{ set: true, passkeys: 0, name: 'Ana', identity: true }} close={() => {}} done={() => {}} />)
    expect(button(host, 'Remove password')).toBeDefined()
  })
  it('not offered with neither a passkey nor a linked identity', () => {
    const host = mount(<PasswordSheet status={{ set: true, passkeys: 0, name: 'Ana', identity: false }} close={() => {}} done={() => {}} />)
    expect(button(host, 'Remove password')).toBeUndefined()
  })
})

describe('resumePasskeyProof', () => {
  it('opens AddPasskeySheet with the remembered name, resumed', () => {
    const changed = vi.fn()
    expect(resumePasskeyProof('passkey-add', { name: 'YubiKey' }, { st: LIST_WITH_IDENTITY, changed })).toBe(true)
    const { host } = openedSheet()
    expect(host.querySelector('h3').textContent).toBe('Add a passkey')
    expect(byPlaceholder(host, 'Name, e.g. Work laptop').value).toBe('YubiKey')
  })

  it('opens RemovePasskeySheet for the passkey found by id, its numbered title', () => {
    const st = { passkeys: [{ id: 'a', name: null }, { id: 'b', name: 'Phone' }], password: false, identity: null, lastWayIn: false }
    expect(resumePasskeyProof('passkey-remove', { id: 'b' }, { st, changed: vi.fn() })).toBe(true)
    const { host } = openedSheet()
    expect(host.textContent).toContain('Phone')
  })

  it('answers false for a passkey no longer listed', () => {
    const st = { passkeys: [], password: false, identity: null, lastWayIn: false }
    expect(resumePasskeyProof('passkey-remove', { id: 'gone' }, { st, changed: vi.fn() })).toBe(false)
    expect(mocks.sheets).toHaveLength(0)
  })

  it('opens DeviceLinkSheet, resumed', () => {
    expect(resumePasskeyProof('device-link', undefined, { st: LIST_WITH_IDENTITY, changed: vi.fn() })).toBe(true)
    const { host } = openedSheet()
    expect(host.querySelector('h3').textContent).toBe('Add another device')
  })

  it('answers false for any other act', () => {
    expect(resumePasskeyProof('email', {}, { st: LIST_WITH_IDENTITY, changed: vi.fn() })).toBe(false)
  })
})

describe('a resumed sheet spends the provider proof once', () => {
  const proofCalls = path => mocks.calls.filter(c => c.path === path && c.body?.identityProof === true).length

  it('DeviceLinkSheet: "Make a new code" asks for a fresh proof instead of resending the spent one', async () => {
    mocks.answers['GET /api/account/passkeys'] = LIST_WITH_IDENTITY
    mocks.answers['POST /api/account/device-link'] = () => ({ code: 'ABCDEF123456', expires: Date.now() - 1 })
    const host = mount(<DeviceLinkSheet close={() => {}} resume />)
    await settle(); await settle()
    expect(proofCalls('/api/account/device-link')).toBe(1)
    await click(host, 'Make a new code')
    await settle()
    expect(proofCalls('/api/account/device-link')).toBe(1)
    expect(button(host, 'Confirm with a passkey')).toBeTruthy()
  })

  it('AddPasskeySheet: a retry after the server spent the challenge asks for a fresh proof', async () => {
    mocks.answers['POST /api/account/passkeys/options'] = { cid: 'add-cid', options: { challenge: 'abc' } }
    mocks.answers['POST /api/account/passkeys/verify'] = Object.assign(new Error('expired'), { status: 400, data: { code: 'challenge' } })
    const host = mount(<AddPasskeySheet state={LIST_WITH_IDENTITY} close={() => {}} done={() => {}} resume />)
    await settle()
    expect(proofCalls('/api/account/passkeys/options')).toBe(1)
    await click(host, 'Create passkey')
    await settle()
    expect(proofCalls('/api/account/passkeys/options')).toBe(1)
    expect(button(host, 'Confirm with a passkey')).toBeTruthy()
  })

  it('EmailSheet: back to the address and on to the confirm step again asks for a fresh proof', async () => {
    mocks.answers['POST /api/account/email'] = Object.assign(new Error('in use'), { status: 409, data: { code: 'email-taken' } })
    const host = mount(<EmailSheet status={STATUS_WITH_IDENTITY} initialEmail="ana@example.com" close={() => {}} done={() => {}} resume />)
    await settle()
    expect(proofCalls('/api/account/email')).toBe(1)
    await click(host, 'Back')
    await submit(host)
    await settle()
    expect(proofCalls('/api/account/email')).toBe(1)
    expect(button(host, 'Confirm with Example ID')).toBeTruthy()
  })
})

describe('resumePasswordProof', () => {
  it('opens RemovePasswordSheet, resumed', () => {
    const changed = vi.fn()
    expect(resumePasswordProof('password-remove', undefined, { status: STATUS_WITH_IDENTITY, done: changed })).toBe(true)
    const { host } = openedSheet()
    expect(host.querySelector('h3').textContent).toBe('Remove your password?')
  })

  it('opens EmailSheet at its confirm step with the remembered address', () => {
    const changed = vi.fn()
    expect(resumePasswordProof('email', { email: 'ana@example.com' }, { status: STATUS_WITH_IDENTITY, done: changed })).toBe(true)
    const { host } = openedSheet()
    expect(host.textContent).toContain('ana@example.com')
    expect(host.textContent).toContain('First confirm that it is you.')
  })

  it('opens RemoveEmailSheet, resumed', () => {
    const changed = vi.fn()
    expect(resumePasswordProof('email-remove', undefined, { status: STATUS_WITH_IDENTITY, done: changed })).toBe(true)
    const { host } = openedSheet()
    expect(host.querySelector('h3').textContent).toBe('Remove your sign-in e-mail?')
  })

  it('answers false for setting a first password - that proof never goes through this step', () => {
    expect(resumePasswordProof('password', {}, { status: STATUS_WITH_IDENTITY, done: vi.fn() })).toBe(false)
  })
})

describe('resumeIdentityProof', () => {
  it('opens RemoveIdentitySheet, resumed', () => {
    expect(resumeIdentityProof('identity-remove', undefined, { state: LIST_WITH_IDENTITY, done: vi.fn() })).toBe(true)
    const { host } = openedSheet()
    expect(host.querySelector('h3').textContent).toBe('Remove this identity?')
  })
  it('answers false for identity-link - linking has no proof step of its own to resume', () => {
    expect(resumeIdentityProof('identity-link', undefined, { state: LIST_WITH_IDENTITY, done: vi.fn() })).toBe(false)
  })
})

describe('reopenAfterProof', () => {
  const provider = { name: 'Example ID' }

  it('answers false with no remembered record', async () => {
    expect(await reopenAfterProof(null, { changed: vi.fn(), provider })).toBe(false)
    expect(mocks.sheets).toHaveLength(0)
  })

  it('answers false with no provider configured any more', async () => {
    expect(await reopenAfterProof({ act: 'passkey-add', draft: {} }, { changed: vi.fn(), provider: null })).toBe(false)
    expect(mocks.sheets).toHaveLength(0)
  })

  it('loads the passkeys state and dispatches a passkey act', async () => {
    mocks.answers['GET /api/account/passkeys'] = LIST_WITH_IDENTITY
    const changed = vi.fn()
    expect(await reopenAfterProof({ act: 'passkey-add', draft: { name: 'Phone' } }, { changed, provider })).toBe(true)
    const { host } = openedSheet()
    expect(host.querySelector('h3').textContent).toBe('Add a passkey')
  })

  it('loads the password state and dispatches a password act', async () => {
    mocks.answers['GET /api/account/password'] = STATUS_WITH_IDENTITY
    const changed = vi.fn()
    expect(await reopenAfterProof({ act: 'email-remove', draft: {} }, { changed, provider })).toBe(true)
    const { host } = openedSheet()
    expect(host.querySelector('h3').textContent).toBe('Remove your sign-in e-mail?')
  })

  it('loads the passkeys state and dispatches identity-remove', async () => {
    mocks.answers['GET /api/account/passkeys'] = LIST_WITH_IDENTITY
    const changed = vi.fn()
    expect(await reopenAfterProof({ act: 'identity-remove', draft: {} }, { changed, provider })).toBe(true)
    const { host } = openedSheet()
    expect(host.querySelector('h3').textContent).toBe('Remove this identity?')
  })

  it('answers false when the account state cannot be read', async () => {
    mocks.answers['GET /api/account/passkeys'] = fail(500, { error: 'down' })
    expect(await reopenAfterProof({ act: 'passkey-add', draft: {} }, { changed: vi.fn(), provider })).toBe(false)
  })
})
