// @vitest-environment happy-dom
// Stats → Body → More (owner 2026-11-24): the whole list can be hidden in Customize, or single
// rows switched off. And the top-set chart counts a workout saved without a start time.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'
import { setLinkShown, setCardState, resetLayout, isCustom, groupOf, PAGES } from '../lib/page-layout.js'

const mocks = vi.hoisted(() => ({ S: null, charts: [] }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const start = Date.now() - 2 * 86400000
const workout = { id: 'w1', d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000,
  entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }] }
// An old record with only its day, as some imports and early versions saved them.
const old = { id: 'w0', d: '2025-06-01', entries: [{ id: '0025', sets: [{ w: 50, r: 5, done: true }] }] }
let root, host
afterEach(() => { act(() => root.unmount()); host.remove() })
function mount(extra = {}) {
  mocks.charts = []
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts: [old, workout], ...extra }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
const links = () => [...host.querySelectorAll('[data-stats-links] .lrow-t')].map(x => x.textContent)

describe('Stats More list', () => {
  it('drops a row switched off and keeps the rest', () => {
    mount()
    expect(links()).toContain('Journal')
    const s = { ...mocks.S }; setLinkShown(s, 'journal', false); setLinkShown(s, 'tools', false)
    act(() => root.unmount()); host.remove()
    mount(s)
    expect(links()).not.toContain('Journal')
    expect(links()).not.toContain('Tools')
    expect(links()).toContain('Structural balance')
  })
  it('hides the whole list from Customize, and Body goes with it when its weight card is hidden too', () => {
    const s = { workouts: [] }; setCardState(s, 'stats', 'links', 'hidden')
    mount({ layout: s.layout })
    expect(host.querySelector('[data-stats-links]')).toBeNull()
    expect(host.querySelector('#stats-body')).toBeTruthy()
    setCardState(s, 'stats', 'bodyweight', 'hidden')
    act(() => root.unmount()); host.remove()
    mount({ layout: s.layout })
    expect(host.querySelector('#stats-body')).toBeNull()
    expect([...host.querySelectorAll('.stats-index .seg button')].map(b => b.textContent)).not.toContain('Body')
  })
  it('the list moves to Lifts with the Body module off, and Customize files it there', () => {
    const card = PAGES.stats.find(c => c.id === 'links')
    expect(groupOf(card, {})).toBe('body')
    expect(groupOf(card, { modules: { body: false } })).toBe('lifts')
  })
  it('Reset brings every row back', () => {
    const s = {}; setLinkShown(s, 'journal', false)
    expect(isCustom(s, 'stats')).toBe(true)
    resetLayout(s, 'stats')
    expect(isCustom(s, 'stats')).toBe(false)
  })
  it('the top-set chart keeps a workout that has a day but no start time', () => {
    mount()
    const top = mocks.charts.find(c => c.ariaLabel === 'Top set')
    expect(top.points.map(p => p.y)).toEqual([50, 60])
  })
})
