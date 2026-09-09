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

  it('an unreachable server leaves the cached config alone', async () => {
    useStore.setState({ config: { coach: { enabled: true } } })
    api.mockRejectedValueOnce(new Error('offline'))
    expect(await useStore.getState().refreshConfig()).toBeNull()
    expect(useStore.getState().config.coach.enabled).toBe(true)
  })
})
