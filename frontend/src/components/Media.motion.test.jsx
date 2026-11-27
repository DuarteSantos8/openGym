// @vitest-environment happy-dom
// An exercise's animation opens on its still under the system's reduced motion, and its
// "tap to pause" hint is a named button the keyboard and a screen reader can reach.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Media from './Media.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: { gifSize: 'full' }, update: () => {} })
  const useStore = selector => selector(snap())
  useStore.getState = snap
  return { useStore }
})

const EX = { id: 'bench', n: 'bench press', gif: 'bench.gif', img: 'bench.jpg' }
let host, root, reduce
beforeEach(() => {
  reduce = false
  vi.spyOn(window, 'matchMedia').mockImplementation(q => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
const mount = () => act(() => root.render(<Media ex={EX} />))
const hint = () => host.querySelector('.gifhint')
const src = () => host.querySelector('img').getAttribute('src')
const key = k => act(() => hint().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

describe('exercise animation', () => {
  it('plays, and its hint is a focusable button named for what it does', () => {
    mount()
    expect(src()).toContain('bench.gif')
    expect(hint().getAttribute('role')).toBe('button')
    expect(hint().tabIndex).toBe(0)
    expect(hint().getAttribute('aria-label')).toBe('Pause animation')
  })

  it('Enter and Space toggle it', () => {
    mount()
    key('Enter')
    expect(hint().getAttribute('aria-label')).toBe('Play animation')
    expect(src()).not.toContain('bench.gif')
    key(' ')
    expect(hint().getAttribute('aria-label')).toBe('Pause animation')
    expect(src()).toContain('bench.gif')
  })

  it('opens on the still under reduced motion, and a tap plays it', () => {
    reduce = true
    mount()
    expect(src()).not.toContain('bench.gif')
    expect(hint().getAttribute('aria-label')).toBe('Play animation')
    act(() => hint().click())
    expect(hint().getAttribute('aria-label')).toBe('Pause animation')
    expect(src()).toContain('bench.gif')
  })
})
