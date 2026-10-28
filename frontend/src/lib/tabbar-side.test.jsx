// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { WIDE_QUERY, tabbarOnSide, useWideScreen } from './tabbar-side.js'

// A screen that turns: matchMedia answers for WIDE_QUERY and tells its listeners when it changes.
function screen(wide) {
  const listeners = new Set()
  const mq = { get matches() { return wide }, addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) }
  window.matchMedia = q => (q === WIDE_QUERY ? mq : { matches: false })
  return { turn(to) { wide = to; listeners.forEach(f => f()) }, listeners }
}

function mount() {
  const seen = []
  const Probe = () => { seen.push(useWideScreen()); return null }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  return { last: () => seen[seen.length - 1], unmount: () => act(() => root.unmount()) }
}

describe('where the tab bar stands', () => {
  afterEach(() => { delete window.matchMedia })

  it('on the right on a screen wider than it is tall, below the computer layout', () => {
    expect(WIDE_QUERY).toBe('(min-aspect-ratio: 1/1) and (max-width: 999px)')
  })

  it('follows the screen as it turns, and lets go of it on unmount', () => {
    const s = screen(false)
    const m = mount()
    expect(m.last()).toBe(false)
    act(() => s.turn(true))
    expect(m.last()).toBe(true)
    act(() => s.turn(false))
    expect(m.last()).toBe(false)
    m.unmount()
    expect(s.listeners.size).toBe(0)
  })

  it('stays at the bottom where there is no matchMedia', () => {
    const m = mount()
    expect(m.last()).toBe(false)
    m.unmount()
  })
})

describe('Settings → Look & Home → Tab bar', () => {
  it('automatic (the default, and an older profile without the key): on the right only on a wide screen', () => {
    for (const pref of ['auto', undefined, null]) {
      expect(tabbarOnSide(pref, true)).toBe(true)
      expect(tabbarOnSide(pref, false)).toBe(false)
    }
  })

  it('bottom and right are kept whatever the screen', () => {
    expect(tabbarOnSide('bottom', true)).toBe(false)
    expect(tabbarOnSide('right', false)).toBe(true)
  })
})
