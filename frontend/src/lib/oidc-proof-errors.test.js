import { describe, expect, it } from 'vitest'
import { oidcProofErrorKey } from './oidc-proof-errors.js'
import { oidcLinkErrorKey } from './oidc-link-errors.js'

describe('oidcProofErrorKey', () => {
  it('maps state-expired and state-unknown to the same "try again" sentence', () => {
    expect(oidcProofErrorKey('state-expired')).toBe('The confirmation attempt expired - try again.')
    expect(oidcProofErrorKey('state-unknown')).toBe('The confirmation attempt expired - try again.')
  })

  it('maps token-invalid to its own sentence', () => {
    expect(oidcProofErrorKey('token-invalid')).toBe("Your identity couldn't be confirmed - try again.")
  })

  it('maps identity-mismatch to its own sentence, naming that a different account was used', () => {
    expect(oidcProofErrorKey('identity-mismatch')).toBe("That wasn't the linked identity for this profile - try again with the right account.")
  })

  it('maps stale-sign-in to a sentence that neither blames the person nor names a different proof', () => {
    const sentence = oidcProofErrorKey('stale-sign-in')
    expect(sentence).toBe("Your sign-in provider didn't confirm a new sign-in - try again, or tell whoever runs this instance if it keeps happening.")
  })

  it('maps provider-unreachable and provider-misconfigured to the shared infrastructure sentences', () => {
    expect(oidcProofErrorKey('provider-unreachable')).toBe("This instance can't reach its sign-in provider right now - tell whoever runs it.")
    expect(oidcProofErrorKey('provider-misconfigured')).toBe("Sign-in through the provider isn't set up correctly on this instance - tell whoever runs it.")
  })

  it('falls back to the generic sentence for an unrecognised code, undefined and null', () => {
    const generic = "Something went wrong confirming it's you - try again."
    expect(oidcProofErrorKey('some-code-this-client-has-never-seen')).toBe(generic)
    expect(oidcProofErrorKey(undefined)).toBe(generic)
    expect(oidcProofErrorKey(null)).toBe(generic)
    expect(oidcProofErrorKey('')).toBe(generic)
  })

  // The code arrives off the URL fragment, so an inherited property name reaches this lookup as
  // readily as a real one. A bare index answers Object.prototype for '__proto__' and a function
  // for 'constructor' or 'toString' - all truthy, so the fallback never fires unless the lookup
  // is guarded.
  it('answers the fallback sentence for every name inherited from Object.prototype', () => {
    const generic = "Something went wrong confirming it's you - try again."
    for (const crafted of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) {
      expect(oidcProofErrorKey(crafted)).toBe(generic)
    }
  })

  it('never echoes a crafted code into the returned sentence', () => {
    const crafted = '<script>alert(1)</script>'
    const sentence = oidcProofErrorKey(crafted)
    expect(sentence).not.toContain(crafted)
  })

  it('always answers a plain string, whatever it is handed', () => {
    for (const crafted of ['__proto__', 'constructor', null, undefined, '', 'unmapped-code', 'stale-sign-in']) {
      expect(typeof oidcProofErrorKey(crafted)).toBe('string')
    }
  })

  // Every sentence has to be one a person can act on - retrying or telling the operator - and
  // none of them may point at a different kind of proof: for a provider-only profile there is
  // none.
  it('no sentence tells a person the provider can never confirm them, or names another proof to try', () => {
    for (const code of ['state-expired', 'state-unknown', 'token-invalid', 'identity-mismatch', 'stale-sign-in', 'provider-unreachable', 'provider-misconfigured', 'unknown-code']) {
      const sentence = oidcProofErrorKey(code)
      expect(sentence).not.toMatch(/passkey|password/i)
    }
  })

  // A proof step is phrased around confirming an existing session's owner, not around linking a
  // new identity - reusing the link table's wording verbatim for these would misdescribe what
  // the person was doing, so each gets its own sentence in this table.
  it('never shares a sentence with the link table for the codes phrased around an attempt', () => {
    for (const code of ['state-expired', 'state-unknown', 'token-invalid']) {
      expect(oidcProofErrorKey(code)).not.toBe(oidcLinkErrorKey(code))
    }
  })

  // The two provider-infrastructure codes describe the same underlying fact regardless of which
  // flow hit it (a discovery/token fetch failing, a shape-invalid issuer config), so both tables
  // reuse the identical sentence rather than rewording it per context.
  it('shares the provider-infrastructure sentences verbatim with the link table', () => {
    for (const code of ['provider-unreachable', 'provider-misconfigured']) {
      expect(oidcProofErrorKey(code)).toBe(oidcLinkErrorKey(code))
    }
  })

  it('maps locked, a departure past the request budget, to the shared wait-and-retry sentence', () => {
    expect(oidcProofErrorKey('locked')).toBe('Too many attempts - wait a minute and try again.')
  })
})
