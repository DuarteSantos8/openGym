// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { autoplayMuted } from './Media.jsx'

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
