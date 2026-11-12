import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollToTop, GLIDE_CHECK_MS } from './scroll-top.js'

// A window whose smooth scroll either moves (a real glide) or is dropped (WebKit from the very
// bottom of a page, TestFlight 11-08).
function fakeWin(y, { glides }) {
  const calls = []
  const win = {
    scrollY: y,
    scrollTo: vi.fn((a, b) => {
      calls.push(a)
      if (typeof a === 'object' && a.behavior === 'smooth') { if (glides) win.scrollY = Math.max(0, win.scrollY - 1500) }
      else win.scrollY = typeof a === 'object' ? a.top : b
    }),
  }
  return { win, calls }
}

describe('back to the top', () => {
  afterEach(() => vi.useRealTimers())
  it('a dropped glide is finished as a jump', async () => {
    vi.useFakeTimers()
    const { win, calls } = fakeWin(5000, { glides: false })
    scrollToTop({ win })
    expect(calls[0]).toEqual({ top: 0, left: 0, behavior: 'smooth' })
    await vi.advanceTimersByTimeAsync(GLIDE_CHECK_MS + 5)
    expect(win.scrollY).toBe(0)
  })
  it('a glide that moves is left to finish', async () => {
    vi.useFakeTimers()
    const { win, calls } = fakeWin(1200, { glides: true })
    scrollToTop({ win })
    await vi.advanceTimersByTimeAsync(GLIDE_CHECK_MS * 3)
    expect(calls).toHaveLength(1)
    expect(win.scrollY).toBe(0)
  })
})
