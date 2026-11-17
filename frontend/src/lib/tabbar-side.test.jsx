// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WIDE_QUERY, useWideScreen } from './tabbar-side.js'

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

// The rail's rules in index.css: at the top level, so every screen gets them (a merge once lost the
// brace closing the media query before them, and the rail applied only at 360px or less), with the
// names under the icons hidden for the eye only, and Back to top kept off the rail.
describe('the stylesheet of the rail', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const depthAt = i => [...css.slice(0, i)].reduce((d, c) => d + (c === '{') - (c === '}'), 0)

  it('stands outside every @media, and the file closes every brace it opens', () => {
    expect(depthAt(css.length)).toBe(0)
    expect(depthAt(css.indexOf('body.tabbar-side{'))).toBe(0)
  })

  it('hides the names under the icons from the eye only', () => {
    const short = css.slice(css.indexOf('@media (max-height:480px){\n  body.tabbar-side'))
    const rule = /span:not\(\.tab-ic\):not\(\.cir\)\{([^}]*)\}/.exec(short)[1]
    expect(rule).not.toMatch(/display:\s*none/)
    expect(rule).toMatch(/position:absolute/)
    expect(rule).toMatch(/clip-path:inset\(50%\)/)
  })

  it('keeps Back to top off the rail', () => {
    expect(css).toMatch(/body\.tabbar-side #totop,body\.tabbar-side\.resting #totop\{left:auto;right:max\(calc\(var\(--rail\) \+ 16px\)/)
  })
})
