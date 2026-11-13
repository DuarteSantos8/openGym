/**
 * Maps a short, stable link-failure code to the one sentence a profile owner reads on the
 * Settings screen after attaching an external identity.
 *
 * A separate table from `oidc-errors.js` exists on purpose: every sentence there is phrased
 * around signing in, and reusing that copy here would misdescribe the action to an owner who
 * was never signing in - they were already signed in, and nothing about their session
 * changed. Two sentences below also depart from the usual "try again" or "tell whoever runs it"
 * close: one names the one thing the owner can act on instead of a bare description of the
 * refusal, and the other describes a state rather than instructing an order of operations that
 * the last-credential refusal may make impossible.
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
 * @param {string|null|undefined} code Short failure code from the link callback fragment.
 * @returns {string} The English sentence; the caller passes it through the translation helper.
 */
export function oidcLinkErrorKey(code) {
  const sentences = {
    'not-signed-in': 'You need to be signed in to this profile to link an identity - sign in and try again.',
    'provider-misconfigured': "Sign-in through the provider isn't set up correctly on this instance - tell whoever runs it.",
    'provider-unreachable': "This instance can't reach its sign-in provider right now - tell whoever runs it.",
    'state-expired': 'The link attempt expired - try again.',
    'state-unknown': 'The link attempt expired - try again.',
    'token-invalid': "The link attempt couldn't be verified - try again.",
    'session-changed': 'The profile that started this link is no longer signed in here - sign in again and try again.',
    'identity-collision': 'This identity is already linked to another profile on this instance. Sign out and sign in with it directly to reach that profile.',
    'profile-linked': 'This profile already has an identity linked - only one can be linked at a time.',
    'ticket-invalid': 'The link attempt expired - try again.',
    'locked': 'Too many attempts - wait a minute and try again.'
  }
  const known = Object.prototype.hasOwnProperty.call(sentences, code)
  return (known && sentences[code]) || 'Something went wrong linking that identity - try again.'
}
