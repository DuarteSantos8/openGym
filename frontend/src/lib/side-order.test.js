import { describe, it, expect } from 'vitest'
import { sidesInOrder, nextSide } from './side-order.js'

const set = (L, R) => ({ sides: { L: { done: L }, R: { done: R } } })

describe('side order', () => {
  it('is left first unless the exercise says right first', () => {
    expect(sidesInOrder(undefined)).toEqual(['L', 'R'])
    expect(sidesInOrder({ side: true })).toEqual(['L', 'R'])
    expect(sidesInOrder({ side: true, sideOrder: 'LR' })).toEqual(['L', 'R'])
    expect(sidesInOrder({ side: true, sideOrder: 'RL' })).toEqual(['R', 'L'])
  })

  it('the next side is the first one in order still to do', () => {
    expect(nextSide(set(false, false), {})).toBe('L')
    expect(nextSide(set(true, false), {})).toBe('R')
    expect(nextSide(set(false, false), { sideOrder: 'RL' })).toBe('R')
    expect(nextSide(set(false, true), { sideOrder: 'RL' })).toBe('L')
  })

  it('a set with the second side ticked first still asks for the first', () => {
    expect(nextSide(set(false, true), {})).toBe('L')
    expect(nextSide(set(true, false), { sideOrder: 'RL' })).toBe('R')
  })
})
