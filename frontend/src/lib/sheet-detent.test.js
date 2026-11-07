import { describe, expect, it } from 'vitest'
import { pull, releaseDetent } from './sheet-detent.js'

const a = 400, z = 800
const rel = o => releaseDetent({ raw: 400, v: 0, a, z, single: false, dirty: false, ...o })

describe('releaseDetent', () => {
  it('from large, a slow drag down settles on the nearer detent', () => {
    expect(rel({ raw: 590, from: 'l' })).toBe('m')
    expect(rel({ raw: 610, from: 'l' })).toBe('l')
  })
  it('from medium, a short slow pull up goes large; a nudge springs back', () => {
    expect(rel({ raw: 450 })).toBe('l')
    expect(rel({ raw: 430 })).toBe('m')
  })
  it('a flick down from medium closes, a slow pull to the bottom closes too', () => {
    expect(rel({ raw: 380, v: 1.2 })).toBe('close')
    expect(rel({ raw: 250 })).toBe('close')
  })
  it('a small pull down springs back to medium', () => {
    expect(rel({ raw: 360 })).toBe('m')
  })
  it('a flick up from medium goes large', () => {
    expect(rel({ raw: 450, v: -1.2 })).toBe('l')
  })
  it('a flick down from large goes to medium, not shut', () => {
    expect(rel({ raw: 780, v: 1.2, from: 'l' })).toBe('m')
  })
  it('a single-size sheet never goes large', () => {
    expect(rel({ raw: 700, v: -2, single: true })).toBe('m')
    expect(rel({ raw: 250, single: true })).toBe('close')
  })
  it('a sheet holding edits never closes by a gesture', () => {
    expect(rel({ raw: 100, v: 2, dirty: true })).toBe('m')
  })
})

describe('pull', () => {
  it('follows the finger between the detents', () => {
    expect(pull(600, a, z)).toEqual({ h: 600, ty: 0 })
  })
  it('rubber-bands above large', () => {
    expect(pull(900, a, z).h).toBeCloseTo(815)
  })
  it('keeps its height below small and slides down instead', () => {
    expect(pull(300, a, z)).toEqual({ h: 400, ty: 100 })
  })
})
