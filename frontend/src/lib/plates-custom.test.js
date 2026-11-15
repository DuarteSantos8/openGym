// #886: a gym's own plate sizes. 1, 2, 3, 4, 5, 10, 15 and 20 kg, no 1.25 or 1.5: the list takes
// sizes the usual set lacks, drops them again, and the loader only ever reaches for what is there.
import { describe, expect, it } from 'vitest'
import { plateSizesFor, isPlateSize, withoutPlateSize, withPlatePairs, inventoryFor, rowLoad, ownsPlates } from './plates.js'

const gym = { unit: 'kg', plates: { kg: { 20: 4, 15: 2, 10: 2, 5: 2, 4: 1, 3: 1, 2: 1, 1: 1, _ts: 1 } } }

describe('a plate set of the gym’s own (#886)', () => {
  it('lists the usual sizes plus its own, heaviest first', () => {
    const sizes = plateSizesFor(gym)
    expect(sizes).toContain(4)
    expect(sizes).toContain(3)
    expect(sizes).toContain(1.25)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(plateSizesFor({ unit: 'kg' })).not.toContain(3)
  })

  it('takes sizes on the quarter grid only', () => {
    expect(isPlateSize(3)).toBe(true)
    expect(isPlateSize(0.25)).toBe(true)
    expect(isPlateSize(0.3)).toBe(false)
    expect(isPlateSize(0)).toBe(false)
    expect(isPlateSize(150)).toBe(false)
  })

  it('loads from those sizes, so 26 kg on a 20 kg bar is a 3 a side, not "1 kg short"', () => {
    const inv = inventoryFor(gym)
    expect(rowLoad('pairs', 26, 20, inv)).toMatchObject({ plates: [3], missing: 0 })
    expect(rowLoad('pairs', 22.5, 20, inv)).toMatchObject({ plates: [1], missing: 0.25 })
    expect(rowLoad('pairs', 34, 20, inv)).toMatchObject({ plates: [5, 2], missing: 0 })
  })

  it('a size of its own leaves the list, a usual one stays at 0, stamped', () => {
    let S = { ...gym, plates: withoutPlateSize(gym, 3, 9) }
    expect(S.plates.kg[3]).toBeUndefined()
    expect(S.plates.kg._ts).toBe(9)
    expect(plateSizesFor(S)).not.toContain(3)
    S = { ...S, plates: withoutPlateSize(S, 20, 10) }
    expect(S.plates.kg[20]).toBe(0)
    expect(plateSizesFor(S)).toContain(20)
    // A new size comes in from the standard set like any other change.
    const fresh = { unit: 'kg', plates: withPlatePairs({ unit: 'kg' }, 0.25, 2) }
    expect(inventoryFor(fresh).find(p => p.w === 0.25)).toEqual({ w: 0.25, n: 2 })
    expect(inventoryFor(fresh).find(p => p.w === 20)?.n).toBe(6)
    // Removing the last size keeps the list its own (an empty list would be the standard set again).
    const one = { unit: 'kg', plates: { kg: { 3: 2, _ts: 1 } } }
    const none = { unit: 'kg', plates: withoutPlateSize(one, 3) }
    expect(ownsPlates(none)).toBe(true)
    expect(inventoryFor(none)).toEqual([])
  })
})
