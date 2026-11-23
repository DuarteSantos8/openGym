import { describe, expect, it, vi } from 'vitest'
import { watchAccount } from './account-watch.js'

const flush = () => new Promise(r => setTimeout(r, 0))
function client({ session = null, name = 'Sam', getFails = false } = {}) {
  let current = session
  const listeners = new Set()
  return {
    set(s) { current = s; listeners.forEach(fn => fn(s)) },
    auth: { session: () => current, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn) } },
    profiles: { get: vi.fn(async () => { if (getFails) throw new Error('offline'); return { display_name: name } }) },
    listeners,
  }
}
const A = { user: { id: 'u-1', email: 'a@example.com' } }
const B = { user: { id: 'u-2', email: 'b@example.com' } }

describe('watchAccount: the app hears who is signed in to the hosted account', () => {
  it('says who is signed in at once, then their name when it has been read', async () => {
    const c = client({ session: A }); const set = vi.fn()
    watchAccount(c, set)
    expect(set).toHaveBeenLastCalledWith({ email: 'a@example.com', name: '' })
    await flush()
    expect(set).toHaveBeenLastCalledWith({ email: 'a@example.com', name: 'Sam' })
  })

  it('nobody signed in is nobody, and no name is asked for', async () => {
    const c = client(); const set = vi.fn()
    watchAccount(c, set)
    await flush()
    expect(set).toHaveBeenCalledWith(null)
    expect(c.profiles.get).not.toHaveBeenCalled()
  })

  it('follows a sign-in and a sign-out', async () => {
    const c = client(); const set = vi.fn()
    watchAccount(c, set)
    c.set(A); await flush()
    expect(set).toHaveBeenLastCalledWith({ email: 'a@example.com', name: 'Sam' })
    c.set(null)
    expect(set).toHaveBeenLastCalledWith(null)
  })

  it('a renewed session for the same person asks for nothing again', async () => {
    const c = client({ session: A }); const set = vi.fn()
    watchAccount(c, set)
    await flush()
    c.set({ ...A, access_token: 'newer' }); await flush()
    expect(c.profiles.get).toHaveBeenCalledTimes(1)
  })

  it('a name that arrives after someone else signed in is not put on them', async () => {
    const c = client({ session: A }); const set = vi.fn()
    let release
    c.profiles.get = vi.fn(() => new Promise(r => { release = () => r({ display_name: 'Sam' }) }))
    watchAccount(c, set)
    c.profiles.get = vi.fn(async () => ({ display_name: 'Bea' }))
    c.set(B); await flush()
    release(); await flush()
    expect(set).toHaveBeenLastCalledWith({ email: 'b@example.com', name: 'Bea' })
  })

  it('a name that cannot be read leaves the address, and stopping stops', async () => {
    const c = client({ session: A, getFails: true }); const set = vi.fn()
    const stop = watchAccount(c, set)
    await flush()
    expect(set).toHaveBeenLastCalledWith({ email: 'a@example.com', name: '' })
    stop()
    expect(c.listeners.size).toBe(0)
  })

  it('no client (the default edition) does nothing', () => {
    const set = vi.fn()
    expect(typeof watchAccount(null, set)).toBe('function')
    expect(set).not.toHaveBeenCalled()
  })
})
