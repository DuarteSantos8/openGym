// @vitest-environment happy-dom
// Plan motion moments 2 and 3 (Edit mode, Favourites filter): the phase classes, the pill and bar that
// stay for their exit, the filter's leavers. Behaviour and classes only, never timing. Reduce Motion:
// no phase class, no exit copy, no transform in any keyframe, no transform transition on a row.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Plan from './Plan.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/RoutineFolder.jsx', () => ({ folderNameSheet: vi.fn() }))

const routine = (id, name, extra) => ({ id, name, ex: [{ id: '0025' }], ...extra })
let host, root, calls
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  localStorage.clear(); localStorage.setItem('gym_plan_view', 'routines')
  calls = []
  Element.prototype.animate = function (frames, opts) { calls.push({ el: this, frames, opts }); return {} }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S,
    routines: [routine('a', 'Push A', { fav: true }), routine('b', 'Mobility'), routine('c', 'Pull A')],
    routineFolders: [], week: {}, dayPlan: {} }, user: null }))
  act(() => root.render(<Plan />))
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.useRealTimers()
  document.documentElement.className = ''; delete Element.prototype.animate; useUI.setState({ toasts: [] })
})

const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const edit = () => click([...host.querySelectorAll('.plan-textbtn')].find(b => b.textContent === 'Edit'))
const done = () => click([...host.querySelectorAll('.plan-textbtn')].find(b => b.textContent === 'Done'))
const routes = () => host.querySelector('.plan-routes')
const settle = () => act(() => { vi.advanceTimersByTime(400) })

describe('Edit mode motion', () => {
  it('entering Edit marks the list for the slide, keeps the pill as an inert exit copy and raises the bar', () => {
    edit()
    expect(routes().classList.contains('is-edit-in')).toBe(true)
    const pill = host.querySelector('.plan-pill')
    expect(pill.classList.contains('is-away')).toBe(true)
    expect(pill.hasAttribute('inert')).toBe(true)
    expect(pill.getAttribute('aria-hidden')).toBe('true')
    const bar = host.querySelector('.plan-editbar')
    expect(bar.classList.contains('is-leaving')).toBe(false)
    settle()
    expect(routes().className).not.toMatch(/is-edit-(in|out)/)
    expect(host.querySelector('.plan-pill')).toBeNull()
  })

  it('leaving Edit settles the titles, lets the bar go out inert and fades the pill back', () => {
    edit(); settle(); done()
    expect(routes().classList.contains('is-edit-out')).toBe(true)
    const bar = host.querySelector('.plan-editbar')
    expect(bar.classList.contains('is-leaving')).toBe(true)
    expect(bar.hasAttribute('inert')).toBe(true)
    expect(host.querySelector('.plan-pill').classList.contains('is-back')).toBe(true)
    settle()
    expect(host.querySelector('.plan-editbar')).toBeNull()
    expect(host.querySelector('.plan-pill').classList.contains('is-back')).toBe(false)
  })

  it('Reduce Motion: no phase, no exit copies, the bar and pill switch at once', () => {
    document.documentElement.classList.add('reduce-motion')
    edit()
    expect(routes().className).not.toMatch(/is-edit-(in|out)/)
    expect(host.querySelector('.plan-pill')).toBeNull()
    done()
    expect(routes().className).not.toMatch(/is-edit-(in|out)/)
    expect(host.querySelector('.plan-editbar')).toBeNull()
    expect(host.querySelector('.plan-pill').className).toBe('plan-pill')
  })
})

describe('Favourites filter motion', () => {
  const star = () => host.querySelector('[aria-label="Favourites"]')
  const flush = fn => act(async () => { fn(); await Promise.resolve() })

  it('the routines that leave fade out as ghosts; the data is written at once', async () => {
    await flush(() => star().dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(host.querySelectorAll('.plan-routine')).toHaveLength(1)
    expect(localStorage.getItem('og_plan_starred')).toBe('1')
    const out = calls.filter(c => c.opts.duration === 100)
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].opts.easing).toBe('ease-out')
    expect(out[0].el.getAttribute('aria-hidden')).toBe('true')
  })

  it('Reduce Motion: no transform in any keyframe and no transform transition on a row', async () => {
    document.documentElement.classList.add('reduce-motion')
    await flush(() => star().dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(calls.every(c => c.frames.every(f => !('transform' in f)))).toBe(true)
    expect([...host.querySelectorAll('[data-flip-key]')].every(el => !el.style.transition)).toBe(true)
  })
})

it('the stylesheet switches the Edit and Favourites animations off under the class and the media query', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync('src/index.css', 'utf8')
  expect(css).toContain('.reduce-motion .plan-routes[class*="is-edit-"] :is(.plan-check,.plan-grip,.lrow-i,.grow,.bm-mini-wrap),.reduce-motion .plan-editbar,.reduce-motion .plan-pill,.reduce-motion .plan-starred-bar .ss{animation:none}')
  expect(css).toContain('@media (prefers-reduced-motion:reduce){.plan-routes[class*="is-edit-"] :is(.plan-check,.plan-grip,.lrow-i,.grow,.bm-mini-wrap),.plan-editbar,.plan-pill,.plan-starred-bar .ss{animation:none}}')
})
