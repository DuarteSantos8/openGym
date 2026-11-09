// #926: a machine's odd stack typed or pasted in one go, instead of one weight at a time.
import { describe, expect, it } from 'vitest'
import { parseWeightList } from './dumbbells.js'

describe('parseWeightList', () => {
  it('reads one per line, commas, semicolons and spaces, sorted and without doubles', () => {
    expect(parseWeightList('5\n11.3\n18.1\n')).toEqual([5, 11.3, 18.1])
    expect(parseWeightList('18.1, 5,11.3;  5')).toEqual([5, 11.3, 18.1])
    expect(parseWeightList('20 kg\n25kg\n30 lb')).toEqual([20, 25, 30])
  })
  it('takes a comma between digits as the decimal comma where the language writes one', () => {
    expect(parseWeightList('5; 11,3; 18,1', true)).toEqual([5, 11.3, 18.1])
    expect(parseWeightList('2,5\n5\n7,5', true)).toEqual([2.5, 5, 7.5])
    expect(parseWeightList('5, 10, 15', true)).toEqual([5, 10, 15])
    expect(parseWeightList('5,10,15', false)).toEqual([5, 10, 15])
  })
  it('skips what is not a weight, and the other scripts’ commas separate too', () => {
    expect(parseWeightList('abc\n-5\n0\n12')).toEqual([12])
    expect(parseWeightList('5، 10، 15')).toEqual([5, 10, 15])
    expect(parseWeightList('5，10，15')).toEqual([5, 10, 15])
    expect(parseWeightList('')).toEqual([])
  })
})
