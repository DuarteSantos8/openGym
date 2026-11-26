// Vitest setup, run before every test file (vite.config.js test.setupFiles).
//
// Node 24 and later ship a Web Storage of their own: `localStorage` sits on the global and is
// unusable unless node was started with --localstorage-file (undefined, or a getter that throws).
// Vitest's happy-dom environment does not overwrite a global that already exists, so a happy-dom
// test got Node's instead of happy-dom's and the first getItem threw: 565 failures on Node 26
// (#733). Node 22, which CI uses, has none, and nothing here changes anything there.
//
// The stand-in is happy-dom's own Storage, and the `Storage` global goes with it: the multi-tab
// and quota tests patch Storage.prototype.setItem, and Node's Storage class would leave that
// patch on a prototype nobody uses.
import { Storage } from 'happy-dom'

// `in`, not reading s.getItem: happy-dom binds a method onto the instance the first time it is
// read, and then a test that patches Storage.prototype.setItem (the multi-tab and quota tests)
// never sees the calls.
const usable = s => s != null && typeof s === 'object' && 'getItem' in s && 'setItem' in s

export function ensureWebStorage(g = globalThis) {
  // Only a DOM environment; a node-environment test that wants storage brings its own stub.
  if (typeof g.document === 'undefined') return
  for (const key of ['localStorage', 'sessionStorage']) {
    let current
    try { current = g[key] } catch { current = null }
    if (usable(current)) continue
    Object.defineProperty(g, key, { value: new Storage(), configurable: true, writable: true })
    if (g.Storage !== Storage) Object.defineProperty(g, 'Storage', { value: Storage, configurable: true, writable: true })
  }
}

ensureWebStorage()

// A unit test never opens a connection. happy-dom's fetch is a real one: a relative address
// becomes http://localhost:3000/..., a socket is opened, refused, and the refusal is logged some
// time later. Code under test survives that (it catches), but the log does not always arrive
// before the worker closes, and then the whole run fails with every test passing ("Closing rpc
// while onUserConsoleLog was pending"). So in a DOM environment fetch refuses at once, the way a
// browser with no network does (a TypeError), and names what was asked for. A test that needs an
// answer stubs fetch or passes one in, as most already do; its stub replaces this.
export function refuseNetwork(g = globalThis) {
  if (typeof g.document === 'undefined') return
  const refuse = input => {
    const url = typeof input === 'string' ? input : input?.url || String(input)
    return Promise.reject(new TypeError(`fetch is not available in a unit test (asked for ${url}). Stub it, or pass a fetch in.`))
  }
  Object.defineProperty(g, 'fetch', { value: refuse, configurable: true, writable: true })
  if (g.window && g.window !== g) { try { g.window.fetch = refuse } catch { /* the global one is what code calls */ } }
}

refuseNetwork()
