import { afterEach, describe, expect, it } from 'vitest'
import { platformFlag } from './platform-now.js'

afterEach(() => { delete globalThis.Capacitor })

describe('platformFlag', () => {
  it('is ios or android inside the native shell, web anywhere else', () => {
    expect(platformFlag()).toBe('web')
    for (const p of ['ios', 'android']) {
      globalThis.Capacitor = { getPlatform: () => p }
      expect(platformFlag()).toBe(p)
    }
    globalThis.Capacitor = { getPlatform: () => 'web' }
    expect(platformFlag()).toBe('web')
  })
})
