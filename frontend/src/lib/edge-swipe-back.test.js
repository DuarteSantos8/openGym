// @vitest-environment happy-dom
// The iOS edge swipe back: what decides it (pure), and the gesture on a page, including that a
// touch starting anywhere but the edge still reaches the swipe rows, cards, chips and sliders.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EDGE_PX, COMMIT_FRACTION, edgeSwipeEnabled, startsAtEdge, progressOf, lockOf, releaseOf,
  backTarget, installEdgeSwipeBack, BACK_PREVIEW_EVENT,
} from './edge-swipe-back.js'

describe('where it is on', () => {
  it('the iPhone/iPad app and the iOS home-screen web app only', () => {
    expect(edgeSwipeEnabled({ mobile: true, platform: 'ios' })).toBe(true)
    expect(edgeSwipeEnabled({ mobile: true, platform: 'android' })).toBe(false)   // system back
    expect(edgeSwipeEnabled({ mobile: false, ios: true, standalone: true })).toBe(true)
    expect(edgeSwipeEnabled({ mobile: false, ios: true, standalone: false })).toBe(false)   // Safari's own swipe
    expect(edgeSwipeEnabled({ mobile: false, ios: false, standalone: true })).toBe(false)   // Android PWA, desktop
  })
})

describe('the decisions', () => {
  it('starts only within the edge, the right one in RTL', () => {
    expect(startsAtEdge(0, 390)).toBe(true)
    expect(startsAtEdge(EDGE_PX, 390)).toBe(true)
    expect(startsAtEdge(EDGE_PX + 1, 390)).toBe(false)
    expect(startsAtEdge(5, 390, true)).toBe(false)
    expect(startsAtEdge(390 - 5, 390, true)).toBe(true)
    expect(progressOf(380, 300, true)).toBe(80)
    expect(progressOf(5, 85)).toBe(80)
  })
  it('locks sideways towards back, gives a scroll or a wrong-way swipe away, waits inside the slop', () => {
    expect(lockOf(4, 3)).toBeNull()
    expect(lockOf(15, 4)).toBe('go')
    expect(lockOf(8, 20)).toBe('abort')
    expect(lockOf(-15, 0)).toBe('abort')
  })
  it('goes back past a third of the width or on a flick, springs back otherwise', () => {
    const width = 390
    expect(releaseOf({ dx: width * COMMIT_FRACTION, width, vx: 0 })).toBe('back')
    expect(releaseOf({ dx: 100, width, vx: 0.1 })).toBe('cancel')
    expect(releaseOf({ dx: 60, width, vx: 0.9 })).toBe('back')
    expect(releaseOf({ dx: 5, width, vx: 2 })).toBe('cancel')
    expect(releaseOf({ dx: -40, width, vx: 0 })).toBe('cancel')
  })
})

/* ---------- on a page ---------- */

let stop, back, row, rowDown
const W = 390
const ptr = (type, x, y = 300, id = 1) => new PointerEvent(type, { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true })
const swipe = (target, xs, { ids = 1 } = {}) => {
  target.dispatchEvent(ptr('pointerdown', xs[0], 300, ids))
  for (const x of xs.slice(1, -1)) target.dispatchEvent(ptr('pointermove', x, 302, ids))
  target.dispatchEvent(ptr('pointerup', xs[xs.length - 1], 302, ids))
}
const page = ({ withBack = true } = {}) => {
  document.body.innerHTML = `<div id="app">${withBack ? '<button data-back>Back</button>' : ''}<div class="swrow">a set</div></div><div id="modal-root"></div>`
  back = document.querySelector('[data-back]')
  row = document.querySelector('.swrow')
  rowDown = vi.fn()
  row.addEventListener('pointerdown', rowDown)
  if (back) back.onclick = vi.fn()
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: W })
  document.documentElement.dir = 'ltr'
  window.matchMedia = vi.fn(() => ({ matches: false }))
})
afterEach(() => { stop?.(); stop = null; vi.useRealTimers(); document.body.innerHTML = '' })

describe('the gesture', () => {
  it('past a third: the page follows, then the back button is pressed', () => {
    page(); stop = installEdgeSwipeBack(window, { enabled: true })
    const app = document.getElementById('app')
    row.dispatchEvent(ptr('pointerdown', 6))
    row.dispatchEvent(ptr('pointermove', 30))
    row.dispatchEvent(ptr('pointermove', 160))
    expect(app.style.transform).toBe('translateX(154px)')
    expect(document.querySelector('.edge-back-shade')).not.toBeNull()
    row.dispatchEvent(ptr('pointerup', 160))
    expect(back.onclick).not.toHaveBeenCalled()      // after the page has slid out
    vi.advanceTimersByTime(400)
    expect(back.onclick).toHaveBeenCalledTimes(1)
    expect(app.style.transform).toBe('')
    expect(document.querySelector('.edge-back-shade')).toBeNull()
  })

  it('short of a third and slow: springs back, nothing pressed', () => {
    page(); stop = installEdgeSwipeBack(window, { enabled: true })
    vi.setSystemTime(0)
    row.dispatchEvent(ptr('pointerdown', 6))
    vi.setSystemTime(100); row.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 300, pointerId: 1, pointerType: 'touch', bubbles: true }))
    vi.setSystemTime(600); row.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 300, pointerId: 1, pointerType: 'touch', bubbles: true }))
    row.dispatchEvent(ptr('pointerup', 60))
    vi.advanceTimersByTime(400)
    expect(back.onclick).not.toHaveBeenCalled()
  })

  it('claims an edge touch before a set row sees it, and leaves every other touch alone', () => {
    page(); stop = installEdgeSwipeBack(window, { enabled: true })
    swipe(row, [6, 40, 200])
    expect(rowDown).not.toHaveBeenCalled()
    swipe(row, [EDGE_PX + 30, 120, 300])                // a set-row swipe from mid-screen
    expect(rowDown).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400)
    expect(back.onclick).toHaveBeenCalledTimes(1)       // only the edge swipe
  })

  it('does nothing where the screen has no back button: the touch is the row\'s', () => {
    page({ withBack: false }); stop = installEdgeSwipeBack(window, { enabled: true })
    swipe(row, [6, 60, 300])
    expect(rowDown).toHaveBeenCalledTimes(1)
    expect(document.getElementById('app').style.transform).toBe('')
  })

  it('does nothing behind an open sheet, nor for a disabled back button', () => {
    page()
    document.getElementById('modal-root').classList.add('open')
    expect(backTarget()).toBeNull()
    document.getElementById('modal-root').classList.remove('open')
    expect(backTarget()).toBe(back)
    back.disabled = true
    expect(backTarget()).toBeNull()
  })

  it('a vertical scroll from the edge is given up, nothing pressed', () => {
    page(); stop = installEdgeSwipeBack(window, { enabled: true })
    row.dispatchEvent(ptr('pointerdown', 6, 300))
    row.dispatchEvent(ptr('pointermove', 9, 360))
    row.dispatchEvent(ptr('pointerup', 9, 420))
    vi.advanceTimersByTime(400)
    expect(back.onclick).not.toHaveBeenCalled()
    expect(document.querySelector('.edge-back-shade')).toBeNull()
  })

  it('holds the page still under a claimed touch, and only then', () => {
    page(); stop = installEdgeSwipeBack(window, { enabled: true })
    const tm = () => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); document.dispatchEvent(e); return e.defaultPrevented }
    expect(tm()).toBe(false)
    row.dispatchEvent(ptr('pointerdown', 6))
    expect(tm()).toBe(true)
    row.dispatchEvent(ptr('pointerup', 6))
    expect(tm()).toBe(false)
  })

  it('right to left: from the right edge, swiping left', () => {
    page(); document.documentElement.dir = 'rtl'
    stop = installEdgeSwipeBack(window, { enabled: true })
    swipe(row, [6, 60, 300])                             // the left edge means nothing in RTL
    expect(rowDown).toHaveBeenCalledTimes(1)
    row.dispatchEvent(ptr('pointerdown', W - 5))
    row.dispatchEvent(ptr('pointermove', W - 40))
    row.dispatchEvent(ptr('pointermove', W - 200))
    expect(document.getElementById('app').style.transform).toBe('translateX(-195px)')
    row.dispatchEvent(ptr('pointerup', W - 200))
    vi.advanceTimersByTime(400)
    expect(back.onclick).toHaveBeenCalledTimes(1)
  })

  it('with reduced motion nothing moves: the same decision, then straight back', () => {
    page(); window.matchMedia = vi.fn(q => ({ matches: /reduce/.test(q) }))
    stop = installEdgeSwipeBack(window, { enabled: true })
    row.dispatchEvent(ptr('pointerdown', 6))
    row.dispatchEvent(ptr('pointermove', 40))
    row.dispatchEvent(ptr('pointermove', 200))
    expect(document.getElementById('app').style.transform).toBe('')
    expect(document.querySelector('.edge-back-shade')).toBeNull()
    row.dispatchEvent(ptr('pointerup', 200))
    expect(back.onclick).toHaveBeenCalledTimes(1)
  })

  it('off (Android, a Safari tab): an edge swipe is just a touch', () => {
    page(); stop = installEdgeSwipeBack(window, { enabled: false })
    swipe(row, [6, 60, 300])
    expect(rowDown).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400)
    expect(back.onclick).not.toHaveBeenCalled()
  })

  it('a mouse never swipes back', () => {
    page(); stop = installEdgeSwipeBack(window, { enabled: true })
    row.dispatchEvent(new PointerEvent('pointerdown', { clientX: 6, clientY: 300, pointerId: 1, pointerType: 'mouse', bubbles: true }))
    expect(rowDown).toHaveBeenCalledTimes(1)
  })
})

// The gesture finds a page's back button by data-back. A back arrow added later without it just
// has no swipe, silently: every chevron button that navigates away (nav(...) or a back()) has it.
describe('every page back arrow is marked', () => {
  const files = import.meta.glob('../views/*.jsx', { query: '?raw', import: 'default', eager: true })
  it('carries data-back', () => {
    const unmarked = []
    for (const [file, src] of Object.entries(files)) {
      for (const line of src.split('\n')) {
        if (!/chevronLeft/.test(line) || !/<button/.test(line)) continue
        // …with where it goes (data-back="/plan"), for the page underneath; a bare attribute
        // would render as "true" and point the preview nowhere.
        if (/onClick=\{(\(\) => nav\(|back\}|home\})/.test(line) && !/data-back=/.test(line)) unmarked.push(file + ': ' + line.trim())
      }
    }
    expect(unmarked).toEqual([])
  })
})

// TestFlight 1.4.2 (27): the page it goes back to shows underneath, sliding in from a little to
// the left (parallax) under a fading shade; App.jsx renders it when asked (BACK_PREVIEW_EVENT).
describe('the page underneath', () => {
  let events
  const stack = () => {
    document.body.innerHTML = `<div id="app"><div class="page" data-path="/plan/r/1"><button data-back="/plan">Back</button><div class="swrow">a set</div></div></div><div id="modal-root"></div>`
    back = document.querySelector('[data-back]'); back.onclick = vi.fn()
    row = document.querySelector('.swrow')
  }
  // What App.jsx does on the event: the page underneath appears (or goes) in #app.
  const onPreview = e => {
    events.push(e.detail)
    const app = document.getElementById('app')
    if ('path' in e.detail) {
      app.querySelector('.page.under')?.remove()
      if (e.detail.path) { const u = document.createElement('div'); u.className = 'page under'; u.dataset.path = e.detail.path; app.append(u) }
    }
  }
  beforeEach(() => { events = []; window.addEventListener(BACK_PREVIEW_EVENT, onPreview) })
  afterEach(() => window.removeEventListener(BACK_PREVIEW_EVENT, onPreview))

  it('is asked for as the edge touch is claimed, slides in with the page, and becomes the page on landing', () => {
    stack(); stop = installEdgeSwipeBack(window, { enabled: true })
    row.dispatchEvent(ptr('pointerdown', 6))
    expect(events).toEqual([{ path: '/plan' }])
    row.dispatchEvent(ptr('pointermove', 30))
    row.dispatchEvent(ptr('pointermove', 6 + W / 2))
    const top = document.querySelector('.page:not(.under)')
    const under = document.querySelector('.page.under')
    expect(top.style.transform).toBe(`translateX(${W / 2}px)`)
    expect(under.style.visibility).toBe('visible')
    expect(under.style.transform).toBe(`translateX(${-0.3 * 0.5 * W}px)`)    // halfway in: -15%
    expect(document.querySelector('.edge-back-shade').style.opacity).toBe(String(0.5 * 0.35))
    expect(top.classList.contains('edge-back-page')).toBe(true)
    row.dispatchEvent(ptr('pointerup', 6 + W / 2))
    expect(under.style.transform).toBe('translateX(0px)')                   // slides fully in
    vi.advanceTimersByTime(261)
    expect(events.at(-1)).toEqual({ commit: '/plan' })                      // App restores its scroll
    expect(back.onclick).toHaveBeenCalledTimes(1)
    expect(top.style.transform).toBe(`translateX(${W}px)`)                  // stays out: no flash back
    expect(events).not.toContainEqual({ path: null })
    // Two frames on, React has replaced it; a page still there (the button went nowhere) is reset.
    vi.advanceTimersByTime(100)
    expect(document.querySelector('.edge-back-shade')).toBeNull()
    expect(top.style.transform).toBe('')
  })

  it('a cancelled swipe slides it back out and has it taken away', () => {
    stack(); stop = installEdgeSwipeBack(window, { enabled: true })
    row.dispatchEvent(ptr('pointerdown', 6))
    row.dispatchEvent(ptr('pointermove', 30))
    row.dispatchEvent(ptr('pointermove', 60))
    row.dispatchEvent(ptr('pointerup', 60))
    expect(document.querySelector('.page.under').style.transform).toBe(`translateX(${-0.3 * W}px)`)
    vi.advanceTimersByTime(300)
    expect(events.at(-1)).toEqual({ path: null })
    expect(document.querySelector('.page.under')).toBeNull()
    expect(document.querySelector('.edge-back-shade')).toBeNull()
    expect(document.querySelector('.page').style.transform).toBe('')
    expect(back.onclick).not.toHaveBeenCalled()
  })

  it('a tap at the edge asks for it and then lets it go', () => {
    stack(); stop = installEdgeSwipeBack(window, { enabled: true })
    row.dispatchEvent(ptr('pointerdown', 6))
    row.dispatchEvent(ptr('pointerup', 6))
    expect(events).toEqual([{ path: '/plan' }, { path: null }])
  })

  it('right to left: it slides in from the right', () => {
    stack(); document.documentElement.dir = 'rtl'
    stop = installEdgeSwipeBack(window, { enabled: true })
    row.dispatchEvent(ptr('pointerdown', W - 6))
    row.dispatchEvent(ptr('pointermove', W - 30))
    row.dispatchEvent(ptr('pointermove', W - 6 - W / 2))
    expect(document.querySelector('.page.under').style.transform).toBe(`translateX(${0.3 * 0.5 * W}px)`)
  })

  it('with reduced motion it is never asked for: nothing slides, the page just goes back', () => {
    stack(); window.matchMedia = vi.fn(q => ({ matches: /reduce/.test(q) }))
    stop = installEdgeSwipeBack(window, { enabled: true })
    swipe(row, [6, 40, 250])
    expect(events.filter(e => 'path' in e)).toEqual([])
    expect(back.onclick).toHaveBeenCalledTimes(1)
  })

  it('a back button that cannot say where it goes (data-back="") swipes without one', () => {
    stack(); back.setAttribute('data-back', '')
    stop = installEdgeSwipeBack(window, { enabled: true })
    swipe(row, [6, 40, 250])
    vi.advanceTimersByTime(300)
    expect(events).toEqual([])
    expect(back.onclick).toHaveBeenCalledTimes(1)
  })
})
