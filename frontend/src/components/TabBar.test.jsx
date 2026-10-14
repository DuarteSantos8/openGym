// @vitest-environment happy-dom
// The tab bar is fixed on screen and re-renders on every store write — once a second for the
// whole of a rest. Its buttons must survive that: a component declared inside the render body is
// a new function each time, which React reads as a different type and rebuilds from scratch.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

const nav = vi.hoisted(() => ({ switchTab: vi.fn(), popToRoot: vi.fn(), switching: false }))
vi.mock('../lib/use-tab-nav.js', () => ({
  switchTab: nav.switchTab, popToRoot: nav.popToRoot, isSwitching: () => nav.switching,
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, originalUser, frames

beforeEach(() => {
  const store = useStore.getState()
  originalS = store.S
  originalUser = store.user
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 1, name: 'test' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  nav.switchTab.mockClear(); nav.popToRoot.mockClear(); nav.switching = false
  // Frames run only when a test says so: what the first paint looks like stays observable.
  frames = []
  window.requestAnimationFrame = vi.fn(cb => { frames.push(cb); return frames.length })
  window.cancelAnimationFrame = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState({ S: originalS, user: originalUser })
})

const buttons = () => [...host.querySelectorAll('#tabbar button')]
const bar = props => <TabBar tab="home" lit onPlus={() => {}} {...props} />
const runFrames = () => act(() => { const due = frames; frames = []; due.forEach(cb => cb()) })
const pillSlot = () => host.querySelector('.tab-pill-slot')
const slot = () => pillSlot().style.getPropertyValue('--slot')
const running = () => useStore.getState().update(s => { s.active = { id: 'a', name: 'Push A', entries: [], cur: 0, start: Date.now() - 60_000 } }, false)

describe('the bar', () => {
  it('is Home · Training · + · Nutrition · Progress', () => {
    act(() => { root.render(bar()) })
    const icon = el => el.querySelector('svg')?.getAttribute('data-icon')
    expect(buttons().map(b => b.textContent)).toEqual(['Home', 'Training', '', 'Nutrition', 'Progress'])
    expect(buttons().map(icon)).toEqual(['house', 'dumbbell', 'plus', 'utensils', 'chart'])
    expect(buttons()[2].getAttribute('aria-label')).toBe('Add')
    expect(buttons()[2].getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('keeps the very same buttons across a store write', () => {
    act(() => { root.render(bar()) })
    const before = buttons()
    act(() => { useStore.getState().update(s => { s.restSec = 91 }, false) })
    buttons().forEach((el, i) => expect(el).toBe(before[i]))
  })

  it('lights the tab on screen, and none on a page every tab can open', () => {
    act(() => { root.render(bar({ tab: 'progress' })) })
    expect(buttons().map(b => b.getAttribute('aria-current'))).toEqual([null, null, null, null, 'page'])
    act(() => { root.render(bar({ tab: 'progress', lit: false })) })
    expect(buttons().every(b => !b.getAttribute('aria-current'))).toBe(true)
  })

  it('switches to another tab, and takes the tab on screen back to its root', () => {
    act(() => { root.render(bar({ tab: 'train' })) })
    act(() => { buttons()[3].click() })
    expect(nav.switchTab).toHaveBeenCalledWith('food')
    act(() => { buttons()[1].click() })
    expect(nav.popToRoot).toHaveBeenCalledWith('train')
  })

  it('does nothing while a switch is rebuilding the history: tabs and + both', () => {
    const onPlus = vi.fn()
    act(() => { root.render(bar({ onPlus })) })
    nav.switching = true
    act(() => { buttons()[1].click(); buttons()[2].click() })
    expect(nav.switchTab).not.toHaveBeenCalled()
    expect(onPlus).not.toHaveBeenCalled()
    nav.switching = false
    act(() => { buttons()[2].click() })
    expect(onPlus).toHaveBeenCalledOnce()
  })

  it('shows the live dot on Training while a workout runs, and names it', () => {
    act(() => { root.render(bar()) })
    expect(host.querySelector('.live-dot')).toBeNull()
    act(() => { running() })
    expect(buttons()[1].querySelector('.live-dot')).not.toBeNull()
    expect(buttons()[1].getAttribute('aria-label')).toBe('Training, workout in progress')
    // The + stays the +: it is never a Resume button.
    expect(buttons()[2].className).toBe('start')
  })
})

describe('the sliding pill', () => {
  it('maps the four tabs onto the five slots, skipping the +', () => {
    const want = { home: '0', train: '1', food: '3', progress: '4' }
    for (const [tab, s] of Object.entries(want)) {
      act(() => { root.render(bar({ tab })) })
      expect(slot(), tab).toBe(s)
    }
  })

  it('does not slide on its first paint, only once two frames have gone by', () => {
    act(() => { root.render(bar({ tab: 'food' })) })
    const track = () => host.querySelector('.tab-pill-track')
    expect(track().className).toBe('tab-pill-track')
    runFrames()
    expect(track().className).toBe('tab-pill-track')
    runFrames()
    expect(track().className).toBe('tab-pill-track ready')
  })

  it('slides within one side of the +, and jumps across it rather than passing under it', () => {
    act(() => { root.render(bar({ tab: 'home' })) })
    const pill = () => host.querySelector('.tab-pill')
    const first = pill()
    act(() => { root.render(bar({ tab: 'train' })) })
    expect(pillSlot().classList.contains('jump')).toBe(false)
    expect(pill()).toBe(first)               // the same pill, slid
    act(() => { root.render(bar({ tab: 'food' })) })
    expect(pillSlot().classList.contains('jump')).toBe(true)
    expect(pill()).not.toBe(first)           // a fresh one, fading in at Nutrition
  })

  it('with no tab lit fades out where it is, and comes back from there', () => {
    act(() => { root.render(bar({ tab: 'progress' })) })
    act(() => { root.render(bar({ tab: 'progress', lit: false })) })
    expect(pillSlot().classList.contains('off')).toBe(true)
    expect(slot()).toBe('4')                 // not flashed over to the first slot
    act(() => { root.render(bar({ tab: 'progress' })) })
    expect(pillSlot().classList.contains('off')).toBe(false)
    expect(slot()).toBe('4')
  })

  it('is decorative', () => {
    act(() => { root.render(bar()) })
    expect(host.querySelector('.tab-pill-track').getAttribute('aria-hidden')).toBe('true')
  })
})
