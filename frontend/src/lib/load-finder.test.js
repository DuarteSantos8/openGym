import { describe, it, expect } from 'vitest'
import { FEELS, MAX_TRIES, startLoad, begin, answer, nextUp, nextDown, stepIn } from './load-finder.js'

describe('load finder: a first working weight from two or three test sets', () => {
  it('starts from something anyone can pick up, by equipment and unit', () => {
    expect(startLoad({ eq: 'barbell' }, 'kg')).toBe(20)
    expect(startLoad({ eq: 'barbell' }, 'lb')).toBe(45)
    expect(startLoad({ eq: 'ez barbell' }, 'kg')).toBe(10)
    expect(startLoad({ eq: 'dumbbell' }, 'kg')).toBe(5)
    expect(startLoad({ eq: 'dumbbell' }, 'lb')).toBe(10)
    expect(startLoad({ eq: 'kettlebell' }, 'kg')).toBe(8)
    expect(startLoad({ eq: 'cable' }, 'kg')).toBe(10)
    expect(startLoad({ eq: 'leverage machine' }, 'lb')).toBe(20)
    expect(startLoad({ eq: 'something new' }, 'kg')).toBe(5)
    expect(startLoad(null, 'kg')).toBe(5)
  })

  it('moves by about a fifth, never less than one step, and stays on the step grid', () => {
    expect(nextUp(20, 2.5)).toBe(25)
    expect(nextUp(5, 2.5)).toBe(7.5)
    expect(nextUp(2.5, 2.5)).toBe(5)
    expect(nextUp(45, 5)).toBe(55)
    expect(nextDown(20, 2.5)).toBe(15)
    expect(nextDown(5, 2.5)).toBe(2.5)
    expect(nextDown(2.5, 2.5)).toBe(0)
    expect(nextDown(0, 2.5)).toBe(0)
    expect(nextUp(0, 2.5)).toBe(2.5)
    expect(nextUp(20, 0)).toBe(24)
  })

  it('"about right" ends it at once with the weight just tried', () => {
    const s = answer(begin(20, 2.5), 'right')
    expect(s).toMatchObject({ done: true, weight: 20, tries: 1 })
  })

  it('"easy" goes up and asks again; "too hard" goes down and asks again', () => {
    const up = answer(begin(20, 2.5), 'easy')
    expect(up).toMatchObject({ done: false, weight: 25, tries: 1 })
    const down = answer(begin(20, 2.5), 'hard')
    expect(down).toMatchObject({ done: false, weight: 15, tries: 1 })
  })

  it('easy then too hard settles on the weight that was easy', () => {
    let s = answer(begin(20, 2.5), 'easy')
    s = answer(s, 'hard')
    expect(s).toMatchObject({ done: true, weight: 20, tries: 2 })
  })

  it('too hard then easy settles on the lighter weight, the one that was done', () => {
    let s = answer(begin(20, 2.5), 'hard')
    s = answer(s, 'easy')
    expect(s).toMatchObject({ done: true, weight: 15, tries: 2 })
  })

  it('stops after three test sets so the finder never becomes the workout', () => {
    let s = begin(20, 2.5)
    for (let i = 0; i < MAX_TRIES; i++) s = answer(s, 'easy')
    expect(s.done).toBe(true)
    expect(s.tries).toBe(MAX_TRIES)
    // three easy sets: start with the last weight lifted, not one never tried
    expect(s.weight).toBe(30)
    let h = begin(20, 2.5)
    for (let i = 0; i < MAX_TRIES; i++) h = answer(h, 'hard')
    expect(h.done).toBe(true)
    // three too hard: one more step down from the last one
    expect(h.weight).toBe(nextDown(nextDown(nextDown(20, 2.5), 2.5), 2.5))
  })

  it('too hard at nothing left to take off ends at zero rather than looping', () => {
    const s = answer(begin(0, 2.5), 'hard')
    expect(s).toMatchObject({ done: true, weight: 0 })
  })

  it('a weight changed by hand before answering is the one that counts', () => {
    const s = answer({ ...begin(20, 2.5), weight: 12.5 }, 'right')
    expect(s.weight).toBe(12.5)
  })

  it('ignores an answer it does not know and an answer after the end', () => {
    const s = begin(20, 2.5)
    expect(answer(s, 'maybe')).toBe(s)
    const done = answer(s, 'right')
    expect(answer(done, 'easy')).toBe(done)
    expect(FEELS).toEqual(['easy', 'right', 'hard'])
  })

  it('is deterministic and never returns a negative or unrounded weight', () => {
    for (const start of [0, 2.5, 5, 20, 45, 102.5]) for (const step of [1, 1.25, 2.5, 5]) {
      for (const path of [['easy', 'easy', 'easy'], ['hard', 'hard', 'hard'], ['easy', 'hard'], ['hard', 'easy'], ['easy', 'right']]) {
        let s = begin(start, step)
        for (const f of path) s = answer(s, f)
        expect(s.done).toBe(true)
        expect(s.weight).toBeGreaterThanOrEqual(0)
        expect(Math.abs(s.weight / step - Math.round(s.weight / step))).toBeLessThan(1e-9)
      }
    }
  })

  // The bar itself is the least a barbell lift can weigh (review of #60): the finder never
  // suggests less than the floor it is given, and says so instead of going on subtracting.
  it('never goes under the floor: too hard on the empty bar ends there and says it is the floor', () => {
    const s = answer(begin(20, 2.5, { floor: 20 }), 'hard')
    expect(s).toMatchObject({ done: true, weight: 20, atFloor: true, tries: 1 })
  })

  it('steps down to the floor, not past it', () => {
    expect(nextDown(22.5, 2.5, 20)).toBe(20)
    expect(nextDown(20, 2.5, 20)).toBe(20)
    let s = answer(begin(30, 2.5, { floor: 20 }), 'hard')
    expect(s).toMatchObject({ done: false, weight: 25 })
    s = answer(s, 'hard')
    expect(s).toMatchObject({ done: false, weight: 20 })
    s = answer(s, 'hard')
    expect(s).toMatchObject({ done: true, weight: 20, atFloor: true })
  })

  it('starts on the floor when the usual start is under it, and a normal ending is not "at the floor"', () => {
    expect(begin(10, 2.5, { floor: 15 }).weight).toBe(15)
    expect(answer(begin(20, 2.5, { floor: 20 }), 'right').atFloor).toBeFalsy()
    expect(answer(begin(0, 2.5), 'hard')).toMatchObject({ done: true, weight: 0, atFloor: true })
  })

  it('holds the floor on every path', () => {
    for (const floor of [0, 15, 20]) for (const path of [['hard', 'hard', 'hard'], ['hard', 'easy'], ['easy', 'hard'], ['hard', 'right']]) {
      let s = begin(20, 2.5, { floor })
      for (const f of path) s = answer(s, f)
      expect(s.done).toBe(true)
      expect(s.weight).toBeGreaterThanOrEqual(floor)
    }
  })

  // With the dumbbells or the machine stack someone has listed, the finder only ever names a
  // weight that is there (review of #60), the way the workout's own + and - do.
  it('walks the weights that are owned instead of the step grid', () => {
    const rack = [4, 6, 8, 10, 12.5, 15, 20]
    expect(nextUp(10, 2.5, rack)).toBe(12.5)     // 12 is the aim; 12.5 is the nearest bell above
    expect(nextUp(4, 2.5, rack)).toBe(6)         // 4.8 is the aim; never the bell already held
    expect(nextUp(20, 2.5, rack)).toBe(20)       // top of the rack
    expect(nextDown(10, 2.5, 0, rack)).toBe(8)
    expect(nextDown(4, 2.5, 0, rack)).toBe(4)    // bottom of the rack
    expect(stepIn(rack, 10, 1)).toBe(12.5)
    expect(stepIn(rack, 10, -1)).toBe(8)
    expect(stepIn(rack, 20, 1)).toBe(20)
    expect(stepIn(rack, 11, -1)).toBe(10)
  })

  it('starts on an owned weight and ends on one, on every path', () => {
    const rack = [4, 6, 8, 10, 12.5, 15, 20]
    expect(begin(5, 2.5, { weights: rack }).weight).toBe(4)
    expect(begin(7, 2.5, { weights: rack }).weight).toBe(6)
    expect(begin(50, 2.5, { weights: rack }).weight).toBe(20)
    for (const path of [['easy', 'easy', 'easy'], ['hard', 'hard', 'hard'], ['easy', 'hard'], ['hard', 'easy'], ['easy', 'right']]) {
      let s = begin(10, 2.5, { weights: rack })
      for (const f of path) s = answer(s, f)
      expect(s.done).toBe(true)
      expect(rack).toContain(s.weight)
    }
  })

  it('too hard on the lightest owned weight says it cannot go lighter; easy on the heaviest ends there', () => {
    const rack = [4, 6, 8]
    expect(answer(begin(4, 2.5, { weights: rack }), 'hard')).toMatchObject({ done: true, weight: 4, atFloor: true })
    expect(answer(begin(8, 2.5, { weights: rack }), 'easy')).toMatchObject({ done: true, weight: 8 })
    expect(answer(begin(8, 2.5, { weights: rack }), 'easy').atFloor).toBeFalsy()
  })

  it('an empty or missing list of owned weights changes nothing', () => {
    expect(begin(20, 2.5, { weights: [] }).weight).toBe(20)
    expect(nextUp(20, 2.5, null)).toBe(25)
    expect(nextDown(20, 2.5, 0, [])).toBe(15)
  })
})

