// Where the phone keeps the user's own API key: the platform's secure storage — the Keychain on
// iOS, the Keystore-backed EncryptedSharedPreferences on Android — and nowhere else. Never in
// S (which syncs and exports), never in localStorage (which the WebView evicts and any page on
// the same origin can read), never in the coach device file next to it.
//
// The plugin is imported lazily and every call is wrapped: on a plain web dev run it stores
// to localStorage by its own admission, and in a test there is no platform at all. In both
// cases the fallback is a process-local map that forgets on reload, which is the honest
// behaviour for a place that cannot keep a secret.
const KEY = 'coach.apiKey'
const memory = new Map()

// The loaded plugin travels inside a plain object, never as a promise's own value (no `await`
// or `.then` may ever hand the proxy back bare — the wrapper below is the whole point). Capacitor's
// registerPlugin() hands out a Proxy that answers EVERY property name with a native-method
// wrapper — `then` included — so a promise that resolves to the proxy itself takes it for a
// thenable, calls SecureStorage.then() on the native side ("not implemented on android"), and
// never settles. That one await hung the whole feature on the phone: "Save and use the Coach"
// greyed out forever, the key "not saved", the Coach "thinking" without end (issues #42, #58).
let pluginPromise = null
function plugin() {
  if (!pluginPromise) {
    pluginPromise = import('@aparajita/capacitor-secure-storage')
      .then(m => ({ store: m && m.SecureStorage && typeof m.SecureStorage.get === 'function' ? m.SecureStorage : null }))
      .catch(() => ({ store: null }))
  }
  return pluginPromise
}

// A native call that never answers must not hang the setup screen behind a greyed-out button
// (issue #42: "Save and use the Coach" stayed disabled forever on one Android 16 phone). After
// this long the platform store is treated as unavailable and the process-local map takes over.
const NATIVE_TIMEOUT_MS = 4000
export const withTimeout = (promise, ms = NATIVE_TIMEOUT_MS) => new Promise((resolve, reject) => {
  const tm = setTimeout(() => reject(new Error('secure storage timed out')), ms)
  promise.then(v => { clearTimeout(tm); resolve(v) }, e => { clearTimeout(tm); reject(e) })
})

// Any small secret under a key of its own, with the same fallbacks: lib/cf-access.js keeps the
// Cloudflare Access service token here, beside the Coach's API key.
export async function secureGet(key) {
  const { store: p } = await plugin()
  if (p) {
    try { const v = await withTimeout(p.get(key)); return typeof v === 'string' && v ? v : null } catch { /* fall through */ }
  }
  return memory.get(key) || null
}
export async function secureSet(key, value) {
  const v = String(value || '').trim()
  if (!v) return secureRemove(key)
  const { store: p } = await plugin()
  if (p) {
    try { await withTimeout(p.set(key, v)); memory.delete(key); return } catch { /* fall through */ }
  }
  memory.set(key, v)
}
export async function secureRemove(key) {
  const { store: p } = await plugin()
  if (p) { try { await withTimeout(p.remove(key)) } catch { /* nothing to clear */ } }
  memory.delete(key)
}

export const getApiKey = () => secureGet(KEY)
export const setApiKey = value => secureSet(KEY, value)
export const clearApiKey = () => secureRemove(KEY)
