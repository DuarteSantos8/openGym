// @vitest-environment happy-dom
// Your month in openGym (v1.4.5): the year's stories for one month, and the Daily form card.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useWrappedUI, openMonthStory } from '../lib/wrapped-ui.js'
import Wrapped from './Wrapped.jsx'
import DailyFormCard from './DailyFormCard.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/home', search: '' }) }))

const clone = v => JSON.parse(JSON.stringify(v))
const W = (d, w = 60) => {
  const start = new Date(d + 'T18:00:00').getTime()
  return { id: d, d, start, end: start + 50 * 60000, name: 'Push', routineIds: ['A'], entries: [{ id: '0025', sets: [{ w, r: 8, done: true }, { w, r: 8, done: true }] }], prs: [] }
}
let host, root
const seed = over => { const st = clone(DEF); Object.assign(st, over); useStore.setState({ S: st, user: null }) }
const S = () => useStore.getState().S
const render = el => act(() => root.render(el))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text || b.getAttribute('aria-label') === text)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useWrappedUI.setState({ year: null, month: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('the month as stories', () => {
  it('opens on the month, steps through its cards and closes, without marking the year as seen', () => {
    seed({ workouts: ['2026-10-02', '2026-10-09', '2026-10-16'].map(d => W(d)) })
    act(() => openMonthStory('2026-10'))
    render(<Wrapped />)
    expect(host.querySelector('.wr-year').textContent).toBe('October 2026')
    expect(host.textContent).toContain('Your month in openGym')
    act(() => button('Next card').click())
    expect(host.textContent).toContain('Workouts this month')
    expect(S().wrapped?.opened || []).toEqual([])
    act(() => button('Close').click())
    expect(useWrappedUI.getState().month).toBeNull()
  })
  it('ignores a month that is not one', () => {
    act(() => openMonthStory('october'))
    expect(useWrappedUI.getState().month).toBeNull()
  })
})

describe('Stats: the Daily form card', () => {
  const Card = () => <DailyFormCard S={useStore(s => s.S)} />
  it('asks once whether to switch the check-in on, and remembers the answer', () => {
    seed({ workouts: ['2026-10-02', '2026-10-09', '2026-10-16'].map(d => W(d)) })
    render(<Card />)
    expect(host.textContent).toContain('Check in before workouts?')
    act(() => button('Not for me').click())
    expect(S().dailyForm).toBe(false)
    render(<Card key="2" />)
    expect(host.querySelector('[data-daily-form]')).toBeNull()
  })
  it('shows a pattern with both counts once there is enough data, and how sure it is', () => {
    const days = []
    for (let i = 0; i < 20; i++) { const d = new Date(2026, 8, 1 + i * 2, 12); days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`) }
    seed({
      dailyForm: true,
      workouts: days.map((d, i) => W(d, i % 2 ? 90 : 100)),
      dayForm: Object.fromEntries(days.map((d, i) => [d, { energy: i % 2 ? 2 : 5, _ts: 1 }])),
    })
    render(<Card />)
    const ins = host.querySelector('[data-insights]')
    expect(ins).not.toBeNull()
    expect(ins.textContent).toContain('When your energy is 4 or 5')
    expect(ins.textContent).toMatch(/\d+ vs \d+ workouts/)
    expect(host.textContent).toContain('Patterns, not proof.')
  })
  it('says how far it is from the first insight', () => {
    seed({ dailyForm: true, workouts: [W('2026-10-02')], dayForm: { '2026-10-02': { energy: 4, _ts: 1 } } })
    render(<Card />)
    expect(host.textContent).toMatch(/Insights show up once there is enough to compare/)
  })
})
