import { describe, expect, it } from 'vitest'
import { cleanBands, starterBands, setBandsOf, toggleSetBand, withSetBands, bandText, bandResistanceKg, bandRank, nextBandsUp, usesBands, withBandEx, bandsCell, bandsFromCell, newBandId, MAX_SET_BANDS, cleanBand, bandLabel } from './bands.js'

// Reddit: "15 reps with red", the bands of each set by colour, light to heavy.
const LIST = [
  { id: 'y', name: 'Yellow', color: '#f2c94c', kg: 5 },
  { id: 'r', name: 'Red', color: '#eb5757', kg: 10 },
  { id: 'g', name: 'Green', color: '#27ae60', kg: 15 },
]
const NOKG = LIST.map(({ kg, ...b }) => b)

describe('the band list', () => {
  it('keeps real bands only, each id once', () => {
    const out = cleanBands([...LIST, { id: 'y', name: 'Again' }, { id: 'x' }, null, { id: 'constructor', name: 'Proto' }, { id: 'p', name: '  Purple  ', color: 'nope', kg: -3 }])
    expect(out.map(b => b.id)).toEqual(['y', 'r', 'g', 'p'])
    expect(out[3]).toEqual({ id: 'p', name: 'Purple', color: '#f2c94c' })
  })

  it('starts with five, light to heavy, and new ids never clash', () => {
    const s = starterBands()
    expect(s).toHaveLength(5)
    expect(bandRank([s[0].id], s)).toBeLessThan(bandRank([s[4].id], s))
    const id = newBandId([{ id: 'b-' + (1000).toString(36) }], 1000)
    expect(id).not.toBe('b-' + (1000).toString(36))
  })
})

describe('bands on a set', () => {
  it('toggles a band on and off, and the field goes with the last one', () => {
    let s = { w: 0, r: 15, done: false }
    s = toggleSetBand(s, 'r')
    s = toggleSetBand(s, 'y')
    expect(setBandsOf(s)).toEqual(['r', 'y'])
    s = toggleSetBand(toggleSetBand(s, 'r'), 'y')
    expect(s).toEqual({ w: 0, r: 15, done: false })
  })

  it('never holds more than a few at once, nor junk', () => {
    let s = {}
    for (const id of ['a', 'b', 'c', 'd', 'e']) s = toggleSetBand(s, id)
    expect(setBandsOf(s)).toHaveLength(MAX_SET_BANDS)
    expect(setBandsOf({ bands: ['a', 'a', 7, '__proto__x', ''] })).toEqual(['a', '__proto__x'])
    expect(withSetBands({ r: 1, bands: ['a'] }, [])).toEqual({ r: 1 })
  })

  it('reads "Red + Yellow", a deleted band as "band"', () => {
    expect(bandText(['r', 'y'], LIST)).toBe('Red + Yellow')
    expect(bandText(['gone'], LIST)).toBe('band')
  })
})

describe('band order', () => {
  it('ranks by resistance when every band has one, else by place in the list', () => {
    expect(bandResistanceKg(['r', 'y'], LIST)).toBe(15)
    expect(bandResistanceKg(['r', 'y'], NOKG)).toBeNull()
    expect(bandRank(['r', 'y'], LIST)).toBeGreaterThan(bandRank(['r'], LIST))
    expect(bandRank(['g'], NOKG)).toBeGreaterThan(bandRank(['r'], NOKG))
    expect(bandRank([], LIST)).toBe(0)
  })

  it('steps up to the next heavier band or pair, a single band first', () => {
    expect(nextBandsUp(['y'], LIST)).toEqual(['r'])
    expect(nextBandsUp(['r'], LIST)).toEqual(['g'])
    expect(nextBandsUp(['g'], NOKG)).toEqual(['g', 'y'])
    expect(nextBandsUp(['g'], LIST)).toEqual(['g', 'y'])
    expect(nextBandsUp(['g', 'r'], LIST)).toBeNull()
    expect(nextBandsUp([], LIST)).toEqual(['y'])
  })
})

describe('which exercises get bands', () => {
  it('a band exercise by its equipment, any other when switched on', () => {
    expect(usesBands({}, '0005')).toBe(true)
    expect(usesBands({ bandEx: { '0005': false } }, '0005')).toBe(false)
    expect(usesBands({}, '0025')).toBe(false)
    expect(usesBands({ bandEx: { '0025': true } }, '0025')).toBe(true)
    expect(usesBands({}, '0025', { bands: ['r'] })).toBe(true)
  })

  it('stores only a choice that differs from the default', () => {
    expect(withBandEx({}, '0025', true, false)).toEqual({ '0025': true })
    expect(withBandEx({ '0025': true }, '0025', false, false)).toEqual({})
    expect(withBandEx({}, '0005', false, true)).toEqual({ '0005': false })
  })
})

describe('the CSV column', () => {
  it('writes names and reads them back, new names as new bands', () => {
    expect(bandsCell({ bands: ['r', 'y'] }, LIST)).toBe('Red + Yellow')
    expect(bandsCell({}, LIST)).toBe('')
    const back = bandsFromCell('red + Yellow + Mint', LIST, 5000)
    expect(back.ids.slice(0, 2)).toEqual(['r', 'y'])
    expect(back.added).toHaveLength(1)
    expect(back.added[0].name).toBe('Mint')
    expect(back.ids[2]).toBe(back.added[0].id)
    expect(bandsFromCell('', LIST)).toEqual({ ids: [], added: [] })
  })
})

describe('a band by level (TestFlight 11-08)', () => {
  it('keeps a level beside the colour, trimmed, and drops one that only repeats the name', () => {
    expect(cleanBand({ id: 'b1', name: 'Red', color: '#eb5757', level: '  Heavy ' })).toMatchObject({ level: 'Heavy' })
    expect(cleanBand({ id: 'b2', name: 'Level 3', color: '#8d8d8d', level: 'level 3' }).level).toBeUndefined()
    expect(bandLabel({ name: 'Red', level: 'Heavy' })).toBe('Red · Heavy')
    expect(bandLabel({ name: 'Level 3' })).toBe('Level 3')
  })
})
