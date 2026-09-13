import { describe, expect, it, vi } from 'vitest'
import { tappable, revealChip } from './use-sheet-keyboard.js'

const keyEvent = (key, target) => {
  const ev = { key, target, currentTarget: target, preventDefault: vi.fn() }
  return ev
}

describe('tappable', () => {
  it('turns a plain onClick into a keyboard-reachable button', () => {
    const onClick = vi.fn()
    const p = tappable(onClick)
    expect(p.role).toBe('button')
    expect(p.tabIndex).toBe(0)
    expect(p.onClick).toBe(onClick)
    const el = {}
    p.onKeyDown(keyEvent('Enter', el))
    expect(onClick).toHaveBeenCalledTimes(1)
    const space = keyEvent(' ', el)
    p.onKeyDown(space)
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(space.preventDefault).toHaveBeenCalled()   // Space must not scroll the page
  })

  it('ignores other keys and keys from nested controls', () => {
    const onClick = vi.fn()
    const p = tappable(onClick)
    const el = {}
    p.onKeyDown(keyEvent('a', el))
    p.onKeyDown(keyEvent('Escape', el))
    expect(onClick).not.toHaveBeenCalled()
    const nested = { key: 'Enter', target: {}, currentTarget: el, preventDefault: vi.fn() }
    p.onKeyDown(nested)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('gives an inert row nothing to react to', () => {
    expect(tappable(undefined)).toEqual({})
  })
})

// A strip is 300px wide showing content from scrollLeft; chips are 80px wide, 8px apart.
const strip = (scrollLeft = 0, width = 300) => ({
  scrollLeft, clientWidth: width,
  getBoundingClientRect: () => ({ left: 20, width })
})
const chipAt = (contentX, strip) => ({
  getBoundingClientRect: () => ({ left: 20 + contentX - strip.scrollLeft, width: 80 })
})

describe('revealChip', () => {
  it('scrolls the strip, and only the strip, until the active chip is inside it', () => {
    const s = strip(0)
    expect(revealChip(s, chipAt(500, s))).toBe(true)
    expect(s.scrollLeft).toBe(500 + 80 + 16 - 300)   // chip's right edge plus the padding at the right edge
    const back = strip(400)
    expect(revealChip(back, chipAt(100, back))).toBe(true)
    expect(back.scrollLeft).toBe(100 - 16)            // padding at the left edge
  })

  it('leaves a visible chip where it is', () => {
    const s = strip(100)
    expect(revealChip(s, chipAt(200, s))).toBe(false)
    expect(s.scrollLeft).toBe(100)
  })

  it('never reaches for the page: no scrollIntoView, nothing without a measurable strip', () => {
    const s = strip(0)
    const chip = Object.assign(chipAt(900, s), { scrollIntoView: vi.fn() })
    revealChip(s, chip)
    expect(chip.scrollIntoView).not.toHaveBeenCalled()
    expect(revealChip(null, chip)).toBe(false)
    expect(revealChip({ scrollLeft: 0, clientWidth: 0, getBoundingClientRect: () => ({ left: 0, width: 0 }) }, chip)).toBe(false)
  })
})
