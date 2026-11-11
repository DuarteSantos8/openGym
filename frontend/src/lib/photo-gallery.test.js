import { describe, expect, it } from 'vitest'
import { photoStatus, photoCountsByDay, groupByMonth } from './photo-gallery.js'

const ph = (...days) => days.map(d => ({ d }))

describe('photoStatus', () => {
  const today = '2026-10-31'
  it('says none when there is no photo at all', () => {
    expect(photoStatus([], today)).toEqual({ kind: 'none', days: 0 })
    expect(photoStatus(null, today)).toEqual({ kind: 'none', days: 0 })
  })
  it('says today when a photo is filed for today, whatever else there is', () => {
    expect(photoStatus(ph('2026-10-31', '2026-09-01'), today)).toEqual({ kind: 'today', days: 0 })
  })
  it('says yesterday for a latest photo one day old', () => {
    expect(photoStatus(ph('2026-10-30', '2026-09-01'), today)).toEqual({ kind: 'yesterday', days: 1 })
  })
  it('counts the days since the latest, however the list is ordered', () => {
    expect(photoStatus(ph('2026-09-01', '2026-10-24', '2026-10-01'), today)).toEqual({ kind: 'days', days: 7 })
    expect(photoStatus(ph('2025-10-31'), today)).toEqual({ kind: 'days', days: 365 })
  })
  it('counts across a daylight-saving change and a month end as whole days', () => {
    expect(photoStatus(ph('2026-10-24'), '2026-10-26')).toEqual({ kind: 'days', days: 2 })   // the clocks go back on the 25th in Europe
    expect(photoStatus(ph('2026-02-28'), '2026-03-02')).toEqual({ kind: 'days', days: 2 })
  })
  it('never counts a photo from the future as a gap', () => {
    expect(photoStatus(ph('2026-11-02'), today)).toEqual({ kind: 'today', days: 0 })
  })
})

describe('photoCountsByDay', () => {
  it('counts the photos of each day', () => {
    expect(photoCountsByDay(ph('2026-10-30', '2026-10-30', '2026-10-01'))).toEqual({ '2026-10-30': 2, '2026-10-01': 1 })
  })
  it('is empty for nothing', () => {
    expect(photoCountsByDay([])).toEqual({})
    expect(photoCountsByDay(undefined)).toEqual({})
  })
})

describe('groupByMonth', () => {
  it('runs consecutive photos of one month together, in the order given', () => {
    const photos = ph('2026-10-30', '2026-10-01', '2026-09-15', '2025-10-02')
    expect(groupByMonth(photos)).toEqual([
      { key: '2026-10', year: 2026, month: 9, items: [photos[0], photos[1]] },
      { key: '2026-09', year: 2026, month: 8, items: [photos[2]] },
      { key: '2025-10', year: 2025, month: 9, items: [photos[3]] },
    ])
  })
  it('keeps the same month of two years apart', () => {
    expect(groupByMonth(ph('2026-10-30', '2025-10-30')).map(g => g.key)).toEqual(['2026-10', '2025-10'])
  })
  it('is empty for nothing', () => {
    expect(groupByMonth([])).toEqual([])
  })
})
