import { describe, expect, it } from 'vitest'
import { insertActiveOccurrence, replaceActiveOccurrence, syncActiveExposures } from './active-session.js'

const pair = id => ({
  exposure: { exposureId: id, exerciseId: id },
  entry: { exposureId: id, id, sets: [] }
})

describe('canonical active-session occurrence pairs', () => {
  it('replaces the entry and the exposure selected by the old exposureId', () => {
    const active = { exposures: [pair('a').exposure, pair('b').exposure], entries: [pair('a').entry, pair('b').entry] }
    expect(replaceActiveOccurrence(active, 1, pair('c'))).toBe(true)
    expect(active.entries.map(x => x.exposureId)).toEqual(['a', 'c'])
    expect(active.exposures.map(x => x.exposureId)).toEqual(['a', 'c'])
  })

  it('inserts both records at the same logical position', () => {
    const active = { exposures: [pair('a').exposure], entries: [pair('a').entry] }
    expect(insertActiveOccurrence(active, 1, pair('b'))).toBe(true)
    expect(active.entries.map(x => x.exposureId)).toEqual(['a', 'b'])
    expect(active.exposures.map(x => x.exposureId)).toEqual(['a', 'b'])
  })

  it('fails closed for mismatched pairs or a missing old exposure', () => {
    const active = { exposures: [], entries: [pair('a').entry] }
    expect(replaceActiveOccurrence(active, 0, { exposure: pair('b').exposure, entry: pair('c').entry })).toBe(false)
    expect(active.entries[0].exposureId).toBe('a')
  })

  it('orders, filters and groups exposures from their linked entries', () => {
    const active = {
      exposures: [pair('a').exposure, pair('b').exposure, pair('orphan').exposure],
      entries: [{ ...pair('b').entry, sg: 'group' }, pair('a').entry]
    }
    expect(syncActiveExposures(active)).toBe(true)
    expect(active.exposures.map(x => x.exposureId)).toEqual(['b', 'a'])
    expect(active.exposures[0].sg).toBe('group')
    expect(active.exposures[1].sg).toBeUndefined()
  })
})
