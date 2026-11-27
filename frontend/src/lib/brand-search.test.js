import { describe, expect, it } from 'vitest'
import { CATALOGUE, searchExercises } from './exercises.js'
import { brandHits, brandIndex, searchWithBrands } from './brand-search.js'

const find = re => CATALOGUE.find(e => re.test(e.n))
const PRESS = find(/^sled 45° leg press$/i)
const CURL = find(/^lever lying leg curl$/i)
const EXT = find(/^lever leg extension$/i)
const ROW = find(/^cable seated row$/i)
const list = [PRESS, CURL, EXT, ROW]
const S = {
  exGym: {
    [PRESS.id]: { split: true, brands: { g1: 'Life Fitness' } },
    [EXT.id]: { split: true, brands: { g2: 'Technogym' } },
    [CURL.id]: { split: true },
    [ROW.id]: { split: false, brands: { g1: 'Life Fitness' } },   // no longer per gym: its brand does not count
  },
  workouts: [{ d: '2026-10-01', entries: [{ id: CURL.id, brand: 'LifeFitness', sets: [] }, { id: ROW.id, brand: 'Life Fitness', sets: [] }] }],
}
const names = (q, st = S) => list.filter(e => brandHits(list, st, q).has(e.id)).map(e => e.n)

describe('search by machine brand (#1082)', () => {
  it('reads the brands set per gym and the ones logged, for exercises kept per gym only', () => {
    expect(Object.fromEntries(brandIndex(S))).toEqual({ [PRESS.id]: ['Life Fitness'], [EXT.id]: ['Technogym'], [CURL.id]: ['LifeFitness'] })
  })
  it('matches whatever the spacing, punctuation and case', () => {
    for (const q of ['Life Fitness', 'lifefitness', 'life fit', 'LIFE-FITNESS']) expect(names(q)).toEqual([PRESS.n, CURL.n])
    expect(names('techno')).toEqual([EXT.n])
  })
  it('narrows by name with the words that are not the brand', () => {
    expect(names('life fitness press')).toEqual([PRESS.n])
    expect(names('technogym squat')).toEqual([])
  })
  it('never takes one letter or a plain exercise search for a brand', () => {
    expect(names('l')).toEqual([])
    expect(names('leg press')).toEqual([])
  })
  it('puts brand hits first and keeps the name results after them, each once', () => {
    const out = searchWithBrands(list, S, 'life')
    expect(out.slice(0, 2)).toEqual([PRESS, CURL])
    expect(new Set(out).size).toBe(out.length)
    expect(searchWithBrands(list, { exGym: {} }, 'leg press')).toEqual(searchExercises(list, 'leg press'))
  })
})
