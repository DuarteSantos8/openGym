// @vitest-environment happy-dom
// The iPhone's floating tab bar (Liquid Glass G1): its structure for a screen reader, and the
// shrink on scroll. The look is index.css; what happens at the edges of the screen needs a device.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

const path = vi.hoisted(() => ({ now: '/plan' }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: path.now }),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, originalUser
beforeEach(() => {
  path.now = '/plan'
  const store = useStore.getState()
  originalS = store.S; originalUser = store.user
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 1, name: 'test' } })
  document.documentElement.dataset.platform = 'ios'
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  delete document.documentElement.dataset.platform
  vi.restoreAllMocks()
  useStore.setState({ S: originalS, user: originalUser })
})

const bar = () => host.querySelector('#tabbar')
const scrollTo = y => act(() => { window.scrollY = y; window.dispatchEvent(new Event('scroll')) })

describe('the floating tab bar', () => {
  it('reads Home, Plan, Start, Choose routine, Stats, Exercises, with Start outside the tablists', () => {
    act(() => { root.render(<TabBar onStart={() => {}} onPick={() => {}} />) })
    const lists = [...bar().querySelectorAll('[role=tablist]')]
    expect(lists).toHaveLength(2)
    const order = [...bar().querySelectorAll('.gt, .orb, .alt')].map(e => e.textContent || e.getAttribute('aria-label'))
    expect(order).toEqual(['Home', 'Plan', 'Start', 'Choose routine', 'Stats', 'Exercises'])
    expect(bar().querySelector('.orb').closest('[role=tablist]')).toBeNull()
    const plan = bar().querySelectorAll('.gt')[1]
    expect(plan.getAttribute('aria-selected')).toBe('true')
    expect(plan.getAttribute('aria-posinset')).toBe('2')
    expect(bar().querySelector('.orb').getAttribute('aria-label')).toBe('Start workout')
  })

  it('names the running workout with its time and drops Choose routine', () => {
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), active: { id: 'a', entries: [], cur: 0, start: Date.now() - 754000 } } })
    act(() => { root.render(<TabBar onStart={() => {}} onPick={() => {}} />) })
    expect(bar().querySelector('.orb').textContent).toContain('Resume workout, 12:34 elapsed')
    expect(bar().querySelector('.alt')).toBeNull()
  })

  it('shrinks after 24 pt down, takes the other tabs out of the tab order, and grows back on a tap', () => {
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)   // past the settling moment after a page opens
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true })
    scrollTo(100); scrollTo(130)
    expect(bar().classList.contains('min')).toBe(true)
    const t = [...bar().querySelectorAll('.gt')]
    expect(t.map(e => e.inert)).toEqual([true, false, true, true])
    expect(t[1].getAttribute('aria-label')).toBe('Plan, show all tabs')
    act(() => t[1].click())
    expect(bar().classList.contains('min')).toBe(false)
  })

  it('shows only Home, and not inert, when shrunk on a page with no tab lit', () => {
    path.now = '/settings'
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true })
    scrollTo(100); scrollTo(130)
    expect([...bar().querySelectorAll('.gt')].map(e => e.inert)).toEqual([false, true, true, true])
  })
})

describe('Reduce Motion in index.css', () => {
  // (happy-dom cannot match :root[attr], so the prefix is cut; the rest of each selector is as written.)
  // Cut from the stylesheet itself: the lens must end up with an opacity-only transition however
  // the bar is shaped, or it slides when it should only fade.
  it('leaves the lens with a transition on opacity alone', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/index.css', 'utf8')
    const from = css.indexOf(':root[data-platform="ios"] #tabbar{'), to = css.indexOf('/* Glass fallbacks', from)
    expect(from).toBeGreaterThan(-1); expect(to).toBeGreaterThan(from)
    const sheet = document.createElement('style')
    sheet.textContent = css.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, '').replaceAll(':root[data-platform="ios"] ', '')
    document.head.appendChild(sheet)
    host.innerHTML = '<nav id="tabbar"><span class="lens"></span></nav>'
    const nav = host.firstChild
    for (const c of ['rm', 'rm fwd', 'rm back', 'rm min']) {
      nav.className = c
      expect(getComputedStyle(nav.firstChild).transition, c).toBe('opacity .15s linear')
    }
    nav.className = 'fwd'
    expect(getComputedStyle(nav.firstChild).transition).toContain('left')
    sheet.remove()
  })
})
