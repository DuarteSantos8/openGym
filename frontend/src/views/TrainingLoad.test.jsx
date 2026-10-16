// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../lib/format.js'
import { _setLangState } from '../lib/i18n-core.js'
import TrainingLoad from './TrainingLoad.jsx'

const press = { id: 'press', n: 'Press', primaries: ['chest'], secondaries: ['triceps'], custom: true }
const mocks = vi.hoisted(() => ({
  S: null, search: '', nav: vi.fn(), heatmaps: [],
  calendarSheet: vi.fn(), workoutDetailSheet: vi.fn(), dayOverrideSheet: vi.fn(), exerciseHistorySheet: vi.fn(),
}))

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useLocation: () => ({ search: mocks.search, pathname: '/progress/load' }),
}))
vi.mock('../lib/use-tab-nav.js', () => ({ back: vi.fn(), isSwitching: () => false, switchTab: vi.fn(), popToRoot: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  calendarSheet: mocks.calendarSheet, workoutDetailSheet: mocks.workoutDetailSheet,
  dayOverrideSheet: mocks.dayOverrideSheet, exerciseHistorySheet: mocks.exerciseHistorySheet,
}))
vi.mock('../components/Heatmap.jsx', () => ({
  default: props => { mocks.heatmaps.push(props); return React.createElement('div', { 'data-heatmap': true }) },
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/BodyMap.jsx', () => ({
  default: () => React.createElement('div', { 'data-body-map': true }),
  BodyMapLegend: () => null,
}))

const set = (extra = {}) => ({ done: true, w: 80, r: 8, ...extra })
const workout = (id, d, sets) => ({ id, d, start: new Date(`${d}T12:00:00`).getTime(), entries: [{ id: '0025', sets }] })
const state = over => ({
  unit: 'kg', body: 'male', effort: null, targetW: null, bodyweight: [], exWeights: {}, dayPlan: {},
  routines: [{ id: 'push', name: 'Push', emoji: null, ex: [{ id: press.id, sets: 2 }] }],
  customEx: [press], week: { 1: ['push'] }, weekStart: 1, queue: null, rotation: null, workouts: [], ...over,
})
const ratedWorkouts = () => [workout('rated', todayISO(), Array.from({ length: 6 }, () => set({ rir: 2 })))]
const unratedWorkouts = () => [workout('unrated', todayISO(), Array.from({ length: 6 }, () => set()))]

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.S = state()
  mocks.search = ''
  mocks.heatmaps.length = 0
  for (const fn of [mocks.nav, mocks.calendarSheet, mocks.workoutDetailSheet, mocks.dayOverrideSheet, mocks.exerciseHistorySheet]) fn.mockClear()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = (search = '') => { mocks.search = search; act(() => root.render(<TrainingLoad />)) }
const seg = () => host.querySelector('.seg')
const segLabels = () => [...seg().querySelectorAll('button')].map(b => b.textContent)
const segButton = label => [...seg().querySelectorAll('button')].find(b => b.textContent === label)
const selected = () => [...seg().querySelectorAll('button[aria-pressed="true"]')].map(b => b.textContent)
const cardTitles = () => [...host.querySelectorAll('.card h2')].map(h => h.textContent.trim())
const emptyTitle = () => host.querySelector('.empty strong')?.textContent
const buttonWithText = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const click = el => { expect(el, 'expected an element to click').toBeTruthy(); act(() => el.click()) }

describe('TrainingLoad — views and deep link', () => {
  it('offers Activity, Muscles and Plan, opening on Activity with the year heatmap', () => {
    mount()
    expect(segLabels()).toEqual(['Activity', 'Muscles', 'Plan'])
    expect(selected()).toEqual(['Activity'])
    expect(cardTitles()).toContain('Activity (last 12 months)')
    expect(host.querySelector('[data-heatmap]')).toBeTruthy()
  })

  it.each([
    ['muscles', 'Muscles'],
    ['plan', 'Plan'],
    ['activity', 'Activity'],
  ])('opens on ?view=%s', (view, label) => {
    mocks.S = state({ workouts: [workout('w', '2026-01-10', [set()])] })
    mount(`?view=${view}`)
    expect(selected()).toEqual([label])
  })

  it('falls back to Activity for an invalid view', () => {
    mount('?view=nonsense')
    expect(selected()).toEqual(['Activity'])
    expect(host.querySelector('[data-heatmap]')).toBeTruthy()
  })

  it('falls back to Activity for ?view=effort when there is no effort data', () => {
    mount('?view=effort')
    expect(selected()).toEqual(['Activity'])
  })

  it('switches segment in place and replaces the URL, keeping other params', () => {
    mount('?x=1')
    click(segButton('Plan'))
    expect(mocks.nav).toHaveBeenCalledWith('/progress/load?x=1&view=plan', { replace: true })
    expect(selected()).toEqual(['Plan'])
    expect(host.querySelector('[data-weekly-muscle-volume]')).toBeTruthy()
    expect(host.querySelector('[data-heatmap]')).toBeNull()

    click(segButton('Muscles'))
    expect(mocks.nav).toHaveBeenLastCalledWith('/progress/load?x=1&view=muscles', { replace: true })
    expect(selected()).toEqual(['Muscles'])
  })

  it('opens Plan for the legacy ?focus=weekly-volume link and replaces the URL without focus', () => {
    mount('?focus=weekly-volume')
    expect(selected()).toEqual(['Plan'])
    expect(host.querySelector('[data-weekly-muscle-volume]')).toBeTruthy()
    expect(mocks.nav).toHaveBeenCalledTimes(1)
    expect(mocks.nav).toHaveBeenCalledWith('/progress/load?view=plan', { replace: true })
  })

  it('keeps other params when redirecting the legacy focus link', () => {
    mount('?focus=weekly-volume&x=1')
    expect(mocks.nav).toHaveBeenCalledWith('/progress/load?x=1&view=plan', { replace: true })
  })

  it('does not redirect without the legacy focus', () => {
    mount('?view=plan')
    expect(mocks.nav).not.toHaveBeenCalled()
  })
})

describe('TrainingLoad — Effort segment', () => {
  it('is hidden without effort data', () => {
    mocks.S = state({ workouts: [workout('bw', '2026-01-10', [{ done: true, w: 0, r: 10 }])] })
    mount()
    expect(segLabels()).not.toContain('Effort')
  })

  it('appears for rated history and opens the Effort card', () => {
    mocks.S = state({ workouts: ratedWorkouts() })
    mount()
    expect(segLabels()).toEqual(['Activity', 'Muscles', 'Plan', 'Effort'])
    click(segButton('Effort'))
    expect(mocks.nav).toHaveBeenCalledWith('/progress/load?view=effort', { replace: true })
    const head = [...host.querySelectorAll('.card h2')].find(h => h.textContent.trim().startsWith('Effort'))
    expect(head).toBeTruthy()
    expect(head.textContent).not.toContain('estimated')
  })

  it('reads short in German and keeps the full word as the name', async () => {
    const de = (await import('../locales/de.js')).default
    _setLangState('de', de, null, null)
    try {
      mocks.S = state({ workouts: ratedWorkouts() })
      mount()
      const effort = [...seg().querySelectorAll('button')].at(-1)
      expect(effort.textContent).toBe('Einsatz')
      expect(effort.getAttribute('aria-label')).toBe('Anstrengung')
    } finally { _setLangState('en', {}, null, null) }
  })

  it('opens directly on ?view=effort', () => {
    mocks.S = state({ workouts: ratedWorkouts() })
    mount('?view=effort')
    expect(selected()).toEqual(['Effort'])
  })

  it('badges estimated numbers on unrated import history', () => {
    mocks.S = state({ workouts: unratedWorkouts() })
    mount('?view=effort')
    const head = [...host.querySelectorAll('.card h2')].find(h => h.textContent.trim().startsWith('Effort'))
    expect(head, 'expected an Effort card for estimable history').toBeTruthy()
    // Six self-anchored sets estimate RIR 0: a real average with an honest badge.
    expect(head.textContent).toContain('estimated')
    expect(host.textContent).toContain('0 rated')
  })
})

describe('TrainingLoad — calendar action and heatmap taps', () => {
  it('opens the calendar on today from the header action', () => {
    mount()
    click(host.querySelector('button[aria-label="Calendar"]'))
    expect(mocks.calendarSheet).toHaveBeenCalledWith(todayISO())
  })

  it('opens the workout detail when the tapped day has one workout', () => {
    const only = workout('only', '2026-01-10', [set()])
    mocks.S = state({ workouts: [only, workout('other', '2026-01-11', [set()])] })
    mount()
    mocks.heatmaps.at(-1).onDay('2026-01-10')
    expect(mocks.workoutDetailSheet).toHaveBeenCalledWith(only)
    expect(mocks.calendarSheet).not.toHaveBeenCalled()
    expect(mocks.dayOverrideSheet).not.toHaveBeenCalled()
  })

  it('opens the calendar on the day when it has several workouts', () => {
    mocks.S = state({ workouts: [workout('a', '2026-01-10', [set()]), workout('b', '2026-01-10', [set()])] })
    mount()
    mocks.heatmaps.at(-1).onDay('2026-01-10')
    expect(mocks.calendarSheet).toHaveBeenCalledWith('2026-01-10')
    expect(mocks.workoutDetailSheet).not.toHaveBeenCalled()
    expect(mocks.dayOverrideSheet).not.toHaveBeenCalled()
  })

  it('opens the day override sheet on a day without workouts', () => {
    mocks.S = state({ workouts: [workout('a', '2026-01-10', [set()])] })
    mount()
    mocks.heatmaps.at(-1).onDay('2026-01-12')
    expect(mocks.dayOverrideSheet).toHaveBeenCalledWith('2026-01-12')
    expect(mocks.workoutDetailSheet).not.toHaveBeenCalled()
    expect(mocks.calendarSheet).not.toHaveBeenCalled()
  })

  it('reads the heatmap metric from the profile, defaulting to time', () => {
    mount()
    expect(mocks.heatmaps.at(-1).metric).toBe('time')
    act(() => root.unmount())
    root = createRoot(host)
    mocks.S = state({ heatmapMetric: 'vol' })
    mount()
    expect(mocks.heatmaps.at(-1).metric).toBe('vol')
  })
})

describe('TrainingLoad — Muscles and Plan', () => {
  it('shows the muscle maps when there are workouts', () => {
    mocks.S = state({ workouts: [workout('w', '2026-01-10', [set()])] })
    mount('?view=muscles')
    expect(host.querySelector('[data-body-map]')).toBeTruthy()
    expect(emptyTitle()).toBeUndefined()
  })

  it('shows the muscle maps for a plan with no workouts yet', () => {
    mount('?view=muscles')
    expect(host.querySelector('[data-body-map]')).toBeTruthy()
    expect(emptyTitle()).toBeUndefined()
  })

  it('shows "No workouts yet" with no workouts and no planned load', () => {
    mocks.S = state({ routines: [], week: {} })
    mount('?view=muscles')
    expect(emptyTitle()).toBe('No workouts yet')
    expect(host.querySelector('[data-body-map]')).toBeNull()
  })

  it('sits Weekly muscle volume on Plan once there are routines', () => {
    mount('?view=plan')
    expect(host.querySelector('[data-weekly-muscle-volume]').textContent).toContain('Chest2 sets')
    expect(emptyTitle()).toBeUndefined()
  })

  it('shows "No routines yet" on Plan, and its Routines pill opens the routines', () => {
    mocks.S = state({ routines: [], week: {} })
    mount('?view=plan')
    expect(emptyTitle()).toBe('No routines yet')
    expect(host.querySelector('[data-weekly-muscle-volume]')).toBeNull()
    click(buttonWithText('Routines'))
    expect(mocks.nav).toHaveBeenCalledWith('/train/routines')
  })
})
