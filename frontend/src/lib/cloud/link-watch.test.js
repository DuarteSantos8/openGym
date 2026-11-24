import { describe, expect, it, vi } from 'vitest'
import { watchLink, tellLinkFailure } from './link-watch.js'
import { createServerLink } from './server-link.js'
import { createAuth } from './auth.js'

const box = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) } } }
// `stored` is what the browser's storage says now; `session()` is what this tab last knew.
function fakeAuth(session) {
  let current = session, stored = session
  const fns = new Set()
  const auth = { session: () => current, sync: vi.fn(() => { current = stored; return current }), onChange: fn => { fns.add(fn); return () => fns.delete(fn) } }
  return { auth, set: s => { current = stored = s; fns.forEach(fn => fn(s)) }, elsewhere: s => { stored = s } }
}
function fakeStore(state) {
  let st = { ready: true, user: null, ...state }
  const subs = new Set()
  const api = {
    getState: () => st,
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
    set: next => { const prev = st; st = { ...st, ...next }; subs.forEach(fn => fn(st, prev)) },
  }
  st.signOut = vi.fn(async () => { api.set({ user: null }); return { owed: false } })
  return api
}
const tick = () => new Promise(r => setTimeout(r, 0))
const linked = id => { const s = box(); createServerLink(s).leaving(id); const note = createServerLink(s); note.check({ hostedId: id, serverUser: { id: 7 } }); return note }

describe('the server profile ends with the account it was opened through', () => {
  it('signed out of the account, anywhere: the server profile is signed out, forced so nothing is lost', async () => {
    const c = fakeAuth({ user: { id: 'u-1' } }), store = fakeStore({ user: { id: 7 } })
    watchLink({ client: c, store, note: linked('u-1') })
    await tick()
    expect(store.getState().signOut).not.toHaveBeenCalled()
    c.set(null)
    await tick()
    expect(store.getState().signOut).toHaveBeenCalledWith({ force: true })
    expect(store.getState().user).toBeNull()
  })

  it('already so when the page loads (signed out in another tab, then a reload)', async () => {
    const c = fakeAuth(null), store = fakeStore({ user: { id: 7 } })
    watchLink({ client: c, store, note: linked('u-1') })
    await tick()
    expect(store.getState().signOut).toHaveBeenCalledTimes(1)
  })

  it('waits until the app knows who is signed in to the server', async () => {
    const c = fakeAuth(null), store = fakeStore({ ready: false, user: null })
    const note = linked('u-1')
    watchLink({ client: c, store, note })
    await tick()
    expect(store.getState().signOut).not.toHaveBeenCalled()
    expect(note.ownerOf({ id: 7 })).toBe('u-1')   // not forgotten on a guess
    store.set({ ready: true, user: { id: 7 } })
    await tick()
    expect(store.getState().signOut).toHaveBeenCalledTimes(1)
  })

  // Found in review of #79: a tab left open signed out of the account acted on that, and signed
  // out the server profile another tab had just opened through a fresh sign-in.
  it('asks storage who is signed in before acting: a tab left open does not act on what was true when it loaded', async () => {
    const c = fakeAuth(null), store = fakeStore({ user: null })
    const note = linked('u-1')
    watchLink({ client: c, store, note })
    c.elsewhere({ user: { id: 'u-1' } })           // another tab signed in and linked
    store.set({ user: { id: 7 } })                 // and this tab took the server profile over
    await tick()
    expect(c.auth.sync).toHaveBeenCalled()
    expect(store.getState().signOut).not.toHaveBeenCalled()
  })

  it('once it has ended the profile itself, it says so for the other tabs', async () => {
    const c = fakeAuth({ user: { id: 'u-1' } }), store = fakeStore({ user: { id: 7 } })
    const note = linked('u-1')
    watchLink({ client: c, store, note })
    c.set(null)
    await tick()
    expect(store.getState().user).toBeNull()
    expect(note.ownerOf({ id: 7 })).toBeNull()
    expect(note.check({ hostedId: 'u-1', serverUser: { id: 7 } })).toBe('end')
  })

  // The tab that signed out on the account screen ended the profile and said so. This one hears
  // of the sign-out and lets go as well, though for it the account id may not even differ.
  it('a profile another tab ended is let go of here', async () => {
    const c = fakeAuth({ user: { id: 'u-1' } }), store = fakeStore({ user: { id: 7 } })
    const note = linked('u-1')
    watchLink({ client: c, store, note })
    await tick()
    note.ended()
    c.set(null)
    await tick()
    expect(store.getState().signOut).toHaveBeenCalledWith({ force: true })
    expect(store.getState().user).toBeNull()
  })

  it('but not if the profile could not be ended: it is still known whose it is', async () => {
    const c = fakeAuth({ user: { id: 'u-1' } }), store = fakeStore({ user: { id: 7 } })
    store.getState().signOut = vi.fn(async () => ({ owed: true, count: 2, stashed: false }))
    const note = linked('u-1')
    watchLink({ client: c, store, note })
    c.set(null)
    await tick()
    expect(note.ownerOf({ id: 7 })).toBe('u-1')
  })

  it('someone else signs in to the account: the same', async () => {
    const c = fakeAuth({ user: { id: 'u-1' } }), store = fakeStore({ user: { id: 7 } })
    watchLink({ client: c, store, note: linked('u-1') })
    c.set({ user: { id: 'u-2' } })
    await tick()
    expect(store.getState().signOut).toHaveBeenCalledTimes(1)
  })

  it('a server profile nobody noted is left alone: an admin with a passkey and no account', async () => {
    const c = fakeAuth(null), store = fakeStore({ user: { id: 7 } })
    watchLink({ client: c, store, note: createServerLink(box()) })
    await tick()
    expect(store.getState().signOut).not.toHaveBeenCalled()
  })

  it('does not start a second sign-out while one is under way, and stops when told to', async () => {
    const c = fakeAuth({ user: { id: 'u-1' } }), store = fakeStore({ user: { id: 7 } })
    let finish
    store.getState().signOut = vi.fn(() => new Promise(r => { finish = () => { store.set({ user: null }); r({ owed: false }) } }))
    const stop = watchLink({ client: c, store, note: linked('u-1') })
    c.set(null); c.set(null)
    await tick()
    expect(store.getState().signOut).toHaveBeenCalledTimes(1)
    finish(); await tick()
    stop()
    store.set({ user: { id: 8 } }); c.set({ user: { id: 'u-9' } })
    await tick()
    expect(store.getState().signOut).toHaveBeenCalledTimes(1)
  })

  it('without the cloud client there is nothing to watch', () => {
    expect(watchLink({ client: null, store: fakeStore({}), note: createServerLink(box()) })()).toBeUndefined()
  })
})

// Found in review of #80, with the real auth client: where storage will not keep the session,
// the watcher's look at storage must not sign the person straight back out.
describe('with the real account client', () => {
  it('a sign-in storage would not keep survives the watcher', async () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} }
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, user: { id: 'u-1', email: 'a@example.com' } }) })
    const auth = createAuth({ url: 'https://proj.example', key: 'sb_publishable_test', fetchImpl, storage, events: null })
    const store = fakeStore({ user: null })
    watchLink({ client: { auth }, store, note: createServerLink(box()) })
    await auth.signIn('a@example.com', 'right-password')
    await tick()
    expect(auth.session()?.user.id).toBe('u-1')
  })
})

// Found in review of #78: someone on this device's profile whose sign-in to the server was
// refused came back to the app with no word about it, because the screen that says so is the
// sign-in screen, which they never see.
describe('a refused sign-in is said to someone who stays in the app', () => {
  it('on this device\'s profile: says why, once', () => {
    const toast = vi.fn(), clear = vi.fn()
    tellLinkFailure({ arrival: { error: 'disabled' }, guest: true, label: 'Ironvane', toast, clear })
    expect(toast).toHaveBeenCalledWith('This account has been disabled.')
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('not for a cancelled sign-in, a clean arrival, or someone the sign-in screen will tell', () => {
    const toast = vi.fn(), clear = vi.fn()
    tellLinkFailure({ arrival: { error: 'cancelled' }, guest: true, label: 'Ironvane', toast, clear })
    tellLinkFailure({ arrival: { signedIn: true }, guest: true, label: 'Ironvane', toast, clear })
    tellLinkFailure({ arrival: null, guest: true, label: 'Ironvane', toast, clear })
    tellLinkFailure({ arrival: { error: 'disabled' }, guest: false, label: 'Ironvane', toast, clear })
    expect(toast).not.toHaveBeenCalled()
  })
})
