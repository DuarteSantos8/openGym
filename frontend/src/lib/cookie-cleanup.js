// Finish pending cleanup before sending another login, including against older API versions.
export let pendingCookieCleanup = null

// Boot retries logout until the server acknowledges it. The fallback must be shared across
// tabs even when localStorage is full. This session cookie carries only the pending flag.
const LOGOUT_OWED_KEY = 'gym_logout_owed'
const localMarkerKeys = () => {
  try { return Object.keys(localStorage).filter(k => k === LOGOUT_OWED_KEY || k.startsWith(LOGOUT_OWED_KEY + ':')) } catch { return [] }
}
const forgetMarkers = keys => {
  try { for (const key of keys) localStorage.removeItem(key) } catch { /* unavailable */ }
}
const debtCookie = () => {
  try { return document.cookie.match(/(?:^|;\s*)gym_logout_owed=([01])(?:;|$)/)?.[1] } catch { return undefined }
}
const writeDebtCookie = value => {
  try {
    document.cookie = LOGOUT_OWED_KEY + '=' + value + '; Path=/; SameSite=Strict' + (location.protocol === 'https:' ? '; Secure' : '')
    return debtCookie() === value
  } catch { return false }
}

export function logoutOwed(on) {
  // Snapshot before reading the cookie. A different tab writes a fresh key, so clearing
  // the observed generation cannot remove a later logout that must survive a restart.
  const markers = localMarkerKeys()
  if (on === true) {
    const shared = writeDebtCookie('1')
    try {
      const nonce = crypto.getRandomValues(new Uint32Array(4)).join('-')
      localStorage.setItem(LOGOUT_OWED_KEY + ':' + nonce, '1')
      forgetMarkers(markers)
      return true
    } catch { /* quota */ }
    if (shared) return true
    try { sessionStorage.setItem(LOGOUT_OWED_KEY, '1'); return true } catch { return false }
  }
  if (on === false) {
    forgetMarkers(markers)
    try { sessionStorage.removeItem(LOGOUT_OWED_KEY) } catch { /* unavailable */ }
    writeDebtCookie('0')
    return false
  }
  const cookie = debtCookie()
  if (cookie === '1') return true
  if (cookie === '0') {
    // The verified provider callback can clear the cookie but cannot remove old storage markers.
    forgetMarkers(markers)
    try { sessionStorage.removeItem(LOGOUT_OWED_KEY) } catch { /* unavailable */ }
    return false
  }
  if (markers.length) return true
  try { return !!sessionStorage.getItem(LOGOUT_OWED_KEY) } catch { return false }
}

export function trackCookieCleanup(request) {
  const prior = pendingCookieCleanup
  const done = Promise.all([prior, request.then(() => true, () => false)]).then(([, succeeded]) => {
    if (succeeded && pendingCookieCleanup === done) logoutOwed(false)
  }).finally(() => {
    if (pendingCookieCleanup === done) pendingCookieCleanup = null
  })
  pendingCookieCleanup = done
}
