// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MUSCLES } from '../lib/muscles.js'
import Stats from './Stats.jsx'

const NOW = new Date(2026, 8, 30, 12).getTime()
const press = { id: 'press', n: 'Press', primaries: ['chest'], secondaries: ['triceps'], custom: true }
const mocks = vi.hoisted(() => ({ S: null, bodyMaps: [] }))

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: vi.fn(), goalSheet: vi.fn(), calendarSheet: vi.fn(), workoutDetailSheet: vi.fn(),
  exerciseHistorySheet: vi.fn(), WorkoutRow: () => React.createElement('div'), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/LineChart.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/BodyMap.jsx', () => ({
  default: props => {
    mocks.bodyMaps.push(props)
    return React.createElement('div', { 'data-body-map': true, 'data-selected': props.selected || '' },
      React.createElement('button', { 'aria-label': 'Chest', onClick: () => props.onMuscle?.('chest') }, 'Chest'))
  },
  BodyMapLegend: () => React.createElement('div', { 'data-body-map-legend': true }),
}))

const completed = (d, muscle, sets) => ({
  id: `${d}-${muscle}`, d, start: new Date(`${d}T12:00:00`).getTime(),
  entries: [{ id: `custom-${muscle}`, exercise: { primaries: [muscle], secondaries: [] }, sets: Array.from({ length: sets }, () => ({ done: true })) }],
})
const state = over => ({
  unit: 'kg', body: 'male', effort: 'rir', targetW: null, bodyweight: [], exWeights: {},
  routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 2 }] }],
  customEx: [press], week: { 1: ['push'] }, weekStart: 1, workouts: [], ...over,
})

let host, root
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.bodyMaps.length = 0
  mocks.S = state({ workouts: [completed('2026-09-30', 'biceps', 3)] })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const mount = () => act(() => root.render(<Stats />))
const comparison = () => host.querySelector('[data-weekly-volume-comparison]')
const button = label => host.querySelector(`button[aria-label="${label}"]`)
const weeklyToggle = () => comparison().querySelector('.weekly-volume-toggle')
const row = muscle => comparison().querySelector(`[data-muscle-volume="${muscle}"]`)
const value = muscle => row(muscle).querySelector('.v')
const bar = muscle => row(muscle).querySelector('.bar i')
const renderedMuscles = () => [...comparison().querySelectorAll('[data-muscle-volume]')].map(item => item.dataset.muscleVolume)
const missedHeading = () => [...comparison().querySelectorAll('h4')].find(item => item.textContent === 'Not trained in this period') || null
const isBefore = (first, second) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('Stats — weekly planned vs completed volume', () => {
  it('shows completed/planned progress with completed first for the current week', () => {
    mocks.S = state({
      routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
      workouts: [completed('2026-09-30', 'chest', 8), completed('2026-09-30', 'biceps', 3)],
    })
    mount()
    expect(button('Previous week')).toBeTruthy()
    expect(host.querySelector('[data-body-map]')).toBeTruthy()
    expect(host.querySelector('[data-body-map-legend]')).toBeTruthy()
    expect(mocks.bodyMaps.at(-1).load).toEqual({ chest: 8, biceps: 3 })
    expect([...comparison().querySelectorAll('[data-muscle-volume]')].map(item => item.dataset.muscleVolume))
      .toEqual(['chest', 'biceps', 'triceps'])
    expect(value('chest').textContent).toBe('8/12 · 67%')
    expect(value('chest').getAttribute('aria-label')).toBe('Completed 8 sets · Planned 12 sets')
    expect(bar('chest').style.width).toBe('67%')
    expect(value('triceps').textContent).toBe('0/4.8 · 0%')
    expect(bar('triceps').style.width).toBe('0%')
    expect(value('biceps').textContent).toBe('3/0')
    expect(value('biceps').getAttribute('aria-label')).toBe('Completed 3 sets · Planned 0 sets')
    expect(bar('biceps').style.width).toBe('100%')
    expect(button('Next week').disabled).toBe(true)
  })

  it('orders the current week by completed then planned volume and expands planned-only rows', () => {
    mocks.S = state({
      routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
      workouts: [
        completed('2026-09-30', 'biceps', 8),
        completed('2026-09-30', 'upper-back', 6),
        completed('2026-09-30', 'chest', 4),
        completed('2026-09-30', 'calves', 4),
        completed('2026-09-30', 'deltoids', 2),
      ],
    })
    mount()

    expect(renderedMuscles()).toEqual(['biceps', 'upper-back', 'chest', 'calves'])
    expect(row('triceps')).toBeNull()
    expect(weeklyToggle().textContent).toBe('Show more')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('false')
    expect(weeklyToggle().querySelector('[data-icon="chevronDown"]')).toBeTruthy()
    expect(isBefore(weeklyToggle(), missedHeading())).toBe(true)
    expect([...comparison().querySelectorAll('.mchip.miss')].map(item => item.textContent)).toContain('Triceps')

    act(() => weeklyToggle().click())
    expect(renderedMuscles()).toEqual(['biceps', 'upper-back', 'chest', 'calves', 'deltoids', 'triceps'])
    expect(weeklyToggle().textContent).toBe('Show less')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('true')
    expect(weeklyToggle().querySelector('[data-icon="chevronDown"]')).toBeTruthy()
    expect(isBefore(weeklyToggle(), missedHeading())).toBe(true)
    expect(value('triceps').textContent).toBe('0/4.8 · 0%')
    expect(isBefore(row('triceps'), missedHeading())).toBe(true)
    expect([...comparison().querySelectorAll('.mchip.miss')].map(item => item.textContent)).toContain('Triceps')

    act(() => weeklyToggle().click())
    expect(renderedMuscles()).toEqual(['biceps', 'upper-back', 'chest', 'calves'])
    expect(weeklyToggle().textContent).toBe('Show more')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('shows the completed-all-muscles summary after current-week rows', () => {
    mocks.S = state({ workouts: MUSCLES.map(muscle => completed('2026-09-30', muscle, 1)) })
    mount()
    const summary = [...comparison().querySelectorAll('.muted.small')]
      .find(item => item.textContent === 'Every muscle group got some work in this period.')
    expect(summary).toBeTruthy()
    expect(isBefore(row(renderedMuscles().at(-1)), summary)).toBe(true)
  })

  it('shows the selected muscle completed/planned ratio below the completed map', () => {
    mocks.S = state({
      routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
      workouts: [
        completed('2026-09-30', 'chest', 8), completed('2026-09-30', 'biceps', 7),
        completed('2026-09-30', 'upper-back', 6), completed('2026-09-30', 'calves', 5),
        completed('2026-09-30', 'deltoids', 4),
      ],
    })
    mount()
    expect(weeklyToggle()).toBeTruthy()
    act(() => host.querySelector('[data-body-map] button[aria-label="Chest"]').click())
    expect(host.querySelector('[data-body-map]').dataset.selected).toBe('chest')
    expect(comparison().querySelectorAll('[data-muscle-volume]')).toHaveLength(1)
    expect(value('chest').textContent).toBe('8/12 · 67%')
    expect(value('chest').getAttribute('aria-label')).toBe('Completed 8 sets · Planned 12 sets')
    expect(weeklyToggle()).toBeNull()
  })

  it('shows the real percentage while capping only over-plan bar fill', () => {
    mocks.S = state({
      routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
      workouts: [completed('2026-09-30', 'chest', 14)],
    })
    mount()
    expect(value('chest').textContent).toBe('14/12 · 117%')
    expect(bar('chest').style.width).toBe('100%')
  })

  it('navigates previous weeks as completed-only and respects a Sunday week start', () => {
    mocks.S = state({
      weekStart: 0,
      workouts: [completed('2026-09-27', 'biceps', 1), completed('2026-09-20', 'quadriceps', 4)],
    })
    mount()
    expect(comparison().dataset.week).toBe('2026-09-27')
    act(() => button('Previous week').click())
    expect(comparison().dataset.week).toBe('2026-09-20')
    expect(host.querySelector('[data-body-map]')).toBeTruthy()
    expect(host.querySelector('[data-body-map-legend]')).toBeTruthy()
    expect(mocks.bodyMaps.at(-1).load).toEqual({ quadriceps: 4 })
    expect(value('quadriceps').textContent).toBe('4 sets')
    expect(row('quadriceps').querySelector('.bar i').style.width).toBe('100%')
    expect(comparison().textContent).not.toContain('/')
    expect(comparison().textContent).not.toContain('Planned')
    expect(comparison().querySelector('[aria-label*="Planned"]')).toBeNull()
    expect([...comparison().querySelectorAll('.mchip.miss')].map(item => item.textContent)).toContain('Chest')
    expect(button('Next week').disabled).toBe(false)
    act(() => button('Next week').click())
    expect(comparison().dataset.week).toBe('2026-09-27')
    expect(button('Next week').disabled).toBe(true)
  })

  it('shows four completed muscles for a previous week, then expands without planned semantics', () => {
    mocks.S = state({
      workouts: [
        completed('2026-09-30', 'chest', 8), completed('2026-09-30', 'biceps', 7),
        completed('2026-09-30', 'upper-back', 6), completed('2026-09-30', 'calves', 5),
        completed('2026-09-30', 'deltoids', 4),
        completed('2026-09-22', 'quadriceps', 9), completed('2026-09-22', 'hamstring', 8),
        completed('2026-09-22', 'gluteal', 7), completed('2026-09-22', 'calves', 6),
        completed('2026-09-22', 'upper-back', 5), completed('2026-09-22', 'biceps', 4),
      ],
    })
    mount()
    act(() => weeklyToggle().click())
    expect(renderedMuscles()).toHaveLength(6)

    act(() => button('Previous week').click())
    expect(renderedMuscles()).toEqual(['quadriceps', 'hamstring', 'gluteal', 'calves'])
    expect(weeklyToggle().textContent).toBe('Show more')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('false')
    expect(weeklyToggle().querySelector('[data-icon="chevronDown"]')).toBeTruthy()

    act(() => weeklyToggle().click())
    expect(renderedMuscles()).toEqual(['quadriceps', 'hamstring', 'gluteal', 'calves', 'upper-back', 'biceps'])
    expect(weeklyToggle().textContent).toBe('Show less')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('true')
    expect(weeklyToggle().querySelector('[data-icon="chevronDown"]')).toBeTruthy()
    expect(isBefore(weeklyToggle(), missedHeading())).toBe(true)
    expect(comparison().textContent).not.toContain('/')
    expect(comparison().textContent).not.toContain('Planned')
    expect(comparison().querySelector('[aria-label*="Planned"]')).toBeNull()

    act(() => weeklyToggle().click())
    expect(renderedMuscles()).toEqual(['quadriceps', 'hamstring', 'gluteal', 'calves'])
    expect(weeklyToggle().textContent).toBe('Show more')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('false')

    act(() => weeklyToggle().click())
    act(() => button('Next week').click())
    expect(renderedMuscles()).toEqual(['chest', 'biceps', 'upper-back', 'calves'])
    expect(weeklyToggle().textContent).toBe('Show more')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('omits Show more when the weekly list has four or fewer rows', () => {
    mocks.S = state({ workouts: [
      completed('2026-09-30', 'chest', 4),
      completed('2026-09-30', 'biceps', 3),
      completed('2026-09-22', 'quadriceps', 2),
      completed('2026-09-22', 'hamstring', 1),
    ] })
    mount()
    expect(renderedMuscles()).toEqual(['chest', 'biceps', 'triceps'])
    expect(weeklyToggle()).toBeNull()
    act(() => button('Previous week').click())
    expect(renderedMuscles()).toEqual(['quadriceps', 'hamstring'])
    expect(weeklyToggle()).toBeNull()
  })

  it('keeps the completed map, legend, navigator, and empty state for an empty previous week', () => {
    mount()
    act(() => button('Previous week').click())
    expect(button('Previous week')).toBeTruthy()
    expect(button('Next week').disabled).toBe(false)
    expect(host.querySelector('[data-body-map]')).toBeTruthy()
    expect(host.querySelector('[data-body-map-legend]')).toBeTruthy()
    expect(mocks.bodyMaps.at(-1).load).toEqual({})
    expect(comparison().textContent).toContain('No workouts in this period yet.')
    expect(comparison().textContent).not.toContain('Planned')
    expect(comparison().querySelector('[aria-label*="Planned"]')).toBeNull()
  })
})
