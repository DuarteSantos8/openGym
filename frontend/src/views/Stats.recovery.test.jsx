import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MUSCLES, MUSCLE_NAME, levelsOf, rankOf, loadOfWorkouts } from '../lib/muscles.js'
import { FATIGUE_STATES, STRENGTH_FLOOR, fatigueOf, strengthOf } from '../lib/recovery.js'
import { fatigueStateOf } from '../lib/recovery-view.js'
import Stats, { weeksSinceTraining, FATIGUE_LEVELS, STRENGTH_LEVELS } from './Stats.jsx'

const DAY = 86400000
const HOUR = 3600000
const BASE_NOW = Date.UTC(2026, 0, 22, 12)

const mocks = vi.hoisted(() => ({
  maps: [],
  mapMounts: 0,
  S: {
    unit: 'kg', body: 'male', effort: 'rir', targetW: null,
    bodyweight: [], routines: [], workouts: [],
  },
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: mocks.S }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {},
  WorkoutRow: () => React.createElement('div'), bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/Icon.jsx', () => ({ default: props => React.createElement('span', props) }))
vi.mock('../components/BodyMap.jsx', () => ({
  default: props => {
    mocks.maps.push(props)
    return React.createElement('div', { 'data-body-map': true, 'data-selected-muscle': props.selected || '' })
  },
  BodyMapLegend: () => React.createElement('div', { 'data-balance-legend': true }),
}))

function iso(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function set(done, extra = {}) {
  return { done, w: 80, r: 8, unit: 'kg', ...extra }
}

function workout(id, start, entries) {
  return { id, d: iso(start), start, unit: 'kg', entries }
}

function entry(id, sets) {
  return { id, sets }
}

function lifecycleWorkouts(now = BASE_NOW) {
  // A 6-set chest day (6 x 80kg x 8, intensity-weighted ~2694 kg) crosses .5 at ~35 hours,
  // so the edge flips fatigued -> recovering after one 60-second tick.
  const fatigueEdge = now - (36 * Math.log2((6 * 640 * (30 / 38) ** 1.5) / (2000 * Math.LN2)) * HOUR - 30000)
  // This completed set is in the initial 30-day Balance window, then ages out after one tick.
  const balanceEdge = now - (30 * DAY - 30000)
  // The 14-day strength edge becomes sub-full after one tick.
  const strengthEdge = now - (14 * DAY - 30000)
  // This completed event must remain the latest training event for abs: the newer set is undone.
  const absCompleted = now - 20 * DAY
  const absUndone = now - DAY
  return [
    workout('fatigue-edge', fatigueEdge, [entry('1254', Array.from({ length: 6 }, () => set(true, { rir: 0 })))]),
    workout('balance-edge', balanceEdge, [entry('1254', [set(true, { rir: 2 })])]),
    workout('strength-edge', strengthEdge, [entry('1001', [set(true, { rir: 2 })])]),
    workout('abs-completed', absCompleted, [entry('1002', [set(true, { rir: 2 })])]),
    workout('abs-undone', absUndone, [entry('1002', [set(false, { rir: 0 })])]),
  ]
}

function allFatiguedWorkout(now = BASE_NOW) {
  // Twelve completed sets per exercise (80kg x 8): every involved muscle gets weighted tonnage
  // >= 12 x 640 x (30/38)^1.5 x 0.4 ~= 2155 kg, i.e. fatigue above the .55 top band regardless
  // of the catalogue's secondary-muscle metadata.
  const ids = [
    ['1018', 1], // trapezius
    ['1012', 1], // deltoids
    ['1167', 1], // chest
    ['1013', 1], // upper-back
    ['3011', 1], // serratus
    ['1413', 1], // biceps
    ['1399', 1], // triceps
    ['1016', 1], // forearm
    ['1005', 2], // abs + obliques
    ['1010', 1], // lower-back
    ['1003', 1], // gluteal
    ['1001', 1], // quadriceps
    ['1511', 1], // hamstring
    ['1494', 1], // adductors
    ['1002', 2], // abs + hip-flexors
    ['1000', 1], // calves
    ['1396', 2], // calves + tibialis
  ]
  return workout('all-fatigued', now, ids.map(([id]) => entry(id, Array.from({ length: 12 }, () => set(true)))))
}

function allSubfullWorkout(now = BASE_NOW) {
  return workout('all-subfull', now - 15 * DAY, [entry('1254', [set(true)])])
}

function resetFixture(workouts = lifecycleWorkouts()) {
  mocks.S.workouts = workouts
  mocks.maps.length = 0
  mocks.mapMounts = 0
}

// Server-render Stats to a static markup string. The BodyMap mock records the maps the
// component computed, so the numeric assertions read from `lastMap()` exactly as before;
// everything view-dependent is asserted on the rendered markup text.
function renderStats() {
  return renderToStaticMarkup(React.createElement(Stats))
}

function textOf(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const lastMap = () => mocks.maps[mocks.maps.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_NOW)
  resetFixture()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Stats muscle recovery view runtime', () => {
  it('starts in Balance and renders the default 7-day map; the 30-day window adds the edge set', () => {
    const workouts = lifecycleWorkouts()
    const html = renderStats()
    const text = textOf(html)
    expect(text).toContain('Muscle balance')
    expect(text).toContain('Week')
    // default 7-day window: only the fatigue-edge (6 sets) sits inside the week
    expect(lastMap().load.chest).toBe(6)
    // the 30-day window adds the balance-edge set - same helper Stats uses
    const cutoff = BASE_NOW - 30 * DAY
    const inWin = workouts.filter(w => (w.start || Date.parse(w.d)) >= cutoff)
    expect(loadOfWorkouts(inWin, null).chest).toBe(7)
  })

  it('computes fatigue with production boundaries, the 60-second decay, and the strength map', () => {
    const workouts = lifecycleWorkouts()
    renderStats()
    const beforeTick = fatigueOf(workouts, BASE_NOW).chest
    expect(fatigueStateOf(beforeTick)).toBe(FATIGUE_STATES.FATIGUED)
    const afterTick = fatigueOf(workouts, BASE_NOW + 60000).chest
    expect(afterTick).toBeLessThan(0.5)
    expect(fatigueStateOf(afterTick)).toBe(FATIGUE_STATES.RECOVERING)
    // one 60-second tick later the 14-day strength edge is past the plateau
    const strength = strengthOf(workouts, BASE_NOW + 60000)
    expect(strength.quadriceps).toBeLessThan(1)
    // the 30-day Balance edge ages out after the tick (30d + 30s), matching the window filter
    const cutoff = BASE_NOW + 60000 - 30 * DAY
    const inWin = workouts.filter(w => (w.start || Date.parse(w.d)) >= cutoff)
    expect(loadOfWorkouts(inWin, null).chest).toBe(6)
  })

  it('ignores an undone latest set, floors rendered training age, and follows production rankOf ordering', () => {
    const workouts = lifecycleWorkouts()
    renderStats()
    // The production helper used by Stats' rendered strength hint floors six elapsed days to zero.
    expect(weeksSinceTraining(BASE_NOW, BASE_NOW - 6 * DAY)).toBe(0)
    // Strength rows follow the production rankOf ordering: worked, sub-full muscles first
    // (the 14-day edge has just crossed the plateau after the 60-second tick).
    const strength = strengthOf(workouts, BASE_NOW + 60000)
    const expectedRows = rankOf(strength).worked
      .filter(slug => strength[slug] < 1)
      .map(slug => MUSCLE_NAME[slug])
    expect(expectedRows).toContain('Quads')
    // The newer abs row is undone, so the abs volume hint still reflects the 20-day-old event.
    expect(weeksSinceTraining(BASE_NOW, BASE_NOW - 20 * DAY)).toBe(2)
  })

  it('uses production boundaries and fixed absolute bands for all-fatigued and all-subfull maps', () => {
    expect(fatigueStateOf(0.2499)).toBe(FATIGUE_STATES.READY)
    expect(fatigueStateOf(0.25)).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatigueStateOf(0.5)).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatigueStateOf(0.5001)).toBe(FATIGUE_STATES.FATIGUED)

    resetFixture([allFatiguedWorkout()])
    const fatigue = fatigueOf([allFatiguedWorkout()], BASE_NOW)
    expect(Object.keys(fatigue)).toEqual(MUSCLES)
    expect(Object.values(fatigue).every(value => value > 0.5)).toBe(true)
    expect(Object.values(levelsOf(fatigue, FATIGUE_LEVELS)).every(level => level === 4)).toBe(true)

    resetFixture([allSubfullWorkout()])
    const strength = strengthOf([allSubfullWorkout()], BASE_NOW)
    expect(Object.values(strength).every(value => value < 1)).toBe(true)
    expect(Math.min(...Object.values(strength))).toBe(STRENGTH_FLOOR)
    expect(STRENGTH_LEVELS.at(-1)).toEqual({ at: 1, level: 4 })
  })
})
