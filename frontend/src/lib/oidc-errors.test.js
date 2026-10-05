import { describe, expect, it } from 'vitest'
import { oidcErrorKey, oidcReturnErrorKey } from './oidc-errors.js'

// The mapped codes are the easy half. The half worth pinning down is the fallback: a code this
// client has never heard of must still read as an instruction, not render nothing, because the
// server can ship a code before this client knows it.
describe('oidcErrorKey', () => {
  it('maps state-expired to the shared expired sentence', () => {
    expect(oidcErrorKey('state-expired')).toBe('The sign-in attempt expired - try again.')
  })

  it('maps state-unknown to the same sentence as state-expired - the two are indistinguishable to a visitor', () => {
    expect(oidcErrorKey('state-unknown')).toBe('The sign-in attempt expired - try again.')
  })

  it('maps invite-invalid to its own sentence', () => {
    expect(oidcErrorKey('invite-invalid')).toBe("That invite code isn't valid anymore - try again with a current one.")
  })

  it('maps token-invalid to its own sentence', () => {
    expect(oidcErrorKey('token-invalid')).toBe("The sign-in attempt couldn't be verified - try again.")
  })

  it('maps provider-unreachable to its own sentence', () => {
    expect(oidcErrorKey('provider-unreachable')).toBe("This instance can't reach its sign-in provider right now - tell whoever runs it.")
  })

  it('maps provider-misconfigured to its own sentence', () => {
    expect(oidcErrorKey('provider-misconfigured')).toBe("Sign-in through the provider isn't set up correctly on this instance - tell whoever runs it.")
  })

  it('maps account-disabled to its own sentence', () => {
    expect(oidcErrorKey('account-disabled')).toBe('This account has been disabled - contact whoever runs this instance.')
  })

  it('falls back to the generic sentence for an unrecognised code', () => {
    expect(oidcErrorKey('some-code-this-client-has-never-seen')).toBe('Something went wrong signing in - try again.')
  })

  it('falls back to the generic sentence for undefined', () => {
    expect(oidcErrorKey(undefined)).toBe('Something went wrong signing in - try again.')
  })

  it('falls back to the generic sentence for null', () => {
    expect(oidcErrorKey(null)).toBe('Something went wrong signing in - try again.')
  })

  it('falls back to the generic sentence for the empty string', () => {
    expect(oidcErrorKey('')).toBe('Something went wrong signing in - try again.')
  })

  it('never echoes a code carrying unexpected characters into the returned sentence', () => {
    const crafted = '<script>alert(1)</script>'
    const sentence = oidcErrorKey(crafted)
    expect(sentence).toBe('Something went wrong signing in - try again.')
    expect(sentence).not.toContain(crafted)
  })

  // The code arrives off the URL fragment, so an inherited property name reaches this lookup as
  // readily as a real one. A bare index answers Object.prototype for '__proto__' and a function
  // for 'constructor' or 'toString' - all truthy, so the fallback never fires and the caller is
  // handed something that is not a sentence. Whatever renders the result then receives an object.
  it('answers the fallback sentence for every name inherited from Object.prototype', () => {
    for (const crafted of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) {
      expect(oidcErrorKey(crafted)).toBe('Something went wrong signing in - try again.')
    }
  })

  it('always answers a plain string, whatever it is handed', () => {
    for (const crafted of ['__proto__', 'constructor', null, undefined, '', 'unmapped-code', 'state-expired']) {
      expect(typeof oidcErrorKey(crafted)).toBe('string')
    }
  })

  it('carries a try-again or a tell-the-operator instruction for every code in the table', () => {
    const codes = [
      'state-expired', 'state-unknown', 'invite-invalid', 'token-invalid',
      'provider-unreachable', 'provider-misconfigured', 'account-disabled', 'unmapped-code'
    ]
    for (const code of codes) {
      const sentence = oidcErrorKey(code)
      expect(sentence.includes('try again') || sentence.includes('whoever runs')).toBe(true)
    }
  })

  it('maps locked, a departure past the request budget, to the shared wait-and-retry sentence', () => {
    expect(oidcErrorKey('locked')).toBe('Too many attempts - wait a minute and try again.')
  })
})

describe('oidcReturnErrorKey', () => {
  it('reads an unattributed state code as an attempt that expired, whatever it was for', () => {
    expect(oidcReturnErrorKey('state-unknown')).toBe('The attempt at the sign-in provider expired - try again.')
    expect(oidcReturnErrorKey('state-expired')).toBe('The attempt at the sign-in provider expired - try again.')
  })

  it('keeps the instance-level sentences', () => {
    expect(oidcReturnErrorKey('provider-misconfigured')).toBe(oidcErrorKey('provider-misconfigured'))
    expect(oidcReturnErrorKey('locked')).toBe(oidcErrorKey('locked'))
  })

  it('never resolves an inherited name to anything but the expired sentence', () => {
    for (const code of ['__proto__', 'constructor', 'toString', undefined, null, '']) {
      expect(oidcReturnErrorKey(code)).toBe('The attempt at the sign-in provider expired - try again.')
    }
  })
})
