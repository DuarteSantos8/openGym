// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { installViewportGuard, realign, viewportDisplacement, keyboardOpen } from './viewport-guard.js'

function fakeWindow({ innerHeight = 800, vvHeight = 800, offsetTop = 0, pageTop = 0, scrollY = 0, active = null } = {}) {
  const listeners = {}
  const on = (map, type, fn) => { (map[type] = map[type] || []).push(fn) }
  const vv = {
    height: vvHeight, offsetTop, pageTop, listeners: {},
    addEventListener(t, fn) { on(this.listeners, t, fn) }, removeEventListener() {}
  }
  const doc = {
    activeElement: active, listeners: {},
    addEventListener(t, fn) { on(this.listeners, t, fn) }, removeEventListener() {}
  }
  const win = {
    innerHeight, scrollX: 0, scrollY, visualViewport: vv, document: doc,
    scrollTo: vi.fn(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout,
    fire: (target, type, ev = {}) => (target.listeners[type] || []).forEach(fn => fn(ev))
  }
  return win
}

describe('viewport guard', () => {
  it('reads the displacement from either the offset or a page-top that outran scrollY', () => {
    expect(viewportDisplacement(fakeWindow({ offsetTop: 190 }))).toBe(190)
    expect(viewportDisplacement(fakeWindow({ pageTop: 120, scrollY: 0 }))).toBe(120)
    expect(viewportDisplacement(fakeWindow())).toBe(0)
    expect(viewportDisplacement({ visualViewport: null })).toBe(0)
  })

  it('knows the keyboard from the visual viewport losing more than a toolbar', () => {
    expect(keyboardOpen(fakeWindow({ vvHeight: 480 }))).toBe(true)
    expect(keyboardOpen(fakeWindow({ vvHeight: 760 }))).toBe(false)
  })

  it('realigns a displaced page by scrolling to where it already is — and only then', () => {
    const w = fakeWindow({ offsetTop: 190, scrollY: 0 })
    expect(realign(w)).toBe(true)
    expect(w.scrollTo).toHaveBeenCalledWith(0, 0)

    expect(realign(fakeWindow())).toBe(false)                                   // aligned
    expect(realign(fakeWindow({ offsetTop: 190, vvHeight: 480 }))).toBe(false)  // keyboard still up
    expect(realign(fakeWindow({ offsetTop: 190, active: { tagName: 'INPUT' } }))).toBe(false) // still typing
  })

  it('fires when the keyboard has just closed, again after its animation, and on focusout', async () => {
    vi.useFakeTimers()
    const w = fakeWindow({ vvHeight: 480 })
    const off = installViewportGuard(w)
    // keyboard closes but iOS leaves the offset behind
    w.visualViewport.height = 800; w.visualViewport.offsetTop = 190
    w.fire(w.visualViewport, 'resize')
    expect(w.scrollTo).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400)
    expect(w.scrollTo).toHaveBeenCalledTimes(2)   // the late check after the dismiss animation
    // a blur from a text field re-checks as well; a button losing focus does not
    w.fire(w.document, 'focusout', { target: { tagName: 'BUTTON' } })
    expect(w.scrollTo).toHaveBeenCalledTimes(2)
    w.fire(w.document, 'focusout', { target: { tagName: 'INPUT' } })
    expect(w.scrollTo).toHaveBeenCalledTimes(3)
    off()
    vi.advanceTimersByTime(400)
    expect(w.scrollTo).toHaveBeenCalledTimes(3)   // timers cleared on uninstall
    vi.useRealTimers()
  })

  it('does nothing while the keyboard is open, and nothing at all without a visualViewport', () => {
    const w = fakeWindow({ vvHeight: 480, offsetTop: 190 })
    installViewportGuard(w)
    w.fire(w.visualViewport, 'scroll')
    expect(w.scrollTo).not.toHaveBeenCalled()
    expect(typeof installViewportGuard({ visualViewport: null, document: {} })).toBe('function')
  })
})
