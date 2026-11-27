// A delayed logout response expires the browser cookie. Let it finish before starting another login.
export let pendingCookieCleanup = null

// Boot retries logout until the server acknowledges it. The fallback must be shared across
// tabs even when localStorage is full. This session cookie carries only the pending flag.
const LOGOUT_OWED_KEY = 'gym_logout_owed'
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
  if (on === true) {
    try { localStorage.setItem(LOGOUT_OWED_KEY, '1'); return true } catch { /* quota */ }
    if (writeDebtCookie('1')) return true
    try { sessionStorage.setItem(LOGOUT_OWED_KEY, '1'); return true } catch { return false }
  }
  if (on === false) {
    try { localStorage.removeItem(LOGOUT_OWED_KEY) } catch { /* unavailable */ }
    try { sessionStorage.removeItem(LOGOUT_OWED_KEY) } catch { /* unavailable */ }
    writeDebtCookie('0')
    return false
  }
  try { if (localStorage.getItem(LOGOUT_OWED_KEY)) return true } catch { /* unavailable */ }
  const cookie = debtCookie()
  if (cookie !== undefined) return cookie === '1'
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
