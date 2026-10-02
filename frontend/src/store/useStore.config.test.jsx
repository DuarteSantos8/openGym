// @vitest-environment happy-dom
// /api/config is what tells a client whether the server offers the Coach (and guest mode).
// loadConfig() caches it for a boot; refreshConfig() always asks — the Coach setup screen on a
// paired phone relies on that, because the admin may have switched the Coach on since boot.
// The bug this pins: the phone never fetched it at all, and said "your server has no Coach
// enabled" to a server whose admin was looking at a green test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))

import { api } from '../lib/api.js'
import { useStore } from './useStore.js'

beforeEach(() => { api.mockReset(); useStore.setState({ config: null }) })
afterEach(() => { useStore.setState({ config: null }) })

describe('server config', () => {
  it('loadConfig fetches once and then answers from the cache', async () => {
    api.mockResolvedValue({ invite_only: true, allow_guest: false, coach: { enabled: true } })
    expect(await useStore.getState().loadConfig()).toEqual({ invite_only: true, allow_guest: false, coach: { enabled: true } })
    expect(await useStore.getState().loadConfig()).toMatchObject({ coach: { enabled: true } })
    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith('/api/config')
  })

  it('refreshConfig always asks the server, so a Coach switched on after boot is seen', async () => {
    api.mockResolvedValueOnce({ invite_only: true, allow_guest: false })
    await useStore.getState().loadConfig()
    expect(useStore.getState().config.coach).toBeUndefined()

    api.mockResolvedValueOnce({ invite_only: true, allow_guest: false, coach: { enabled: true, provider: 'anthropic' } })
    await useStore.getState().refreshConfig()
    expect(useStore.getState().config.coach.enabled).toBe(true)
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('a sign-in re-asks only when the held copy was fetched without a session', async () => {
    // GET /api/config carries a `coach` key only for a session — the block, or null on an
    // instance with no Coach (api/server.js). So no key means the copy came back
    // unauthenticated, and coachAvailable() hangs every Coach entry point off that block.
    localStorage.clear()
    api.mockResolvedValueOnce({ invite_only: false, allow_guest: true })
    await useStore.getState().loadConfig()
    expect(useStore.getState().config.coach).toBeUndefined()

    api.mockResolvedValueOnce({ invite_only: false, allow_guest: true, coach: { enabled: true, provider: 'compatible' } })
    useStore.getState().setUser({ id: 'u1', name: 'A' })
    await vi.waitFor(() => expect(useStore.getState().config.coach.enabled).toBe(true))
    expect(api).toHaveBeenCalledTimes(2)

    // A copy that carries the key was made for a session and is already the right answer.
    useStore.getState().setUser({ id: 'u1', name: 'A' })
    expect(api).toHaveBeenCalledTimes(2)

    // Including on an instance with no Coach at all, where the key is null — this is the case
    // that used to re-ask on every sign-in, and on every boot of a signed-in browser.
    useStore.setState({ config: { invite_only: false, allow_guest: true, coach: null } })
    useStore.getState().setUser({ id: 'u1', name: 'A' })
    expect(api).toHaveBeenCalledTimes(2)
    useStore.setState({ user: null })
    localStorage.clear()
  })

  it('two callers asking at once make one request', async () => {
    // Signing in re-asks and the pairing flow awaits a refresh of its own right after it, so
    // both used to go out. It is one answer.
    api.mockResolvedValue({ invite_only: false, allow_guest: true, coach: null })
    const [a, b] = await Promise.all([useStore.getState().refreshConfig(), useStore.getState().refreshConfig()])
    expect(api).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)

    // Not a cache, though: the next caller gets a fresh answer, which is the whole point of
    // refreshConfig — an admin can switch the Coach on while a phone sits on the setup screen.
    await useStore.getState().refreshConfig()
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('an unreachable server leaves the cached config alone', async () => {
    useStore.setState({ config: { coach: { enabled: true } } })
    api.mockRejectedValueOnce(new Error('offline'))
    expect(await useStore.getState().refreshConfig()).toBeNull()
    expect(useStore.getState().config.coach.enabled).toBe(true)
  })
})
