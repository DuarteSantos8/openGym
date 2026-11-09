// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { shouldOffer, readSeen, writeSeen, SEEN_KEY } from './update-notice.js'

const info = { hasUpdate: true, latestVersion: '1.4.6', apkUrl: 'https://example.invalid/app.apk' }

describe('shouldOffer', () => {
  it('offers a newer version with an APK that was not offered before', () => {
    expect(shouldOffer(info, '', false)).toBe(true)
    expect(shouldOffer(info, '1.4.5', false)).toBe(true)
  })

  it('offers each version once', () => {
    expect(shouldOffer(info, '1.4.6', false)).toBe(false)
  })

  it('waits while a workout is open', () => {
    expect(shouldOffer(info, '', true)).toBe(false)
  })

  it('stays quiet with nothing newer, no APK to install, or no answer at all', () => {
    expect(shouldOffer({ ...info, hasUpdate: false }, '', false)).toBe(false)
    expect(shouldOffer({ ...info, apkUrl: null }, '', false)).toBe(false)
    expect(shouldOffer({ ...info, latestVersion: '' }, '', false)).toBe(false)
    expect(shouldOffer(null, '', false)).toBe(false)
  })
})

describe('the version last offered', () => {
  beforeEach(() => { try { localStorage.removeItem(SEEN_KEY) } catch { /* no storage */ } })

  it('is kept on the device', () => {
    expect(readSeen()).toBe('')
    writeSeen('1.4.6')
    expect(readSeen()).toBe('1.4.6')
  })
})
