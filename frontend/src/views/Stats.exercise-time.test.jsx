// @vitest-environment happy-dom
// Time per exercise on Stats: each exercise's average time a session, from its ticks
// (lib/exercise-time.js), longest first, over the picked range.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ history: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: vi.fn(), goalSheet: vi.fn(), calendarSheet: vi.fn(), workoutDetailSheet: vi.fn(),
  exerciseHistorySheet: mocks.history, WorkoutRow: () => React.createElement('div'), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/LineChart.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => React.createElement('div'), BodyMapLegend: () => null }))

import { ExerciseTimeCard } from './Stats.jsx'

const MIN = 60000
const DAY = 86400000
const tick = (start, min) => ({ w: 50, r: 8, done: true, at: start + min * MIN })
const session = (daysAgo, entries) => {
  const start = Date.now() - daysAgo * DAY
  return { id: 'w' + daysAgo, d: '2026-10-01', start, end: start + 60 * MIN, entries: entries(start) }
}
const S = {
  unit: 'kg',
  workouts: [
    session(200, s => [{ id: '0025', sets: [tick(s, 16)] }]),
    session(3, s => [{ id: '0025', sets: [tick(s, 4), tick(s, 8)] }, { id: '0032', sets: [tick(s, 10)] }]),
  ],
}

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const rows = () => [...host.querySelectorAll('.mrow')].map(el => el.textContent)

describe('Stats — time per exercise', () => {
  it('lists each exercise’s average a session, longest first, over the last 3 months', () => {
    act(() => root.render(<ExerciseTimeCard S={S} />))
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toContain('8 min')
    expect(rows()[1]).toContain('2 min')
    act(() => host.querySelector('.mrow').click())
    expect(mocks.history).toHaveBeenCalledWith('0025')
  })

  it('takes in older workouts on All', () => {
    act(() => root.render(<ExerciseTimeCard S={S} />))
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'All').click())
    expect(rows()[0]).toContain('12 min')
  })
})
