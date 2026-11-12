// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { startWebSignIn, isWebReturn, finishWebSignIn, phoneSignIn, phoneSession } from './openrouter-signin.js'

const keyFetch = (calls = []) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => '{"key":"sk-or-v1-zzz"}' } }

describe('Sign in with OpenRouter, web', () => {
  beforeEach(() => sessionStorage.clear())

  it('goes to openrouter.ai with this page as the callback and keeps the verifier for the way back', async () => {
    let went = null
    await startWebSignIn({ go: u => { went = u }, loc: { origin: 'https://gym.example', pathname: '/' } })
    const u = new URL(went)
    expect(u.host).toBe('openrouter.ai')
    expect(u.searchParams.get('callback_url')).toBe('https://gym.example/')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    const pending = JSON.parse(sessionStorage.getItem('og_openrouter_pending'))
    expect(pending.state).toBe(u.searchParams.get('state'))
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('finishes with the key, strips the code from the address, and refuses a foreign state', async () => {
    let went = null
    await startWebSignIn({ go: u => { went = u }, loc: { origin: 'https://gym.example', pathname: '/' } })
    const state = new URL(went).searchParams.get('state')
    const loc = { href: `https://gym.example/?code=c1&state=${state}`, pathname: '/', search: `?code=c1&state=${state}` }
    expect(isWebReturn(loc)).toBe(true)
    const replaced = []
    const saved = []
    const calls = []
    const r = await finishWebSignIn({ save: k => saved.push(k), loc, history: { replaceState: (a, b, c) => replaced.push(c) }, fetch: keyFetch(calls) })
    expect(r).toEqual({ ok: true, back: '#/admin' })
    expect(saved).toEqual(['sk-or-v1-zzz'])
    expect(replaced).toEqual(['/#/admin'])
    expect(calls[0].body.code).toBe('c1')
    expect(isWebReturn(loc)).toBe(false)

    await startWebSignIn({ go: () => {}, loc: { origin: 'https://gym.example', pathname: '/' } })
    const bad = await finishWebSignIn({ save: () => { throw new Error('must not save') }, loc: { href: 'https://gym.example/?code=c1&state=evil', pathname: '/' }, history: { replaceState() {} }, fetch: keyFetch() })
    expect(bad.ok).toBe(false)
  })
})

describe('Sign in with OpenRouter, phone', () => {
  it('opens the auth page with the opengym.ch bridge as callback and trades the returned code', async () => {
    let opened = null
    const key = await phoneSignIn({
      open: async url => { opened = new URL(url); return `opengym://openrouter?code=c9&state=${opened.searchParams.get('state')}` },
      fetch: keyFetch()
    })
    expect(key).toBe('sk-or-v1-zzz')
    expect(opened.searchParams.get('callback_url')).toBe('https://opengym.ch/openrouter/')
  })

  it('a way back with no code is a cancel, a wrong state is not ours', async () => {
    await expect(phoneSignIn({ open: async () => 'opengym://openrouter', fetch: keyFetch() })).rejects.toMatchObject({ code: 'cancelled' })
    await expect(phoneSignIn({ open: async () => 'opengym://openrouter?code=x1234567&state=no', fetch: keyFetch() })).rejects.toMatchObject({ code: 'state' })
  })

  it('headless: no callback in that address, and a pasted code buys the key with the same verifier', async () => {
    const calls = []
    const h = await phoneSession({ fetch: keyFetch(calls) })
    expect(new URL(h.headlessUrl).searchParams.get('callback_url')).toBeNull()
    expect(new URL(h.headlessUrl).searchParams.get('code_challenge')).toBe(new URL(h.url).searchParams.get('code_challenge'))
    expect(await h.redeem('  abcdefgh1234 ')).toBe('sk-or-v1-zzz')
    expect(await h.redeem('opengym://openrouter?code=zyxwvu987654')).toBe('sk-or-v1-zzz')
    expect(calls[0].body.code_verifier).toBe(calls[1].body.code_verifier)
    await expect(h.redeem('no')).rejects.toThrow()
  })
})
