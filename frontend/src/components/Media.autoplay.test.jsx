// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { autoplayClip, autoplayMuted } from './Media.jsx'

// Android's WebView autoplays only a video that carries the muted *attribute*; React sets the
// property alone, and the catalogue loops sat on their first frame in the phone app.
describe('autoplayMuted', () => {
  it('sets the muted attribute and starts playback, swallowing a refusal', async () => {
    const el = { muted: false, defaultMuted: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v }, play: vi.fn(() => Promise.reject(new Error('NotAllowedError'))) }
    autoplayMuted(el)
    expect(el.muted).toBe(true)
    expect(el.defaultMuted).toBe(true)
    expect(el.attrs.muted).toBe('')
    expect(el.play).toHaveBeenCalled()
    await Promise.resolve()
  })
  it('ignores the unmount call', () => { expect(() => autoplayMuted(null)).not.toThrow() })
})

// A clip plays while it is on screen: one scrolled away is paused, and started again when it is back.
describe('autoplayClip', () => {
  it('pauses a clip out of view and plays it again in view, and stops watching it on unmount', () => {
    const seen = new Set()
    let report = null
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb) { report = cb }
      observe(el) { seen.add(el) }
      unobserve(el) { seen.delete(el) }
    })
    const el = { muted: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v }, play: vi.fn(() => Promise.resolve()), pause: vi.fn() }
    const stop = autoplayClip(el)
    expect(el.play).toHaveBeenCalledTimes(1)
    expect(seen.has(el)).toBe(true)
    report([{ target: el, isIntersecting: false }])
    expect(el.pause).toHaveBeenCalledTimes(1)
    report([{ target: el, isIntersecting: true }])
    expect(el.play).toHaveBeenCalledTimes(2)
    stop()
    expect(seen.has(el)).toBe(false)
    vi.unstubAllGlobals()
  })
})
