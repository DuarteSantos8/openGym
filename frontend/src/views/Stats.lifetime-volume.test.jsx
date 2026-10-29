// @vitest-environment happy-dom
// Everything ever lifted, a tile on Stats (Discord): imported sessions count, warm-ups only when
// the profile counts them (#719), and a profile with nothing lifted gets no tile at all.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH = '0025'
const session = (d, sets) => ({
  id: d, d, name: 'Push', start: Date.parse(d + 'T10:00:00Z'), end: Date.parse(d + 'T11:00:00Z'),
  entries: [{ id: BENCH, target: { sets: sets.length, reps: 5 }, sets }],
})
const warm = (w, r) => ({ w, r, done: true, phase: 'warmup', warmup: true })
const work = (w, r) => ({ w, r, done: true })

let root, host
afterEach(() => { act(() => root.unmount()); host.remove() })

function mount(settings, workouts) {
  mocks.S = { unit: 'kg', body: 'male', effort: 'none', targetW: null, bodyweight: [], routines: [], exWeights: {}, ...settings, workouts }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
  return host.querySelector('[data-lifetime-volume] .v')?.textContent ?? null
}

const history = () => [
  session('2026-09-01', [warm(40, 10), work(100, 5), work(100, 5)]),
  session('2026-09-08', [work(102.5, 5)]),
  // An imported year-old session counts like any other.
  { ...session('2025-01-05', Array.from({ length: 10 }, () => work(100, 10))), name: 'Imported', vol: 10000 },
]

describe('Stats: lifted in total', () => {
  it('adds up every session in the profile unit', () => {
    expect(mount({}, history())).toBe('11,513 kg')
  })

  it('takes the warm-ups in when the profile counts them', () => {
    expect(mount({ volumeWarmups: true }, history())).toBe('11,913 kg')
  })

  it('says lb for a pound profile', () => {
    expect(mount({ unit: 'lb' }, [session('2026-09-01', [work(225, 5)])])).toBe('1,125 lb')
  })

  it('stays away until something was lifted', () => {
    expect(mount({}, [])).toBeNull()
  })
})
