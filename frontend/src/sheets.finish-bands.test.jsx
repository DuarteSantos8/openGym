// @vitest-environment happy-dom
// The finish summary said "Today: 12, 12" for a band curl done with Red, while "Next time" right
// under it said "12 × Green" (QA 1.4.5). Today and Last time now name the bands, as History does.
import { describe, expect, it } from 'vitest'
import { setsLine } from './sheets.jsx'
import { finishCompare } from './lib/finish-compare.js'
import { setKnownBands } from './lib/bands.js'

const BANDS = [{ id: 'b-red', name: 'Red', color: '#eb5757', kg: 10 }, { id: 'b-green', name: 'Green', color: '#27ae60', kg: 15 }]

describe('band sets on the finish summary', () => {
  it('names the colour of each set', () => {
    setKnownBands(BANDS)
    expect(setsLine([{ w: 0, r: 12, bands: ['b-red'] }, { w: 0, r: 12, bands: ['b-red'] }], 'kg')).toBe('12 × Red, 12 × Red')
    expect(setsLine([{ w: 0, r: 10, bands: ['b-red', 'b-green'], f: true }], 'kg')).toBe('10 × Red + Green F')
  })
  it('leaves a set without bands as it was', () => {
    expect(setsLine([{ w: 60, r: 5 }, { w: 60, r: 9, f: true }], 'kg')).toBe('60 kg × 5, 9 F')
  })
  it('keeps the bands in the rows it compares', () => {
    const routine = { id: 'r1', name: 'A', ex: [{ id: '0976', sets: 2, reps: 12, weight: 0, mode: 'reps', bands: ['b-red'] }] }
    const now = { id: 'w1', d: '2026-11-09', start: Date.parse('2026-11-09T10:00:00'), end: Date.parse('2026-11-09T10:30:00'),
      entries: [{ id: '0976', rid: 'r1', target: { ...routine.ex[0] }, sets: [{ w: 0, r: 12, done: true, bands: ['b-red'] }, { w: 0, r: 12, done: true }] }] }
    const [row] = finishCompare({ unit: 'kg', routines: [routine], workouts: [now], bands: BANDS, exWeights: {} }, now)
    expect(row.today).toEqual([{ w: 0, r: 12, bands: ['b-red'] }, { w: 0, r: 12 }])
  })
})
