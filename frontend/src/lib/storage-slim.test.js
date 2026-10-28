import { describe, expect, it } from 'vitest'
import { slimForStorage, writeFitting } from './storage-slim.js'

const rec = d => ({ id: 'x:' + d, type: 'steps', v: 1, d })
const S = { workouts: [{ id: 'w' }], health: [rec('2026-10-26'), rec('2026-07-29'), rec('2026-07-28'), rec('2025-01-01')] }

describe('the copy a full device keeps', () => {
  it('keeps the readings of the last days, today included, and everything else whole', () => {
    const slim = slimForStorage(S, 90, '2026-10-26')
    expect(slim.health.map(r => r.d)).toEqual(['2026-10-26', '2026-07-29'])
    expect(slim.workouts).toBe(S.workouts)
    expect(slimForStorage(S, 0, '2026-10-26').health).toEqual([])
  })

  it('writes the whole copy when it fits, then 90 days, 30 days, no readings', () => {
    const tried = []
    const fits = max => text => { tried.push(JSON.parse(text).health.length); if (text.length > max) throw new Error('quota') }
    expect(writeFitting(S, fits(1e6), '2026-10-26')).toBe(null)
    tried.length = 0
    const noReadings = JSON.stringify({ ...S, health: [] }).length
    expect(writeFitting(S, fits(noReadings), '2026-10-26')).toBe(0)
    expect(tried).toEqual([4, 2, 1, 0])
    expect(() => writeFitting(S, fits(10), '2026-10-26')).toThrow('quota')
  })

  it('a copy with no readings is refused as it was', () => {
    expect(() => writeFitting({ workouts: [] }, () => { throw new Error('quota') })).toThrow('quota')
  })
})
