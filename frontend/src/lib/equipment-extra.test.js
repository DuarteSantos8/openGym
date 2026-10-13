import { describe, expect, it } from 'vitest'
import { ALL_EQUIPMENT } from './equipment.js'
import { isLoadedEq } from './exercises.js'

// Issue #393: clubbell and macebell are real loaded tools with no catalogue entries yet.
describe('clubbell and macebell', () => {
  it('keeps both on the equipment list, whether the catalogue uses them or not', () => {
    expect(ALL_EQUIPMENT).toEqual(expect.arrayContaining(['clubbell', 'macebell']))
  })

  it('treats a set on either as a loaded set', () => {
    expect(isLoadedEq({ eq: 'clubbell' })).toBe(true)
    expect(isLoadedEq({ eq: 'macebell' })).toBe(true)
    expect(isLoadedEq({ eq: 'kettlebell' })).toBe(true)
  })
})
