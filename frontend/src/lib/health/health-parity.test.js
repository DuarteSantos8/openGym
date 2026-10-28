/* api/health/fold.js mergeReadings is the server's copy of the app's own import
   (lib/health/records.js importRecords + bridgeWeights, run by lib/health/sync.js applyReadings):
   the server folds an iPhone Shortcut's readings into a stored profile, the app folds an export or
   a HealthKit read into its own. The two must leave a profile the same way. */
import { describe, expect, it } from 'vitest'
import { mergeReadings, readingsFromShortcut } from '../../../../api/health/fold.js'
import { applyReadings } from './sync.js'

const clone = v => JSON.parse(JSON.stringify(v))
const strip = S => ({
  health: S.health.map(({ id, type, v, u, t, d, src, sid, lo, hi }) => ({ id, type, v, u, t, d, src, sid, ...(lo != null ? { lo } : {}), ...(hi != null ? { hi } : {}) }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
  bodyweight: S.bodyweight.map(({ d, w, src }) => ({ d, w, src: src || 'manual' })),
})

const BODY = {
  metrics: {
    weight: { values: '176.4\n80.1\n79.9', dates: '2026-10-10T07:30:00+02:00\n2026-10-12T07:31:00+02:00\n2026-10-12T21:00:00+02:00', unit: 'lb' },
    leanMass: { values: '63.2', dates: '2026-10-12T07:31:00+02:00', unit: 'kg' },
    steps: { values: '8123\n9500', dates: '2026-10-11\n2026-10-12' },
    restingHeartRate: { values: '52\n54', dates: '2026-10-12T06:00:00+02:00\n2026-10-12T07:00:00+02:00' },
    sleep: { starts: '2026-10-11T23:00:00+02:00', ends: '2026-10-12T06:00:00+02:00', values: 'Core' },
  }
}

describe('server and app fold readings into a profile the same way', () => {
  for (const unit of ['kg', 'lb']) {
    it(`a ${unit} profile with a typed weigh-in, a deletion and a manual record`, () => {
      const base = {
        unit, bodyweight: [{ d: '2026-10-12', w: unit === 'lb' ? 180 : 81, t: 1 }],
        health: [{ id: 'm1', type: 'bodyFat', v: 20, u: '%', t: 5, d: '2026-10-01', src: 'manual', c: 5, _ts: 5 }],
        deleted: { health: { 'apple-health:steps:2026-10-11': 99 } },
      }
      const { readings } = readingsFromShortcut(BODY)
      const server = clone(base), app = clone(base)
      const a = mergeReadings(server, readings, 1000)
      const b = applyReadings(app, readings, { now: 1000 })
      expect(a).toEqual(b)
      expect(strip(server)).toEqual(strip(app))
      // and a second pass agrees too
      expect(mergeReadings(server, readings, 2000)).toEqual(applyReadings(app, readings, { now: 2000 }))
    })
  }
})
