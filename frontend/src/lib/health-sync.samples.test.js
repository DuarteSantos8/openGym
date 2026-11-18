import { describe, expect, it } from 'vitest'
import { workoutSamples } from './health-sync.js'
import { packCurve } from './heart-history.js'

describe('workoutSamples', () => {
  const T = Date.UTC(2026, 10, 2, 9)
  it('draws from the curve kept with the workout, with no health hub (the web app)', async () => {
    const hrc = packCurve([[T + 1000, 120], [T + 6000, 130]], T, T + 60000)
    expect(await workoutSamples({ id: 'w', start: T, end: T + 60000, hrc })).toEqual([[T + 2500, 120], [T + 7500, 130]])
  })
  it('has nothing without a kept curve off the phone', async () => {
    expect(await workoutSamples({ id: 'w', start: T, end: T + 60000 })).toEqual([])
  })
})
