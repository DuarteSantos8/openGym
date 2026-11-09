// Settings → About & updates → Network log (phone app): every request this copy of the app made
// since it started, so anyone can see for themselves that a phone kept on its own talks to nobody.
//
// What counts: fetch and XMLHttpRequest from the page, EventSource and WebSocket, sendBeacon, the
// native calls that skip the WebView (lib/capacitor-fetch.js nativeFetch: the Coach, WebDAV, the
// gym search; lib/update.js: the APK download), and everything the page loads by itself (pictures
// such as map tiles, frames such as a YouTube player), which the browser's resource timing reports.
// What does not: the app's own files (same origin, data:, blob:), which never leave the phone.
//
// Only the address is kept, without its query string or fragment (a token can sit there), and
// only in memory: closing the app starts the count again at 0. Nothing is sent anywhere, of course.

const MAX = 300
let entries = []
let total = 0
let startedAt = 0
let started = false
const subs = new Set()

const notify = () => subs.forEach(fn => { try { fn() } catch { /* a listener's own trouble */ } })

/** The page's own origin: what the app serves itself (https://localhost, capacitor://localhost). */
const ownOrigin = () => { try { return globalThis.location?.origin || '' } catch { return '' } }

/** `raw` as { origin, host, path } for the log, or null for the app's own files. */
export function addressOf(raw, own = ownOrigin()) {
  let u
  try { u = new URL(String(raw), own && own !== 'null' ? own : undefined) } catch { return null }
  if (!/^(https?|wss?):$/.test(u.protocol)) return null
  if (own && u.origin === own) return null
  return { origin: u.origin, host: u.host, path: u.pathname || '/' }
}

/** Notes one request. `via` says how it went out: fetch, xhr, native, img, iframe, ... */
export function logRequest(url, { method = 'GET', via = 'fetch', at = Date.now() } = {}) {
  const a = addressOf(url)
  if (!a) return false
  total++
  entries.push({ at, method: String(method || 'GET').toUpperCase(), via, ...a })
  if (entries.length > MAX) entries = entries.slice(-MAX)
  notify()
  return true
}

/** { total, entries (oldest first, the last MAX), since } for the page. */
export function netLog() {
  return { total, entries, since: startedAt }
}

export function subscribeNetLog(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

/** The log by host, most requests first: [{ host, count, last }]. */
export function hostsOf(list) {
  const m = new Map()
  for (const e of list || []) {
    const h = m.get(e.host) || { host: e.host, count: 0, last: 0 }
    h.count++
    if (e.at > h.last) h.last = e.at
    m.set(e.host, h)
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.last - a.last)
}

// Resource-timing entries the wrappers below already counted.
const WRAPPED = new Set(['fetch', 'xmlhttprequest', 'beacon', 'other'])

/** Starts listening (main.jsx, phone app). Safe to call twice. `win` for the tests. */
export function startNetLog(win = globalThis) {
  if (started || !win) return
  started = true
  startedAt = Date.now()

  const f = win.fetch
  if (typeof f === 'function') {
    win.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url
        logRequest(url, { method: init?.method || input?.method || 'GET', via: 'fetch' })
      } catch { /* never in the way of the request */ }
      return f.apply(win, arguments)
    }
  }
  const X = win.XMLHttpRequest
  if (X?.prototype?.open) {
    const open = X.prototype.open
    X.prototype.open = function (method, url) {
      try { logRequest(url, { method, via: 'xhr' }) } catch { /* as above */ }
      return open.apply(this, arguments)
    }
  }
  const nav = win.navigator
  if (nav && typeof nav.sendBeacon === 'function') {
    const beacon = nav.sendBeacon
    try {
      nav.sendBeacon = function (url) {
        try { logRequest(url, { method: 'POST', via: 'beacon' }) } catch { /* as above */ }
        return beacon.apply(this, arguments)
      }
    } catch { /* read-only in this browser */ }
  }
  for (const [name, via] of [['EventSource', 'eventsource'], ['WebSocket', 'websocket']]) {
    const C = win[name]
    if (typeof C !== 'function') continue
    const Wrapped = function (url, opts) {
      try { logRequest(url, { via }) } catch { /* as above */ }
      return new C(url, opts)
    }
    Wrapped.prototype = C.prototype
    Object.assign(Wrapped, C)
    try { win[name] = Wrapped } catch { /* read-only */ }
  }
  // Pictures, frames, media, styles: whatever the page loads without a script asking.
  const PO = win.PerformanceObserver
  if (typeof PO === 'function') {
    try {
      new PO(list => {
        for (const e of list.getEntries()) {
          if (!WRAPPED.has(e.initiatorType)) logRequest(e.name, { via: e.initiatorType || 'load' })
        }
      }).observe({ type: 'resource', buffered: true })
    } catch { /* no resource timing here */ }
  }
}

/** For the tests. */
export function _resetNetLog() { entries = []; total = 0; startedAt = 0; started = false; subs.clear() }
