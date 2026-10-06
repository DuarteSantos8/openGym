// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProveOwner } from './PasswordAuth.jsx'
import { recallProof } from '../lib/pending-proof.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* ProveOwner's third answer - a sign-in at the provider as the profile's linked identity: offered
   only when the profile has a linked identity, an instance provider is configured, and there is
   an act to request a proof for. Everything ProveOwner already did with no identity is covered,
   unchanged, by PasswordAuth.test.jsx and Passkeys.test.jsx - this file only exercises the new
   leg. */
const mocks = vi.hoisted(() => {
  const state = {
    MOBILE: false, webauthn: true, config: { password_login: true }, sheets: [], answers: {}, calls: [],
    unfinished: false, proofWaiter: null
  }
  state.toast = vi.fn()
  state.passkeyAssertion = vi.fn(async () => ({ cid: 'c1', credential: { id: 'k1' } }))
  state.requestProofTicket = vi.fn(async () => 'a-proof-ticket')
  state.oidcProofStartUrl = vi.fn(ticket => '/api/oidc/proof/start?ticket=' + ticket)
  state.clearUnfinished = vi.fn()
  state.proofUnsub = vi.fn()
  // The phone's own app-channel starter (AppSignIn.jsx): registers the waiter this file's MOBILE
  // cases trigger by hand (mocks.proofWaiter), and resolves to the unsubscribe the component keeps.
  state.startProviderProof = vi.fn(async (act, onProof) => { state.proofWaiter = onProof; return state.proofUnsub })
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
  api: vi.fn(async () => ({})),
  webauthnOK: () => mocks.webauthn,
  passkeyAssertion: (...a) => mocks.passkeyAssertion(...a),
  passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
// Matches SyncBanner.test.jsx's own convention: a getter, so a test can flip MOBILE mid-suite
// without re-mocking the module.
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('../lib/oidc.js', () => ({
  requestProofTicket: (...a) => mocks.requestProofTicket(...a),
  oidcProofStartUrl: (...a) => mocks.oidcProofStartUrl(...a),
}))
vi.mock('./AppSignIn.jsx', () => ({
  startProviderProof: (...a) => mocks.startProviderProof(...a),
  useAttemptUnfinished: () => [mocks.unfinished, mocks.clearUnfinished]
}))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

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

beforeEach(() => {
  mocks.MOBILE = false
  mocks.webauthn = true
  mocks.config = { password_login: true, oidc: { name: 'Example ID' } }
  mocks.sheets.length = 0
  mocks.requestProofTicket.mockClear()
  mocks.requestProofTicket.mockResolvedValue('a-proof-ticket')
  mocks.oidcProofStartUrl.mockClear()
  mocks.passkeyAssertion.mockClear()
  mocks.unfinished = false
  mocks.proofWaiter = null
  mocks.clearUnfinished.mockClear()
  mocks.proofUnsub.mockClear()
  mocks.startProviderProof.mockClear()
  mocks.startProviderProof.mockImplementation(async (act, onProof) => { mocks.proofWaiter = onProof; return mocks.proofUnsub })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('ProveOwner without a provider configured, or without identity', () => {
  it('renders no provider option when config has no oidc', async () => {
    mocks.config = { password_login: true }
    const host = mount(<ProveOwner passkey password identity act="identity-remove" onProof={vi.fn()} />)
    await settle()
    expect(button(host, 'Confirm with Example ID')).toBeUndefined()
    expect(host.textContent).not.toContain('or confirm with')
  })

  it('renders no provider option when identity is false, even with a provider configured', async () => {
    const host = mount(<ProveOwner passkey password act="identity-remove" onProof={vi.fn()} />)
    await settle()
    expect(button(host, 'Confirm with Example ID')).toBeUndefined()
  })

  it('renders no provider option without an act - a proof cannot be requested for nothing', async () => {
    const host = mount(<ProveOwner passkey password identity onProof={vi.fn()} />)
    await settle()
    expect(button(host, 'Confirm with Example ID')).toBeUndefined()
  })
})

describe('ProveOwner with the provider option', () => {
  it('renders after passkey and password, behind the divider, plain - not the only loud button', async () => {
    const host = mount(<ProveOwner passkey password identity act="identity-remove" onProof={vi.fn()} />)
    await settle()
    expect(host.textContent).toContain('or confirm with Example ID')
    const btn = button(host, 'Confirm with Example ID')
    expect(btn).toBeDefined()
    expect(btn.className).not.toMatch(/\bprimary\b/)
    expect(button(host, 'Confirm with a passkey').className).toMatch(/\bprimary\b/)
    expect(host.textContent).not.toMatch(/nothing here can confirm/)
  })

  it('is the only, loud option, with no divider, when the profile has no passkey and no password', async () => {
    const host = mount(<ProveOwner identity act="identity-remove" onProof={vi.fn()} />)
    await settle()
    expect(host.textContent).not.toContain('or confirm with')
    expect(button(host, 'Confirm with Example ID').className).toMatch(/\bprimary\b/)
  })

  it('remembers the pending change, buys a ticket and departs to the ticket-carrying address; buttons disable while it runs', async () => {
    let resolveTicket
    mocks.requestProofTicket.mockImplementationOnce(() => new Promise(r => { resolveTicket = r }))
    const before = window.location.href
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" draft={{ note: 'x' }} onProof={vi.fn()} />)
    await settle()
    act(() => { button(host, 'Confirm with Example ID').click() })
    expect(button(host, 'Confirm with Example ID').disabled).toBe(true)
    expect(recallProof({ storage: sessionStorage })).toEqual({ act: 'identity-remove', draft: { note: 'x' } })
    await act(async () => { resolveTicket('a-proof-ticket'); await Promise.resolve() })
    expect(mocks.requestProofTicket).toHaveBeenCalledWith('identity-remove')
    expect(window.location.href).not.toBe(before)
    expect(window.location.href).toContain('/api/oidc/proof/start?ticket=a-proof-ticket')
  })

  it('a refused ticket shows explain(e), re-enables the buttons and forgets the pending change', async () => {
    mocks.requestProofTicket.mockRejectedValueOnce(fail(409, { code: 'last-way-in' }))
    const before = window.location.href
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" draft={{}} onProof={vi.fn()} />)
    await settle()
    await click(host, 'Confirm with Example ID')
    expect(alertText(host)).toMatch(/only way into your profile/)
    expect(button(host, 'Confirm with Example ID').disabled).toBe(false)
    expect(recallProof({ storage: sessionStorage })).toBeNull()
    expect(window.location.href).toBe(before)
  })

  it('a bad act (400) also shows through explain and does not navigate', async () => {
    mocks.requestProofTicket.mockRejectedValueOnce(fail(400, { code: 'act-invalid' }))
    const before = window.location.href
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" onProof={vi.fn()} />)
    await settle()
    await click(host, 'Confirm with Example ID')
    expect(alertText(host)).not.toBeNull()
    expect(window.location.href).toBe(before)
  })
})

describe('ProveOwner resuming a provider proof', () => {
  it('calls onProof once with { identityProof: true } on mount', async () => {
    const onProof = vi.fn(async () => {})
    mount(<ProveOwner identity providerName="Example ID" act="identity-remove" resume onProof={onProof} />)
    await settle()
    expect(onProof).toHaveBeenCalledTimes(1)
    expect(onProof).toHaveBeenCalledWith({ identityProof: true })
  })

  it('only calls onProof once even mounted twice, as StrictMode does', async () => {
    const onProof = vi.fn(async () => {})
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push({ root, host })
    act(() => root.render(<React.StrictMode><ProveOwner identity providerName="Example ID" act="identity-remove" resume onProof={onProof} /></React.StrictMode>))
    await settle()
    expect(onProof).toHaveBeenCalledTimes(1)
  })

  it('a refusal on resume renders through explain', async () => {
    const onProof = vi.fn(async () => { throw fail(403, { code: 'identity-proof' }) })
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" resume onProof={onProof} />)
    await settle()
    expect(alertText(host)).toBe('The confirmation attempt expired — try again.')
  })
})

describe('ProveOwner on the phone app (MOBILE)', () => {
  beforeEach(() => {
    mocks.MOBILE = true
    // Task 3 of this plan makes webauthnOK() answer false on the mobile build itself; this task's
    // own phone cases mock that answer directly rather than depending on Task 3 landing first.
    mocks.webauthn = false
  })

  it('tapping "Confirm with {provider}" starts the app channel instead of the web ticket/navigation path', async () => {
    const before = window.location.href
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" draft={{ note: 'x' }} onProof={vi.fn()} />)
    await settle()
    await click(host, 'Confirm with Example ID')
    expect(mocks.startProviderProof).toHaveBeenCalledWith('identity-remove', expect.any(Function))
    expect(mocks.requestProofTicket).not.toHaveBeenCalled()
    expect(recallProof({ storage: sessionStorage })).toBeNull()
    expect(window.location.href).toBe(before)
  })

  it('starting a new attempt clears a stale "unfinished" note immediately', async () => {
    mocks.unfinished = true
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" onProof={vi.fn()} />)
    await settle()
    await click(host, 'Confirm with Example ID')
    expect(mocks.clearUnfinished).toHaveBeenCalledTimes(1)
  })

  it('when the proof comes back, calls onProof once with { identityProof: true, proof }', async () => {
    const onProof = vi.fn(async () => {})
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" onProof={onProof} />)
    await settle()
    await click(host, 'Confirm with Example ID')
    await act(async () => { await mocks.proofWaiter('proof-id-1') })
    expect(onProof).toHaveBeenCalledTimes(1)
    expect(onProof).toHaveBeenCalledWith({ identityProof: true, proof: 'proof-id-1' })
  })

  it('a refusal once the proof comes back is worded through explain()', async () => {
    const onProof = vi.fn(async () => { throw fail(403, { code: 'identity-proof' }) })
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" onProof={onProof} />)
    await settle()
    await click(host, 'Confirm with Example ID')
    await act(async () => { await mocks.proofWaiter('proof-id-1') })
    expect(alertText(host)).toBe('The confirmation attempt expired — try again.')
  })

  it('a refused ticket shows explain(e) and re-enables the button', async () => {
    mocks.startProviderProof.mockRejectedValueOnce(fail(409, { code: 'last-way-in' }))
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" onProof={vi.fn()} />)
    await settle()
    await click(host, 'Confirm with Example ID')
    expect(alertText(host)).toMatch(/only way into your profile/)
    expect(button(host, 'Confirm with Example ID').disabled).toBe(false)
  })

  it('unmounting before the proof comes back removes the waiter', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<ProveOwner identity providerName="Example ID" act="identity-remove" onProof={vi.fn()} />))
    await settle()
    await click(host, 'Confirm with Example ID')
    act(() => root.unmount())
    expect(mocks.proofUnsub).toHaveBeenCalledTimes(1)
    host.remove()
  })

  it('the resume path never runs on the phone', async () => {
    const onProof = vi.fn(async () => {})
    mount(<ProveOwner identity providerName="Example ID" act="identity-remove" resume onProof={onProof} />)
    await settle()
    expect(onProof).not.toHaveBeenCalled()
  })

  it('shows "Sign-in was not finished" under the provider button while useAttemptUnfinished(\'proof\') is true', async () => {
    mocks.unfinished = true
    const host = mount(<ProveOwner identity providerName="Example ID" act="identity-remove" onProof={vi.fn()} />)
    await settle()
    expect(host.textContent).toContain('Sign-in was not finished')
    expect(button(host, 'Confirm with Example ID')).toBeDefined()
  })

  it('with no passkey ceremony possible here (webauthnOK false) and nothing else to answer with, shows the no-passkey-here dead end', async () => {
    const host = mount(<ProveOwner passkey onProof={vi.fn()} />)
    await settle()
    expect(host.textContent).toContain('This browser cannot confirm with your passkey. Do this on a device that holds one.')
    expect(button(host, 'Confirm with a passkey')).toBeUndefined()
  })
})
