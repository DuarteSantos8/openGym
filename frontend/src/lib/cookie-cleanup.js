// A delayed logout response expires the browser cookie. Let it finish before starting another login.
export let pendingCookieCleanup = null

// The cookie is HttpOnly. Boot retries logout until the server acknowledges it. A full device
// store may still let this tab record the retry in its session storage.
const LOGOUT_OWED_KEY = 'gym_logout_owed'
export function logoutOwed(on) {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[name]
      if (on === undefined) {
        if (storage.getItem(LOGOUT_OWED_KEY) === '1') return true
      } else if (on) {
        storage.setItem(LOGOUT_OWED_KEY, '1')
        return true
      } else storage.removeItem(LOGOUT_OWED_KEY)
    } catch { /* try the other storage */ }
  }
  return false
}

export function trackCookieCleanup(request) {
  const done = request.finally(() => {
    if (pendingCookieCleanup === done) pendingCookieCleanup = null
  })
  pendingCookieCleanup = done
}
