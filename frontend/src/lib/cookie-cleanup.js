// Finish pending cleanup before sending another login, including against older API versions.
export let pendingCookieCleanup = null

// Boot retries logout until the server acknowledges it. The fallback must be shared across
// tabs even when localStorage is full. The nonce identifies a logout, never a person or session.
const LOGOUT_OWED_KEY = 'gym_logout_owed'
const ACK_PREFIX = LOGOUT_OWED_KEY + '_done_'
const localMarkerKeys = () => {
  try { return Object.keys(localStorage).filter(k => k === LOGOUT_OWED_KEY || k.startsWith(LOGOUT_OWED_KEY + ':')) } catch { return [] }
}
const forgetMarkers = keys => {
  try { for (const key of keys) localStorage.removeItem(key) } catch { /* unavailable */ }
}
const writeCookie = (name, value, expire = false) => {
  try {
    document.cookie = name + '=' + value + '; Path=/; SameSite=Strict' + (expire ? '; Max-Age=0' : '') + (location.protocol === 'https:' ? '; Secure' : '')
  } catch { /* unavailable */ }
}
function snapshot() {
  // Snapshot before reading the cookie. A different tab writes a fresh key, so clearing
  // the observed generation cannot remove a later logout that must survive a restart.
  const markers = localMarkerKeys()
  let session = null, cookies = ''
  try { session = sessionStorage.getItem(LOGOUT_OWED_KEY) } catch { /* unavailable */ }
  try { cookies = document.cookie } catch { /* unavailable */ }
  const current = cookies.match(/(?:^|;\s*)gym_logout_owed=([\d-]+)(?:;|$)/)?.[1]
  const acks = [...cookies.matchAll(/(?:^|;\s*)(gym_logout_owed_done_[\d-]+)=1(?=;|$)/g)].map(m => m[1])
  return { markers, session, current, acks }
}
function forgetSnapshot({ markers, session }) {
  forgetMarkers(markers)
  try {
    if (session && sessionStorage.getItem(LOGOUT_OWED_KEY) === session) sessionStorage.removeItem(LOGOUT_OWED_KEY)
  } catch { /* unavailable */ }
}
export function logoutOwed(on) {
  const before = snapshot()
  if (on === true) {
    const nonce = crypto.getRandomValues(new Uint32Array(4)).join('-')
    writeCookie(LOGOUT_OWED_KEY, nonce)
    for (const name of before.acks) writeCookie(name, '', true)
    try {
      localStorage.setItem(LOGOUT_OWED_KEY + ':' + nonce, '1')
      forgetSnapshot(before)
      return true
    } catch { /* quota */ }
    if (snapshot().current === nonce) return true
    try { sessionStorage.setItem(LOGOUT_OWED_KEY, nonce); return true } catch { return false }
  }
  if (on === false) {
    writeCookie(LOGOUT_OWED_KEY, '0')
    forgetSnapshot(before)
    for (const name of before.acks) writeCookie(name, '', true)
    return false
  }
  if (before.current === '0') {
    // The verified provider callback can clear the cookie but cannot remove old storage markers.
    forgetSnapshot(before)
    return false
  }
  if (before.current) return !before.acks.includes(ACK_PREFIX + before.current)
  return !!(before.markers.length || before.session)
}

export function trackCookieCleanup(startRequest) {
  const before = snapshot()
  const prior = pendingCookieCleanup
  const request = startRequest()
  const settled = request.then(() => {
    // A late reply may retire its own occurrence only. Writing a separate cookie avoids
    // a cross-tab compare-then-write race on the current generation, even at full quota.
    if (before.current && before.current !== '0') writeCookie(ACK_PREFIX + before.current, '1')
    forgetSnapshot(before)
  }, () => {})
  const done = Promise.all([prior, settled]).finally(() => {
    if (pendingCookieCleanup === done) pendingCookieCleanup = null
  })
  pendingCookieCleanup = done
  return request
}
