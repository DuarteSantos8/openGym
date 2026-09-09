import { describe, expect, it, vi } from 'vitest'
import { tappable } from './use-sheet-keyboard.js'

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
