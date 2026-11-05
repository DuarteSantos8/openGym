// Discord, 2026-11-04: a bench press logged as 30 kg read "5 per side" and 12.5 kg read "Bar only".
// Both are right for a 20 kg bar, but nothing said that bar was counted, and 12.5 kg cannot be
// "bar only" on a 20 kg bar. The first line names the bar; a weight under it says so.
import { describe, expect, it } from 'vitest'
import { plateText } from './plate-text.js'
import { inventoryFor, rowLoad, sameLoad } from './plates.js'

const inv = inventoryFor({ unit: 'kg' })

describe('the plate line', () => {
  it('names the bar it counts with on the first line', () => {
    expect(plateText(rowLoad('pairs', 30, 20, inv), { unit: 'kg', base: 20, first: true })).toBe('5 per side on a 20 kg bar')
    expect(plateText(rowLoad('pairs', 40, 20, inv), { unit: 'kg', base: 20 })).toBe('10 per side')
  })
  it('says a weight under the bar is under the bar, not "bar only"', () => {
    const L = rowLoad('pairs', 12.5, 20, inv)
    expect(L).toMatchObject({ barOnly: true, underBar: true, bar: 20 })
    expect(plateText(L, { unit: 'kg', base: 20, first: true })).toBe('Lighter than the 20 kg bar')
    expect(plateText(rowLoad('pairs', 20, 20, inv), { unit: 'kg', base: 20 })).toBe('Bar only')
    expect(sameLoad(rowLoad('pairs', 12.5, 20, inv), rowLoad('pairs', 20, 20, inv))).toBe(false)
  })
  it('a machine with a base weight of its own is never called a bar', () => {
    expect(plateText(rowLoad('pairs', 145, 50, inv), { unit: 'lb', base: 50, first: true, bar: false })).not.toMatch(/bar/)
    expect(plateText(rowLoad('pairs', 40, 50, inv), { unit: 'lb', base: 50, first: true, bar: false })).toBe('Bar only')
  })
  it('a single stack and a bar-less machine stay as they were', () => {
    expect(plateText(rowLoad('single', 25, 0, inv), { unit: 'kg', base: 0, first: true })).toBe('Load 25')
    expect(plateText(rowLoad('pairs', 30, 0, inv), { unit: 'kg', base: 0, first: true })).toBe('15 per side')
  })
})
