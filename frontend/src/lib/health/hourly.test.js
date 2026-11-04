// A recent day kept an hour at a time (api/health/catalogue.js compactHourly) still reads as one
// day on the cards and the charts: its hours' total, or their mean with the lowest and highest;
// and a profile tidied on the device folds old hours into days the way the server does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dailyValues, normalizeHealthState } from './records.js'

const hour = (d, hh) => Date.parse(`${d}T${String(hh).padStart(2, '0')}:00:00Z`)
const rec = (type, d, hh, v, more = {}) => ({ id: `apple-health:${type}:${hour(d, hh)}`, type, v, u: '', t: hour(d, hh), d, src: 'apple-health', sid: `${type}:${hour(d, hh)}`, c: 1, _ts: 1, ...more })

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T12:00:00Z')) })
afterEach(() => { vi.restoreAllMocks() })

describe('a day read from its hours', () => {
  it('a total is the sum of its hours', () => {
    const S = { health: [rec('steps', '2026-10-18', 9, 500), rec('steps', '2026-10-18', 14, 800)] }
    expect(dailyValues(S, 'steps')).toMatchObject([{ d: '2026-10-18', v: 1300 }])
  })
  it('heart rate is the mean of its hours, from the lowest to the highest of them', () => {
    const S = { health: [rec('heartRate', '2026-10-18', 9, 75, { lo: 60, hi: 90 }), rec('heartRate', '2026-10-18', 10, 65, { lo: 55, hi: 70 })] }
    expect(dailyValues(S, 'heartRate')).toMatchObject([{ d: '2026-10-18', v: 70, lo: 55, hi: 90 }])
  })
})

describe('tidying the profile on the device', () => {
  it('folds steps kept by the hour into their day, and keeps recent heart rate by the hour', () => {
    const S = { health: [rec('steps', '2026-09-01', 9, 500), rec('steps', '2026-09-01', 10, 200), rec('steps', '2026-10-18', 9, 300),
      rec('heartRate', '2026-10-18', 9, 70)] }
    normalizeHealthState(S)
    expect(S.health.map(r => [r.sid, r.v])).toEqual([['steps:2026-09-01', 700], [`heartRate:${hour('2026-10-18', 9)}`, 70], ['steps:2026-10-18', 300]])
  })
})
