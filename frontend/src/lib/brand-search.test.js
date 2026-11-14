import { describe, expect, it } from 'vitest'
import { CATALOGUE, searchExercises } from './exercises.js'
import { brandIndex, brandMatches, withBrandHits, brandFirst } from './brand-search.js'

const ex = re => CATALOGUE.find(e => re.test(e.n))
const PRESS = ex(/^sled 45° leg press$/i)
const CURL = ex(/^lever lying leg curl$/i)
const EXT = ex(/^lever leg extension$/i)
const ROW = ex(/^cable seated row$/i)
const list = [PRESS, CURL, EXT, ROW]

const S = {
  exGym: {
    [PRESS.id]: { split: true, brands: { g1: 'Life Fitness' }, _ts: 1 },
    [EXT.id]: { split: true, brands: { g2: 'Technogym' }, _ts: 1 },
    [CURL.id]: { split: true, _ts: 1 },
    // Not split any more: its brand no longer counts.
    [ROW.id]: { split: false, brands: { g1: 'Life Fitness' }, _ts: 1 },
  },
  workouts: [{ d: '2026-10-01', gym: { id: 'g1' }, entries: [
    { id: CURL.id, brand: 'LifeFitness', sets: [] },
    { id: ROW.id, brand: 'Life Fitness', sets: [] },
    { id: EXT.id, brand: '  ', sets: [] },
  ] }],
}
const hits = (q, st = S) => [...brandMatches(list, st, q)].map(([id, b]) => [list.find(e => e.id === id).n, b])

describe('search by machine brand (#1082)', () => {
  it('collects the brands of split exercises, per gym and from logged entries', () => {
    expect(Object.fromEntries(brandIndex(S))).toEqual({ [PRESS.id]: ['Life Fitness'], [EXT.id]: ['Technogym'], [CURL.id]: ['LifeFitness'] })
  })

  it('builds the index once for the same workouts and exGym', () => {
    expect(brandIndex(S)).toBe(brandIndex({ ...S }))
    expect(brandIndex({ ...S, exGym: { ...S.exGym } })).not.toBe(brandIndex(S))
  })

  it('finds a brand whatever the spacing, punctuation and case', () => {
    for (const q of ['Life Fitness', 'lifefitness', 'life fit', 'LIFE-FITNESS']) {
      expect(hits(q).map(h => h[0])).toEqual([PRESS.n, CURL.n])
    }
    expect(hits('techno')).toEqual([[EXT.n, 'Technogym']])
  })

  it('narrows by name with the words that are not a brand', () => {
    expect(hits('life fitness press')).toEqual([[PRESS.n, 'Life Fitness']])
    expect(hits('technogym squat')).toEqual([])
  })

  it('never takes a one-letter word for a brand', () => {
    expect(hits('l')).toEqual([])
    expect(hits('t')).toEqual([])
    expect(hits('leg press')).toEqual([])
  })

  it('finds nothing for an exercise that is not split or has an empty brand', () => {
    expect(hits('life fitness').map(h => h[0])).not.toContain(ROW.n)
    const empty = { exGym: { [PRESS.id]: { split: true, brands: { g1: '' } }, [EXT.id]: { split: false, brands: { g1: 'Technogym' } } }, workouts: [] }
    expect(hits('life', empty)).toEqual([])
    expect(hits('technogym', empty)).toEqual([])
  })

  it('puts the brand hits first, then the plain results in their own order, each once', () => {
    const scope = [ROW, EXT, PRESS, CURL]
    const byBrand = brandMatches(scope, S, 'life fitness')
    const found = [CURL, ROW]
    expect(withBrandHits(scope, found, byBrand)).toEqual([PRESS, CURL, ROW])
    expect(brandFirst([ROW, CURL, EXT, PRESS], byBrand)).toEqual([CURL, PRESS, ROW, EXT])
  })

  it('stays inside the list it is given, so filters already set still apply', () => {
    expect([...brandMatches([CURL, ROW], S, 'life fitness').keys()]).toEqual([CURL.id])
  })

  it('with no brands stored, gives exactly searchExercises\' result', () => {
    for (const st of [{}, { exGym: {} , workouts: [] }, { exGym: { [ROW.id]: { split: true } }, workouts: [] }]) {
      for (const q of ['leg press', 'life fitness', 'row']) {
        const found = searchExercises(CATALOGUE, q)
        const byBrand = brandMatches(CATALOGUE, st, q)
        expect(byBrand.size).toBe(0)
        expect(withBrandHits(CATALOGUE, found, byBrand)).toBe(found)
        expect(brandFirst(found, byBrand)).toBe(found)
      }
    }
  })
})
