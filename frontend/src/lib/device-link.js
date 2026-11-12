// Device-link URL is origin + ?link=TOKEN. HashRouter never sees that query, so we read
// window.location.search directly rather than the router.
//
// The token is the one-time code a signed-in device shows (components/Passkeys.jsx, #95): the
// QR code carries this link, and opening it on the other device lands on the sheet that redeems
// the code there.

export function linkTokenFromSearch(search) {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('link') || ''
}

export function stripLinkFromUrl() {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  if (!u.searchParams.has('link')) return
  u.searchParams.delete('link')
  const q = u.searchParams.toString()
  history.replaceState({}, '', u.pathname + (q ? '?' + q : '') + u.hash)
}

// The link for a code: this app's own address, a subpath deployment included, which is also the
// only origin a passkey for this instance can be created on. Built here rather than by the server,
// which knows its ORIGIN but not the path the app is served under.
export function deviceLinkUrl(code, loc = window.location) {
  return loc.origin + loc.pathname + '?link=' + encodeURIComponent(code)
}

// A first name for a new passkey, from the browser that makes it — "Chrome · Android",
// "Safari · iPhone" — so a list of several says which is which without anyone typing. Product
// names only, nothing to translate; the owner can rename it. Empty when nothing is recognised.
export function deviceLabel(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  const s = String(ua || '')
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /CrOS/.test(s) ? 'ChromeOS' : /Macintosh|Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows'
    : /Linux/.test(s) ? 'Linux' : ''
  // Order matters: every Chromium browser says "Chrome", and Chrome says "Safari".
  const browser = /Edg(e|A|iOS)?\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera'
    : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
    : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : ''
  return [browser, os].filter(Boolean).join(' · ')
}
