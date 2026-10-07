// @vitest-environment happy-dom
// Weekly muscle volume, as planned: it lived on Plan until v1.3.11 and is analysis, so it moved to
// Stats, right after Muscle balance (Plan keeps a row that links here, /stats?focus=weekly-volume).
// What it counts did not change: every weekday routine once, plus a running rotation's sessions.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: vi.fn(), goalSheet: vi.fn(), calendarSheet: vi.fn(), workoutDetailSheet: vi.fn(),
  exerciseHistorySheet: vi.fn(), WorkoutRow: () => React.createElement('div'), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/LineChart.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => React.createElement('div'), BodyMapLegend: () => null }))

import Stats, { WeeklyPlanVolume } from './Stats.jsx'

const press = { id: 'press', n: 'Press', primaries: ['chest'], secondaries: ['triceps'], custom: true }
const state = over => ({
  unit: 'kg', body: 'male', effort: null, targetW: null, bodyweight: [], exWeights: {}, workouts: [], dayPlan: {},
  routines: [{ id: 'push', name: 'Push', emoji: null, ex: [{ id: press.id, sets: 2 }] }],
  customEx: [press], week: { 1: ['push'] }, weekStart: 1, queue: null, rotation: null, ...over,
})

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); window.location.hash = '' })

const card = () => host.querySelector('[data-weekly-muscle-volume]')
const render = S => act(() => root.render(<WeeklyPlanVolume S={S} />))

describe('Stats — weekly muscle volume from the plan', () => {
  it('shows every non-zero effective-set total from the recurring schedule', () => {
    render(state())
    expect(card().textContent).toContain('Weekly muscle volume')
    expect(card().textContent).toContain('Chest2 sets')
    expect(card().textContent).toContain('Triceps0.8 sets')
  })

  it('follows the weekly schedule: a routine on two days counts twice', () => {
    render(state({ week: { 1: ['push'], 3: 'push' } }))
    expect(card().textContent).toContain('Chest4 sets')
    expect(card().textContent).toContain('Triceps1.6 sets')
  })

  it('counts the sessions of a running rotation too', () => {
    render(state({ week: {}, queue: { ids: ['push'], since: Date.now(), startsOn: '2026-01-01', label: 'R' } }))
    expect(card().textContent).toContain('Chest2 sets')
  })

  it('says so when the plan has no volume', () => {
    render(state({ week: { 1: ['stale'] } }))
    expect(card().textContent).toContain('No muscle volume planned.')
    expect(card().querySelector('.mrow')).toBeNull()
  })

  it('omits explicit zero-weight muscles', () => {
    const zeroPress = { id: 'zero-press', n: 'Zero press', muscleWeights: { chest: 1, biceps: 0 }, custom: true }
    render(state({ customEx: [zeroPress], routines: [{ id: 'z', name: 'Zero', ex: [{ id: zeroPress.id, sets: 2 }] }], week: { 1: ['z'] } }))
    expect(card().textContent).toContain('Chest2 sets')
    expect(card().textContent).not.toContain('Biceps')
  })

  it('shows the top five and opens the rest on Show more', () => {
    const many = { id: 'many', n: 'Many', primaries: ['chest', 'lats', 'quads', 'glutes', 'hamstrings', 'calves'], secondaries: [], custom: true }
    render(state({ customEx: [many], routines: [{ id: 'm', name: 'M', ex: [{ id: many.id, sets: 3 }] }], week: { 1: ['m'] } }))
    expect(card().querySelectorAll('.mrow').length).toBe(5)
    const more = card().querySelector('.weekly-plan-toggle')
    expect(more.textContent).toBe('Show more')
    act(() => more.click())
    expect(card().querySelectorAll('.mrow').length).toBe(6)
    expect(card().querySelector('.weekly-plan-toggle').textContent).toBe('Show less')
  })

  it('sits on Stats right after Muscle balance, and only once there are routines', () => {
    mocks.S = state()
    act(() => root.render(<Stats />))
    const balance = [...host.querySelectorAll('.card h2')].find(h => h.textContent.startsWith('Muscle balance'))?.closest('.card')
    expect(balance).toBeTruthy()
    expect(balance.nextElementSibling).toBe(card())
    expect(card().id).toBe('weekly-volume')
    mocks.S = state({ routines: [], week: {} })
    act(() => root.render(<Stats />))
    expect(card()).toBeNull()
  })

  it('scrolls itself into view when Plan links here', () => {
    vi.useFakeTimers()
    try {
      window.location.hash = '#/stats?focus=weekly-volume'
      mocks.S = state()
      const scroll = vi.fn()
      const orig = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = scroll
      act(() => root.render(<Stats />))
      act(() => { vi.advanceTimersByTime(50) })
      Element.prototype.scrollIntoView = orig
      expect(scroll).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
})
