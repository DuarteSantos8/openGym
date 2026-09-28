// @vitest-environment happy-dom
// @vitest-environment happy-dom

// moveGymCard backs the on-card ◀ ▶ reorder buttons: it moves the card at `from` to index `to`,
// returning a new array. These tests cover that contract — a move is a splice, the input is never
// mutated, and degenerate moves (in place, out of range, past the ends) are safe no-ops, so a
// button at either end of the rail is simply inert.
//
// moveGymCard itself is pure, but importing CheckIn.jsx loads the store (which registers a
// visibilitychange listener at module load) and the scanner/sheet modules, so the file runs under
// happy-dom with those heavy imports stubbed. The function under test touches none of them.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/scan.js', () => ({ scanCode: vi.fn(), importCodeFromImage: vi.fn() }))
vi.mock('../components/CameraScan.jsx', () => ({ default: () => null }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))

import { moveGymCard } from './CheckIn.jsx'

const cards = (...ids) => ids.map(id => ({ id, label: id.toUpperCase(), value: id, fmt: 'qrcode' }))
const ids = list => list.map(c => c.id)

describe('moveGymCard', () => {
  it('moves a card forward to a later slot', () => {
    expect(ids(moveGymCard(cards('a', 'b', 'c', 'd'), 0, 2))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a card backward to an earlier slot', () => {
    expect(ids(moveGymCard(cards('a', 'b', 'c', 'd'), 3, 1))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('is a permutation — no card is lost or duplicated', () => {
    const before = cards('a', 'b', 'c', 'd', 'e')
    const after = moveGymCard(before, 4, 0)
    expect(ids(after).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(after).toHaveLength(before.length)
  })

  it('leaves the array unchanged when dropped in place', () => {
    expect(ids(moveGymCard(cards('a', 'b', 'c'), 1, 1))).toEqual(['a', 'b', 'c'])
  })

  it('clamps a target past the end to the last slot', () => {
    expect(ids(moveGymCard(cards('a', 'b', 'c'), 0, 99))).toEqual(['b', 'c', 'a'])
  })

  it('ignores an out-of-range source without throwing', () => {
    expect(ids(moveGymCard(cards('a', 'b'), 5, 0))).toEqual(['a', 'b'])
  })

  it('does not mutate the input array', () => {
    const before = cards('a', 'b', 'c')
    const snapshot = ids(before)
    moveGymCard(before, 0, 2)
    expect(ids(before)).toEqual(snapshot)
  })
})
