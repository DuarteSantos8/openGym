import { describe, expect, it } from 'vitest'
import { favIds, isFav, toggleFav, sortFavouritesFirst } from './favourites.js'

const ex = id => ({ id, n: id })

describe('favourites', () => {
  it('reads a profile without the field as no favourites', () => {
    expect(favIds({})).toEqual([])
    expect(favIds({ favEx: null })).toEqual([])
    expect(isFav({}, '0001')).toBe(false)
  })

  it('toggles an id in and out of the list and reports the new state', () => {
    const s = {}
    expect(toggleFav(s, '0001')).toBe(true)
    expect(toggleFav(s, 'c123')).toBe(true)
    expect(s.favEx).toEqual(['0001', 'c123'])
    expect(isFav(s, '0001')).toBe(true)
    expect(toggleFav(s, '0001')).toBe(false)
    expect(s.favEx).toEqual(['c123'])
  })

  it('moves favourites to the front and keeps both halves in their original order', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map(ex)
    const S = { favEx: ['d', 'b', 'zzz-not-listed'] }
    expect(sortFavouritesFirst(list, S).map(e => e.id)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('returns the very same list when there are no favourites', () => {
    const list = ['a', 'b'].map(ex)
    expect(sortFavouritesFirst(list, {})).toBe(list)
  })
})
