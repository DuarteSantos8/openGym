// The watch relay, the page's side (docs/ZEPP_OS.md). A Zepp OS watch talks to the phone through a
// Side Service that runs inside the Zepp app, never inside openGym, so the two meet on the user's
// own openGym server instead: the page leaves its snapshot there and picks up what the watch sent
// (api/watch-relay.js, the /api/watch/* routes). This is a WatchBridge with the native plugin's
// calls, so lib/watch-sync.js runs the very same sync over it (startLinkSync): the same snapshot,
// the same events, applied through the same actions.
//
// Signed in to a server only (the web app, or a phone paired with one). Without a paired Zepp
// watch it asks the server once at start and when the app comes back, and sends nothing.
import { api } from './api.js'
import { startLinkSync } from './watch-sync.js'

// How often the page looks for the watch's events while it is open. The phone's page sleeps in a
// pocket anyway; what waits on the server is picked up when it wakes (watch-sync.js onVisible).
export const RELAY_POLL_MS = 15000
// "The watch is there right now": it checked in within this.
const REACHABLE_MS = 2 * 60 * 1000

const stateListeners = new Set()
/** Settings paired or unpaired a watch: the sync asks the server again. */
export function relayChanged () { for (const fn of stateListeners) { try { fn() } catch { /* a listener's problem */ } } }

/** The paired watches, for Settings. */
export async function relayLinks (call = api) {
  const r = await call('/api/watch/links')
  return Array.isArray(r?.links) ? r.links : []
}
/** A code for the Zepp app's openGym settings page: { code, exp }. */
export async function relayPairCode (call = api) {
  const r = await call('/api/watch/pair', { method: 'POST', body: '{}' })
  return { code: String(r?.code || ''), exp: Number(r?.exp) || 0 }
}
export async function relayUnlink (id = null, call = api) {
  const r = await call('/api/watch/unlink', { method: 'POST', body: JSON.stringify(id ? { id } : {}) })
  relayChanged()
  return Array.isArray(r?.links) ? r.links : []
}

/**
 * The WatchBridge over the server. `call` is lib/api.js api() (a test's stand-in), `doc` the
 * document whose visibility pauses the polling.
 */
export function relayBridge ({ call = api, doc = globalThis.document, pollMs = RELAY_POLL_MS, now = () => Date.now(), signedIn = () => true } = {}) {
  let paired = false
  return {
    async status () {
      try {
        // Nobody signed in: no server to ask (a guest, the phone on its own).
        if (!signedIn()) throw new Error('signed out')
        const r = await call('/api/watch/events')
        paired = Number(r?.paired) > 0
        return { supported: true, paired, installed: paired, activated: true, reachable: paired && now() - (Number(r?.seen) || 0) < REACHABLE_MS }
      } catch {
        paired = false
        return { supported: true, paired: false, installed: false, activated: true, reachable: false }
      }
    },
    async sendSnapshot ({ json }) {
      if (!paired) return { sent: false }
      await call('/api/watch/snapshot', { method: 'PUT', body: JSON.stringify({ json }) })
      return { sent: true }
    },
    async drain () {
      if (!paired) return { events: [] }
      const r = await call('/api/watch/events')
      return { events: Array.isArray(r?.events) ? r.events : [] }
    },
    async ack ({ ids }) {
      if (!Array.isArray(ids) || !ids.length) return {}
      await call('/api/watch/ack', { method: 'POST', body: JSON.stringify({ ids }) })
      return {}
    },
    addListener (name, fn) {
      if (name === 'watchState') {
        stateListeners.add(fn)
        return { remove: () => stateListeners.delete(fn) }
      }
      if (name !== 'watchEvent') return { remove () {} }
      // No push from the server: a look every few seconds while the page is in front and a watch
      // is paired. The drain it starts is the one the native link's event starts.
      const tm = setInterval(() => { if (paired && (!doc || doc.visibilityState !== 'hidden')) fn() }, pollMs)
      return { remove: () => clearInterval(tm) }
    },
    // The native link's extras, which a Zepp watch has no use for.
    async openOnWatch () { return {} },
    async sendClips () { return {} },
    async dropClips () { return {} },
  }
}

/** Started once by the app: the sync of lib/watch-sync.js over the relay. Returns the stop. */
export async function startWatchRelay ({ useStore, useUI }) {
  const stop = await startLinkSync(relayBridge({ signedIn: () => !!useStore.getState().user }), { useStore, useUI }, { health: false, clips: false })
  // Signed in or out since: asked again.
  const offUser = useStore.subscribe((s, prev) => { if ((s.user?.id || null) !== (prev.user?.id || null)) relayChanged() })
  return () => { offUser(); stop() }
}
