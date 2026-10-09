import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WorkoutScrollAnchor from './WorkoutScrollAnchor.jsx'

let root, container, dom, scrollY, pageHeight
const height = () => pageHeight + (parseFloat(container.firstChild?.style.paddingBottom) || 0)
const tileTop = key => container.querySelector(`[data-unit-key="${key}"]`).getBoundingClientRect().top

beforeEach(() => {
  dom = parseHTML('<html><body><div id="root"></div></body></html>').window
  globalThis.window = dom
  globalThis.document = dom.document
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  scrollY = 800; pageHeight = 2400
  dom.innerHeight = 600; dom.scrollX = 0
  Object.defineProperty(dom, 'scrollY', { configurable: true, get: () => Math.min(scrollY, Math.max(0, height() - 600)) })
  Object.defineProperty(document.body, 'scrollHeight', { configurable: true, get: height })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: height })
  dom.scrollTo = vi.fn(({ top }) => { scrollY = top })
  dom.Element.prototype.getBoundingClientRect = function () {
    if (this.className === 'whdr') return { top: 0, bottom: 80 }
    const offset = document.body.style.position === 'fixed' ? parseFloat(document.body.style.top) : -window.scrollY
    const top = Number(this.dataset.top || 0) + offset + (parseFloat(this.style.marginTop) || 0)
    return { top, bottom: top + Number(this.dataset.height || 0) }
  }
  container = document.getElementById('root')
  root = createRoot(container)
})

afterEach(async () => { await act(async () => { root.unmount() }) })

async function render(collapsed, tiles, nextHeight = pageHeight) {
  // Changing height during commit models the browser clamping scrollY when the page shrinks.
  const committed = el => { if (el) pageHeight = nextHeight }
  await act(async () => {
    root.render(<WorkoutScrollAnchor collapsed={collapsed}>
      <div className="whdr" />
      <div className="workout-list" ref={committed}>
        {tiles.map(([key, top, height]) => <section className="wl-unit" key={key} data-unit-key={key} data-top={top} data-height={height} />)}
      </div>
    </WorkoutScrollAnchor>)
  })
}

it('keeps the visible tile at the same pixel when a completed tile above it collapses', async () => {
  await render('', [['0', 100, 700], ['1', 800, 650]])
  const top = tileTop('1')
  await render('0', [['0', 100, 200], ['1', 300, 650]])
  expect(tileTop('1')).toBe(top)
  expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 300, left: 0, behavior: 'instant' })
})

it('keeps a partly visible next tile still when the topmost tile itself is collapsing', async () => {
  scrollY = 600
  await render('', [['0', 100, 700], ['1', 800, 650]])
  const top = tileTop('1')
  await render('0', [['0', 100, 200], ['1', 300, 650]])
  expect(tileTop('1')).toBe(top)
})

it('reserves only enough space to avoid a page-end clamp, then reclaims it on expansion', async () => {
  await render('', [['0', 100, 700], ['1', 800, 400]], 1400)
  const top = tileTop('1')
  await render('0', [['0', 100, 100], ['1', 200, 400]], 700)
  expect(tileTop('1')).toBe(top)
  expect(container.firstChild.style.paddingBottom).toBe('100px')
  await render('', [['0', 100, 700], ['1', 800, 400]], 1400)
  expect(tileTop('1')).toBe(top)
  expect(container.firstChild.style.paddingBottom).toBe('')
})

it('holds the next tile at the page start when shrinking would require a negative scroll offset', async () => {
  scrollY = 400
  await render('', [['0', 100, 700], ['1', 800, 650]])
  const top = tileTop('1')
  await render('0', [['0', 100, 100], ['1', 200, 650]])
  expect(tileTop('1')).toBe(top)
  expect(window.scrollY).toBe(0)
  expect(container.querySelector('[data-unit-key="1"]').style.marginTop).toBe('200px')
  const firstTop = tileTop('0')
  await render('', [['0', 100, 700], ['1', 800, 650]])
  expect(tileTop('0')).toBe(firstTop)
  expect(container.querySelector('[data-unit-key="1"]').style.marginTop).toBe('')
})

it('updates the locked body offset while the Layout sheet is open', async () => {
  document.body.style.position = 'fixed'; document.body.style.top = '-800px'
  await render('', [['0', 100, 700], ['1', 800, 650]])
  const top = tileTop('1')
  await render('0', [['0', 100, 200], ['1', 300, 650]])
  expect(tileTop('1')).toBe(top)
  expect(document.body.style.top).toBe('-300px')
  expect(window.scrollTo).not.toHaveBeenCalled()
})

it('does not scroll when a collapse below the viewport leaves its top unchanged', async () => {
  await render('', [['0', 100, 700], ['1', 800, 650], ['2', 1500, 700]])
  await render('2', [['0', 100, 700], ['1', 800, 650], ['2', 1500, 100]])
  expect(window.scrollTo).not.toHaveBeenCalled()
})

it('ignores unrelated updates and mounting a restored collapsed session', async () => {
  await render('0', [['0', 100, 100], ['1', 200, 1000]])
  await render('0', [['0', 100, 100], ['1', 200, 1000]])
  expect(window.scrollTo).not.toHaveBeenCalled()
})

it('cancels an older sheet correction when restoring the workout anchor', async () => {
  const cancel = vi.fn()
  window.addEventListener('workout-scroll-anchor', cancel)
  await render('', [['0', 100, 700], ['1', 800, 650]])
  await render('0', [['0', 100, 200], ['1', 300, 650]])
  expect(cancel).toHaveBeenCalledOnce()
})
