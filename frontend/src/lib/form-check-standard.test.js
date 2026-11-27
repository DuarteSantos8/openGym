// @vitest-environment happy-dom
// The depth a rep must reach to count is the lifter's, remembered per drill on this phone.
import { beforeEach, describe, expect, it } from 'vitest'
import { storedStandard, storeStandard, STANDARD_KEY } from './form-check-standard.js'

beforeEach(() => localStorage.clear())

describe('the stored standard', () => {
  it('is the drill default until one is picked', () => {
    expect(storedStandard('squat')).toBe('parallel')
  })

  it('remembers the pick per drill', () => {
    storeStandard('squat', 'below')
    expect(storedStandard('squat')).toBe('below')
    storeStandard('squat', 'any')
    expect(storedStandard('squat')).toBe('any')
    expect(JSON.parse(localStorage.getItem(STANDARD_KEY))).toEqual({ squat: 'any' })
  })

  it('ignores what is not one of the drill standards, stored or asked for', () => {
    storeStandard('squat', 'knee-deep')
    expect(localStorage.getItem(STANDARD_KEY)).toBe(null)
    localStorage.setItem(STANDARD_KEY, JSON.stringify({ squat: 'ankle' }))
    expect(storedStandard('squat')).toBe('parallel')
    localStorage.setItem(STANDARD_KEY, 'not json')
    expect(storedStandard('squat')).toBe('parallel')
    storeStandard('bench', 'below')
    expect(storedStandard('bench')).toBe(null)
  })

  it('falls back to the default when storage cannot be read', () => {
    const real = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    try { expect(storedStandard('squat')).toBe('parallel') } finally { Storage.prototype.getItem = real }
  })
})
