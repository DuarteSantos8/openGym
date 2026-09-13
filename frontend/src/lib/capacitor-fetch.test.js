import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  platform: 'ios',
  request: vi.fn(async () => ({ status: 200, data: '{}' }))
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => native.platform
  },
  CapacitorHttp: { request: native.request }
}))

const { nativeFetch } = await import('./capacitor-fetch.js')

describe('native Coach transport timeouts', () => {
  beforeEach(() => {
    native.platform = 'ios'
    native.request.mockClear()
  })

  it('lets an iOS request outlast a slow local Coach job', async () => {
    await nativeFetch('http://ollama.test/v1/chat/completions', { method: 'POST', body: '{}' })

    expect(native.request).toHaveBeenCalledWith(expect.objectContaining({
      connectTimeout: 40 * 60000,
      readTimeout: 40 * 60000
    }))
  })

  it('keeps Android connection failures short without shortening response reads', async () => {
    native.platform = 'android'

    await nativeFetch('http://ollama.test/v1/chat/completions', { method: 'POST', body: '{}' })

    expect(native.request).toHaveBeenCalledWith(expect.objectContaining({
      connectTimeout: 30000,
      readTimeout: 40 * 60000
    }))
  })
})
