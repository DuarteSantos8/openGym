// Screen transitions on the iPhone app (Liquid Glass G6). iOS only: App.jsx wraps the router's
// history with wrapHistory() there, so every push, back and tab re-tap goes through run(), and
// Android and the web keep the navigation they have.
//
// Three styles, picked from what was tapped (styleFor) and saved on the history entry, so going
// back mirrors the way in:
//   slide  the iOS push/pop (380 ms), the base for everything
//   zoom   a routine card grows into its page and shrinks back into the same card (400 ms)
//   fly    an exercise row's picture flies to the page's picture, the page fades in (300 ms)
// A tab switch is not here: a plain 140 ms CSS fade (index.css .vfade), so the tab bar's lens
// stays live. The edge swipe (lib/edge-swipe-back.js) follows the finger with plain transforms
// and lands without any of this. Glass (header, bottom edge, tab bar) never moves: each is its
// own named piece. Reduce Motion: a 150 ms fade for every style. Without View Transitions
// (view-transition-class needs Safari 18.2): the page's own CSS class animates, a slide for slide
// and zoom, a fade for fly (index.css .vpush, .vpop, .vfade).
//
// The old page and the new one are frozen to a viewport-sized clipped box while the browser
// takes its pictures (.vt-f), so a 1,324-row Library is never snapshotted whole.
import { pathBefore, onSheetEntry } from './nav.js'

export const MS = { slide: 380, zoom: 400, fly: 300 }
const OPEN_SEL = 'a[href],button,[role="button"],[tabindex],[data-vt],.item,.lrow'
const ROOT = /^\/(home|plan|stats|library)?\/?$/   // the four tab roots (and '/')
export const isTabRoot = p => ROOT.test(p)
const seg = p => p.split('/')[1] || ''

/* ---------- pure decisions (unit-tested) ---------- */

// Edge swipe release: p = how far across (0..1), v = speed at release in px/ms.
export const swipeDone = (p, v) => v > 0.5 || (p >= 0.35 && v >= -0.3)

// Speed over the last 80 ms of a drag: h = [[x, t], ...] (x towards "back").
export function swipeVelocity(h, now) {
  const r = h.filter(q => now - q[1] <= 80), dt = r.length > 1 ? r.at(-1)[1] - r[0][1] : 0
  return dt > 0 ? (r.at(-1)[0] - r[0][0]) / dt : 0
}

// The screen's corner radius in pt, by its long side in px (approximate; the zoom ends on it).
const SCREEN_R = { 667: 0, 736: 0, 812: 40, 844: 47, 852: 55, 874: 62, 896: 42, 926: 53, 932: 55, 956: 62 }
export const screenR = h => SCREEN_R[h] ?? 47

// Is a thumbnail's rect fully between the header and the tab bar? Else the soft edge fades it
// and lifting it out would make it jump.
export const inView = (r, navBottom, barTop) => r.top >= navBottom && r.bottom <= barTop

export const thumbOf = el => el?.closest('.item,.lrow,.wd-ex')?.querySelector('img.thumb') ?? null
export const cardOf = el => el?.closest('[data-vt="zoom"]') ?? el
// What was tapped decides the style: a routine card zooms, a row with a picture flies, the rest slides.
export const styleFor = el => (!el ? 'slide' : el.closest('[data-vt="zoom"]') ? 'zoom' : thumbOf(el) ? 'fly' : 'slide')

// A picture flies one step only (a deeper page has no thumbnail to land on).
export const popStyle = (style, steps = 1) => (style === 'fly' && steps > 1 ? 'slide' : style)
// A tab re-tap from a deep page: the style of the way in only when it came straight from that root.
export const retapStyle = (vt, to) => (vt && vt.from === to ? vt.style : 'slide')
// A swipe commits only if nothing moved the page since the finger went down.
export const swipeCommits = (done, startUrl, nowUrl) => !!done && startUrl === nowUrl

/* ---------- state ---------- */

// ep counts inputs: a move captures it, and its update callback (which runs a frame or more after
// the tap) does nothing if a tab tap, a drag or another move came in between. busy = a move or
// a swipe is running, and content rows ignore taps. vt counts moves (the last one owns the names).
export const st = { ep: 0, vt: 0, busy: false, ref: null, y: null, swiped: false, motion: null, onHalt: null }
let tap = null   // the control the last click landed on

const root = () => document.documentElement
const reduced = () => { try { return !!matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
// view-transition-class arrived in Safari 18.2; without it the CSS cannot target our pieces
export const canVT = () => typeof document.startViewTransition === 'function' && !!globalThis.CSS?.supports?.('view-transition-class', 'a')
const topPage = () => document.querySelector('#app > .page:not(.under)')
export const opens = p => [...p.querySelectorAll(OPEN_SEL)]

// How the next page arrives when no View Transition runs (App.jsx Page): the page's own CSS class.
export function setMotion(path, v) { st.motion = { path, v, t: Date.now() } }
export const navMotion = path => (st.motion && st.motion.path === path && Date.now() - st.motion.t < 2000 ? st.motion.v : 'fade')

/* ---------- the engine ---------- */

const nm = (el, cls, name = cls) => {
  if (!el?.isConnected) return
  el.style.setProperty('view-transition-name', 'vt-' + name); el.style.setProperty('view-transition-class', cls)
}

// A page frozen to the viewport: fixed, clipped, content shifted up by the scroll it was left at.
// body keeps the document tall so the window does not clamp (and tell the app it scrolled to 0).
function freeze(p, y) {
  if (!p) return
  p.style.setProperty('--vt-y', y + 'px'); p.classList.add('vt-f')
}
function unfreeze() {
  document.querySelectorAll('#app > .page.vt-f').forEach(p => { p.classList.remove('vt-f'); p.style.removeProperty('--vt-y') })
  document.body.style.minHeight = ''
  if (st.y != null) { const y = st.y; st.y = null; window.scrollTo(0, y) }
}

// End a running transition now (the DOM is already in its final state) and give every name back.
function stopVT() {
  const r = st.ref; st.ref = null
  try { r?.skipTransition() } catch { /* already over */ }
  st.busy = false
  root().removeAttribute('data-nav'); root().removeAttribute('data-nopic')
  document.querySelectorAll('[style*="view-transition"]').forEach(e => { e.style.removeProperty('view-transition-name'); e.style.removeProperty('view-transition-class') })
  unfreeze()
}

// Every new input starts here: end whatever is still moving, make every callback still waiting do nothing.
export function halt() {
  st.ep++; st.vt++   // first: skipTransition() may run a waiting update callback at once, and it must see the new count
  st.onHalt?.()      // the edge swipe: a finger still down is let go, a settle is finished
  stopVT()
}

// kind: 'push' | 'pop'. style: 'slide' | 'zoom' | 'fly'. update(ep) changes the route and renders it
// (a promise for a pop, which waits for the history event). x.card() = the zoom card (push: before
// update; pop: found again after it). x.pic(isNew) = the picture to fly, or null. x.y = scroll to restore.
export function run(kind, style, update, x = {}) {
  halt()
  const ep = st.ep, n = ++st.vt, push = kind === 'push', rm = reduced()
  st.busy = true
  if (!canVT()) {   // the new page's own CSS class animates (App.jsx Page)
    try { update(ep) } finally { setTimeout(() => { if (st.vt === n) st.busy = false }, (rm ? 150 : MS[style]) + 80) }
    return
  }
  const zoom = style === 'zoom' && !rm && !!x.card, pic = style === 'fly' && !rm && x.pic
  const names = isNew => {
    nm(document.querySelector('#app .gh'), 'top')   // glass: its own groups, they never ride the page
    nm(document.querySelector('.gh .edge-b'), 'bot', 'eb'); nm(document.getElementById('tabbar'), 'bot', 'tab')
    const p = topPage()
    if (!zoom) nm(p, 'page')
    else if (push) isNew ? nm(p, 'row') : (nm(p, 'base'), nm(x.card(), 'row'))
    else isNew ? (nm(p, 'base'), nm(x.card(), 'row')) : nm(p, 'row')
    if (pic) nm(pic(isNew), 'pic')
  }
  st.y = push ? null : x.y ?? 0
  const y0 = window.scrollY
  document.body.style.minHeight = Math.max(document.documentElement.scrollHeight, (st.y ?? 0) + window.innerHeight) + 'px'
  freeze(topPage(), y0)
  root().dataset.nav = rm ? 'fade' : style + '-' + kind
  names(false)
  const t = st.ref = document.startViewTransition(() => {
    if (st.ep !== ep) return undefined
    return Promise.resolve(update(ep)).then(() => {
      if (st.ep !== ep) return
      freeze(topPage(), st.y ?? 0)
      if (st.y != null) window.scrollTo(0, st.y)
      names(true)
      // no picture on the new page: the old thumbnail fades out instead of vanishing (index.css)
      if (push && pic && !pic(true)) root().dataset.nopic = ''
    })
  })
  // skipped or failed: nothing to report. Every promise is caught, so a skipped move is no unhandled rejection.
  ;[t.ready, t.updateCallbackDone].forEach(p => p.catch(() => {}))
  if (zoom) t.ready.then(() => grow(push)).catch(() => {})
  t.finished.catch(() => {}).then(() => { if (st.vt === n) stopVT() })   // a newer move owns the names now
}

// The browser does not animate the corners of a group: 16 pt card <-> the screen's own corner.
function grow(push) {
  const ms = parseFloat(getComputedStyle(root()).getPropertyValue('--vtd')) || MS.zoom
  const R = screenR(Math.max(screen.width, screen.height)) + 'px'
  root().animate({ borderRadius: push ? ['16px', R] : [R, '16px'] },
    { duration: ms, easing: 'cubic-bezier(.32,.72,0,1)', pseudoElement: '::view-transition-group(vt-row)' })
}

/* ---------- navigation ---------- */

function focusTitle() {
  const h = topPage()?.querySelector('h1')
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
}
function focusOpener(i) {
  const p = topPage()
  if (p) (opens(p)[i] || p.querySelector('h1'))?.focus?.({ preventScroll: true })
}
// A frame later, once the page is there; and not if another input came in meanwhile.
const later = (ep, fn) => requestAnimationFrame(() => { if (st.ep === ep) fn() })

// The control tapped a moment ago, once.
function takeTap() {
  const t = tap; tap = null
  return t && performance.now() - t.t < 800 && t.el?.isConnected ? t.el : null
}
const pathOf = to => (typeof to === 'string' ? to : to.pathname || '').split(/[?#]/)[0]

// Wraps a react-router history (App.jsx): push, back and tab re-tap animate, the rest is untouched.
// The entry a push creates keeps { style, opener, fit, from }; going back reads it from the entry
// being left. flush = react-dom's flushSync, scrollOf = the scroll a path was left at.
export function wrapHistory(h, { flush, scrollOf }) {
  const w = Object.create(h)
  const here = () => h.location
  // a move to another page ends whatever still moves (a tab tap does); a query-only change leaves it be
  const plain = (path, fn) => { if (path && path !== here().pathname) halt(); setMotion(path, 'fade'); return fn() }
  const update = (path, kind, style, go, after) => ep => {
    setMotion(path, canVT() ? 'none' : style === 'fly' ? 'fade' : kind)
    const r = go()
    later(ep, after)
    return r
  }
  const thumbFit = th => {
    if (!th) return false
    const nav = document.querySelector('.gh .nav'), bar = document.getElementById('tabbar')
    return inView(th.getBoundingClientRect(), nav ? nav.getBoundingClientRect().bottom : 0, bar ? bar.getBoundingClientRect().top : window.innerHeight)
  }
  const hero = () => topPage()?.querySelector('.exmedia img,.exmedia video') ?? null
  // pop: the card / thumbnail on the fresh page is found again by the opener's index
  const popX = (vt, y) => ({
    card: () => cardOf(opens(topPage())[vt.opener]),
    pic: vt.fit ? isNew => (isNew ? thumbOf(opens(topPage())[vt.opener]) : hero()) : null,
    y,
  })

  w.listen = fn => h.listen(a => (a.action === 'POP' ? flush(() => fn(a)) : fn(a)))   // a pop renders at once, inside the VT callback

  w.push = (to, state) => {
    const path = pathOf(to), el = takeTap()
    if (!path || path === here().pathname || isTabRoot(path) || onSheetEntry()) return plain(path, () => h.push(to, state))
    const page = topPage(), style = styleFor(el), th = style === 'fly' ? thumbOf(el) : null
    const vt = { style, opener: el && page ? opens(page).indexOf(el) : -1, fit: thumbFit(th), from: here().pathname }
    const go = () => (canVT() ? flush(() => h.push(to, { ...state, vt })) : h.push(to, { ...state, vt }))
    run('push', style, update(path, 'push', style, go, focusTitle),
      { card: () => cardOf(el), pic: vt.fit ? isNew => (isNew ? hero() : th) : null })
  }

  w.replace = (to, state) => {
    const path = pathOf(to), vt = here().state?.vt, was = here().pathname
    const user = !!takeTap()
    // a tab tap is a new input even on the lit tab: a push or slide still waiting must not land after it
    if (user && isTabRoot(path)) halt()
    if (st.swiped || !path || path === was || !isTabRoot(path) || onSheetEntry()) return plain(path, () => h.replace(to, state))
    // tab switch: the plain 140 ms fade, the new page's title takes focus
    if (!vt || seg(path) !== seg(was)) {
      plain(path, () => h.replace(to, state))
      if (user) later(st.ep, focusTitle)
      return
    }
    // a re-tap on the lit tab from a page deeper in it: back to the root
    const style = retapStyle(vt, path)
    const go = () => (canVT() ? flush(() => h.replace(to, state)) : h.replace(to, state))
    run('pop', style, update(path, 'pop', style, go, focusTitle), style === 'slide' ? { y: 0 } : { ...popX(vt, 0) })
  }

  w.go = delta => {
    const vt = here().state?.vt, to = pathBefore(Math.max(1, -delta))
    if (delta >= 0 || !vt || !to || st.swiped || onSheetEntry()) return plain(to || '', () => h.go(delta))
    const style = popStyle(delta < -1 ? 'slide' : vt.style, -delta)
    const go = () => new Promise(res => {
      const fin = () => { clearTimeout(tm); removeEventListener('popstate', fin); res() }
      const tm = setTimeout(fin, 400)   // no history event (nothing to go back to): do not hold the move for ever
      addEventListener('popstate', fin)
      h.go(delta)
    })
    run('pop', style, update(to, 'pop', style, go, () => focusOpener(vt.opener)),
      style === 'slide' ? { y: scrollOf(to) } : popX(vt, scrollOf(to)))
  }
  return w
}

// The listeners that go with it (App.jsx, once): which control was tapped, taps on the page while
// something moves, and taps the browser sends to <html> during a transition.
export function installTransitions() {
  const onClick = e => {
    const el = e.target
    if (st.busy && el.closest?.('#app .page') && !el.closest('.gh')) { e.preventDefault(); e.stopPropagation(); return }   // like iOS: rows wait until the page lands
    tap = { el: el.closest?.(OPEN_SEL) || null, t: performance.now() }
  }
  // While a View Transition runs the browser may send every tap to <html>. Pass it on to the GLASS
  // control under the finger only (back, round buttons, tab bar). pointerup, not click: iOS often
  // gives no click for a tap on a non-interactive target.
  // Only a tap that went down AND up on the same glass control: the end of a scroll is not a tap.
  const glassAt = e => [...document.querySelectorAll('.gh button,.gh [data-back],#tabbar button')].find(b => {
    const r = b.getBoundingClientRect(); return !b.disabled && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  })
  let downOn = null
  const onPtrDown = e => { downOn = e.target === root() && root().hasAttribute('data-nav') ? glassAt(e) : null }
  const onUp = e => {
    const was = downOn; downOn = null
    if (e.target !== root() || !root().hasAttribute('data-nav')) return
    const hit = glassAt(e)
    if (hit && hit === was) hit.click()
  }
  // ...and a swallowed tap on <html> would also move focus from the new title to <body> (mousedown blurs)
  const onDown = e => { if (e.target === root() && root().hasAttribute('data-nav')) e.preventDefault() }
  addEventListener('click', onClick, true); addEventListener('pointerdown', onPtrDown, true); addEventListener('pointerup', onUp, true); addEventListener('mousedown', onDown, true)
  return () => { removeEventListener('click', onClick, true); removeEventListener('pointerdown', onPtrDown, true); removeEventListener('pointerup', onUp, true); removeEventListener('mousedown', onDown, true) }
}
