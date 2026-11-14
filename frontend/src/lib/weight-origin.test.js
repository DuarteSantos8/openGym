import { expect, it } from 'vitest'
import { prefilledReading, measuredAt } from './weight-origin.js'
it('describes the selected reading and never labels an average as one measurement', () => {
  const day = { d: '2026-11-14', w: 81, t: Date.now(), ins: [
    { id: 'a', at: '07:00', w: 80, src: 'ah', t: 1 }, { id: 'b', at: '20:00', w: 82, t: 2 },
  ] }
  expect(prefilledReading(day, 'first').src).toBe('ah')
  expect(prefilledReading(day, 'last').id).toBe('b')
  expect(prefilledReading(day, 'avg')).toBeNull()
  expect(measuredAt(day.d, prefilledReading(day))).toBe(new Date(2026, 10, 14, 7).getTime())
})
it('does not invent a measurement time for an old reading without one', () => {
  const r = prefilledReading({ d: '2026-11-01', w: 80, t: Date.now() })
  expect(measuredAt('2026-11-01', r)).toBeNull()
})
