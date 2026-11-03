// @vitest-environment happy-dom
// v1.4.3 integration: health-read's merges (lib/health-read.js) run as producers of the store's
// update(), which since perf-1015 hands them a copy-on-access draft instead of a full clone. The
// health-read tests drive the merges with a stand-in `apply`; this one goes through the real
// update(), whose test-mode check throws if the previous state was changed in place.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))

import { useStore } from './useStore.js'
import { mergeHeartRate, mergeWeighIns } from '../lib/health-read.js'

const T0 = Date.UTC(2026, 9, 14, 17, 0, 0)
const workout = () => ({
  id: 'w1', d: '2026-10-14', name: 'Push', start: T0, end: T0 + 30 * 60e3,
  entries: [{ id: 'e1', ex: 'bench', sets: [
    { w: 60, r: 8, done: true, at: T0 + 5 * 60e3 },
    { w: 60, r: 8, done: true, at: T0 + 9 * 60e3 },
  ] }],
})
// One reading every 5 s over the whole workout, 120 to 150 bpm.
const samples = () => Array.from({ length: 30 * 12 + 60 }, (_, i) => [T0 + i * 5000, 120 + (i % 31)])

describe('health-read through the copy-on-access update()', () => {
  beforeEach(() => {
    useStore.getState().update(s => {
      s.unit = 'kg'
      s.workouts = [workout(), { id: 'w0', d: '2026-10-01', name: 'Old', start: T0 - 13 * 864e5, end: T0 - 13 * 864e5 + 60e3, entries: [] }]
      s.bodyweight = [{ d: '2026-10-12', w: 80, t: T0 - 2 * 864e5 }]
      s.active = null
    }, false)
  })

  it('fills the heart rate without touching the previous state, and stamps the workout', () => {
    const before = useStore.getState().S
    const frozen = JSON.stringify(before)
    let changed = false
    useStore.getState().update(s => { changed = mergeHeartRate(s, 'w1', samples(), 'hc', T0 + 40 * 60e3) }, false)
    const after = useStore.getState().S
    expect(changed).toBe(true)
    expect(JSON.stringify(before)).toBe(frozen)
    const w = after.workouts.find(x => x.id === 'w1')
    expect(w.entries[0].sets.every(set => set.hr?.avg > 0)).toBe(true)
    expect(w.hr).toMatchObject({ src: 'hc' })
    expect(before.workouts.find(x => x.id === 'w1').hr).toBeUndefined()
    // untouched fields stay shared, touched ones are new objects
    expect(after.bodyweight).toBe(before.bodyweight)
    expect(after.workouts).not.toBe(before.workouts)
    // what is saved carries the reading
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.workouts.find(x => x.id === 'w1').hr).toMatchObject({ src: 'hc' })
  })

  it('imports a weigh-in, keeps the typed one, and leaves the previous state alone', () => {
    const before = useStore.getState().S
    const frozen = JSON.stringify(before)
    let days = []
    const records = [
      { t: T0 - 2 * 864e5 + 3600e3, kg: 81, id: 'x1', origin: 'com.withings' }, // a typed day: ignored
      { t: T0, kg: 79.5, id: 'x2', origin: 'com.withings' },
    ]
    useStore.getState().update(s => { days = mergeWeighIns(s, records, { src: 'hc', seen: {} }) }, false)
    const after = useStore.getState().S
    expect(days).toEqual(['2026-10-14'])
    expect(JSON.stringify(before)).toBe(frozen)
    expect(after.bodyweight.map(b => [b.d, b.w, b.src || null])).toEqual([['2026-10-12', 80, null], ['2026-10-14', 79.5, 'hc']])
    expect(after.workouts).toBe(before.workouts)
  })
})
