import { describe, it, expect, vi } from 'vitest'
import {
  ATTEMPT_KEY, ATTEMPT_MAX_AGE_MS,
  newVerifier, challengeFor, parseAppReturn, appStartUrl,
  beginAttempt, peekAttempt, takeAttempt, finishAppReturn
} from './oidc-app.js'

// A minimal Storage the way an in-memory one would behave, so these tests never touch the real
// localStorage (and can run in any order without one polluting the next).
function memoryStorage() {
  const m = new Map()
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  }
}

describe('challengeFor', () => {
  it('matches the RFC 7636 Appendix B worked example', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = await challengeFor(verifier)
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('newVerifier', () => {
  it('is a 43-character base64url string, different on every call', () => {
    const a = newVerifier()
    const b = newVerifier()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })
})

describe('parseAppReturn', () => {
  it('reads a code from the app\'s own return address', () => {
    expect(parseAppReturn('opengym://oidc?code=' + 'a'.repeat(20))).toEqual({ code: 'a'.repeat(20) })
  })
  it('reads an err from the app\'s own return address', () => {
    expect(parseAppReturn('opengym://oidc?err=locked')).toEqual({ err: 'locked' })
  })
  it('is null for the wrong scheme', () => {
    expect(parseAppReturn('https://oidc?code=' + 'a'.repeat(20))).toBe(null)
  })
  it('is null for the wrong host', () => {
    expect(parseAppReturn('opengym://other?code=' + 'a'.repeat(20))).toBe(null)
  })
  it('is null for a malformed code or err', () => {
    expect(parseAppReturn('opengym://oidc?code=short')).toBe(null)
    expect(parseAppReturn('opengym://oidc?err=NotLowercase')).toBe(null)
  })
  it('is null when neither param is present', () => {
    expect(parseAppReturn('opengym://oidc')).toBe(null)
  })
  it('is null for text that is not a URL at all', () => {
    expect(parseAppReturn('not a url')).toBe(null)
  })
})

describe('appStartUrl', () => {
  it('builds the app-flavoured start address with the challenge encoded', () => {
    expect(appStartUrl('https://gym.example.com', 'signIn', { challenge: 'a+b' }))
      .toBe('https://gym.example.com/api/oidc/app/start?challenge=a%2Bb')
  })
  it('builds the link start address with the ticket encoded', () => {
    expect(appStartUrl('https://gym.example.com', 'link', { ticket: 'a+b' }))
      .toBe('https://gym.example.com/api/oidc/app/link/start?ticket=a%2Bb')
  })
  it('builds the proof start address with the ticket encoded', () => {
    expect(appStartUrl('https://gym.example.com', 'proof', { ticket: 'a+b' }))
      .toBe('https://gym.example.com/api/oidc/app/proof/start?ticket=a%2Bb')
  })
})

describe('beginAttempt / peekAttempt / takeAttempt', () => {
  it('writes an attempt and returns its challenge', async () => {
    const storage = memoryStorage()
    const { challenge } = await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const held = peekAttempt({ storage })
    expect(held.base).toBe('https://gym.example.com')
    expect(held.mode).toBe('signIn')
    expect(await challengeFor(held.verifier)).toBe(challenge)
  })

  it('a second beginAttempt replaces the first outright', async () => {
    const storage = memoryStorage()
    const first = await beginAttempt({ base: 'https://a.example.com', mode: 'signIn' }, { storage })
    const second = await beginAttempt({ base: 'https://b.example.com', mode: 'signIn' }, { storage })
    expect(second.challenge).not.toBe(first.challenge)
    const held = peekAttempt({ storage })
    expect(held.base).toBe('https://b.example.com')
  })

  it('takeAttempt returns the held attempt once, then nothing', async () => {
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    const first = takeAttempt({ storage })
    expect(first.base).toBe('https://gym.example.com')
    expect(takeAttempt({ storage })).toBe(null)
  })

  it('an attempt older than ATTEMPT_MAX_AGE_MS is dropped', async () => {
    const storage = memoryStorage()
    let clock = 1000
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage, now: () => clock })
    clock += ATTEMPT_MAX_AGE_MS + 1
    expect(peekAttempt({ storage, now: () => clock })).toBe(null)
  })

  it('ATTEMPT_KEY is the storage key an attempt is written under', async () => {
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    expect(storage.getItem(ATTEMPT_KEY)).not.toBe(null)
  })
})

describe('finishAppReturn', () => {
  it('never calls redeem when the URL is not a return at all', async () => {
    const redeem = vi.fn()
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    const outcome = await finishAppReturn('https://gym.example.com/', { redeem, storage })
    expect(outcome).toEqual({ kind: 'none' })
    expect(redeem).not.toHaveBeenCalled()
  })

  it('never calls redeem when no attempt of this phone is held', async () => {
    const redeem = vi.fn()
    const storage = memoryStorage()
    const outcome = await finishAppReturn('opengym://oidc?code=' + 'a'.repeat(20), { redeem, storage })
    expect(outcome).toEqual({ kind: 'none' })
    expect(redeem).not.toHaveBeenCalled()
  })

  it('maps an err= return to a failed outcome, without calling redeem', async () => {
    const redeem = vi.fn()
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    const outcome = await finishAppReturn('opengym://oidc?err=locked', { redeem, storage })
    expect(outcome).toEqual({ kind: 'failed', mode: 'signIn', code: 'locked' })
    expect(redeem).not.toHaveBeenCalled()
  })

  it('a code= return calls redeem with the base, the code and this phone\'s own verifier, and maps a token+user answer to signed-in', async () => {
    const storage = memoryStorage()
    const { challenge } = await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    const redeem = vi.fn(async (base, body) => {
      expect(base).toBe('https://gym.example.com')
      expect(body.code).toBe('a'.repeat(20))
      expect(await challengeFor(body.verifier)).toBe(challenge)
      return { token: 'TOKEN', user: { id: 'u1', name: 'Ana', admin: false } }
    })
    const outcome = await finishAppReturn('opengym://oidc?code=' + 'a'.repeat(20), { redeem, storage })
    expect(outcome).toEqual({ kind: 'signed-in', base: 'https://gym.example.com', token: 'TOKEN', user: { id: 'u1', name: 'Ana', admin: false } })
  })

  it('a thrown redeem maps to a failed outcome carrying its code', async () => {
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    const redeem = vi.fn(async () => { throw Object.assign(new Error('nope'), { data: { code: 'verifier-mismatch' } }) })
    const outcome = await finishAppReturn('opengym://oidc?code=' + 'a'.repeat(20), { redeem, storage })
    expect(outcome).toEqual({ kind: 'failed', mode: 'signIn', code: 'verifier-mismatch' })
  })

  it('a { confirm } answer maps to a confirm outcome carrying the handle, the seeded name and the invite flag', async () => {
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    const redeem = vi.fn(async () => ({ confirm: { handle: 'h1', name: 'Sam', invite: false } }))
    const outcome = await finishAppReturn('opengym://oidc?code=' + 'a'.repeat(20), { redeem, storage })
    expect(outcome).toEqual({ kind: 'confirm', base: 'https://gym.example.com', handle: 'h1', name: 'Sam', invite: false })
  })

  it('an answer carrying neither token nor confirm maps to a failed outcome coded bad-response', async () => {
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    const redeem = vi.fn(async () => ({}))
    const outcome = await finishAppReturn('opengym://oidc?code=' + 'a'.repeat(20), { redeem, storage })
    expect(outcome).toEqual({ kind: 'failed', mode: 'signIn', code: 'bad-response' })
  })

  it('a { linked: true } answer maps to a linked outcome', async () => {
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'link' }, { storage })
    const redeem = vi.fn(async () => ({ linked: true }))
    const outcome = await finishAppReturn('opengym://oidc?code=' + 'a'.repeat(20), { redeem, storage })
    expect(outcome).toEqual({ kind: 'linked' })
  })

  it('a { proof } answer maps to a proof outcome, carrying the attempt\'s own act', async () => {
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'proof', act: 'identity-remove' }, { storage })
    const redeem = vi.fn(async () => ({ proof: 'proof-id-1' }))
    const outcome = await finishAppReturn('opengym://oidc?code=' + 'a'.repeat(20), { redeem, storage })
    expect(outcome).toEqual({ kind: 'proof', act: 'identity-remove', proof: 'proof-id-1' })
  })

  it('a second return with another code makes no request: the attempt was already spent', async () => {
    const storage = memoryStorage()
    await beginAttempt({ base: 'https://gym.example.com', mode: 'signIn' }, { storage })
    const redeem = vi.fn(async () => ({ token: 'TOKEN', user: { id: 'u1', name: 'Ana', admin: false } }))
    await finishAppReturn('opengym://oidc?code=' + 'a'.repeat(20), { redeem, storage })
    redeem.mockClear()
    const second = await finishAppReturn('opengym://oidc?code=' + 'b'.repeat(20), { redeem, storage })
    expect(second).toEqual({ kind: 'none' })
    expect(redeem).not.toHaveBeenCalled()
  })
})
