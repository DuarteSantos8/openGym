import { describe, expect, it } from 'vitest'
import { photoNudge, monthGroups, photoCounts } from './photo-gallery.js'

const P = (d, key = d) => ({ d, key })

describe('photoNudge', () => {
  it('says today, yesterday, or how long it has been', () => {
    expect(photoNudge([P('2026-11-06')], '2026-11-06')).toEqual({ kind: 'today' })
    expect(photoNudge([P('2026-11-05'), P('2026-10-01')], '2026-11-06')).toEqual({ kind: 'yesterday' })
    expect(photoNudge([P('2026-10-01'), P('2026-10-20')], '2026-11-06')).toEqual({ kind: 'ago', days: 17 })
  })
  it('nothing without photos, and a photo from the future counts as today', () => {
    expect(photoNudge([], '2026-11-06')).toBeNull()
    expect(photoNudge(null, '2026-11-06')).toBeNull()
    expect(photoNudge([P('2026-11-09')], '2026-11-06')).toEqual({ kind: 'today' })
  })
  it('counts days right across a clock change', () => {
    expect(photoNudge([P('2026-10-24')], '2026-10-26')).toEqual({ kind: 'ago', days: 2 })
  })
})

describe('monthGroups and photoCounts', () => {
  it('cuts a newest-first list into months and counts each day', () => {
    const list = [P('2026-11-02', 'a'), P('2026-11-02', 'b'), P('2026-10-30', 'c'), P('2025-11-01', 'd')]
    expect(monthGroups(list).map(g => [g.month, g.items.map(p => p.key)])).toEqual([
      ['2026-11', ['a', 'b']], ['2026-10', ['c']], ['2025-11', ['d']],
    ])
    expect(photoCounts(list)).toEqual({ '2026-11-02': 2, '2026-10-30': 1, '2025-11-01': 1 })
    expect(monthGroups(undefined)).toEqual([])
  })
})
