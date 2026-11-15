// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { takeOidcReturn, oidcArrival, clearOidcArrival, oidcErrorText, oidcOkText, startWebSignIn, startUrl, oidcOn, oidcOnly, oidcLabel } from './oidc.js'

/* The browser half of provider sign-in (#130): where it leaves for, what it reads on the way back,
   and that every refusal the server can send has its own sentence. */
const loc = (search, hash = '#/', pathname = '/') => ({ search, hash, pathname })

describe('lib/oidc', () => {
  it('reads the arrival once and tidies the address bar', () => {
    const hist = { state: { idx: 0 }, replaceState: vi.fn() }
    expect(takeOidcReturn(loc('?oidc=signed-in'), hist)).toEqual({ ok: 'signed-in' })
    expect(hist.replaceState).toHaveBeenCalledWith({ idx: 0 }, '', '/#/')
    expect(oidcArrival()).toEqual({ ok: 'signed-in' })
    clearOidcArrival()
    expect(oidcArrival()).toBe(null)
    expect(takeOidcReturn(loc('?keep=1&oidc-error=group', '#/settings/account', '/gym/'), hist)).toEqual({ error: 'group' })
    expect(hist.replaceState).toHaveBeenLastCalledWith({ idx: 0 }, '', '/gym/?keep=1#/settings/account')
    expect(takeOidcReturn(loc(''), hist)).toBe(null)
    expect(takeOidcReturn(loc('?other=1'), hist)).toBe(null)
  })

  it('leaves for the start route under the app base, also for a link the server handed out', () => {
    const go = vi.fn()
    startWebSignIn('web', go)
    expect(go).toHaveBeenLastCalledWith('/api/oidc/start')
    startWebSignIn('reauth', go)
    expect(go).toHaveBeenLastCalledWith('/api/oidc/start?mode=reauth')
    startWebSignIn('/api/oidc/start?mode=link&ticket=abc', go)
    expect(go).toHaveBeenLastCalledWith('/api/oidc/start?mode=link&ticket=abc')
    expect(startUrl()).toBe('/api/oidc/start')
  })

  it('every refusal code has its own sentence, naming the provider where it helps', () => {
    const codes = ['group', 'link-needed', 'invite', 'disabled', 'cancelled', 'taken', 'already-linked', 'wrong-account', 'state', 'throttled', 'oidc-only', 'token', 'provider']
    const texts = codes.map(c => oidcErrorText(c, 'Authentik'))
    expect(new Set(texts).size).toBe(codes.length)
    expect(oidcErrorText('group', 'Authentik')).toContain('Authentik')
    expect(oidcErrorText('something-new', 'X')).toBe(oidcErrorText('provider', 'X'))
    for (const s of texts) expect(s).not.toMatch(/—/)
    expect(oidcOkText('linked', 'A')).toContain('A')
    expect(oidcOkText('signed-in')).toBe(null)
  })

  it('reads the config flags', () => {
    expect(oidcOn({})).toBe(false)
    expect(oidcOn({ oidc: { label: 'Pocket ID' } })).toBe(true)
    expect(oidcOnly({ oidc: { label: 'x', only: true } })).toBe(true)
    expect(oidcLabel({ oidc: { label: 'Pocket ID' } })).toBe('Pocket ID')
    expect(oidcLabel(null)).toBe('SSO')
  })
})
