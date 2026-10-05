// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdentityRow, LinkIdentitySheet, RemoveIdentitySheet, identityError } from './Identity.jsx'
import { fmtDate } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* A linked identity, in the Account section next to passkeys and the code for another device:
   the row in both its unlinked and linked states, and the two proof-gated sheets that attach or
   remove it. The server decides what needs proof and what the last way in is; this only words
   its answers. */
const mocks = vi.hoisted(() => {
  const state = { MOBILE: false, webauthn: true, sheets: [], toasts: [], sync: { server: 'https://gym.example.com' } }
  state.toast = (...a) => state.toasts.push(a)
  state.requestLinkTicket = vi.fn(async () => 'a-ticket')
  state.removeIdentity = vi.fn(async () => ({}))
  state.passkeyAssertion = vi.fn(async () => ({ cid: 'login-cid', credential: { id: 'k1' } }))
  state.startProviderLink = vi.fn(async () => {})
  return state
})
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: { id: 'u1', name: 'Ana' }, sync: mocks.sync })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => mocks.webauthn,
  passkeyAssertion: (...a) => mocks.passkeyAssertion(...a),
  passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
// Matches SyncBanner.test.jsx's own convention: a getter, so a test can flip MOBILE mid-suite
// without re-mocking the module.
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('../lib/oidc.js', () => ({
  requestLinkTicket: (...a) => mocks.requestLinkTicket(...a),
  oidcLinkStartUrl: ticket => '/api/oidc/link/start?ticket=' + ticket,
  removeIdentity: (...a) => mocks.removeIdentity(...a),
}))
// The real PasswordAuth.jsx's ProveOwner (rendered for real by both sheets below) now depends on
// this module too - a stub keeps every existing, non-MOBILE case exercising the real ProveOwner
// unchanged, while this file's own MOBILE cases drive startProviderLink directly.
vi.mock('./AppSignIn.jsx', () => ({
  startProviderLink: (...a) => mocks.startProviderLink(...a),
  startProviderProof: vi.fn(async () => vi.fn()),
  useAttemptUnfinished: () => [false, vi.fn()]
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
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const click = async (host, text) => { act(() => button(host, text).click()); await settle() }
const alertText = host => host.querySelector('[role="alert"]')?.textContent || null
const openedSheet = () => { const close = vi.fn(); return { host: mount(mocks.sheets.at(-1).render(close)), close } }

beforeEach(() => {
  mocks.MOBILE = false
  mocks.webauthn = true
  mocks.sheets.length = 0
  mocks.toasts.length = 0
  mocks.requestLinkTicket.mockClear().mockImplementation(async () => 'a-ticket')
  mocks.removeIdentity.mockClear().mockImplementation(async () => ({}))
  mocks.passkeyAssertion.mockClear().mockImplementation(async () => ({ cid: 'login-cid', credential: { id: 'k1' } }))
  mocks.startProviderLink.mockClear().mockImplementation(async () => {})
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const PROVIDER = { name: 'Example ID' }
const UNLINKED = { passkeys: [], password: false, identity: null, lastWayIn: false }
const UNLINKED_WITH_PASSKEY = { passkeys: [{ id: 'k1' }], password: false, identity: null, lastWayIn: false }
const LINKED_WITH_ADDRESS = { passkeys: [{ id: 'k1' }], password: false, identity: { providerName: 'Example ID', email: 'alex@example.com', linkedAt: '2026-11-05T10:00:00.000Z', usable: true }, lastWayIn: false }
const LINKED_NO_ADDRESS = { passkeys: [{ id: 'k1' }], password: false, identity: { providerName: 'Example ID', email: null, linkedAt: '2026-11-05T10:00:00.000Z', usable: true }, lastWayIn: false }

describe('IdentityRow', () => {
  it('renders nothing until the account state has answered', () => {
    expect(mount(<IdentityRow state={null} provider={PROVIDER} changed={() => {}} />).textContent).toBe('')
  })

  it('nothing linked: offers "Link {provider}" with a chevron, and opens the link sheet', async () => {
    const host = mount(<IdentityRow state={UNLINKED} provider={PROVIDER} changed={() => {}} />)
    expect(host.querySelector('.lrow-t').textContent).toBe('Link Example ID')
    expect(host.querySelector('.lrow-c')).not.toBeNull()
    act(() => host.querySelector('.lrow').click())
    const { host: sheet } = openedSheet()
    expect(sheet.querySelector('h3').textContent).toBe('Link Example ID')
  })

  it('linked with a vouched address: the address is the title, the provider name and date the subtitle, no chevron', () => {
    const host = mount(<IdentityRow state={LINKED_WITH_ADDRESS} provider={PROVIDER} changed={() => {}} />)
    expect(host.querySelector('.lrow-t').textContent).toBe('alex@example.com')
    expect(host.querySelector('.lrow-s').textContent).toBe(`Example ID - linked ${fmtDate('2026-11-05', false, true)}`)
    expect(host.querySelector('.lrow-c')).toBeNull()
    expect(host.querySelector('button[aria-label="Remove linked identity"]')).not.toBeNull()
  })

  it('linked with no address: the provider name is the title, the subtitle drops the address clause', () => {
    const host = mount(<IdentityRow state={LINKED_NO_ADDRESS} provider={PROVIDER} changed={() => {}} />)
    expect(host.querySelector('.lrow-t').textContent).toBe('Example ID')
    expect(host.querySelector('.lrow-s').textContent).toBe(`Linked ${fmtDate('2026-11-05', false, true)}`)
  })

  it('a stored record without a link date still lists, the date left out of the subtitle', () => {
    const { linkedAt, ...withAddress } = LINKED_WITH_ADDRESS.identity
    const host = mount(<IdentityRow state={{ ...LINKED_WITH_ADDRESS, identity: withAddress }} provider={PROVIDER} changed={() => {}} />)
    expect(host.querySelector('.lrow-t').textContent).toBe('alex@example.com')
    expect(host.querySelector('.lrow-s').textContent).toBe('Example ID')
    const { linkedAt: _, ...noAddress } = LINKED_NO_ADDRESS.identity
    const bare = mount(<IdentityRow state={{ ...LINKED_NO_ADDRESS, identity: noAddress }} provider={PROVIDER} changed={() => {}} />)
    expect(bare.querySelector('.lrow-t').textContent).toBe('Example ID')
    expect(bare.querySelector('.lrow-s')).toBeNull()
    expect(bare.querySelector('button[aria-label="Remove linked identity"]')).not.toBeNull()
  })

  it('the last way in: the remove button is disabled and the reason renders under the row', () => {
    const host = mount(<IdentityRow state={{ ...LINKED_WITH_ADDRESS, lastWayIn: true }} provider={PROVIDER} changed={() => {}} />)
    expect(host.querySelector('button[aria-label="Remove linked identity"]').disabled).toBe(true)
    expect(host.textContent).toContain('This is the only way you can sign in to this profile - removing it is not available.')
  })

  it('not the last way in: the remove button is enabled and nothing explains it', () => {
    const host = mount(<IdentityRow state={LINKED_WITH_ADDRESS} provider={PROVIDER} changed={() => {}} />)
    expect(host.querySelector('button[aria-label="Remove linked identity"]').disabled).toBe(false)
    expect(host.textContent).not.toMatch(/only way you can sign in/)
  })

  it('an identity that no longer signs in: listed without a provider name, said so, and removable even beside the last passkey', () => {
    const stale = { ...LINKED_NO_ADDRESS, identity: { ...LINKED_NO_ADDRESS.identity, providerName: null, usable: false }, lastWayIn: true }
    const host = mount(<IdentityRow state={stale} provider={PROVIDER} changed={() => {}} />)
    expect(host.querySelector('.lrow-t').textContent).toBe('Linked identity')
    expect(host.querySelector('.lrow-s').textContent).toBe('This identity can no longer sign in - its provider is not set up on this instance any more.')
    expect(host.querySelector('button[aria-label="Remove linked identity"]').disabled).toBe(false)
    expect(host.textContent).not.toMatch(/only way you can sign in/)
  })

  it('opens the removal sheet from its own trash button', async () => {
    const host = mount(<IdentityRow state={LINKED_WITH_ADDRESS} provider={PROVIDER} changed={() => {}} />)
    act(() => host.querySelector('button[aria-label="Remove linked identity"]').click())
    const { host: sheet } = openedSheet()
    expect(sheet.querySelector('h3').textContent).toBe('Remove this identity?')
  })
})

describe('LinkIdentitySheet', () => {
  it('a passkey proof buys the ticket and departs for the provider, with no second tap', async () => {
    const host = mount(<LinkIdentitySheet close={() => {}} state={UNLINKED_WITH_PASSKEY} provider={PROVIDER} />)
    expect(host.querySelector('h3').textContent).toBe('Link Example ID')
    const before = window.location.href
    await click(host, 'Confirm with a passkey')
    expect(mocks.requestLinkTicket).toHaveBeenCalledWith({ cid: 'login-cid', credential: { id: 'k1' } })
    expect(window.location.href).not.toBe(before)
    expect(window.location.href).toContain('/api/oidc/link/start?ticket=a-ticket')
  })

  it("a refused proof (already linked) shows the link table's sentence in the proof step's own error slot", async () => {
    mocks.requestLinkTicket.mockRejectedValueOnce(fail(409, { code: 'profile-linked' }))
    const host = mount(<LinkIdentitySheet close={() => {}} state={UNLINKED_WITH_PASSKEY} provider={PROVIDER} />)
    await click(host, 'Confirm with a passkey')
    expect(alertText(host)).toBe('This profile already has an identity linked - only one can be linked at a time.')
  })
})

describe('LinkIdentitySheet on the phone app (MOBILE)', () => {
  beforeEach(() => { mocks.MOBILE = true })
  afterEach(() => { mocks.MOBILE = false })

  it('a passkey proof calls startProviderLink with the proof, never buying a web ticket or navigating', async () => {
    const before = window.location.href
    const host = mount(<LinkIdentitySheet close={() => {}} state={UNLINKED_WITH_PASSKEY} provider={PROVIDER} />)
    await click(host, 'Confirm with a passkey')
    expect(mocks.startProviderLink).toHaveBeenCalledWith({ cid: 'login-cid', credential: { id: 'k1' } })
    expect(mocks.requestLinkTicket).not.toHaveBeenCalled()
    expect(window.location.href).toBe(before)
  })

  it("a refused ticket shows the link table's sentence in the proof step's own error slot", async () => {
    mocks.startProviderLink.mockRejectedValueOnce(fail(409, { code: 'profile-linked' }))
    const host = mount(<LinkIdentitySheet close={() => {}} state={UNLINKED_WITH_PASSKEY} provider={PROVIDER} />)
    await click(host, 'Confirm with a passkey')
    expect(alertText(host)).toBe('This profile already has an identity linked - only one can be linked at a time.')
  })
})

describe('RemoveIdentitySheet', () => {
  it('a proof removes the identity, closes, tells Settings to read again, and toasts', async () => {
    const close = vi.fn()
    const done = vi.fn()
    const host = mount(<RemoveIdentitySheet close={close} state={LINKED_WITH_ADDRESS} done={done} />)
    expect(host.textContent).toContain('You will no longer be able to sign in to this profile with Example ID.')
    await click(host, 'Confirm with a passkey')
    expect(mocks.removeIdentity).toHaveBeenCalledWith({ cid: 'login-cid', credential: { id: 'k1' } })
    expect(close).toHaveBeenCalled()
    expect(done).toHaveBeenCalled()
    expect(mocks.toasts).toContainEqual(['Identity removed'])
  })

  it('the last way in: the refusal reads the same sentence the disabled row explains', async () => {
    mocks.removeIdentity.mockRejectedValueOnce(fail(409, { code: 'last-way-in' }))
    const host = mount(<RemoveIdentitySheet close={() => {}} state={LINKED_WITH_ADDRESS} done={() => {}} />)
    await click(host, 'Confirm with a passkey')
    expect(alertText(host)).toBe('This is the only way you can sign in to this profile - removing it is not available.')
  })
})

describe('identityError', () => {
  it("words its own codes, and hands everything else to the password sheet's wording", () => {
    expect(identityError(fail(409, { code: 'last-way-in' }))).toBe('This is the only way you can sign in to this profile - removing it is not available.')
    expect(identityError(fail(409, { code: 'profile-linked' }))).toBe('This profile already has an identity linked - only one can be linked at a time.')
    expect(identityError(fail(409, { code: 'provider-off' }))).toBe("Sign-in through the provider isn't set up correctly on this instance - tell whoever runs it.")
    expect(identityError(fail(403, { code: 'passkey' }))).toBe('Your passkey could not be confirmed.')
  })
})
