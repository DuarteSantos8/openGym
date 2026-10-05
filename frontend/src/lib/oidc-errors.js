/**
 * Maps a short, stable OIDC failure code to the one sentence a visitor reads on the login screen.
 *
 * An unrecognised code falls back to the generic sentence rather than rendering nothing: the
 * server can ship a code this client has never heard of, and a blank screen is worse than a vague
 * one. The code is used only as a lookup key and is never interpolated into the returned sentence
 * - it arrives off the URL, so a sentence built from it would let a crafted link render its own
 * text on the login screen.
 *
 * The lookup is guarded rather than a bare index, because the key arrives off the URL and every
 * object inherits names like `__proto__`, `constructor` and `toString`. A bare index on any of
 * those answers something truthy that is not a sentence, which slips past the fallback and hands
 * a caller-chosen object to whatever renders the result. Only the sentences declared here count
 * as present.
 *
 * @param {string|null|undefined} code Short failure code from the OIDC callback fragment.
 * @returns {string} The English sentence; the caller passes it through the translation helper.
 */
export function oidcErrorKey(code) {
  const sentences = {
    'state-expired': 'The sign-in attempt expired - try again.',
    'state-unknown': 'The sign-in attempt expired - try again.',
    'invite-invalid': "That invite code isn't valid anymore - try again with a current one.",
    'token-invalid': "The sign-in attempt couldn't be verified - try again.",
    'provider-unreachable': "This instance can't reach its sign-in provider right now - tell whoever runs it.",
    'provider-misconfigured': "Sign-in through the provider isn't set up correctly on this instance - tell whoever runs it.",
    'account-disabled': 'This account has been disabled - contact whoever runs this instance.',
    'locked': 'Too many attempts - wait a minute and try again.'
  }
  const known = Object.prototype.hasOwnProperty.call(sentences, code)
  return (known && sentences[code]) || 'Something went wrong signing in - try again.'
}

/**
 * The sentence for a return from the provider the server could not attribute to a sign-in, a
 * link or a proof (it answers those on Settings under `oidc-err` while the browser is signed in):
 * most often an attempt that took longer than its departure cookie lives. The instance-level
 * codes keep their own sentences; anything else reads as an attempt that expired, the one thing
 * the owner can act on.
 *
 * @param {string|null|undefined} code Short failure code from the `oidc-err` query value.
 * @returns {string} The English sentence; the caller passes it through the translation helper.
 */
export function oidcReturnErrorKey(code) {
  if (code === 'provider-misconfigured' || code === 'provider-unreachable' || code === 'locked') return oidcErrorKey(code)
  return 'The attempt at the sign-in provider expired - try again.'
}
