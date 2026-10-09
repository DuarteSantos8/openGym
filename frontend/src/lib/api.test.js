// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { webauthnOK, bio, vault, BIO, VAULT, passkeyError } from './api.js'
import de from '../locales/de.js'
import { _setLangState } from './i18n-core.js'

const originalPublicKeyCredential = window.PublicKeyCredential
const originalCredentials = navigator.credentials

function setCapability(target, property, value) {
  Object.defineProperty(target, property, { configurable: true, value })
}

afterEach(() => {
  setCapability(window, 'PublicKeyCredential', originalPublicKeyCredential)
  setCapability(navigator, 'credentials', originalCredentials)
})

describe('webauthnOK', () => {
  it('accepts WebAuthn when PublicKeyCredential is exposed', () => {
    setCapability(window, 'PublicKeyCredential', class PublicKeyCredential {})
    setCapability(navigator, 'credentials', {})
    expect(webauthnOK()).toBe(true)
  })

  it('does not reject WebAuthn when the generic credentials check is unavailable', () => {
    setCapability(window, 'PublicKeyCredential', class PublicKeyCredential {})
    setCapability(navigator, 'credentials', undefined)
    expect(webauthnOK()).toBe(true)
  })

  it('rejects browsers without the WebAuthn credential type', () => {
    setCapability(window, 'PublicKeyCredential', undefined)
    setCapability(navigator, 'credentials', {})
    expect(webauthnOK()).toBe(false)
  })
})

describe('api()', () => {
  it('a failed request throws with the status and the parsed body attached', async () => {
    const { api } = await import('./api.js')
    const original = globalThis.fetch
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'conflict', rev: 3, state: { _rev: 3 } }) })
    try {
      await expect(api('/api/data', { method: 'PUT', body: '{}' })).rejects.toMatchObject({
        message: 'conflict', status: 409, data: { error: 'conflict', rev: 3, state: { _rev: 3 } }
      })
    } finally { globalThis.fetch = original }
  })
})

// Every API route answers JSON. A 2xx that is not JSON is somebody else answering — Capacitor's
// local server on a phone without a pairing, an auth proxy's login page, a proxy that sends /api/*
// to index.html — and must never read as a server that took the change.
describe('api() refuses an answer that is not the server\'s', () => {
  const html = () => new Response('<!doctype html><title>Sign in</title>', { status: 200, headers: { 'content-type': 'text/html' } })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('a 200 page of HTML is an error with the status it came with', async () => {
    const { api } = await import('./api.js')
    vi.stubGlobal('fetch', async () => html())
    await expect(api('/api/data', { method: 'PUT', body: '{}' })).rejects.toMatchObject({ code: 'bad-response', status: 200 })
    await expect(api('/api/me')).rejects.toMatchObject({ code: 'bad-response', status: 200 })
  })

  it('a JSON answer still comes back as it is', async () => {
    const { api } = await import('./api.js')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, rev: 4 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(api('/api/data', { method: 'PUT', body: '{}' })).resolves.toEqual({ ok: true, rev: 4 })
  })

  it('a refused request whose body is not JSON keeps its HTTP status', async () => {
    const { api } = await import('./api.js')
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
    await expect(api('/api/data')).rejects.toMatchObject({ status: 502, message: 'HTTP 502', data: {} })
  })

  it('pairing with something that is not an openGym server fails instead of saving an empty pairing', async () => {
    const { pairRedeem } = await import('./api.js')
    vi.stubGlobal('fetch', async () => html())
    await expect(pairRedeem('https://gym.example.com', 'ABCD2345')).rejects.toMatchObject({ code: 'bad-response' })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(pairRedeem('https://gym.example.com', 'ABCD2345')).rejects.toMatchObject({ code: 'bad-response' })
  })
})

// A request that never answers used to hold every later push and pull behind it, silently, for
// as long as the socket hung. It gives up instead — with no status, so it reads as offline.
describe('api() gives up on a request that never answers', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
  const hang = () => {
    const seen = []
    vi.stubGlobal('fetch', vi.fn((url, init) => { seen.push(init.signal); return new Promise(() => {}) }))
    return seen
  }

  it('a GET after 20 s, and the request itself is aborted', async () => {
    vi.useFakeTimers()
    const { api } = await import('./api.js')
    const signals = hang()
    const p = api('/api/data/rev')
    const done = vi.fn()
    p.catch(done)
    await vi.advanceTimersByTimeAsync(19000)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    await expect(p).rejects.toMatchObject({ code: 'timeout', status: undefined })
    expect(signals[0].aborted).toBe(true)
  })

  it('a PUT after 60 s, since it carries the whole profile', async () => {
    vi.useFakeTimers()
    const { api } = await import('./api.js')
    hang()
    const p = api('/api/data', { method: 'PUT', body: '{}' })
    const done = vi.fn()
    p.catch(done)
    await vi.advanceTimersByTimeAsync(30000)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(31000)
    await expect(p).rejects.toMatchObject({ code: 'timeout' })
  })

  it('a caller that knows its request is slow sets its own limit, and the option is not sent along', async () => {
    vi.useFakeTimers()
    const { api } = await import('./api.js')
    hang()
    const p = api('/api/admin/coach/test', { method: 'POST', body: '{}', timeout: 150000 })
    const done = vi.fn()
    p.catch(done)
    await vi.advanceTimersByTimeAsync(120000)
    expect(done).not.toHaveBeenCalled()
    expect('timeout' in fetch.mock.calls[0][1]).toBe(false)
    await vi.advanceTimersByTimeAsync(31000)
    await expect(p).rejects.toMatchObject({ code: 'timeout' })
  })
})

// Settings asks for a passkey as proof before a way in is added or removed (components/
// PasswordAuth.jsx, ProveOwner), and calls the prompt off when its sheet closes: the signal has
// to reach the browser's prompt, or a prompt nobody sees any more could still answer.
describe('passkeyAssertion', () => {
  const originalCredentials = navigator.credentials
  afterEach(() => { vi.unstubAllGlobals(); setCapability(navigator, 'credentials', originalCredentials) })
  const options = () => new Response(JSON.stringify({ cid: 'c1', options: { challenge: 'AAAA', allowCredentials: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  const assertion = { id: 'k1', rawId: new Uint8Array([1]).buffer, type: 'public-key', response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer, userHandle: null } }

  it('hands the signal to the prompt, and answers with the challenge id and the assertion', async () => {
    const { passkeyAssertion } = await import('./api.js')
    vi.stubGlobal('fetch', async () => options())
    const get = vi.fn(async () => assertion)
    setCapability(navigator, 'credentials', { get })
    const ctl = new AbortController()
    const r = await passkeyAssertion({ signal: ctl.signal })
    expect(get.mock.calls[0][0].signal).toBe(ctl.signal)
    expect(r.cid).toBe('c1')
    expect(r.credential.id).toBe('k1')
    // Without one, the prompt is asked for exactly as before.
    await passkeyAssertion()
    expect('signal' in get.mock.calls[1][0]).toBe(false)
  })

  it('a prompt called off rejects as an AbortError', async () => {
    const { passkeyAssertion } = await import('./api.js')
    vi.stubGlobal('fetch', async () => options())
    setCapability(navigator, 'credentials', {
      get: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    })
    const ctl = new AbortController()
    const p = passkeyAssertion({ signal: ctl.signal })
    await new Promise(r => setTimeout(r, 0))
    ctl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

// QA 1.3.9: "confirm with {0}" was translated and {0} was not — a German sign-in page read
// "…bestätige mit your fingerprint, face or PIN".
describe('bio / vault', () => {
  afterEach(() => _setLangState('en', {}, null, null))
  it('reads the platform phrase in the UI language', () => {
    expect(bio()).toBe(BIO)
    expect(vault()).toBe(VAULT)
    _setLangState('de', { [BIO]: 'BIO-de', [VAULT]: 'VAULT-de' }, null, null)
    expect(bio()).toBe('BIO-de')
    expect(vault()).toBe('VAULT-de')
  })
})

// The passkey routes answer in English with a stable `code`; the toast used to show the English
// line ("unknown passkey, create a profile first") in every language.
describe('passkeyError', () => {
  afterEach(() => _setLangState('en', {}, null, null))
  const refused = (code, message) => Object.assign(new Error(message), { status: 400, data: { error: message, code } })
  it('says each refusal in the UI language', () => {
    _setLangState('de', de, null, null)
    expect(passkeyError(refused('invite', 'a valid invite code is required'), 'x')).toBe(de['That invite code is not valid.'])
    expect(passkeyError(refused('unknown-credential', 'unknown passkey, create a profile first'), 'x')).toBe(de['This server doesn’t know that passkey. Make a profile first.'])
    expect(passkeyError(refused('disabled', 'this account has been disabled'), 'x')).toBe(de['This account has been disabled.'])
    expect(passkeyError(refused('challenge-expired', 'challenge expired, try again'), 'x')).toBe(de['That took a little too long. Give it another go.'])
  })
  it('an answer without a code is shown as it came, and nothing at all falls back', () => {
    expect(passkeyError(refused(undefined, 'credential already registered'), 'Sign-in failed')).toBe('credential already registered')
    expect(passkeyError({}, 'Sign-in failed')).toBe('Sign-in failed')
  })
})
