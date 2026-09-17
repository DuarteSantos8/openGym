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

  it('lets go of a text field that kept focus after the keyboard closed, then realigns', () => {
    // WebKit: tapping the set's tick does not blur the weight field. With the keyboard down
    // and the page displaced, that focus is what keeps iOS from putting the viewports back.
    const active = { tagName: 'INPUT', blur: vi.fn() }
    const w = fakeWindow({ offsetTop: 190, active })
    expect(realign(w, { release: active })).toBe(true)
    expect(active.blur).toHaveBeenCalledTimes(1)
    expect(w.scrollTo).toHaveBeenCalledWith(0, 0)
    // an aligned page is left alone, focus included (a desktop browser mid-typing)
    const typing = { tagName: 'INPUT', blur: vi.fn() }
    expect(realign(fakeWindow({ active: typing }))).toBe(false)
    expect(typing.blur).not.toHaveBeenCalled()
  })

  it('blurs only the field it is told to release', () => {
    const active = { tagName: 'INPUT', blur: vi.fn() }
    const w = fakeWindow({ offsetTop: 190, active })
    expect(realign(w)).toBe(false)
    expect(realign(w, { release: { tagName: 'INPUT' } })).toBe(false)
    expect(active.blur).not.toHaveBeenCalled()
    expect(w.scrollTo).not.toHaveBeenCalled()
  })

  it('keeps a tapped field focused while its keyboard is still coming up (#242)', () => {
    vi.useFakeTimers()
    const field = { tagName: 'INPUT', blur: vi.fn() }
    const w = fakeWindow({ active: field })
    installViewportGuard(w)
    // iOS scrolls to the field first ...
    w.visualViewport.offsetTop = 190
    w.fire(w.visualViewport, 'scroll')
    w.fire(w.visualViewport, 'scroll')
    // ... and the viewport shrinks for the keyboard afterwards
    w.visualViewport.height = 480
    w.fire(w.visualViewport, 'resize')
    vi.advanceTimersByTime(1000)
    expect(field.blur).not.toHaveBeenCalled()
    expect(w.scrollTo).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not blur the next field after focus moves from one to another', () => {
    vi.useFakeTimers()
    const w = fakeWindow({ offsetTop: 190, active: { tagName: 'BODY' } })
    installViewportGuard(w)
    const prev = { tagName: 'INPUT' }
    w.fire(w.document, 'focusout', { target: prev })   // activeElement is the body during focusout
    const next = { tagName: 'INPUT', blur: vi.fn() }
    w.document.activeElement = next
    vi.advanceTimersByTime(400)
    expect(next.blur).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('lets go of the field once the keyboard has closed around it', () => {
    vi.useFakeTimers()
    const field = { tagName: 'INPUT', blur: vi.fn() }
    const w = fakeWindow({ vvHeight: 480, active: field })
    installViewportGuard(w)
    w.visualViewport.height = 800; w.visualViewport.offsetTop = 190
    w.fire(w.visualViewport, 'resize')
    expect(field.blur).toHaveBeenCalledTimes(1)
    expect(w.scrollTo).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('lets go of a focused field on a displaced page when no keyboard ever reported itself open', () => {
    vi.useFakeTimers()
    const field = { tagName: 'INPUT', blur: vi.fn() }
    const w = fakeWindow({ active: field })
    installViewportGuard(w)
    w.visualViewport.offsetTop = 190
    w.fire(w.visualViewport, 'scroll')
    vi.advanceTimersByTime(600)
    expect(field.blur).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(field.blur).toHaveBeenCalledTimes(1)
    expect(w.scrollTo).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
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

  it('does nothing while the keyboard is open, and nothing at all without a visualViewport', () => {
    const w = fakeWindow({ vvHeight: 480, offsetTop: 190 })
    installViewportGuard(w)
    w.fire(w.visualViewport, 'scroll')
    expect(w.scrollTo).not.toHaveBeenCalled()
    expect(typeof installViewportGuard({ visualViewport: null, document: {} })).toBe('function')
  })
})
