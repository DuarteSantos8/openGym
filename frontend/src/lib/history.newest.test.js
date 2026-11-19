import { describe, expect, it } from 'vitest'
import { newestWorkouts } from './history.js'

const w = (id, d, start) => ({ id, d, start })

describe('newestWorkouts', () => {
  it('orders by day, then start, whatever the list order', () => {
    const list = [w('b', '2026-05-02', 1000), w('a', '2026-05-03', 10), w('c', '2026-05-02', 2000), w('d', '2026-04-01', 5)]
    expect(newestWorkouts(list).map(x => x.id)).toEqual(['a', 'c', 'b', 'd'])
  })
  it('takes the first n', () => {
    const list = [w('a', '2026-05-01'), w('b', '2026-05-02'), w('c', '2026-05-03')]
    expect(newestWorkouts(list, 2).map(x => x.id)).toEqual(['c', 'b'])
  })
  it('falls back to the start timestamp for a record without a valid day, and drops the undated', () => {
    const day = new Date(2026, 5, 10, 9).getTime()
    const list = [w('a', '2026-05-01'), { id: 'x', d: 'bad', start: day }, { id: 'y' }, null]
    expect(newestWorkouts(list).map(x => x.id)).toEqual(['x', 'a'])
  })
  it('is empty for no list', () => {
    expect(newestWorkouts(undefined)).toEqual([])
  })
})
