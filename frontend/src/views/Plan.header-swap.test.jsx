// @vitest-environment happy-dom
// Edit swaps Plan's header for its bar. The header leaves as an inert copy, the bar fades in, the list slides once
// from where it was. Reduce Motion: none of it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({}) }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/RoutineFolder.jsx', () => ({ folderNameSheet: vi.fn() }))

let host, root, calls
const tops = []
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  localStorage.clear(); localStorage.setItem('gym_plan_view', 'routines')
  calls = []; tops.length = 0
  // The header is 130 px tall, the Edit bar 90: the list moves 40 px up when Edit starts.
  Element.prototype.getBoundingClientRect = function () {
    const top = this.classList?.contains('plan-routes') ? (host.querySelector('.plan-top') ? 200 : 160) : 0
    return { top, left: 0, width: 300, height: 50, right: 300, bottom: top + 50 }
  }
  Element.prototype.animate = function (f, o) { const a = { el: this, f, o }; calls.push(a); return a }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'a', name: 'Push A', emoji: null, ex: [{ id: '0025' }] }], routineFolders: [], week: {}, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.querySelectorAll('body > [inert]').forEach(n => n.remove()); vi.useRealTimers(); document.documentElement.className = ''; delete Element.prototype.animate; delete Element.prototype.getBoundingClientRect })

describe('Plan header swap', () => {
  it('the header leaves as an inert copy, the bar fades in, the list slides from its old place', () => {
    act(() => root.render(<Plan />))
    act(() => { host.querySelector('.plan-edit').click() })
    const copy = [...document.querySelectorAll('body > [inert]')].find(n => n.querySelector('.hdr'))
    expect(copy).toBeTruthy()
    expect(copy.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.plan-edithead').classList.contains('is-in')).toBe(true)
    const slide = calls.find(c => c.el.classList.contains('plan-routes'))
    expect(slide.f[0].transform).toBe('translateY(40px)')
    expect(slide.f[1].transform).toBe('none')
    // Done: the Edit bar leaves as a copy, the header fades in.
    act(() => { host.querySelector('.plan-edithead .plan-textbtn:last-child').click() })
    expect([...document.querySelectorAll('body > [inert]')].some(n => n.querySelector('.plan-selcount'))).toBe(true)
    expect(host.querySelector('.plan-top').classList.contains('is-swap')).toBe(true)
  })

  it('Reduce Motion: no copy, no class, no slide', () => {
    document.documentElement.classList.add('reduce-motion')
    act(() => root.render(<Plan />))
    act(() => { host.querySelector('.plan-edit').click() })
    expect([...document.querySelectorAll('body > [inert]')].filter(n => n.querySelector('.hdr, .plan-selcount')).length).toBe(0)
    expect(host.querySelector('.plan-edithead').classList.contains('is-in')).toBe(false)
    expect(calls.filter(c => c.el.classList.contains('plan-routes')).length).toBe(0)
  })
})
