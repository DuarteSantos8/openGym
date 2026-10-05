import { beforeEach, describe, expect, it, vi } from 'vitest'
import { oidcConfirm, oidcLinkStartUrl, oidcPending, oidcProofStartUrl, removeIdentity, requestLinkTicket, requestProofTicket } from './oidc.js'

const calls = []
vi.mock('./api.js', () => ({
  api: vi.fn(async (path, opts) => {
    calls.push([path, opts?.method || 'GET', opts?.body ? JSON.parse(opts.body) : null])
    if (path === '/api/oidc/pending') return { name: 'Alex' }
    if (path === '/api/oidc/confirm') return { user: { id: 'u1', name: 'Alex' } }
    if (path === '/api/account/identities/link-ticket') return { ticket: 'a-ticket' }
    if (path === '/api/account/identities/proof-ticket') return { ticket: 'a-proof-ticket' }
    if (path === '/api/account/identities') return { ok: true, passkeys: [], password: false, identity: null, lastWayIn: false }
  })
}))

beforeEach(() => { calls.length = 0 })

describe('oidcPending', () => {
  it('peeks the waiting identity with a plain GET and no body', async () => {
    const res = await oidcPending()
    expect(calls).toEqual([['/api/oidc/pending', 'GET', null]])
    expect(res).toEqual({ name: 'Alex' })
  })
})

describe('oidcConfirm', () => {
  it('posts the name and the trimmed code, and returns the resulting user', async () => {
    const u = await oidcConfirm('Alex', ' AB12 ')
    expect(calls).toEqual([['/api/oidc/confirm', 'POST', { name: 'Alex', code: 'AB12' }]])
    expect(u).toEqual({ id: 'u1', name: 'Alex' })
  })

  it('sends a missing code as an empty string rather than undefined', async () => {
    await oidcConfirm('Alex', undefined)
    expect(calls).toEqual([['/api/oidc/confirm', 'POST', { name: 'Alex', code: '' }]])
  })
})

describe('oidcLinkStartUrl', () => {
  it('URL-encodes the ticket into the link-start address', () => {
    expect(oidcLinkStartUrl('a+b/c')).toBe('/api/oidc/link/start?ticket=a%2Bb%2Fc')
  })
})

describe('requestLinkTicket', () => {
  it('posts the proof and resolves the ticket string', async () => {
    const ticket = await requestLinkTicket({ cid: 'c1', credential: { id: 'k1' } })
    expect(calls).toEqual([['/api/account/identities/link-ticket', 'POST', { cid: 'c1', credential: { id: 'k1' } }]])
    expect(ticket).toBe('a-ticket')
  })
})

describe('removeIdentity', () => {
  it('sends the proof as a DELETE and resolves the account state', async () => {
    const res = await removeIdentity({ current: 'pw' })
    expect(calls).toEqual([['/api/account/identities', 'DELETE', { current: 'pw' }]])
    expect(res).toEqual({ ok: true, passkeys: [], password: false, identity: null, lastWayIn: false })
  })
})

describe('oidcProofStartUrl', () => {
  it('URL-encodes the ticket into the proof-start address', () => {
    expect(oidcProofStartUrl('a+b/c')).toBe('/api/oidc/proof/start?ticket=a%2Bb%2Fc')
  })
})

describe('requestProofTicket', () => {
  it('posts the act and resolves the ticket string', async () => {
    const ticket = await requestProofTicket('identity-remove')
    expect(calls).toEqual([['/api/account/identities/proof-ticket', 'POST', { act: 'identity-remove' }]])
    expect(ticket).toBe('a-proof-ticket')
  })
})
