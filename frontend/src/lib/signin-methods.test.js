// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { deriveSignInMethods, canRemovePasskey, canUnlinkGoogle, googleLinkErrorText } from './signin-methods.js'

/* The lockout guard, client half: the UI must never offer removing the account's last
   remaining sign-in method. State is derived from a mocked auth shape (provider ids)
   plus the passkey list the server returns. */

const cred = id => ({ id, createdAt: 1, deviceType: null, backedUp: false })

describe('deriveSignInMethods', () => {
  it('a passkey-only account has one method', () => {
    const m = deriveSignInMethods({ providers: [], passkeys: [cred('a')] })
    expect(m).toMatchObject({ googleLinked: false, passkeyCount: 1, methodCount: 1, onlyOneMethod: true })
  })
  it('a Google-only account has one method', () => {
    const m = deriveSignInMethods({ providers: ['google.com'], passkeys: [] })
    expect(m).toMatchObject({ googleLinked: true, passkeyCount: 0, methodCount: 1, onlyOneMethod: true })
  })
  it('Google plus passkeys is two methods', () => {
    const m = deriveSignInMethods({ providers: ['google.com'], passkeys: [cred('a'), cred('b')] })
    expect(m).toMatchObject({ googleLinked: true, passkeyCount: 2, methodCount: 2, onlyOneMethod: false })
  })
  it('unrelated providers do not count as Google', () => {
    const m = deriveSignInMethods({ providers: ['password'], passkeys: [] })
    expect(m.googleLinked).toBe(false)
  })
})

describe('the lockout guard', () => {
  it('the only passkey of a passkey-only account cannot be removed', () => {
    expect(canRemovePasskey(deriveSignInMethods({ providers: [], passkeys: [cred('a')] }))).toBe(false)
  })
  it('one of two passkeys can be removed', () => {
    expect(canRemovePasskey(deriveSignInMethods({ providers: [], passkeys: [cred('a'), cred('b')] }))).toBe(true)
  })
  it('the last passkey can be removed when Google stays linked', () => {
    expect(canRemovePasskey(deriveSignInMethods({ providers: ['google.com'], passkeys: [cred('a')] }))).toBe(true)
  })
  it('Google cannot be unlinked from a Google-only account', () => {
    expect(canUnlinkGoogle(deriveSignInMethods({ providers: ['google.com'], passkeys: [] }))).toBe(false)
  })
  it('Google can be unlinked while a passkey remains', () => {
    expect(canUnlinkGoogle(deriveSignInMethods({ providers: ['google.com'], passkeys: [cred('a')] }))).toBe(true)
  })
  it('nothing can be unlinked when Google is not linked', () => {
    expect(canUnlinkGoogle(deriveSignInMethods({ providers: [], passkeys: [cred('a')] }))).toBe(false)
  })
})

describe('googleLinkErrorText', () => {
  it('names the already-used case plainly', () => {
    expect(googleLinkErrorText('auth/credential-already-in-use')).toBe('That Google account is already used by another account.')
    expect(googleLinkErrorText('auth/account-exists-with-different-credential')).toBe('That Google account is already used by another account.')
  })
  it('names the already-linked case plainly', () => {
    expect(googleLinkErrorText('auth/provider-already-linked')).toBe('Google is already linked to this account.')
  })
  it('anything else falls back to the raw error', () => {
    expect(googleLinkErrorText('auth/network-request-failed')).toBe(null)
    expect(googleLinkErrorText('')).toBe(null)
    expect(googleLinkErrorText(undefined)).toBe(null)
  })
})
