const OAUTH_AUTHORIZE_PATH = '/oauth/authorize'

// The OAuth gateway sends the original authorize request through the same-origin SPA while a
// user signs in. Keep the continuation a path, never an arbitrary URL: the authorize endpoint
// will validate the client, redirect URI, PKCE and state again after the session is established.
export function oauthReturnTarget(raw, origin) {
  if (!raw || !origin) return null
  try {
    const value = String(raw)
    if (!value.startsWith(OAUTH_AUTHORIZE_PATH)) return null
    const base = new URL(String(origin))
    const target = new URL(value, base)
    if (target.origin !== base.origin || target.pathname !== OAUTH_AUTHORIZE_PATH
      || target.username || target.password || target.hash) return null
    return target.pathname + target.search
  } catch { return null }
}

export function readOAuthReturn(location = globalThis.location) {
  try {
    return oauthReturnTarget(new URLSearchParams(location?.search || '').get('oauth_return'), location?.origin)
  } catch { return null }
}

export const shellAuthed = (user, isGuest, oauthLogin) => !oauthLogin && !!(user || isGuest)
