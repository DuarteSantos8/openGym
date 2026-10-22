import { beforeEach, describe, expect, it, vi } from 'vitest'

// Which native shell this is: isAndroid / isIOS answer from Capacitor.getPlatform().
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { platform: 'ios' }
})
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => h.platform } }))

let m
beforeEach(async () => {
  vi.resetModules()
  m = await import('./mobile.js')
})

describe('isIOS', () => {
  it('is true on the iOS shell only', async () => {
    h.platform = 'ios'
    expect(await m.isIOS()).toBe(true)
    expect(await m.isAndroid()).toBe(false)
    h.platform = 'android'
    expect(await m.isIOS()).toBe(false)
    expect(await m.isAndroid()).toBe(true)
    h.platform = 'web'
    expect(await m.isIOS()).toBe(false)
  })
})
