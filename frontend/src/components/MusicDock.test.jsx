// @vitest-environment happy-dom
// The music bar docked above the tab bar: there when a player is chosen, out of the way while a
// rest or a timed set counts, gone while Settings → Features has it off, and the page keeps room
// for it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ S: {}, ui: { timer: null, work: null } }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ S: m.S }) }))
vi.mock('../store/useUI.js', () => ({ useUI: sel => sel(m.ui) }))
vi.mock('./MusicBar.jsx', () => ({ default: ({ source }) => <div className="musicbar">{source}</div> }))

import MusicDock from './MusicDock.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('MusicDock', () => {
  it('shows the bar when a player is chosen, and keeps room for it', () => {
    m.S = { music: 'spotify' }; m.ui = { timer: null, work: null }
    act(() => root.render(<MusicDock />))
    expect(host.querySelector('.music-dock .musicbar').textContent).toBe('spotify')
    expect(document.body.classList.contains('has-music-dock')).toBe(true)
  })

  it('is not there without a player, or while a rest counts', () => {
    m.S = {}; m.ui = { timer: null, work: null }
    act(() => root.render(<MusicDock />))
    expect(host.innerHTML).toBe('')
    m.S = { music: 'spotify' }; m.ui = { timer: { left: 30 }, work: null }
    act(() => root.render(<MusicDock key="2" />))
    expect(host.innerHTML).toBe('')
    expect(document.body.classList.contains('has-music-dock')).toBe(false)
  })

  it('is gone while the bar is turned off, and back with the same player once it is on again', () => {
    m.S = { music: 'spotify', musicBar: false }; m.ui = { timer: null, work: null }
    act(() => root.render(<MusicDock />))
    expect(host.innerHTML).toBe('')
    expect(document.body.classList.contains('has-music-dock')).toBe(false)
    m.S = { music: 'spotify' }
    act(() => root.render(<MusicDock key="2" />))
    expect(host.querySelector('.music-dock .musicbar').textContent).toBe('spotify')
  })
})
