// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MUSCLES, levelsOf } from '../lib/muscles.js'
import { FATIGUE_STATES, STRENGTH_FLOOR, fatigueHalfLifeOf, FATIGUE_SETS_PER_UNIT } from '../lib/recovery.js'
import { fatigueStateOf } from '../lib/recovery-view.js'
import MuscleBalance from './MuscleBalance.jsx'

const DAY = 86400000
const NOW = new Date(2026, 8, 30, 12).getTime()
const BASE_NOW = Date.UTC(2026, 0, 22, 12)
const press = { id: 'press', n: 'Press', primaries: ['chest'], secondaries: ['triceps'], custom: true }

const mocks = vi.hoisted(() => ({ S: null, maps: [], mapMounts: 0, exerciseHistorySheet: vi.fn() }))

vi.mock('../sheets.jsx', () => ({ exerciseHistorySheet: mocks.exerciseHistorySheet }))
vi.mock('./BodyMap.jsx', () => ({
  default: props => {
    mocks.maps.push(props)
    React.useEffect(() => { mocks.mapMounts += 1 }, [])
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
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.maps.length = 0
  mocks.mapMounts = 0
  mocks.exerciseHistorySheet.mockClear()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const mount = () => act(() => root.render(<MuscleBalance S={mocks.S} />))
const lastMap = () => mocks.maps.at(-1)
const button = label => host.querySelector(`button[aria-label="${label}"]`)
const click = el => { expect(el, 'expected an element to click').toBeTruthy(); act(() => el.click()) }
const buttonWithText = (scope, text) => [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const viewSeg = () => host.querySelectorAll('.seg')[0]
const windowSeg = () => host.querySelectorAll('.seg')[1]
const viewButton = text => buttonWithText(viewSeg(), text)
const windowButton = text => buttonWithText(windowSeg(), text)
const hardToggle = () => [...host.querySelectorAll('button')].find(b => !b.closest('.seg') && ['All', 'Hard'].includes(b.textContent.trim()))
const comparison = () => host.querySelector('[data-weekly-volume-comparison]')
const weeklyToggle = () => comparison().querySelector('.weekly-volume-toggle')
const row = muscle => comparison().querySelector(`[data-muscle-volume="${muscle}"]`)
const value = muscle => row(muscle).querySelector('.mus-v')
const renderedMuscles = () => [...comparison().querySelectorAll('[data-muscle-volume]')].map(item => item.dataset.muscleVolume)
const missedRow = () => [...comparison().querySelectorAll('.lrow-t')].find(item => item.textContent === 'Not trained in this period')?.closest('.lrow') || null
const missedNames = () => missedRow()?.querySelector('.lrow-s').textContent.split(', ') || []
const rowTitles = () => [...host.querySelectorAll('.lrow-t')].map(el => el.textContent)
const statCard = () => host.querySelector('.stat-card')
const isBefore = (first, second) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
const expectPressed = el => expect(el?.getAttribute('aria-pressed')).toBe('true')

describe('MuscleBalance — weekly planned vs completed volume', () => {
  beforeEach(() => {
    vi.setSystemTime(NOW)
    mocks.S = state({ workouts: [completed('2026-09-30', 'biceps', 3)] })
  })

  it('shows completed/planned progress with completed first for the current week', () => {
    mocks.S = state({
      routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
      workouts: [completed('2026-09-30', 'chest', 8), completed('2026-09-30', 'biceps', 3)],
    })
    mount()
    expect(button('Previous week')).toBeTruthy()
    expect(host.querySelector('[data-body-map]')).toBeTruthy()
    expect(host.querySelector('[data-body-map-legend]')).toBeTruthy()
    expect(lastMap().captions).toBe(true)
    expect(lastMap().load).toEqual({ chest: 8, biceps: 3 })
    expect(renderedMuscles()).toEqual(['chest', 'biceps', 'triceps'])
    expect(value('chest').textContent).toBe('8/12 · 67%')
    expect(value('chest').getAttribute('aria-label')).toBe('Completed 8 sets · Planned 12 sets')
    expect(value('triceps').textContent).toBe('0/4.8 · 0%')
    // No plan target: the sets alone, never "3/0".
    expect(value('biceps').textContent).toBe('3 sets')
    expect(value('biceps').getAttribute('aria-label')).toBeNull()
    expect(button('Next week').disabled).toBe(true)
    expect(host.querySelector('.pnav-s').textContent).toBe('This week')
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
    expect(isBefore(weeklyToggle(), missedRow())).toBe(true)
    expect(missedNames()).toContain('Triceps')

    click(weeklyToggle())
    expect(renderedMuscles()).toEqual(['biceps', 'upper-back', 'chest', 'calves', 'deltoids', 'triceps'])
    expect(weeklyToggle().textContent).toBe('Show less')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('true')
    expect(isBefore(weeklyToggle(), missedRow())).toBe(true)
    expect(value('triceps').textContent).toBe('0/4.8 · 0%')
    expect(isBefore(row('triceps'), missedRow())).toBe(true)
    expect(missedNames()).toContain('Triceps')

    click(weeklyToggle())
    expect(renderedMuscles()).toEqual(['biceps', 'upper-back', 'chest', 'calves'])
    expect(weeklyToggle().textContent).toBe('Show more')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('joins the missed muscle names into one row subtitle', () => {
    mount()
    expect(missedRow()).toBeTruthy()
    expect(missedRow().querySelector('.lrow-s').textContent).toBe(missedNames().join(', '))
    expect(missedNames()).toContain('Chest')
    expect(missedNames()).not.toContain('Biceps')
    expect(comparison().querySelector('.mchip')).toBeNull()
  })

  it('shows the completed-all-muscles note after current-week rows', () => {
    mocks.S = state({ workouts: MUSCLES.map(muscle => completed('2026-09-30', muscle, 1)) })
    mount()
    const note = [...comparison().querySelectorAll('.inote')]
      .find(item => item.textContent === 'Every muscle group got some work in this period.')
    expect(note).toBeTruthy()
    expect(missedRow()).toBeNull()
    expect(isBefore(row(renderedMuscles().at(-1)), note)).toBe(true)
  })

  it('shows the selected muscle in a StatCard and keeps the full list with the row pressed', () => {
    mocks.S = state({
      routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
      workouts: [
        completed('2026-09-30', 'chest', 8), completed('2026-09-30', 'biceps', 7),
        completed('2026-09-30', 'upper-back', 6), completed('2026-09-30', 'calves', 5),
        completed('2026-09-30', 'deltoids', 4),
      ],
    })
    mount()
    expect(statCard()).toBeNull()
    expect(comparison().querySelector('.inote').textContent).toBe('Tap a muscle to see its numbers.')
    expect(weeklyToggle()).toBeTruthy()

    click(host.querySelector('[data-body-map] button[aria-label="Chest"]'))
    expect(host.querySelector('[data-body-map]').dataset.selected).toBe('chest')
    expect(statCard().querySelector('.stat-card-l').textContent).toBe('Chest')
    expect(statCard().querySelector('.stat-card-num').textContent).toBe('8')
    expect(statCard().querySelector('.stat-card-u').textContent).toBe('/ 12 sets')
    expect(statCard().querySelector('.stat-card-c').textContent).toBe('67% of plan')
    expect(comparison().textContent).not.toContain('Tap a muscle to see its numbers.')
    expect(renderedMuscles()).toHaveLength(4)
    expect(weeklyToggle()).toBeTruthy()
    expect(row('chest').getAttribute('aria-pressed')).toBe('true')
    expect(row('biceps').getAttribute('aria-pressed')).toBe('false')

    click(row('biceps'))
    expect(host.querySelector('[data-body-map]').dataset.selected).toBe('biceps')
    expect(statCard().querySelector('.stat-card-l').textContent).toBe('Biceps')
    expect(row('biceps').getAttribute('aria-pressed')).toBe('true')

    click(row('biceps'))
    expect(statCard()).toBeNull()
    expect(host.querySelector('[data-body-map]').dataset.selected).toBe('')
  })

  it('shows the real percentage for an over-plan muscle', () => {
    mocks.S = state({
      routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
      workouts: [completed('2026-09-30', 'chest', 14)],
    })
    mount()
    expect(value('chest').textContent).toBe('14/12 · 117%')
  })

  it('explains a muscle that is not in the plan', () => {
    mocks.S = state({ workouts: [completed('2026-09-30', 'biceps', 3)] })
    mount()
    click(row('biceps'))
    expect(statCard().querySelector('.stat-card-c').textContent).toBe('Not in your plan this week')
    expect(statCard().querySelector('.stat-card-num').textContent).toBe('3')
    expect(statCard().querySelector('.stat-card-u').textContent).toBe('sets')
    expect(statCard().textContent).not.toContain('Planned')
  })

  it('navigates previous weeks as completed-only and respects a Sunday week start', () => {
    mocks.S = state({
      weekStart: 0,
      workouts: [completed('2026-09-27', 'biceps', 1), completed('2026-09-20', 'quadriceps', 4)],
    })
    mount()
    expect(comparison().dataset.week).toBe('2026-09-27')
    click(button('Previous week'))
    expect(comparison().dataset.week).toBe('2026-09-20')
    expect(host.querySelector('.pnav-s')).toBeNull()
    expect(host.querySelector('[data-body-map-legend]')).toBeTruthy()
    expect(lastMap().load).toEqual({ quadriceps: 4 })
    expect(value('quadriceps').textContent).toBe('4 sets')
    expect(comparison().textContent).not.toContain('/')
    expect(comparison().textContent).not.toContain('Planned')
    expect(comparison().querySelector('[aria-label*="Planned"]')).toBeNull()
    expect(missedNames()).toContain('Chest')
    expect(button('Next week').disabled).toBe(false)
    click(button('Next week'))
    expect(comparison().dataset.week).toBe('2026-09-27')
    expect(button('Next week').disabled).toBe(true)
  })

  it('shows the selected previous-week muscle without plan semantics', () => {
    mocks.S = state({ workouts: [completed('2026-09-22', 'quadriceps', 4)] })
    mount()
    click(button('Previous week'))
    click(row('quadriceps'))
    expect(statCard().querySelector('.stat-card-num').textContent).toBe('4')
    expect(statCard().querySelector('.stat-card-u').textContent).toBe('sets')
    expect(statCard().textContent).not.toContain('Planned')
    expect(statCard().textContent).not.toContain('of plan')
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
    click(weeklyToggle())
    expect(renderedMuscles()).toHaveLength(6)

    click(button('Previous week'))
    expect(renderedMuscles()).toEqual(['quadriceps', 'hamstring', 'gluteal', 'calves'])
    expect(weeklyToggle().textContent).toBe('Show more')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('false')

    click(weeklyToggle())
    expect(renderedMuscles()).toEqual(['quadriceps', 'hamstring', 'gluteal', 'calves', 'upper-back', 'biceps'])
    expect(weeklyToggle().textContent).toBe('Show less')
    expect(weeklyToggle().getAttribute('aria-expanded')).toBe('true')
    expect(isBefore(weeklyToggle(), missedRow())).toBe(true)
    expect(comparison().textContent).not.toContain('/')
    expect(comparison().textContent).not.toContain('Planned')
    expect(comparison().querySelector('[aria-label*="Planned"]')).toBeNull()

    click(weeklyToggle())
    expect(renderedMuscles()).toEqual(['quadriceps', 'hamstring', 'gluteal', 'calves'])
    expect(weeklyToggle().textContent).toBe('Show more')

    click(weeklyToggle())
    click(button('Next week'))
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
    click(button('Previous week'))
    expect(renderedMuscles()).toEqual(['quadriceps', 'hamstring'])
    expect(weeklyToggle()).toBeNull()
  })

  it('keeps the completed map, legend, navigator, and empty state for an empty previous week', () => {
    mount()
    click(button('Previous week'))
    expect(button('Previous week')).toBeTruthy()
    expect(button('Next week').disabled).toBe(false)
    expect(host.querySelector('[data-body-map]')).toBeTruthy()
    expect(host.querySelector('[data-body-map-legend]')).toBeTruthy()
    expect(lastMap().load).toEqual({})
    expect(comparison().textContent).toContain('No workouts in this period yet.')
    expect(comparison().textContent).not.toContain('Planned')
    expect(comparison().querySelector('[aria-label*="Planned"]')).toBeNull()
    expect(comparison().querySelector('.inote').textContent).toBe('No workouts in this period yet.')
  })

  it('omits 0/0 mappings while retaining planned-positive completed-zero rows', () => {
    const zeroPress = { id: 'zero-press', n: 'Zero press', muscleWeights: { chest: 1, biceps: 0 }, custom: true }
    const plannedOnly = { id: 'planned-only', n: 'Planned only', muscleWeights: { triceps: 1 }, custom: true }
    mocks.S = state({
      customEx: [zeroPress, plannedOnly],
      routines: [{
        id: 'zero-plan', name: 'Zero plan',
        ex: [{ id: zeroPress.id, sets: 2 }, { id: plannedOnly.id, sets: 1 }],
      }],
      week: { 1: ['zero-plan'] },
      workouts: [{
        id: 'zero-workout', d: '2026-09-30', start: new Date('2026-09-30T12:00:00').getTime(),
        entries: [{ id: zeroPress.id, exercise: zeroPress, sets: [{ done: true }, { done: true }] }],
      }],
    })
    mount()

    expect(lastMap().load).toEqual({ chest: 2 })
    expect(value('chest').textContent).toBe('2/2 · 100%')
    expect(value('triceps').textContent).toBe('0/1 · 0%')
    expect(row('biceps')).toBeNull()
  })
})

describe('MuscleBalance — windows and the hard-set toggle', () => {
  const rated = (d, muscle, sets, rir) => {
    const w = completed(d, muscle, sets)
    w.entries[0].sets = w.entries[0].sets.map(s => ({ ...s, rir }))
    return w
  }

  beforeEach(() => {
    vi.setSystemTime(NOW)
    mocks.S = state({ workouts: [rated('2026-09-20', 'chest', 3, 0), rated('2026-09-20', 'biceps', 2, 5)] })
  })

  it('puts the view segments first, then the window segments, with Week selected', () => {
    mount()
    expect([...viewSeg().querySelectorAll('button')].map(b => b.textContent)).toEqual(['Muscle balance', 'Fatigue', 'Strength'])
    expect([...windowSeg().querySelectorAll('button')].map(b => b.textContent)).toEqual(['Week', '30d', '90d', 'All'])
    expectPressed(viewButton('Muscle balance'))
    expectPressed(windowButton('Week'))
    expect(host.querySelector('.pnav')).toBeTruthy()
    expect(hardToggle()).toBeUndefined()
  })

  it('swaps the week navigator for a Hard/All toggle on a window, only when hard sets are rated', () => {
    mount()
    click(windowButton('30d'))
    expectPressed(windowButton('30d'))
    expect(host.querySelector('.pnav')).toBeNull()
    expect(comparison()).toBeNull()
    expect(hardToggle().textContent.trim()).toBe('All')
    expect(hardToggle().getAttribute('aria-pressed')).toBe('false')
    expect(lastMap().load).toEqual({ chest: 3, biceps: 2 })
    expect(rowTitles()).toContain('Not trained in this period')
    expect(rowTitles()).not.toContain('No hard sets in this period')

    click(hardToggle())
    expect(hardToggle().textContent.trim()).toBe('Hard')
    expect(hardToggle().getAttribute('aria-pressed')).toBe('true')
    expect(lastMap().load).toEqual({ chest: 3 })
    expect(rowTitles()).toContain('No hard sets in this period')
    expect([...host.querySelectorAll('[data-muscle-volume]')].map(el => el.dataset.muscleVolume)).toEqual(['chest'])

    click(host.querySelector('[data-muscle-volume="chest"]'))
    expect(statCard().querySelector('.stat-card-m').textContent).toBe('by hard sets')
    expect(statCard().querySelector('.stat-card-u').textContent).toBe('sets')
  })

  it('does not offer the toggle when no set is rated hard', () => {
    mocks.S = state({ workouts: [rated('2026-09-20', 'biceps', 2, 5)] })
    mount()
    click(windowButton('90d'))
    expect(hardToggle()).toBeUndefined()
  })
})

describe('MuscleBalance — recovery views', () => {
  const set = (done, extra = {}) => ({ done, w: 80, r: 8, unit: 'kg', ...extra })
  const entry = (id, sets) => ({ id, sets })
  const iso = timestamp => new Date(timestamp).toISOString().slice(0, 10)
  const workout = (id, start, entries) => ({ id, d: iso(start), start, unit: 'kg', entries })
  const tick = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

  const lifecycleWorkouts = (now = BASE_NOW) => {
    // Six same-load sets on the chest score 6/8 of a full session, amplified by the
    // acute:chronic gain of a lone recent session ((6+4)/(1.5+4)). Position that
    // stimulus 30 seconds before its .5 crossing so the real interval update flips it.
    // (The 30-day-old balance session sits outside the 28-day chronic window.)
    const loneGain = (6 + 4) / (6 / 4 + 4)
    const fatigueEdge = now - (
      fatigueHalfLifeOf('chest') * Math.log2(6 / FATIGUE_SETS_PER_UNIT * loneGain / Math.LN2) - 30000
    )
    return [
      workout('fatigue-edge', fatigueEdge, [entry('1254', Array.from({ length: 6 }, () => set(true, { rir: 0 })))]),
      workout('balance-edge', now - (30 * DAY - 30000), [entry('1254', [set(true, { rir: 2 })])]),
      workout('strength-edge', now - (14 * DAY - 30000), [entry('1001', [set(true, { rir: 2 })])]),
      workout('abs-completed', now - 20 * DAY, [entry('1002', [set(true, { rir: 2 })])]),
      workout('abs-undone', now - DAY, [entry('1002', [set(false, { rir: 0 })])]),
    ]
  }
  const allFatiguedWorkout = (now = BASE_NOW) => {
    const ids = [
      '1018', '1012', '1167', '1013', '3011', '1413', '1399', '1016', '1005',
      '1010', '1003', '1001', '1511', '1494', '1002', '1000', '1396',
    ]
    return workout('all-fatigued', now, ids.map(id => entry(id, Array.from({ length: 12 }, () => set(true)))))
  }
  const useFixture = (workouts = lifecycleWorkouts(), over = {}) => {
    mocks.S = { unit: 'kg', body: 'male', effort: 'rir', targetW: null, bodyweight: [], routines: [], workouts, ...over }
  }
  const muscleRow = name => [...host.querySelectorAll('.mus-row')].find(r => r.querySelector('.lrow-t')?.textContent === name)
  const exerciseRow = () => [...host.querySelectorAll('.lrow')].find(r => !r.classList.contains('mus-row') && r.textContent.includes('Est. 1RM'))

  beforeEach(() => { vi.setSystemTime(BASE_NOW); useFixture() })

  it('keeps the selection and window through Balance, Fatigue, and Strength', () => {
    mount()
    expectPressed(viewButton('Muscle balance'))
    expectPressed(windowButton('Week'))

    click(windowButton('30d'))
    click(hardToggle())
    click(host.querySelector('[aria-label="Chest"]'))
    expect(hardToggle().textContent.trim()).toBe('Hard')

    click(viewButton('Fatigue'))
    expectPressed(viewButton('Fatigue'))
    expect(lastMap().thresholds).toBeTruthy()
    expect(lastMap().captions).toBe(true)
    expect(host.textContent).toContain('Fatigue shows how recently each muscle was trained. High means rest.')
    expect(host.querySelector('[data-selected="chest"]')).toBeTruthy()
    expect(statCard().querySelector('.stat-card-l').textContent).toBe('Chest')
    expect(host.firstElementChild.classList.contains('hm-fatigue')).toBe(true)

    click(viewButton('Strength'))
    expectPressed(viewButton('Strength'))
    expect(lastMap().thresholds.at(-1)).toEqual({ at: 1, level: 4 })
    expect(host.textContent).toContain('Strength shows retained muscle strength. Train again to reset it.')
    expect(host.firstElementChild.classList.contains('hm-strength')).toBe(true)

    click(viewButton('Muscle balance'))
    expectPressed(windowButton('30d'))
    expect(hardToggle().textContent.trim()).toBe('Hard')
    expect(lastMap().selected).toBe('chest')
    expect(lastMap().load.chest).toBe(7)
  })

  it('updates the rendered Fatigue map and Balance window on the real 60-second interval', async () => {
    mount()
    click(windowButton('30d'))
    click(viewButton('Fatigue'))
    click(host.querySelector('[aria-label="Chest"]'))

    const mountsBeforeTick = mocks.mapMounts
    const beforeTick = lastMap().load.chest
    expect(fatigueStateOf(beforeTick)).toBe(FATIGUE_STATES.FATIGUED)
    expect(statCard().querySelector('.stat-card-num').textContent).toBe('Fatigued')

    await tick(60000)

    const afterTick = lastMap().load.chest
    expect(mocks.mapMounts).toBe(mountsBeforeTick)
    expect(afterTick).toBeLessThan(beforeTick)
    expect(fatigueStateOf(afterTick)).toBe(FATIGUE_STATES.RECOVERING)
    expect(statCard().querySelector('.stat-card-num').textContent).toBe('Recovering')

    click(viewButton('Strength'))
    expect(lastMap().load.quadriceps).toBeLessThan(1)
    click(viewButton('Muscle balance'))
    expect(lastMap().load.chest).toBe(6)
  })

  it('derives a pound-profile bodyweight in kg and passes it into the rendered Fatigue map', () => {
    useFixture([workout('bodyweight', BASE_NOW, [entry('0001', [{ done: true, w: 0, r: 10 }])])], {
      unit: 'lb', bodyweight: [{ d: '2026-01-20', w: 180 }, { d: '2026-01-22', w: 220.462262 }],
    })
    mount()
    click(viewButton('Fatigue'))

    // One unloaded set is one effective set whatever the profile unit or body mass:
    // intensity is session-local and relative, so the 220 lb bodyweight only travels
    // through opts while the score stays 1 - exp(-1/8 x novice gain of 5/4.25).
    expect(lastMap().load.abs).toBeCloseTo(1 - Math.exp(-5 / 34), 6)
    expect(lastMap().thresholds).toBeTruthy()
  })

  it('renders fixed absolute bands through the actual Fatigue and Strength views', () => {
    // Two back-to-back full sessions: even 0.4-weighted secondary movers accumulate
    // 2 x 12 x 0.4 / 8 = 1.2 raw units, clearing the top band everywhere.
    useFixture([allFatiguedWorkout(), allFatiguedWorkout()])
    mount()
    click(viewButton('Fatigue'))
    const fatigueMap = lastMap()
    expect(Object.keys(fatigueMap.load)).toEqual(MUSCLES)
    expect(Object.values(fatigueMap.load).every(v => v > 0.5)).toBe(true)
    expect(Object.values(levelsOf(fatigueMap.load, fatigueMap.thresholds)).every(level => level === 4)).toBe(true)

    act(() => root.unmount())
    root = createRoot(host)
    useFixture([workout('all-subfull', BASE_NOW - 15 * DAY, [entry('1254', [set(true)])])])
    mount()
    click(viewButton('Strength'))
    const strengthMap = lastMap()
    expect(Object.values(strengthMap.load).every(v => v < 1)).toBe(true)
    expect(Math.min(...Object.values(strengthMap.load))).toBe(STRENGTH_FLOOR)
    expect(strengthMap.thresholds.at(-1)).toEqual({ at: 1, level: 4 })
  })

  it('keeps zero-weight snapshots out of recovery maps and last-trained recency', () => {
    useFixture([workout('zero-mapped', BASE_NOW, [{
      id: 'deleted-zero-mapped',
      muscleSnapshot: { n: 'Zero mapped', muscleWeights: { chest: 1, biceps: 0 } },
      sets: [set(true)],
    }])])
    mount()

    expect(lastMap().load).toEqual({ chest: 1 })
    click(viewButton('Fatigue'))
    expect(lastMap().load.chest).toBeGreaterThan(0)
    expect(lastMap().load.biceps).toBe(0)
    expect(levelsOf(lastMap().load, lastMap().thresholds).biceps).toBe(0)

    click(viewButton('Strength'))
    expect(lastMap().load.chest).toBe(1)
    expect(lastMap().load.biceps).toBe(STRENGTH_FLOOR)
    expect(host.textContent).toContain('Losing strength')
    expect(muscleRow('Biceps').querySelector('.mus-v').textContent).toContain('not trained')
  })

  it('opens the exercise history sheet when a strength exercise row is tapped', () => {
    useFixture([workout('bench', BASE_NOW, [entry('0025', [set(true, { w: 80 })])])])
    mount()
    click(viewButton('Strength'))
    expect(host.textContent).toContain('Tap a muscle to see its exercises.')
    click(host.querySelector('[aria-label="Chest"]'))
    expect(host.textContent).toContain('Exercises · Chest')
    expect(statCard().querySelector('.stat-card-l').textContent).toBe('Chest')
    const exercise = exerciseRow()
    expect(exercise, 'expected a tappable exercise row for the chest').toBeTruthy()
    expect(exercise.tagName).toBe('BUTTON')
    expect(exercise.textContent).toContain('arbell bench press')

    click(exercise)
    expect(mocks.exerciseHistorySheet).toHaveBeenCalledTimes(1)
    expect(mocks.exerciseHistorySheet).toHaveBeenCalledWith('0025')
  })

  it('quotes the retained strength of an exercise as a percentage under 100 once it has decayed', () => {
    useFixture([workout('bench-old', BASE_NOW - 20 * DAY, [entry('0025', [set(true, { w: 80 })])])])
    mount()
    click(viewButton('Strength'))
    click(host.querySelector('[aria-label="Chest"]'))
    const pct = exerciseRow().querySelector('.lrow-v').textContent.match(/(\d+)%/)[1]
    expect(Number(pct)).toBeLessThan(100)
    expect(exerciseRow().querySelector('.lrow-v').textContent).toMatch(/^\d+(\.\d+)? kg · \d+%$/)
  })

  it('lists detrained muscles as pressable rows that select the muscle', () => {
    useFixture([workout('old-bench', BASE_NOW - 20 * DAY, [entry('0025', [set(true, { w: 80 })])])])
    mount()
    click(viewButton('Strength'))
    const chest = muscleRow('Chest')
    expect(chest).toBeTruthy()
    expect(chest.getAttribute('aria-pressed')).toBe('false')
    expect(chest.querySelector('.mus-v').textContent).toMatch(/sets$/)
    click(chest)
    expect(muscleRow('Chest').getAttribute('aria-pressed')).toBe('true')
    expect(lastMap().selected).toBe('chest')
    expect(statCard().querySelector('.stat-card-num').textContent).toMatch(/^\d+%$/)
  })
})
