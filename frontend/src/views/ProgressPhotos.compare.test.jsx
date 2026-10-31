// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '../store/useUI.js'
// The photos are in the media store, which a test has not: every photo gets an address of its own.
vi.mock('../components/CustomMedia.jsx', async orig => ({ ...(await orig()), useMediaUrl: m => ({ url: m ? 'blob:' + m.hash : null }) }))
import { openProgressCompare } from './ProgressPhotos.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const photo = (d, n, w = 300, h = 400) => ({ d, m: { kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg', width: w, height: h } })

describe('before/after compare in a right-to-left language', () => {
  let root, host
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    document.documentElement.removeAttribute('dir')
    useUI.getState().closeAll()
  })

  it('keeps the stage left-to-right so the handle follows the finger and "before" sits on the before photo', () => {
    document.documentElement.setAttribute('dir', 'rtl')
    openProgressCompare(photo('2026-01-01', 1), photo('2026-03-01', 2))
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))
    act(() => host.querySelectorAll('.pp-modes button')[1].click())
    const stage = host.querySelector('.pp-compare')
    expect(stage).not.toBeNull()
    expect(stage.getAttribute('dir')).toBe('ltr')
  })
})

describe('comparing more than two photos', () => {
  let root, host
  const mount = (...photos) => {
    openProgressCompare(...photos)
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))
  }
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    useUI.getState().closeAll()
  })

  it('puts three photos in one row, earliest first, each with its date and no layout choice', () => {
    mount(photo('2026-03-01', 3), photo('2026-01-01', 1), photo('2026-02-01', 2))
    expect(host.querySelector('.pp-compare')).toBeNull()
    expect(host.querySelectorAll('.pp-cell')).toHaveLength(3)
    expect(host.querySelector('.pp-grid').style.getPropertyValue('--cols')).toBe('3')
    expect(host.querySelectorAll('.pp-cell .pp-label')).toHaveLength(3)           // each date is a pill on its photo
    expect(host.querySelector('.pp-modes')).toBeNull()
  })

  it('lets a pair switch between side by side (first) and the slider', () => {
    mount(photo('2026-01-01', 1), photo('2026-03-01', 2))
    const buttons = () => [...host.querySelectorAll('.pp-modes button')]
    expect(buttons()).toHaveLength(2)
    expect(host.querySelectorAll('.pp-cell')).toHaveLength(2)
    expect(host.querySelector('.pp-handle')).toBeNull()
    act(() => buttons()[1].click())
    expect(host.querySelector('.pp-handle')).not.toBeNull()
    expect(host.querySelector('.pp-grid')).toBeNull()
  })

  it('takes the photos as one array too, and keeps five at most', () => {
    mount([1, 2, 3, 4, 5, 6].map(i => photo('2026-0' + i + '-01', i)))
    expect(host.querySelectorAll('.pp-cell')).toHaveLength(5)
  })

  it('has a share button in the bar, for a pair and for more', () => {
    mount(photo('2026-01-01', 1), photo('2026-03-01', 2))
    expect(host.querySelector('.mviewer-bar button[aria-label="Share"]')).not.toBeNull()
    act(() => root.unmount())
    host.remove()
    mount(photo('2026-01-01', 1), photo('2026-02-01', 2), photo('2026-03-01', 3))
    expect(host.querySelector('.mviewer-bar button[aria-label="Share"]')).not.toBeNull()
  })

  describe('the cells', () => {
    const cells = () => [...host.querySelectorAll('.pp-cell')]
    const press = (el, type, init) => act(() => { el.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), init)) })
    const pos = el => el.querySelector('.pp-img').style.objectPosition

    it('are all of the same shape, so the same height, even for photos of other shapes', () => {
      mount(photo('2026-01-01', 1, 300, 400), photo('2026-02-01', 2, 300, 400), photo('2026-03-01', 3, 400, 300))
      const ratios = cells().map(c => c.style.aspectRatio)
      expect(new Set(ratios).size).toBe(1)
      expect(parseFloat(ratios[0])).toBeCloseTo(300 / 400)                  // the middle shape, 3:4 portrait
    })

    it('start centred, and a photo is dragged to choose which part of it shows', () => {
      Element.prototype.getBoundingClientRect = () => ({ width: 150, height: 200, top: 0, left: 0, right: 150, bottom: 200 })
      mount(photo('2026-01-01', 1, 300, 400), photo('2026-02-01', 2, 300, 400), photo('2026-03-01', 3, 400, 300))
      const wide = cells()[2]
      expect(pos(wide)).toBe('50% 50%')
      const room = 400 * (200 / 300) - 150                              // how far a 4:3 photo can move in a 3:4 cell
      press(wide, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
      press(wide, 'pointermove', { pointerId: 1, clientX: 100 + room / 4, clientY: 100 })
      expect(pos(wide)).toBe('25% 50%')                                 // dragged right: shows more of its left
      press(wide, 'pointerup', { pointerId: 1 })
      press(wide, 'pointermove', { pointerId: 1, clientX: 0, clientY: 0 })
      expect(pos(wide)).toBe('25% 50%')                                 // no drag in progress: nothing moves
    })

    it('a photo of the cell\'s own shape has nothing to drag, and one photo moving leaves the others', () => {
      Element.prototype.getBoundingClientRect = () => ({ width: 150, height: 200, top: 0, left: 0, right: 150, bottom: 200 })
      mount(photo('2026-01-01', 1, 300, 400), photo('2026-02-01', 2, 300, 400), photo('2026-03-01', 3, 400, 300))
      const whole = cells()[0]
      press(whole, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
      press(whole, 'pointermove', { pointerId: 1, clientX: 90, clientY: 90 })
      expect(pos(whole)).toBe('50% 50%')
      const wide = cells()[2]
      press(wide, 'pointerdown', { pointerId: 2, clientX: 0, clientY: 0 })
      press(wide, 'pointermove', { pointerId: 2, clientX: 40, clientY: 0 })
      expect(pos(wide)).not.toBe('50% 50%')
      expect(cells().slice(0, 2).map(pos)).toEqual(['50% 50%', '50% 50%'])
    })

    it('keep their place when the layout is switched and back', () => {
      Element.prototype.getBoundingClientRect = () => ({ width: 150, height: 200, top: 0, left: 0, right: 150, bottom: 200 })
      mount(photo('2026-01-01', 1, 400, 300), photo('2026-03-01', 2, 300, 400))
      press(cells()[0], 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
      press(cells()[0], 'pointermove', { pointerId: 1, clientX: 120, clientY: 100 })
      const moved = pos(cells()[0])
      expect(moved).not.toBe('50% 50%')
      const modes = () => [...host.querySelectorAll('.pp-modes button')]
      act(() => modes()[1].click())                                      // the slider
      act(() => modes()[0].click())                                      // side by side again
      expect(pos(cells()[0])).toBe(moved)
    })

    it('say the date as a short pill, with the year only when it is not this year', () => {
      const year = new Date().getFullYear()
      mount(photo(year + '-01-05', 1), photo(year + '-03-09', 2))
      const text = () => [...host.querySelectorAll('.pp-cell .pp-label')].map(e => e.textContent)
      expect(text().every(t => !t.includes(String(year)))).toBe(true)
      act(() => root.unmount()); host.remove()
      mount(photo((year - 1) + '-12-30', 1), photo(year + '-03-09', 2))
      expect(text().every(t => /\d{4}/.test(t))).toBe(true)
    })
  })
})

