import { afterEach, describe, expect, it } from 'vitest'
import { CATALOGUE, EXIDX, healCustomEx, isCustomEx, registerCustom } from './exercises.js'

// #378 / #358: a custom exercise stored without `custom: true` (a plan import before 1.3.8) had
// no Edit, no Delete and a broken thumbnail. Being one of the user's own is where it lives.
afterEach(() => registerCustom([]))

describe('isCustomEx', () => {
  it('a registered custom exercise without the flag is still custom', () => {
    const c = { id: 'cx1', n: 'My row', bp: 'back' }
    expect(isCustomEx(c)).toBe(false)
    registerCustom([c])
    expect(isCustomEx(c)).toBe(true)
    expect(isCustomEx({ ...c })).toBe(true)   // a copy of the stored entry (a store clone)
    expect(isCustomEx(EXIDX.cx1)).toBe(true)
  })

  it('a flagged one is custom even before it is registered', () => {
    expect(isCustomEx({ id: 'cnew', n: 'x', bp: 'back', custom: true })).toBe(true)
  })

  it('a built-in is never custom, also when a custom shadows its id', () => {
    const built = CATALOGUE[0]
    expect(isCustomEx(built)).toBe(false)
    const shadow = { id: built.id, n: 'Mine', bp: 'back' }
    registerCustom([shadow])
    expect(isCustomEx(shadow)).toBe(true)
    expect(isCustomEx(built)).toBe(false)
    registerCustom([])
    expect(EXIDX[built.id]).toBe(built)
  })

  it('nothing is not custom', () => {
    expect(isCustomEx(null)).toBe(false)
    expect(isCustomEx(undefined)).toBe(false)
    expect(isCustomEx('cx1')).toBe(false)
  })
})

describe('healCustomEx', () => {
  it('puts the flag back on entries that lost it, keeping their stamp', () => {
    const list = [{ id: 'a', n: 'A', bp: 'back', _ts: 5 }, { id: 'b', n: 'B', bp: 'chest', eq: 'custom', custom: true }]
    const out = healCustomEx(list)
    expect(out).not.toBe(list)
    expect(out[0]).toEqual({ id: 'a', n: 'A', bp: 'back', _ts: 5, custom: true, eq: '' })
    expect(out[1]).toBe(list[1])
    expect(list[0].custom).toBeUndefined()   // the input is not mutated
  })

  it('is idempotent and keeps identity when nothing is missing', () => {
    const once = healCustomEx([{ id: 'a', n: 'A', bp: 'back', eq: 'cable' }])
    expect(once[0].eq).toBe('cable')
    expect(healCustomEx(once)).toBe(once)
    const empty = []
    expect(healCustomEx(empty)).toBe(empty)
    expect(healCustomEx(undefined)).toBe(undefined)
  })

  it('leaves junk entries alone', () => {
    const list = [null, { id: 'a', n: 'A', bp: 'back', custom: true }]
    expect(healCustomEx(list)).toBe(list)
  })
})
