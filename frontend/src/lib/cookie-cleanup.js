// A delayed logout response expires the browser cookie. Let it finish before starting another login.
export let pendingCookieCleanup = null

// The cookie is HttpOnly. Boot retries logout until the server acknowledges it. A full device
// store may still let this tab record the retry in its session storage.
const LOGOUT_OWED_KEY = 'gym_logout_owed'
const SIGN_IN_KEY = 'gym_sign_in_generation'
const signInGeneration = () => {
  try { return localStorage.getItem(SIGN_IN_KEY) || '1' } catch { return null }
}

export function recordSignIn() {
  try { localStorage.setItem(SIGN_IN_KEY, Date.now().toString(36) + Math.random().toString(36)) } catch { /* storage is unavailable */ }
}

export function logoutOwed(on) {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[name]
      if (on === undefined) {
        const marker = storage.getItem(LOGOUT_OWED_KEY)
        if (!marker) continue
        const current = name === 'sessionStorage' ? signInGeneration() : null
        if (!current || marker === '?' || marker === current) return true
        storage.removeItem(LOGOUT_OWED_KEY)
      } else if (on) {
        storage.setItem(LOGOUT_OWED_KEY, name === 'sessionStorage' ? signInGeneration() || '?' : '1')
        return true
      } else storage.removeItem(LOGOUT_OWED_KEY)
    } catch { /* try the other storage */ }
  }
  return false
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
