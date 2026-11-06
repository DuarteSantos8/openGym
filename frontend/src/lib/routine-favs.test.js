import { describe, expect, it } from 'vitest'
import { isFavRoutine, toggleFavRoutine, favRoutinesFirst } from './routine-favs.js'

describe('favourite routines', () => {
  it('stars and unstars, writing the key only when on', () => {
    const s = { routines: [{ id: 'a' }, { id: 'b' }] }
    expect(toggleFavRoutine(s, 'b')).toBe(true)
    expect(s.routines[1].fav).toBe(true)
    expect(toggleFavRoutine(s, 'b')).toBe(false)
    expect('fav' in s.routines[1]).toBe(false)
    expect(toggleFavRoutine(s, 'nope')).toBe(false)
  })
  it('puts favourites first and keeps each half in order', () => {
    const list = [{ id: 'a' }, { id: 'b', fav: true }, { id: 'c' }, { id: 'd', fav: true }]
    expect(favRoutinesFirst(list).map(r => r.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(isFavRoutine(list[0])).toBe(false)
  })
})
