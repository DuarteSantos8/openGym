import { describe, it, expect } from 'vitest'
import { variantFor, APK_VARIANT, VARIANT_NAMES } from './apk-variant.js'

describe('apk-variant: which sideloaded APK this is', () => {
  it('takes the kind the release build names', () => {
    expect(variantFor('hd', 180)).toBe('hd')
    expect(variantFor('plus', 180)).toBe('plus')
  })
  it('without one, goes by the animations built in', () => {
    expect(variantFor(undefined, 180)).toBe('standard')
    expect(variantFor(undefined, 240)).toBe('plus')
    expect(variantFor(undefined, 360)).toBe('hd')
    expect(variantFor('nonsense', 360)).toBe('hd')
  })
  it('a test build is Standard, and every kind has the name the download page uses', () => {
    expect(APK_VARIANT).toBe('standard')
    expect(VARIANT_NAMES).toEqual({ standard: 'Standard', plus: 'Plus', hd: 'HD' })
  })
})
