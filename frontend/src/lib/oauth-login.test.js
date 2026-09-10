import { describe, expect, it } from 'vitest'
import { oauthReturnTarget, readOAuthReturn, shellAuthed } from './oauth-login.js'

describe('OAuth login continuation', () => {
  const origin = 'https://gym.example.test'
  const target = '/oauth/authorize?client_id=client&state=a%2Bb&scope=exercise%3Aread'

  it('preserves a same-origin authorize request', () => {
    expect(oauthReturnTarget(target, origin)).toBe(target)
    expect(readOAuthReturn({ origin, search: `?oauth_return=${encodeURIComponent(target)}` })).toBe(target)
  })

  it('rejects external, non-authorize, credential-bearing and fragment targets', () => {
    for (const value of [
      'https://gym.example.test/oauth/authorize?client_id=client', 'https://evil.example/collect', '//evil.example/collect', '/settings',
      'https://gym.example.test@evil.example/oauth/authorize', `${target}#outside`
    ]) expect(oauthReturnTarget(value, origin)).toBeNull()
  })

  it('keeps a guest or stale local user out of the app during OAuth login', () => {
    expect(shellAuthed(null, true, true)).toBe(false)
    expect(shellAuthed({ id: 'local' }, false, true)).toBe(false)
    expect(shellAuthed(null, true, false)).toBe(true)
  })
})
