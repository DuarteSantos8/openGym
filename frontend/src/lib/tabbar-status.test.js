import { describe, expect, it } from 'vitest'
import { statusColumn } from './tabbar-side.js'

describe("a right edge that is the system's status column", () => {
  it('is told from a camera cutout by its width', () => {
    expect(statusColumn(81)).toBe(true)    // the iPhone Duo closed
    expect(statusColumn(59)).toBe(false)   // an iPhone on its side, Dynamic Island that way
    expect(statusColumn(0)).toBe(false)
    expect(statusColumn(undefined)).toBe(false)
  })
})
