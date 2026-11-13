// Settings → Animation quality on an iPhone names the iOS switch that pauses every animated image
// (Accessibility › Motion › Auto-Play Animated Images); Android and the web don't see it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { platformNow } from '../lib/platform-now.js'

describe('the iOS animation hint', () => {
  afterEach(() => { delete globalThis.Capacitor; vi.restoreAllMocks() })
  it('knows it runs on iOS from the native bridge', () => {
    globalThis.Capacitor = { getPlatform: () => 'ios' }
    expect(platformNow()).toBe('ios')
  })
  it('stays away on Android and the web', () => {
    globalThis.Capacitor = { getPlatform: () => 'android' }
    expect(platformNow()).toBe('android')
    delete globalThis.Capacitor
    expect(platformNow()).toBe(null)
  })
  it('has the hint in the sheet, behind the iOS check', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('./Animations.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/platformNow\(\) === 'ios' && choice !== 'still'/)
    expect(src).toContain('Auto-Play Animated Images')
  })
})
