// @vitest-environment happy-dom
// The iPhone's screen transitions (lib/transitions.js): the decisions (pure), the engine with a fake
// View Transition (the mock's race cases), without View Transitions (old iOS), and the history wrapper.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./nav.js', () => ({ pathBefore: () => '/plan', onSheetEntry: () => false }))
const T = await import('./transitions.js')
const { st, run, halt, wrapHistory, swipeDone, swipeVelocity, screenR, inView, styleFor, popStyle, retapStyle, swipeCommits, isTabRoot, navMotion } = T

describe('the decisions', () => {
  it('swipeDone: a fast flick or past 35 % goes, a flick back or a short slow drag springs back', () => {
    expect(swipeDone(0.1, 0.7)).toBe(true)
    expect(swipeDone(0.5, 0)).toBe(true)
    expect(swipeDone(0.6, -0.5)).toBe(false)
    expect(swipeDone(0.2, 0.1)).toBe(false)
    expect(swipeDone(0.35, 0)).toBe(true)
  })
  it('swipeVelocity: the speed of the last 80 ms, not the average of the drag', () => {
    expect(swipeVelocity([[0, 0], [10, 400], [100, 500], [160, 540]], 540)).toBeCloseTo((160 - 100) / 40, 5)
    expect(swipeVelocity([[0, 0], [100, 1000]], 1000)).toBe(0)   // one sample in the window
    expect(swipeVelocity([], 5)).toBe(0)
    expect(swipeVelocity([[5, 100], [5, 100]], 100)).toBe(0)     // same instant: no division by zero
  })
  it('screenR: the corner radius by screen height, square on the SE class, 47 for an unknown one', () => {
    expect(screenR(844)).toBe(47); expect(screenR(667)).toBe(0); expect(screenR(956)).toBe(62); expect(screenR(1)).toBe(47)
  })
  it('inView: a thumbnail between the header and the tab bar', () => {
    expect(inView({ top: 120, bottom: 170 }, 100, 700)).toBe(true)
    expect(inView({ top: 90, bottom: 170 }, 100, 700)).toBe(false)
    expect(inView({ top: 660, bottom: 710 }, 100, 700)).toBe(false)
  })
  it('styleFor: a routine card zooms, a row with a picture flies, the rest slides', () => {
    document.body.innerHTML = `<div id="a" class="item" data-vt="zoom"><span id="a1">r</span></div>
      <div id="b" class="item"><img class="thumb"><button id="b1">e</button></div>
      <div id="c" class="item"><button id="c1">s</button></div>`
    expect(styleFor(document.getElementById('a1'))).toBe('zoom')
    expect(styleFor(document.getElementById('b1'))).toBe('fly')
    expect(styleFor(document.getElementById('c1'))).toBe('slide')
    expect(styleFor(null)).toBe('slide')
    document.body.innerHTML = '<div class="row wd-ex"><img class="thumb"><button id="w1">w</button></div>'   // workout page row
    expect(styleFor(document.getElementById('w1'))).toBe('fly')
  })
  it('a pop mirrors the way in; a picture flies one step only; a re-tap zooms only straight back to the root', () => {
    expect(popStyle('zoom')).toBe('zoom'); expect(popStyle('fly')).toBe('fly')
    expect(popStyle('fly', 2)).toBe('slide'); expect(popStyle('zoom', 2)).toBe('zoom')
    expect(retapStyle({ style: 'zoom', from: '/plan' }, '/plan')).toBe('zoom')
    expect(retapStyle({ style: 'zoom', from: '/plan/r/1' }, '/plan')).toBe('slide')
    expect(retapStyle(undefined, '/plan')).toBe('slide')
  })
  it('a swipe lands only if the page is still where it was when the finger went down', () => {
    expect(swipeCommits(true, '#/a', '#/a')).toBe(true)
    expect(swipeCommits(true, '#/a', '#/b')).toBe(false)
    expect(swipeCommits(false, '#/a', '#/a')).toBe(false)
  })
  it('the four tab roots are not pages to push', () => {
    for (const p of ['/', '/home', '/plan', '/stats', '/library']) expect(isTabRoot(p)).toBe(true)
    for (const p of ['/library/x', '/plan/r/1', '/settings']) expect(isTabRoot(p)).toBe(false)
  })
})

/* ---------- the engine ---------- */

const rejections = []
const onRej = e => rejections.push(e.reason)
let mq
const dom = () => {
  document.documentElement.removeAttribute('data-nav')
  document.body.style.minHeight = ''
  document.body.innerHTML = `<div id="app"><div class="page" id="old"><div class="page-in">
    <div class="gh"><div class="edge-b"></div></div><h1>Old</h1>
    <div id="card" class="item" data-vt="zoom"><button id="cardb">go</button></div></div></div></div>
    <nav id="tabbar"><button>tab</button></nav>`
}
// a page swap like React's: the old page leaves, a new one stands there
const swapPage = () => {
  const app = document.getElementById('app')
  app.innerHTML = '<div class="page" id="new"><div class="page-in"><div class="gh"><div class="edge-b"></div></div><h1>New</h1></div></div>'
}
// startViewTransition fake: the callback runs a microtask later (as the browser does, a frame later), or at once
const fakeVT = ({ sync = false } = {}) => {
  document.startViewTransition = vi.fn(cb => {
    const skip = vi.fn()
    const done = sync ? Promise.resolve().then(() => cb()) : new Promise(r => setTimeout(r, 0)).then(() => cb())
    return { ready: done, updateCallbackDone: done, finished: done.then(() => new Promise(r => setTimeout(r, 5))), skipTransition: skip }
  })
}
const tick = ms => new Promise(r => setTimeout(r, ms))

beforeEach(() => {
  window.addEventListener('unhandledrejection', onRej)
  mq = false
  vi.stubGlobal('matchMedia', () => ({ matches: mq, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('CSS', { supports: () => true })
  window.scrollTo = vi.fn()
  Object.assign(st, { ep: 0, vt: 0, busy: false, ref: null, y: null, swiped: false, motion: null, onHalt: null })
  dom()
})
afterEach(() => {
  delete document.startViewTransition
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.removeEventListener('unhandledrejection', onRej)
})

describe('with View Transitions', () => {
  it('a push: names the glass and the page, sets data-nav, and gives everything back at the end', async () => {
    fakeVT()
    const update = vi.fn(() => swapPage())
    run('push', 'slide', update)
    const html = document.documentElement
    expect(html.dataset.nav).toBe('slide-push')
    expect(document.querySelector('.gh').style.getPropertyValue('view-transition-name')).toBe('vt-top')
    expect(document.getElementById('tabbar').style.getPropertyValue('view-transition-class')).toBe('bot')
    expect(document.getElementById('old').classList.contains('vt-f')).toBe(true)   // frozen to the viewport for the picture
    expect(st.busy).toBe(true)
    await tick(40)
    expect(update).toHaveBeenCalledTimes(1)
    expect(html.hasAttribute('data-nav')).toBe(false)
    expect(document.querySelector('[style*="view-transition"]')).toBeNull()
    expect(document.querySelector('.vt-f')).toBeNull()
    expect(document.body.style.minHeight).toBe('')
    expect(st.busy).toBe(false)
    expect(rejections).toEqual([])
  })

  it('a card tap then a second input in the same task: the first move does nothing', async () => {
    fakeVT()
    const first = vi.fn(() => swapPage()), second = vi.fn(() => swapPage())
    run('push', 'slide', first)
    halt()                                   // a tab tap
    expect(document.documentElement.hasAttribute('data-nav')).toBe(false)
    run('push', 'slide', second)
    await tick(40)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[style*="view-transition"]')).toBeNull()
    expect(st.busy).toBe(false)
    expect(rejections).toEqual([])
  })

  it('a move cut short by a halt after its update leaves no names and no frozen page', async () => {
    fakeVT({ sync: true })
    run('push', 'fly', () => swapPage(), { pic: () => null })
    await tick(1)
    halt()
    expect(document.querySelector('[style*="view-transition"]')).toBeNull()
    expect(document.querySelector('.vt-f')).toBeNull()
    expect(document.documentElement.hasAttribute('data-nav')).toBe(false)
    await tick(30)
    expect(rejections).toEqual([])
  })

  it('zoom: the tapped card is the row (before the swap) and the new page the row after it; a pop finds the card again', async () => {
    fakeVT()
    run('push', 'zoom', () => swapPage(), { card: () => document.getElementById('card') })
    expect(document.documentElement.dataset.nav).toBe('zoom-push')
    expect(document.getElementById('card').style.getPropertyValue('view-transition-class')).toBe('row')
    expect(document.getElementById('old').style.getPropertyValue('view-transition-class')).toBe('base')
    await tick(5)
    expect(document.getElementById('new').style.getPropertyValue('view-transition-class')).toBe('row')
    await tick(40)
    expect(document.querySelector('[style*="view-transition"]')).toBeNull()
  })

  it('a pop restores the scroll it left at, after the page is back', async () => {
    fakeVT()
    run('pop', 'slide', () => swapPage(), { y: 640 })
    expect(document.body.style.minHeight).not.toBe('')   // the window cannot clamp while the page is frozen
    await tick(5)
    expect(window.scrollTo).toHaveBeenCalledWith(0, 640)
    await tick(40)
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 640)
    expect(st.y).toBeNull()
  })

  it('Reduce Motion: every style is a fade, nothing zooms or flies', () => {
    fakeVT(); mq = true
    run('push', 'zoom', () => swapPage(), { card: () => document.getElementById('card') })
    expect(document.documentElement.dataset.nav).toBe('fade')
    expect(document.getElementById('card').style.getPropertyValue('view-transition-name')).toBe('')
    expect(document.getElementById('old').style.getPropertyValue('view-transition-class')).toBe('page')
  })
})

describe('without View Transitions (old iOS)', () => {
  it('the update runs once, at once; busy ends by itself even if no animation event comes', () => {
    vi.useFakeTimers()
    const update = vi.fn()
    run('push', 'slide', update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.hasAttribute('data-nav')).toBe(false)
    expect(st.busy).toBe(true)
    vi.advanceTimersByTime(380 + 80)
    expect(st.busy).toBe(false)
  })
  it('a second input ends the first move\'s wait: a newer move owns busy', () => {
    vi.useFakeTimers()
    run('push', 'slide', vi.fn())
    vi.advanceTimersByTime(300)
    run('push', 'slide', vi.fn())
    vi.advanceTimersByTime(200)   // the first one's timer is due now, and must not switch busy off under the second
    expect(st.busy).toBe(true)
    vi.advanceTimersByTime(300)
    expect(st.busy).toBe(false)
  })
})

/* ---------- the history wrapper ---------- */

const fakeHistory = (pathname = '/plan', state = null) => {
  const h = { location: { pathname, state }, push: vi.fn(), replace: vi.fn(), go: vi.fn(), listen: vi.fn(fn => fn) }
  return h
}
const wrap = h => wrapHistory(h, { flush: fn => fn(), scrollOf: () => 120 })
const click = el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }
let off
beforeEach(() => { off = T.installTransitions() })
afterEach(() => off())

describe('wrapHistory (old iOS path: the update runs at once)', () => {
  it('a tap on a routine card pushes with zoom, remembering the card and the page it came from', () => {
    const h = fakeHistory('/plan'), w = wrap(h)
    click(document.getElementById('cardb'))
    w.push('/plan/r/7', undefined)
    expect(h.push).toHaveBeenCalledTimes(1)
    const vt = h.push.mock.calls[0][1].vt
    expect(vt).toMatchObject({ style: 'zoom', from: '/plan' })
    expect(vt.opener).toBeGreaterThanOrEqual(0)
    expect(navMotion('/plan/r/7')).toBe('push')
  })
  it('a row with a picture flies, remembering that its thumbnail is (not) visible', () => {
    document.getElementById('app').innerHTML = '<div class="page"><div class="page-in"><div class="item"><img class="thumb"><button id="ex">x</button></div></div></div>'
    const h = fakeHistory('/library'), w = wrap(h)
    document.getElementById('tabbar').getBoundingClientRect = () => ({ top: 700, bottom: 760 })
    const th = document.querySelector('.thumb'), at = top => { th.getBoundingClientRect = () => ({ top, bottom: top + 50 }) }
    at(-10)   // under the soft edge: the picture would jump, so the fade only
    click(document.getElementById('ex'))
    w.push('/library/bench')
    expect(h.push.mock.calls[0][1].vt).toMatchObject({ style: 'fly', fit: false })
    expect(navMotion('/library/bench')).toBe('fade')
    at(300); halt()   // (the first move is over)
    click(document.getElementById('ex'))
    w.push('/library/squat')
    expect(h.push.mock.calls[1][1].vt).toMatchObject({ style: 'fly', fit: true })
  })
  it('no tap: slide. A tab root, the same page or a query change: plain, no vt saved', () => {
    const h = fakeHistory('/home'), w = wrap(h)
    w.push('/settings')
    expect(h.push.mock.calls[0][1].vt.style).toBe('slide')
    w.push('/stats', { a: 1 })
    expect(h.push.mock.calls[1][1]).toEqual({ a: 1 })
    w.push({ pathname: '/home', search: '?q=1' })
    expect(h.push.mock.calls[2][1]).toBeUndefined()
  })
  it('back reads the style of the entry being left; hardware back and the button are the same call', () => {
    const h = fakeHistory('/plan/r/7', { vt: { style: 'zoom', opener: 2, fit: false, from: '/plan' } }), w = wrap(h)
    w.go(-1)
    expect(h.go).toHaveBeenCalledWith(-1)
    expect(navMotion('/plan')).toBe('pop')
  })
  it('back with no saved style, or after the edge swipe, is plain and one-shot', () => {
    const h = fakeHistory('/plan/r/7', null), w = wrap(h)
    w.go(-1)
    expect(navMotion('/plan')).toBe('fade')
    const h2 = fakeHistory('/plan/r/7', { vt: { style: 'zoom', opener: 0, from: '/plan' } }), w2 = wrap(h2)
    st.swiped = true
    w2.go(-1)
    expect(h2.go).toHaveBeenCalledWith(-1)
    expect(navMotion('/plan')).toBe('fade')
    expect(st.busy).toBe(false)   // plain: nothing was started
  })
  it('a tab switch is the plain fade; a re-tap from a page inside the tab goes back to its root with the way-in style', () => {
    const h = fakeHistory('/plan'), w = wrap(h)
    w.replace('/stats')
    expect(navMotion('/stats')).toBe('fade')
    expect(st.busy).toBe(false)
    const h2 = fakeHistory('/plan/r/7', { vt: { style: 'zoom', opener: 0, fit: false, from: '/plan' } }), w2 = wrap(h2)
    w2.replace('/plan')
    expect(h2.replace).toHaveBeenCalledTimes(1)
    expect(navMotion('/plan')).toBe('pop')
    const h3 = fakeHistory('/plan/r/7', { vt: { style: 'zoom', opener: 0, fit: false, from: '/plan' } }), w3 = wrap(h3)
    w3.replace('/stats')   // another tab: not a re-tap
    expect(navMotion('/stats')).toBe('fade')
  })
  it('a pop renders at once: the router listener is flushed for a POP only', () => {
    const flush = vi.fn(fn => fn()), h = fakeHistory()
    let cb
    h.listen = fn => { cb = fn; return () => {} }
    const w = wrapHistory(h, { flush, scrollOf: () => 0 })
    const fn = vi.fn()
    w.listen(fn)
    cb({ action: 'PUSH' }); expect(flush).not.toHaveBeenCalled()
    cb({ action: 'POP' }); expect(flush).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('wrapHistory (View Transitions): the pop waits for the history event', () => {
  it('go(-1) runs the pop and holds the move until popstate; focus goes back to the opener', async () => {
    fakeVT()
    document.getElementById('app').innerHTML = '<div class="page" id="cur"><div class="page-in"><h1>R</h1></div></div>'
    const h = fakeHistory('/plan/r/7', { vt: { style: 'slide', opener: 0, fit: false, from: '/plan' } })
    h.go = vi.fn(() => { swapPage(); dispatchEvent(new Event('popstate')) })
    const w = wrap(h)
    w.go(-1)
    expect(document.documentElement.dataset.nav).toBe('slide-pop')
    await tick(30)
    expect(h.go).toHaveBeenCalledWith(-1)
    expect(document.documentElement.hasAttribute('data-nav')).toBe(false)
    expect(rejections).toEqual([])
  })
  it('a pop with no history event (nothing to go back to) lets go after 400 ms and leaves nothing behind', async () => {
    fakeVT()
    const h = fakeHistory('/plan/r/7', { vt: { style: 'slide', opener: 0, fit: false, from: '/plan' } })
    wrap(h).go(-1)
    await tick(450)
    expect(document.documentElement.hasAttribute('data-nav')).toBe(false)
    expect(document.querySelector('.vt-f')).toBeNull()
    expect(st.busy).toBe(false)
  })
})

describe('wrapHistory (View Transitions): a newer input wins', () => {
  it('a tap on the lit tab right after a card tap: the waiting push never lands', async () => {
    fakeVT()
    const h = fakeHistory('/plan'), w = wrap(h)
    click(document.getElementById('cardb'))
    w.push('/plan/r/7')
    click(document.querySelector('#tabbar button'))
    w.replace('/plan')   // same tab root: still a new input
    await tick(40)
    expect(h.push).not.toHaveBeenCalled()
    expect(h.replace).toHaveBeenCalledTimes(1)
  })
  it('replace after an edge swipe is plain, and no pic on the new page fades the thumbnail out', async () => {
    const h = fakeHistory('/plan/r/7', { vt: { style: 'zoom', opener: 0, fit: false, from: '/plan' } }), w = wrap(h)
    st.swiped = true
    w.replace('/plan')
    expect(st.busy).toBe(false)
    expect(navMotion('/plan')).toBe('fade')
    fakeVT({ sync: true })
    document.getElementById('app').innerHTML = '<div class="page"><div class="page-in"><div class="gh"></div><img id="t"></div></div>'
    run('push', 'fly', () => swapPage(), { pic: isNew => (isNew ? null : document.getElementById('t')) })
    await tick(1)
    expect(document.documentElement.hasAttribute('data-nopic')).toBe(true)
    await tick(30)
    expect(document.documentElement.hasAttribute('data-nopic')).toBe(false)
  })
})

describe('taps while something moves', () => {
  it('a row on the page is ignored, glass is not', () => {
    document.getElementById('app').innerHTML = '<div class="page"><div class="page-in"><div class="gh"><button id="g">back</button></div><button id="r">row</button></div></div>'
    const seen = []
    document.body.addEventListener('click', e => seen.push(e.target.id))
    st.busy = true
    click(document.getElementById('r')); click(document.getElementById('g'))
    expect(seen).toEqual(['g'])
    st.busy = false
    click(document.getElementById('r'))
    expect(seen).toEqual(['g', 'r'])
  })
  it('a tap sent to <html> during a transition reaches the glass control under the finger only', () => {
    document.getElementById('app').innerHTML = '<div class="page"><div class="page-in"><div class="gh"><button id="g">back</button></div></div></div>'
    const g = document.getElementById('g'), hit = vi.fn()
    g.addEventListener('click', hit)
    g.getBoundingClientRect = () => ({ left: 0, right: 44, top: 0, bottom: 44 })
    document.documentElement.dataset.nav = 'slide-push'
    const dn = (x, y) => document.documentElement.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
    const up = (x, y) => document.documentElement.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y }))
    dn(300, 300); up(300, 300); expect(hit).not.toHaveBeenCalled()
    dn(300, 300); up(20, 20); expect(hit).not.toHaveBeenCalled()   // a drag that ends over the button
    dn(20, 20); up(20, 20); expect(hit).toHaveBeenCalledTimes(1)
    document.documentElement.removeAttribute('data-nav')
    dn(20, 20); up(20, 20); expect(hit).toHaveBeenCalledTimes(1)
  })
})
