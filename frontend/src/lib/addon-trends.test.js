import { describe, it, expect } from 'vitest'
import { trainingVolumeSeries } from './addon-trends.js'

describe('trainingVolumeSeries', () => {
  it('groups workouts on local ISO dates and fills days without a workout with zero', () => {
    const workouts = [{ d: '2026-11-12', vol: 400 }, { d: '2026-11-12', vol: 150 },
      { d: '2026-11-13', vol: 0 }, { d: '2026-11-05', vol: 2000 }]
    const rows = trainingVolumeSeries(workouts, { end: '2026-11-13', days: 3,
      dayOf: w => w.d, volumeOf: w => w.vol })
    expect(rows).toEqual([
      { day: '2026-11-11', volume: 0 },
      { day: '2026-11-12', volume: 550 },
      { day: '2026-11-13', volume: 0 }
    ])
  })

  it('ignores invalid or negative volume instead of producing a misleading chart', () => {
    const rows = trainingVolumeSeries([{ d: '2026-11-13', vol: -1 },
      { d: '2026-11-13', vol: 'not a number' }], { end: '2026-11-13', days: 1,
      dayOf: w => w.d, volumeOf: w => w.vol })
    expect(rows).toEqual([{ day: '2026-11-13', volume: 0 }])
  })
})
