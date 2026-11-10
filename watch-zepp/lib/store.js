// What the watch keeps between launches, in the app's own storage: the session (lib/session.js),
// the events not yet taken by the server (the outbox), and what it knows of the link. Every change
// is saved at once: the app can be closed by a swipe at any moment, and the outbox is the event's
// last copy until the server has it.
import * as C from './session.js'

const KEY_STATE = 'og_state'
const KEY_OUTBOX = 'og_outbox'
const KEY_LINK = 'og_link'

const read = (storage, key, fallback) => {
  try { const v = storage.getItem(key); return v ? JSON.parse(v) : fallback } catch (e) { return fallback }
}

/**
 * `storage` is the app's LocalStorage (getItem/setItem), a test's Map-like stand-in.
 * link: { paired: true|false|null (not known yet), at: last answer from the server, away: the phone did not answer }
 */
export function createStore (storage) {
  let state = C.stateOf(read(storage, KEY_STATE, null))
  let outbox = Array.isArray(read(storage, KEY_OUTBOX, [])) ? read(storage, KEY_OUTBOX, []) : []
  let link = { paired: null, at: 0, away: false, ...read(storage, KEY_LINK, {}) }
  const save = () => { try { storage.setItem(KEY_STATE, JSON.stringify(state)) } catch (e) { /* full: kept in memory */ } }
  const saveOutbox = () => { try { storage.setItem(KEY_OUTBOX, JSON.stringify(outbox)) } catch (e) { /* as above */ } }
  const saveLink = () => { try { storage.setItem(KEY_LINK, JSON.stringify(link)) } catch (e) { /* as above */ } }
  return {
    get state () { return state },
    get outbox () { return outbox },
    get link () { return link },
    /** A new state, and the event it made (if any) queued for the phone. */
    commit (next, ev = null) {
      state = next
      save()
      if (ev) { outbox = C.enqueue(outbox, ev); saveOutbox() }
    },
    settle (accepted) {
      if (!accepted || !accepted.length) return
      outbox = C.settle(outbox, accepted)
      saveOutbox()
    },
    setLink (patch) { link = { ...link, ...patch }; saveLink() },
  }
}

/**
 * One exchange with the server through the phone (app-side/index.js 'sync'): the outbox goes, the
 * snapshot comes back. `request` is the page's this.request. → 'ok', 'unpaired' or 'away'.
 */
export async function syncOnce (store, request, { now = Date.now(), name = '' } = {}) {
  let r
  try {
    r = await request({ method: 'sync', params: { events: store.outbox.slice(0, 50), name } })
  } catch (e) {
    store.setLink({ away: true })
    return 'away'
  }
  if (!r || r.unpaired) { store.setLink({ paired: false, away: false }); return 'unpaired' }
  if (r.error) { store.setLink({ away: true }); return 'away' }
  store.settle(r.accepted)
  const snap = r.json ? C.parseSnapshot(r.json) : null
  if (snap) store.commit(C.applySnapshot(store.state, snap, now))
  store.setLink({ paired: true, away: false, at: now })
  return 'ok'
}
