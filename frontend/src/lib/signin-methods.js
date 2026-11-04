// Sign-in methods (Settings → account linking): the pure half. The component
// (components/SignInMethods.jsx) feeds it the account's provider ids and passkey
// credentials, read from the project's own /api/passkey/list, whose answer the server
// derives from the verified ID token, and every "may I remove this" answer comes from
// here, so the lockout guard is testable without Firebase in the room. The server
// enforces the same guard again on remove (the remove core in sync-server/api/passkey/_methods.js); this copy
// exists so the UI never offers a removal the server would refuse.

export const GOOGLE_PROVIDER_ID = 'google.com'

/** Derive the method state of an account from its provider ids + passkey list. */
export function deriveSignInMethods({ providers = [], passkeys = [] } = {}) {
  const googleLinked = providers.includes(GOOGLE_PROVIDER_ID)
  const passkeyCount = passkeys.length
  // A method is a way back in: Google while linked, passkeys while at least one
  // credential remains. Two passkeys are still ONE method family for the guard's
  // purpose only in the sense that removing one of them is always safe; the count
  // below is what the per-action checks reason about.
  const methodCount = (googleLinked ? 1 : 0) + (passkeyCount > 0 ? 1 : 0)
  return { googleLinked, passkeyCount, methodCount, onlyOneMethod: methodCount <= 1 }
}

/** Removing a passkey is safe while another credential remains, or Google stays. */
export function canRemovePasskey(m) {
  return m.passkeyCount > 1 || m.googleLinked
}

/** Unlinking Google is safe while at least one passkey credential remains. */
export function canUnlinkGoogle(m) {
  return m.googleLinked && m.passkeyCount > 0
}

/** Plain-language text (an i18n source string) for a failed Google link, or null when
 *  the caller should fall back to the raw error. The two named cases are the ones a
 *  person can act on; everything else is a generic failure. */
export function googleLinkErrorText(code) {
  switch (code) {
    case 'auth/credential-already-in-use':
    case 'auth/account-exists-with-different-credential':
    case 'auth/email-already-in-use':
      return 'That Google account is already used by another account.'
    case 'auth/provider-already-linked':
      return 'Google is already linked to this account.'
    default:
      return null
  }
}
