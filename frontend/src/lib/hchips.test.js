// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { installChipDrag } from './hchips.js'

// A real .chips element with overridable scroll geometry and a clamping scrollLeft.
const mountStrip = ({ scrollWidth = 800, clientWidth = 300 } = {}) => {
  document.body.innerHTML = '<div class="chips"><button class="chip">a</button></div>'
  const row = document.querySelector('.chips')
  Object.defineProperties(row, {
    scrollWidth: { value: scrollWidth, configurable: true },
    clientWidth: { value: clientWidth, configurable: true },
  })
  let left = 0
  Object.defineProperty(row, 'scrollLeft', {
    get() { return left },
    set(v) { left = Math.max(0, Math.min(v, scrollWidth - clientWidth)) },
    configurable: true,
  })
  return row
}

const pointer = (type, opts = {}) => new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, ...opts,
})

let stop = () => {}
afterEach(() => { stop(); stop = () => {}; document.body.className = ''; document.body.innerHTML = '' })

describe('installChipDrag', () => {
  const drag = (chip, ...xs) => {
    chip.dispatchEvent(pointer('pointerdown', { clientX: xs[0] }))
    for (const x of xs.slice(1)) window.dispatchEvent(pointer('pointermove', { clientX: x }))
  }

  it('pulls the strip along once the press passes the slop threshold', () => {
    const row = mountStrip()
    stop = installChipDrag(document)
    const chip = document.querySelector('.chip')

    drag(chip, 200, 197)                       // 3px — still a click, nothing moves
    expect(row.scrollLeft).toBe(0)
    expect(document.body.classList.contains('chips-dragging')).toBe(false)

    window.dispatchEvent(pointer('pointermove', { clientX: 140 }))   // now 60px left
    expect(row.scrollLeft).toBe(60)
    expect(document.body.classList.contains('chips-dragging')).toBe(true)

    window.dispatchEvent(pointer('pointerup', { clientX: 140 }))
    expect(document.body.classList.contains('chips-dragging')).toBe(false)
  })

  it('swallows the click that follows a real drag, but not a plain click', () => {
    const row = mountStrip()
    stop = installChipDrag(document)
    const chip = document.querySelector('.chip')

    // plain click through (tiny move, released)
    drag(chip, 100, 102)
    window.dispatchEvent(pointer('pointerup', { clientX: 102 }))
    const plain = pointer('click')
    chip.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)

    // real drag, then its trailing click is eaten
    drag(chip, 300, 260, 220)
    expect(row.scrollLeft).toBe(80)
    window.dispatchEvent(pointer('pointerup', { clientX: 220 }))
    const ghost = pointer('click')
    chip.dispatchEvent(ghost)
    expect(ghost.defaultPrevented).toBe(true)

    // and only that one click
    const next = pointer('click')
    chip.dispatchEvent(next)
    expect(next.defaultPrevented).toBe(false)
  })

  it('leaves touch and non-overflowing rows alone', () => {
    const row = mountStrip()
    stop = installChipDrag(document)
    const chip = document.querySelector('.chip')

    chip.dispatchEvent(pointer('pointerdown', { clientX: 200, pointerType: 'touch' }))
    window.dispatchEvent(pointer('pointermove', { clientX: 120, pointerType: 'touch' }))
    expect(row.scrollLeft).toBe(0)

    const tight = mountStrip({ scrollWidth: 280, clientWidth: 300 })
    drag(document.querySelector('.chip'), 200, 120)
    expect(tight.scrollLeft).toBe(0)
  })

  it('marks an overflowing row with data-xscroll on hover, clears it otherwise', () => {
    const row = mountStrip()
    stop = installChipDrag(document)
    document.querySelector('.chip').dispatchEvent(pointer('pointerover'))
    expect(row.hasAttribute('data-xscroll')).toBe(true)

    const tight = mountStrip({ scrollWidth: 200, clientWidth: 300 })
    document.querySelector('.chip').dispatchEvent(pointer('pointerover'))
    expect(tight.hasAttribute('data-xscroll')).toBe(false)
  })

  it('teardown removes the listeners', () => {
    const row = mountStrip()
    const off = installChipDrag(document)
    off()
    const chip = document.querySelector('.chip')
    chip.dispatchEvent(pointer('pointerdown', { clientX: 300 }))
    window.dispatchEvent(pointer('pointermove', { clientX: 200 }))
    expect(row.scrollLeft).toBe(0)
  })
})
