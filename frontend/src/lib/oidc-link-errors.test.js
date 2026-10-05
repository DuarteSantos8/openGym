import { describe, expect, it } from 'vitest'
import { oidcLinkErrorKey } from './oidc-link-errors.js'
import { oidcErrorKey } from './oidc-errors.js'

// The mapped codes are the easy half. The half worth pinning down is the fallback: a code this
// client has never heard of must still read as an instruction about linking, not render nothing,
// because the server can ship a code before this client knows it.
describe('oidcLinkErrorKey', () => {
  it('maps not-signed-in to its own sentence', () => {
    expect(oidcLinkErrorKey('not-signed-in')).toBe('You need to be signed in to this profile to link an identity - sign in and try again.')
  })

  it('maps provider-misconfigured to its own sentence', () => {
    expect(oidcLinkErrorKey('provider-misconfigured')).toBe("Sign-in through the provider isn't set up correctly on this instance - tell whoever runs it.")
  })

  it('maps provider-unreachable to its own sentence', () => {
    expect(oidcLinkErrorKey('provider-unreachable')).toBe("This instance can't reach its sign-in provider right now - tell whoever runs it.")
  })

  it('maps state-expired to the shared expired sentence', () => {
    expect(oidcLinkErrorKey('state-expired')).toBe('The link attempt expired - try again.')
  })

  it('maps state-unknown to the same sentence as state-expired - the two are indistinguishable to an owner', () => {
    expect(oidcLinkErrorKey('state-unknown')).toBe('The link attempt expired - try again.')
  })

  it('maps token-invalid to its own sentence', () => {
    expect(oidcLinkErrorKey('token-invalid')).toBe("The link attempt couldn't be verified - try again.")
  })

  it('maps session-changed to its own sentence', () => {
    expect(oidcLinkErrorKey('session-changed')).toBe('The profile that started this link is no longer signed in here - sign in again and try again.')
  })

  it('maps identity-collision to its own sentence', () => {
    expect(oidcLinkErrorKey('identity-collision')).toBe('This identity is already linked to another profile on this instance. Sign out and sign in with it directly to reach that profile.')
  })

  it('maps profile-linked to its own sentence', () => {
    expect(oidcLinkErrorKey('profile-linked')).toBe('This profile already has an identity linked - only one can be linked at a time.')
  })

  it('maps ticket-invalid to the shared expired sentence', () => {
    expect(oidcLinkErrorKey('ticket-invalid')).toBe('The link attempt expired - try again.')
  })

  it('falls back to the generic sentence for an unrecognised code', () => {
    expect(oidcLinkErrorKey('some-code-this-client-has-never-seen')).toBe('Something went wrong linking that identity - try again.')
  })

  it('falls back to the generic sentence for undefined', () => {
    expect(oidcLinkErrorKey(undefined)).toBe('Something went wrong linking that identity - try again.')
  })

  it('falls back to the generic sentence for null', () => {
    expect(oidcLinkErrorKey(null)).toBe('Something went wrong linking that identity - try again.')
  })

  it('falls back to the generic sentence for the empty string', () => {
    expect(oidcLinkErrorKey('')).toBe('Something went wrong linking that identity - try again.')
  })

  it('never echoes a code carrying unexpected characters into the returned sentence', () => {
    const crafted = '<script>alert(1)</script>'
    const sentence = oidcLinkErrorKey(crafted)
    expect(sentence).toBe('Something went wrong linking that identity - try again.')
    expect(sentence).not.toContain(crafted)
  })

  // The code arrives off the URL fragment, so an inherited property name reaches this lookup as
  // readily as a real one. A bare index answers Object.prototype for '__proto__' and a function
  // for 'constructor' or 'toString' - all truthy, so the fallback never fires and the caller is
  // handed something that is not a sentence. Whatever renders the result then receives an object.
  it('answers the fallback sentence for every name inherited from Object.prototype', () => {
    for (const crafted of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) {
      expect(oidcLinkErrorKey(crafted)).toBe('Something went wrong linking that identity - try again.')
    }
  })

  it('always answers a plain string, whatever it is handed', () => {
    for (const crafted of ['__proto__', 'constructor', null, undefined, '', 'unmapped-code', 'state-expired']) {
      expect(typeof oidcLinkErrorKey(crafted)).toBe('string')
    }
  })

  // Reusing a sign-in sentence during a link would misdescribe the action to someone who was
  // never signing in, so the codes describing an attempt are reworded. A shared infrastructure
  // problem reads the same regardless of which flow hit it, so those two codes are excluded here
  // by design rather than by oversight.
  it('never shares a sentence with the sign-in table for the codes phrased around an attempt', () => {
    for (const code of ['state-expired', 'state-unknown', 'token-invalid']) {
      expect(oidcLinkErrorKey(code)).not.toBe(oidcErrorKey(code))
    }
  })

  it('maps locked, a departure past the request budget, to the shared wait-and-retry sentence', () => {
    expect(oidcLinkErrorKey('locked')).toBe('Too many attempts - wait a minute and try again.')
  })
})
