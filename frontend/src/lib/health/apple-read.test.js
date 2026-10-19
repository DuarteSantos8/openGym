// Reading through the provider, with HealthKit faked: every kind of type goes the way its kind says
// and comes back as readings — a recent day's heart rate an hour at a time, an older one a day at a
// time. A read that throws for every type of a kind would only show up as "nothing came in".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = []
const HK = {
  isAvailable: async () => ({ available: true }),
  queryDaily: async a => {
    calls.push(a)
    const at = a.hourly ? a.end - 3600000 : a.end - 86400000
    const date = new Date(at).toISOString().slice(0, 10)
    return { days: [{ date, start: at, value: 70, min: 60, max: 90 }] }
  },
  querySamples: async () => ({ samples: [] }),
  querySleep: async () => ({ nights: [] }),
  queryCategory: async () => ({ samples: [] }),
  queryWorkouts: async () => ({ workouts: [] }),
}

vi.mock('../mobile.js', () => ({ MOBILE: true }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => HK }))

const NOW = Date.parse('2026-10-19T12:00:00Z')
beforeEach(() => { calls.length = 0; vi.spyOn(Date, 'now').mockReturnValue(NOW) })
afterEach(() => { vi.restoreAllMocks() })

describe('reading Apple Health', () => {
  it('heart rate comes in: the older days a day at a time, the recent ones an hour at a time', async () => {
    const { appleHealth } = await import('./apple-health.js')
    const out = await appleHealth.fetchMeasurements({ types: ['heartRate'], since: NOW - 200 * 86400000, until: NOW })
    expect(calls.map(c => !!c.hourly)).toEqual([false, true])
    const hr = out.filter(r => r.type === 'heartRate')
    expect(hr).toHaveLength(2)
    expect(hr.some(r => /:\d+$/.test(r.sid))).toBe(true)
    expect(hr.some(r => /:\d{4}-\d{2}-\d{2}$/.test(r.sid))).toBe(true)
  })

  it('a day total read since yesterday is read by the hour only', async () => {
    const { appleHealth } = await import('./apple-health.js')
    const out = await appleHealth.fetchMeasurements({ types: ['steps'], since: NOW - 86400000, until: NOW })
    expect(calls.map(c => [c.stat, !!c.hourly])).toEqual([['sum', true]])
    expect(out.filter(r => r.type === 'steps')).toHaveLength(1)
  })
})
