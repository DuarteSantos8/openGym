import { describe, it, expect } from 'vitest'
import { supersetMeta, setSupersetMeta, syncSupersetMeta } from './superset-meta.js'
import { restSecFor } from './supersetFlow.js'

describe('a superset\'s name and rest between rounds (#292)', () => {
  it('is written onto every member and read back from the group', () => {
    const ex = [{ id: 'a', sg: 'g' }, { id: 'b', sg: 'g' }, { id: 'c' }]
    setSupersetMeta(ex, 'g', { name: '  Arms finisher ', rest: 75 })
    expect(ex[0]).toMatchObject({ sgName: 'Arms finisher', sgRest: 75 })
    expect(ex[1]).toMatchObject({ sgName: 'Arms finisher', sgRest: 75 })
    expect(ex[2].sgName).toBeUndefined()
    expect(supersetMeta(ex, [0, 1])).toEqual({ name: 'Arms finisher', rest: 75 })
    setSupersetMeta(ex, 'g', { name: '', rest: 0 })
    expect(ex[0].sgName).toBeUndefined()
    expect(ex[0].sgRest).toBeUndefined()
  })
  it('a new member takes the group\'s values, one that left drops them', () => {
    const ex = [{ id: 'a', sg: 'g', sgName: 'Pair', sgRest: 60 }, { id: 'b', sg: 'g' }, { id: 'c', sgName: 'Old', sgRest: 30 }]
    syncSupersetMeta(ex)
    expect(ex[1]).toMatchObject({ sgName: 'Pair', sgRest: 60 })
    expect(ex[2].sgName).toBeUndefined()
  })
  it('the group\'s rest replaces the longest member rest after a round', () => {
    const entries = [{ target: { restSec: 120, sgRest: 45 } }, { target: { restSec: 90, sgRest: 45 } }]
    expect(restSecFor(entries, [0, 1], 90)).toBe(45)
    // On a single exercise a leftover value means nothing.
    expect(restSecFor(entries, [0], 90)).toBe(120)
    expect(restSecFor([{ target: { restSec: 120 } }, { target: {} }], [0, 1], 90)).toBe(120)
  })
})
