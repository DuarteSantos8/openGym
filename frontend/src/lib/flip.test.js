// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { flipMeasure, flipPlay, FLIP_MAX } from './flip.js'

// Rows stack 50 px apart in the order of the DOM, so a re-order is a real change of place.
function setup(n) {
  document.body.innerHTML = '<div id="r"></div>'
  const root = document.getElementById('r')
  const rows = []
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div')
    el.dataset.flipKey = 'k' + i
    root.appendChild(el); rows.push(el)
  }
  const place = () => [...root.children].forEach((el, i) => {
    const live = /translate\(0px, ?(-?\d+)px\)/.exec(el.style.transform)
    el.getBoundingClientRect = () => ({ left: 0, top: i * 50 + (live ? +live[1] : 0) })
  })
  place()
  return { root, rows, place }
}
afterEach(() => { document.documentElement.className = ''; document.body.innerHTML = '' })

describe('flip', () => {
  it('moves a row from its old place with a transform-only transition', () => {
    const { root, rows, place } = setup(3)
    const before = flipMeasure(root)
    root.appendChild(rows[0]); place()   // k0 goes from 0 to 100
    flipPlay(root, before)
    expect(rows[0].style.transition).toMatch(/^transform /)
    expect(rows[0].style.transform).toBe('')           // released: it plays toward its place
    expect(rows[1].style.transition).toMatch(/^transform /)   // k1 moved up 50 and plays too
  })

  it('starts the row at the old place before letting go', () => {
    const { root, rows, place } = setup(2)
    const before = flipMeasure(root)
    root.appendChild(rows[0]); place()
    const seen = []
    const orig = rows[1].getBoundingClientRect
    rows[1].getBoundingClientRect = function () { seen.push(rows[1].style.transform); return orig() }
    flipPlay(root, before)
    expect(seen).toContain('translate(0px,50px)')   // k1 sat 50 px lower; the start is committed before it is released
  })

  it('animates at most 12 rows; the rest switch', () => {
    const { root, rows, place } = setup(20)
    const before = flipMeasure(root)
    rows.reverse().forEach(r => root.appendChild(r)); place()
    flipPlay(root, before)
    const animated = rows.filter(r => r.style.transition.startsWith('transform')).length
    expect(animated).toBe(FLIP_MAX)
  })

  it('does nothing under html.reduce-motion: no transform, no transition', () => {
    const { root, rows, place } = setup(3)
    document.documentElement.classList.add('reduce-motion')
    const before = flipMeasure(root)
    root.appendChild(rows[0]); place()
    flipPlay(root, before)
    for (const r of rows) { expect(r.style.transform).toBe(''); expect(r.style.transition).toBe('') }
  })

  it('does nothing under the OS setting', () => {
    const { root, rows, place } = setup(3)
    const real = window.matchMedia
    window.matchMedia = () => ({ matches: true })
    try {
      const before = flipMeasure(root)
      root.appendChild(rows[0]); place()
      flipPlay(root, before)
      for (const r of rows) expect(r.style.transition).toBe('')
    } finally { window.matchMedia = real }
  })

  it('a second flip in flight starts from where the row is now', () => {
    const { root, rows, place } = setup(2)
    flipPlay(root, new Map())                       // empty before: nothing happens
    const b1 = flipMeasure(root)
    root.appendChild(rows[0]); place()
    flipPlay(root, b1)
    rows[0].style.transform = 'translate(0px,-20px)'; place()   // caught mid-flight
    const b2 = flipMeasure(root)
    expect(b2.get('k0').y).toBe(50 - 20)
  })

  it('a child bubbled transitionend keeps the transition; transitioncancel clears it', () => {
    const { root, rows, place } = setup(2)
    const before = flipMeasure(root)
    root.appendChild(rows[0]); place()
    flipPlay(root, before)
    const child = document.createElement('button'); rows[0].appendChild(child)
    child.dispatchEvent(new Event('transitionend', { bubbles: true }))
    expect(rows[0].style.transition).toMatch(/^transform /)
    rows[0].dispatchEvent(new Event('transitioncancel'))
    expect(rows[0].style.transition).toBe('')
  })

  it('a second flip on the same row is not ended by the first flip\'s late transitioncancel', () => {
    const { root, rows, place } = setup(2)
    const b1 = flipMeasure(root)
    root.appendChild(rows[0]); place()
    flipPlay(root, b1)
    const b2 = flipMeasure(root)
    root.insertBefore(rows[0], root.firstChild); place()
    const late = new Event('transitioncancel')   // born when flip one was cancelled, delivered after flip two began
    const t = late.timeStamp; while (performance.now() <= t + 0.01) { /* let the clock move on */ }
    flipPlay(root, b2)
    rows[0].dispatchEvent(late)   // the browser's late cancel of flip one
    expect(rows[0].style.transition).toMatch(/^transform /)
    rows[0].dispatchEvent(new Event('transitioncancel'))   // flip two's own end
    expect(rows[0].style.transition).toBe('')
  })
})
