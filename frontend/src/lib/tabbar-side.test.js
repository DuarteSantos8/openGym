import { describe, expect, it } from 'vitest'
import { tabbarOnSide } from './tabbar-side.js'

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
