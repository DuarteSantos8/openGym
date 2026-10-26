import { describe, expect, it } from 'vitest'
import { tabbarOnSide, statusColumn } from './tabbar-side.js'

describe('where the tab bar stands', () => {
  it('automatic (the default, and an older profile without the key): on the right only on a wide screen', () => {
    for (const pref of ['auto', undefined, null]) {
      expect(tabbarOnSide(pref, true)).toBe(true)
      expect(tabbarOnSide(pref, false)).toBe(false)
    }
  })

  it('bottom and right are kept whatever the screen', () => {
    expect(tabbarOnSide('bottom', true)).toBe(false)
    expect(tabbarOnSide('right', false)).toBe(true)
  })
})

describe("a right edge that is the system's status column", () => {
  it('is told from a camera cutout by its width', () => {
    expect(statusColumn(81)).toBe(true)    // the iPhone Duo closed
    expect(statusColumn(59)).toBe(false)   // an iPhone on its side, Dynamic Island that way
    expect(statusColumn(0)).toBe(false)
    expect(statusColumn(undefined)).toBe(false)
  })
})
