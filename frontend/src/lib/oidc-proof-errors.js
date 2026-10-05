/**
 * Maps a short, stable proof-failure code to the one sentence a profile owner reads after a
 * provider round trip requested as `ProveOwner`'s third proof (a sign-in at the provider as the
 * linked identity).
 *
 * A separate table from `oidc-link-errors.js` exists on purpose: every sentence there is phrased
 * around linking a new identity, and the proof round trip can be requested for something else
 * entirely - removing a passkey, changing a password. None of the codes below suggests a
 * different kind of proof: for a profile whose only way in is the linked identity, there is no
 * other proof to point at.
 *
 * An unrecognised code falls back to the generic sentence rather than rendering nothing: the
 * server can ship a code this client has never heard of, and a blank screen is worse than a
 * vague one. The code is used only as a lookup key and is never interpolated into the returned
 * sentence - it arrives off the URL fragment, so a sentence built from it would let a crafted
 * link render its own text on the Settings screen.
 *
 * The lookup is guarded rather than a bare index, because the key arrives off the URL and every
 * object inherits names like `__proto__`, `constructor` and `toString`. A bare index on any of
 * those answers something truthy that is not a sentence, which slips past the fallback and hands
 * a caller-chosen object to whatever renders the result. Only the sentences declared here count
 * as present.
 *
 * @param {string|null|undefined} code Short failure code from the proof callback fragment.
 * @returns {string} The English sentence; the caller passes it through the translation helper.
 */
export function oidcProofErrorKey(code) {
  const sentences = {
    'state-expired': 'The confirmation attempt expired - try again.',
    'state-unknown': 'The confirmation attempt expired - try again.',
    'token-invalid': "Your identity couldn't be confirmed - try again.",
    'identity-mismatch': 'That wasn\'t the linked identity for this profile - try again with the right account.',
    'stale-sign-in': "Your sign-in provider didn't confirm a new sign-in - try again, or tell whoever runs this instance if it keeps happening.",
    'provider-unreachable': "This instance can't reach its sign-in provider right now - tell whoever runs it.",
    'provider-misconfigured': "Sign-in through the provider isn't set up correctly on this instance - tell whoever runs it.",
    'locked': 'Too many attempts - wait a minute and try again.'
  }
  const known = Object.prototype.hasOwnProperty.call(sentences, code)
  return (known && sentences[code]) || "Something went wrong confirming it's you - try again."
}
