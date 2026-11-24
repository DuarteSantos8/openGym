import { describe, expect, it, vi } from 'vitest'
import { watchLink, tellLinkFailure } from './link-watch.js'
import { createServerLink } from './server-link.js'

const box = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) } } }
function fakeAuth(session) {
  let current = session
  const fns = new Set()
  return { auth: { session: () => current, onChange: fn => { fns.add(fn); return () => fns.delete(fn) } }, set: s => { current = s; fns.forEach(fn => fn(s)) } }
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
    expect(note.owner()).toBe('u-1')            // not forgotten on a guess
    store.set({ ready: true, user: { id: 7 } })
    await tick()
    expect(store.getState().signOut).toHaveBeenCalledTimes(1)
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
