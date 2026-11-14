// Motion for list changes (archive, restore, delete, Move to folder, Make current). The data is
// written first and at once; this is only the visual layer, so nothing here waits on an animation.
// Rows carry data-flip-key. Before the write we note every keyed row. After the commit:
//  - a keyed row that is gone fades out as a ghost copy (100 ms ease-out, `slide` adds a 16 px trail);
//  - the rows that stay FLIP to their new place (lib/flip.js);
//  - a keyed row that is new fades in (160 ms, after `enterDelay`).
// Reduce Motion (html class or the phone): no ghost, slide or FLIP. The leaver stays in its place and
// fades 120 ms linear, then the list closes up; arrivals fade 120 ms. It is out of hit-testing at once.
import { flipPlay, FLIP_MAX, still } from './flip.js'

const KEY = '[data-flip-key]'
const EASE = 'cubic-bezier(.32,.72,0,1)'   // = --ease; the Web Animations API takes no var()
const RM_MS = 120

/** Runs `change()` (the state write) and plays the motion. Options:
 *  slide: a leaver trails 16 px (archive); hold: ms before leavers start to go (Move sheet);
 *  enterDelay: ms before an arrival fades in; dur / delay: the FLIP's, as CSS times;
 *  far: px a follower may travel before it fades in at its new place instead (Favourites, 160);
 *  tick: { key, at } pops the count line of the keyed row `at` ms in; land: key of the block that takes the
 *  new tint and pin (Make current). */
export function listMove(change, { slide = false, hold = 0, enterDelay = 80, dur, delay, tick, land, far } = {}) {
  const rm = still()
  const root = document.body
  const before = new Map(), olds = []
  for (const el of root.querySelectorAll(KEY)) {
    const r = el.getBoundingClientRect()
    before.set(el.dataset.flipKey, { x: r.left, y: r.top })
    const sibs = rm ? [...(el.parentNode?.children || [])] : []
    olds.push({ el, key: el.dataset.flipKey, r, parent: el.parentNode, first: !el.previousElementSibling, after: sibs.slice(sibs.indexOf(el) + 1) })
  }
  change()
  // The commit lands in a microtask at the latest; nothing is painted before it.
  queueMicrotask(() => {
    const now = [...root.querySelectorAll(KEY)]
    const keys = new Set(now.map(el => el.dataset.flipKey))
    const gone = olds.filter(o => !keys.has(o.key) && !o.el.parentElement?.closest(KEY)).slice(0, FLIP_MAX)
    for (const o of gone) ghost(o, rm, slide, hold)
    for (const el of now) if (!before.has(el.dataset.flipKey)) arrive(el, rm, enterDelay)
    if (hold && !rm) delay = `${hold + 40}ms`   // followers wait for the leaver to go
    flipPlay(root, before, { duration: dur, delay, far })
    if (tick && !rm) setTimeout(() => popCount(tick.key), tick.at)
    if (land && !rm) landBlock(land)
  })
}

function ghost({ el, r, parent, first, after }, rm, slide, hold) {
  const g = el.cloneNode(true)
  g.removeAttribute('data-flip-key'); g.removeAttribute('id')
  g.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'))
  g.setAttribute('aria-hidden', 'true'); g.inert = true
  g.style.pointerEvents = 'none'
  const done = () => g.remove()
  if (rm) {
    if (!parent?.isConnected) return   // its whole card went with it: nothing to hold open
    // In place, in the flow: the list closes up when the fade ends.
    parent.insertBefore(g, after.find(n => n.parentNode === parent) || null)
    const a = g.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: RM_MS, easing: 'linear', fill: 'forwards' })
    if (a) { a.onfinish = done; a.oncancel = done } else done()
    return
  }
  if (!g.animate) return
  Object.assign(g.style, { position: 'fixed', margin: '0', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: '2',
    background: el.classList.contains('plan-current') ? 'linear-gradient(var(--acc-soft),var(--acc-soft)) var(--surface)' : 'var(--surface)' })
  if (first) g.style.borderTopWidth = '0'
  const home = parent?.isConnected ? parent : document.body
  home.appendChild(g)   // a card that emptied is gone: the body holds the ghost
  const dir = document.documentElement.dir === 'rtl' ? -1 : 1
  const a = g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${slide ? 16 * dir : 0}px)` }],
    { duration: 100, delay: hold, easing: 'ease-out', fill: 'both' })
  a.onfinish = done; a.oncancel = done
}

function arrive(el, rm, enterDelay) {
  el.animate?.([{ opacity: 0 }, { opacity: 1 }], rm ? { duration: RM_MS, easing: 'linear' } : { duration: 160, delay: enterDelay, easing: EASE, fill: 'backwards' })
}

// Equality, not a selector: a folder name may hold quotes and backslashes.
const byKey = key => [...document.querySelectorAll('[data-flip-key]')].find(e => e.dataset.flipKey === key)

function popCount(key) {
  const n = byKey(key)?.querySelector('.ss')
  if (!n) return
  n.classList.remove('drop-tick'); void n.offsetWidth
  n.classList.add('drop-tick')
  n.addEventListener('animationend', () => n.classList.remove('drop-tick'), { once: true })
}

function landBlock(key) {
  const b = byKey(key)
  if (!b) return
  b.classList.add('cur-land')
  setTimeout(() => b.classList.remove('cur-land'), 450)   // the end look is the plain look, so the swap is unseen
}
