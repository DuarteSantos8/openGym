// @vitest-environment happy-dom
// The live workout bar: one button above the tab bar while a workout runs (lib/live-bar.js decides
// what it says, this draws it).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LiveBar from './LiveBar.jsx'
import * as sound from '../lib/sound.js'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const mocks = vi.hoisted(() => ({ loc: { pathname: '/home' }, nav: vi.fn(), snap: { rows: [], checking: false } }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav, useLocation: () => mocks.loc }))
vi.mock('../lib/device-link-live.js', () => ({ linkSnapshot: () => mocks.snap, onLinkChange: () => () => {} }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const set = (over = {}) => ({ w: 60, r: 8, done: false, ...over })
const entry = (id, sets) => ({ id, target: { mode: 'reps', name: id.toUpperCase(), restSec: 120 }, sets })
const active = (over = {}) => ({
  id: 'w1', name: 'Push day', start: Date.now() - 60e3, cur: 0,
  entries: [entry('bench', [set({ done: true }), set(), set(), set()]), entry('fly', [set()])], ...over,
})

let host, root, originalS, originalUser
const seed = a => act(() => { useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), active: a } }) })
const bar = () => host.querySelector('#livebar')
const text = () => bar()?.textContent || ''

beforeEach(() => {
  originalS = useStore.getState().S
  originalUser = useStore.getState().user
  useStore.setState({ user: { id: 1, name: 'test' } })
  mocks.loc = { pathname: '/home' }
  mocks.snap = { rows: [], checking: false }
  mocks.nav.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  act(() => { useUI.setState({ timer: null }) })
  useStore.setState({ S: originalS, user: originalUser })
})

const render = () => act(() => { root.render(<LiveBar />) })

describe('the live bar', () => {
  it('shows nothing with no workout, and nothing on the workout screen', () => {
    seed(null); render()
    expect(bar()).toBeNull()
    seed(active()); mocks.loc = { pathname: '/workout' }; render()
    expect(bar()).toBeNull()
  })

  it('lifting: routine, exercise, set, and a label that starts and ends as it should', () => {
    seed(active()); render()
    expect(text()).toContain('Push day')
    expect(text()).toContain('BENCH')
    expect(text()).toContain('Set 2 of 4')
    const label = bar().getAttribute('aria-label')
    expect(label.startsWith('Workout in progress')).toBe(true)
    expect(label.endsWith('Opens the workout')).toBe(true)
    expect(label).toContain('1 of 5 sets done')
  })

  it('rest: the word, a countdown, what is next, and no set label', () => {
    seed(active())
    act(() => { useUI.setState({ timer: { left: 72, total: 90, endsAt: Date.now() + 72e3 } }) })
    render()
    expect(text()).toContain('Rest')
    expect(text()).toContain('1:12')
    expect(text()).toContain('Next: BENCH')
    expect(bar().getAttribute('aria-label')).toContain('Next: BENCH')
    expect(text()).not.toContain('Set 2 of 4')
  })

  it('a switch-sides rest says so, in the text and the label', () => {
    seed(active())
    act(() => { useUI.setState({ timer: { left: 20, total: 30, endsAt: Date.now() + 20e3, kind: 'switch' } }) })
    render()
    expect(text()).toContain('Switch sides')
    expect(text()).not.toContain('Rest')
    expect(bar().getAttribute('aria-label')).toContain('Switch sides')
  })

  it('an unnamed, empty workout reads "Workout" with no undefined or NaN', () => {
    seed(active({ name: '', entries: [] })); render()
    expect(text()).toContain('Workout')
    expect(text() + bar().getAttribute('aria-label')).not.toMatch(/undefined|NaN/)
  })

  it('every set done: "All sets done"', () => {
    seed(active({ entries: [entry('bench', [set({ done: true })])] })); render()
    expect(text()).toContain('All sets done')
  })

  it('no watch and no pulse: no device mark, no pulse slot', () => {
    seed(active()); render()
    expect(host.querySelector('.livebar-hr')).toBeNull()
    expect(host.querySelector('.livebar-dev')).toBeNull()
  })

  it('a linked watch shows the mark and reserves the pulse slot', () => {
    mocks.snap = { rows: [{ id: 'watch', kind: 'apple', state: 'live' }], checking: false }
    seed(active()); render()
    expect(host.querySelector('.livebar-dev')).not.toBeNull()
    expect(host.querySelector('.livebar-hr')).not.toBeNull()
    expect(bar().getAttribute('aria-label')).toContain('Watch connected')
  })

  it('a tap goes to the workout', () => {
    seed(active()); render()
    act(() => { bar().click() })
    expect(mocks.nav).toHaveBeenCalledWith('/workout', { state: { rise: 'rise' } })
  })

  it('puts has-livebar on the body while it shows and takes it off on unmount', () => {
    seed(active()); render()
    expect(document.body.classList.contains('has-livebar')).toBe(true)
    act(() => root.unmount())
    expect(document.body.classList.contains('has-livebar')).toBe(false)
    root = createRoot(host)
  })

  it('brings the set label back when a shorter exercise replaces a long one', () => {
    // happy-dom does no layout: say a name with LONG in it is clipped.
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () { return this.textContent.includes('LONG') ? 200 : 0 })
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
    try {
      seed(active({ entries: [entry('longname', [set(), set()])] })); render()
      expect(text()).toContain('LONGNAME')
      expect(text()).not.toMatch(/Set 1 of 2|1\/2/)
      seed(active({ entries: [entry('bench', [set(), set()])] }))
      expect(text()).toContain('Set 1 of 2')
    } finally { sw.mockRestore(); cw.mockRestore() }
  })
})

describe('the rise', () => {
  afterEach(() => { delete document.startViewTransition; vi.restoreAllMocks() })

  it('navigates at once with the rise motion, and never starts a view transition', () => {
    const svt = vi.fn()
    document.startViewTransition = svt
    seed(active()); render()
    act(() => { bar().click() })
    expect(mocks.nav).toHaveBeenCalledTimes(1)
    expect(mocks.nav).toHaveBeenCalledWith('/workout', { state: { rise: 'rise' } })
    expect(svt).not.toHaveBeenCalled()
  })

  it('gives one buzz on the way up', () => {
    const vib = vi.spyOn(sound, 'vibrate').mockImplementation(() => {})
    seed(active()); render()
    act(() => { bar().click() })
    expect(vib).toHaveBeenCalledWith(10)
  })
})
