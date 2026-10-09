// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { installViewportGuard, realign, realignPinned, viewportDisplacement, keyboardOpen } from './viewport-guard.js'

function fakeWindow({ innerHeight = 800, vvHeight = 800, offsetTop = 0, pageTop = 0, scrollY = 0, active = null, bodyStyle = {} } = {}) {
  const listeners = {}
  const on = (map, type, fn) => { (map[type] = map[type] || []).push(fn) }
  const vv = {
    height: vvHeight, offsetTop, pageTop, listeners: {},
    addEventListener(t, fn) { on(this.listeners, t, fn) }, removeEventListener() {}
  }
  const doc = {
    activeElement: active, listeners: {}, body: { style: bodyStyle },
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
  })

  it('stands down while a text field has focus, however displaced the page looks (issue #242)', () => {
    // `keyboardOpen` is unreliable while the keyboard animates in — the browser chrome collapses
    // at the same time, so `innerHeight` falls with the visual viewport and the difference dips
    // back under the threshold. A displaced page plus a focused field is therefore "somebody is
    // typing", not "the keyboard has gone": it used to blur the field and throw the keyboard out.
    const active = { tagName: 'INPUT', blur: vi.fn() }
    const w = fakeWindow({ offsetTop: 190, active })
    expect(realign(w)).toBe(false)
    expect(active.blur).not.toHaveBeenCalled()
    expect(w.scrollTo).not.toHaveBeenCalled()
    // the same while a sheet has the body pinned: no unpin/repin under the keyboard either
    const pinned = fakeWindow({ offsetTop: 190, active: { tagName: 'TEXTAREA', blur: vi.fn() }, bodyStyle: { position: 'fixed', top: '-120px' } })
    expect(realign(pinned)).toBe(false)
    expect(pinned.scrollTo).not.toHaveBeenCalled()
    // an aligned page is left alone, focus included (a desktop browser mid-typing)
    const typing = { tagName: 'INPUT', blur: vi.fn() }
    expect(realign(fakeWindow({ active: typing }))).toBe(false)
    expect(typing.blur).not.toHaveBeenCalled()
  })

  it('still realigns a displaced page once focus has left the field', () => {
    // The correction that used to ride on the blur now happens on `focusout`, when iOS needs it.
    const w = fakeWindow({ offsetTop: 190, active: { tagName: 'BUTTON' } })
    expect(realign(w)).toBe(true)
    expect(w.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('unpins the body for one scroll when a sheet has it fixed, and pins it back where it was', () => {
    const bodyStyle = { position: 'fixed', top: '-240px' }
    const w = fakeWindow({ offsetTop: 190, scrollY: 0, bodyStyle })
    const seen = []
    w.scrollTo = vi.fn(() => seen.push({ ...bodyStyle }))
    expect(realign(w)).toBe(true)
    expect(w.scrollTo).toHaveBeenCalledWith(0, 240)
    expect(seen[0].position).toBe('')                 // the page could actually scroll at that moment
    expect(bodyStyle).toEqual({ position: 'fixed', top: '-240px' })   // and is pinned again after
    expect(realignPinned(fakeWindow())).toBe(false)   // nothing pinned, nothing to do
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

  it('checks again when the page comes back on screen, and not when it goes away', () => {
    vi.useFakeTimers()
    const w = fakeWindow()
    installViewportGuard(w)
    // the page ran on while hidden and came back with the viewports apart
    w.document.hidden = true
    w.visualViewport.offsetTop = 190
    w.fire(w.document, 'visibilitychange')
    expect(w.scrollTo).not.toHaveBeenCalled()      // hidden: nothing to put right yet
    w.document.hidden = false
    w.fire(w.document, 'visibilitychange')
    expect(w.scrollTo).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400)
    expect(w.scrollTo).toHaveBeenCalledTimes(2)   // and once more after anything still animating
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
