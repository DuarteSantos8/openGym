// @vitest-environment happy-dom
// Your year in openGym: the Home card's season, the Stats row, and the stories themselves.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useWrappedUI, openWrapped } from '../lib/wrapped-ui.js'
import { NOW_KEY } from '../lib/wrapped.js'
import { WrappedHomeCard, WrappedStatsCard } from './WrappedEntry.jsx'
import Wrapped from './Wrapped.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/home', search: '' }) }))

const clone = v => JSON.parse(JSON.stringify(v))
const W = (d, hh = '18:00') => {
  const start = new Date(d + 'T' + hh + ':00').getTime()
  return { id: d, d, start, end: start + 50 * 60000, name: 'Push', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }], prs: d.endsWith('-10') ? ['0025'] : [] }
}
let host, root
function seed(over = {}) {
  const st = clone(DEF)
  st.workouts = ['2026-02-10', '2026-02-17', '2026-03-10', '2026-04-14', '2026-11-10'].map(d => W(d))
  st.bodyweight = [{ d: '2026-02-01', w: 80 }, { d: '2026-11-01', w: 78 }]
  Object.assign(st, over)
  useStore.setState({ S: st, user: null })
}
const S = () => useStore.getState().S
const render = el => act(() => root.render(el))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text || b.getAttribute('aria-label') === text)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [] })
  useWrappedUI.setState({ year: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Home: the December card', () => {
  const Card = () => <WrappedHomeCard S={useStore(s => s.S)} />
  it('shows from Dec 1 for a year with workouts, and opens the stories', () => {
    seed()
    localStorage.setItem(NOW_KEY, '2026-11-30')
    render(<Card />)
    expect(host.querySelector('[data-wrapped-home]')).toBeNull()
    localStorage.setItem(NOW_KEY, '2026-12-01')
    render(<Card key="2" />)
    expect(host.textContent).toContain('Your 2026 in openGym is ready 🎉')
    act(() => button('Show me my year').click())
    expect(useWrappedUI.getState().year).toBe(2026)
  })
  it('goes for the year once put away, and stays away', () => {
    seed()
    localStorage.setItem(NOW_KEY, '2027-01-20')
    render(<Card />)
    act(() => button('Not now').click())
    expect(S().wrapped.dismissed).toEqual([2026])
    expect(host.querySelector('[data-wrapped-home]')).toBeNull()
  })
})

describe('Stats: Your year', () => {
  it('offers every year with workouts, newest first', () => {
    seed({ workouts: [W('2025-05-05'), W('2026-02-10')] })
    render(<WrappedStatsCard S={S()} />)
    const chips = [...host.querySelectorAll('.chip')].map(c => c.textContent)
    expect(chips).toEqual(['2025'])
    act(() => host.querySelector('.chip').click())
    expect(useWrappedUI.getState().year).toBe(2025)
  })
  it('is not there without a single workout', () => {
    seed({ workouts: [] })
    render(<WrappedStatsCard S={S()} />)
    expect(host.querySelector('[data-wrapped-stats]')).toBeNull()
  })
})

describe('the stories', () => {
  it('open as a labelled dialog, step through with buttons and keys, and close with Escape', async () => {
    seed()
    act(() => openWrapped(2026))
    render(<Wrapped />)
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-label')).toBe('Your 2026 in openGym')
    expect(S().wrapped.opened).toEqual([2026])
    const group = () => host.querySelector('.wr-card[role="group"]')
    const total = host.querySelectorAll('.wr-progress span').length
    expect(total).toBeGreaterThanOrEqual(8)
    expect(group().getAttribute('aria-label')).toBe(`1 of ${total}`)
    expect(button('Previous card').disabled).toBe(true)
    act(() => button('Next card').click())
    expect(group().getAttribute('aria-label')).toBe(`2 of ${total}`)
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
    expect(group().getAttribute('aria-label')).toBe(`3 of ${total}`)
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
    expect(group().getAttribute('aria-label')).toBe(`2 of ${total}`)
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(useWrappedUI.getState().year).toBeNull()
  })

  it('ends on the summary with Share my year, and every card can be shared', () => {
    seed()
    act(() => openWrapped(2026))
    render(<Wrapped />)
    const total = host.querySelectorAll('.wr-progress span').length
    for (let i = 1; i < total; i++) act(() => button('Next card').click())
    expect(host.querySelector('.wr-summary')).toBeTruthy()
    expect(button('Share my year')).toBeTruthy()
    act(() => button('Share my year').click())
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('leaves body weight out when asked, for good', () => {
    seed()
    act(() => openWrapped(2026))
    render(<Wrapped />)
    for (let i = 0; i < 20 && !host.querySelector('.wr-body .wr-hide'); i++) act(() => button('Next card').click())
    act(() => host.querySelector('.wr-hide').click())
    expect(S().wrappedBody).toBe(false)
    expect(host.querySelector('.wr-hide')).toBeNull()
  })
})
