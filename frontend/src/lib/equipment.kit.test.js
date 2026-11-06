// Your own kit (#323): tags on a gym profile and on your own exercises, used by the filter and the
// session builder.
import { describe, expect, it } from 'vitest'
import { exAvailable, kitAvailable, cleanKit, knownKit } from './equipment.js'

const profile = (kit) => ({ id: 'g1', name: 'Garage', equipment: ['body weight'], accV: 3, kit })
const S = (kit) => ({ equipFilterOn: true, activeEquipId: 'g1', equipProfiles: [profile(kit)] })
const sandbag = { id: 'c1', n: 'sandbag carry', eq: 'body weight', custom: true, kit: ['Sandbag'] }

describe('own kit', () => {
  it('shows an exercise that needs it only where the gym has it, matching without case', () => {
    expect(exAvailable(S(['sandbag ']), sandbag)).toBe(true)
    expect(exAvailable(S(['Rings']), sandbag)).toBe(false)
    expect(exAvailable(S(undefined), sandbag)).toBe(false)
    // No profile filtering: everything shows.
    expect(exAvailable({}, sandbag)).toBe(true)
    expect(kitAvailable({}, { n: 'x' })).toBe(true)
  })
  it('cleans names and lists what is in use', () => {
    expect(cleanKit([' Sandbag ', 'sandbag', '', 'Rings', 7])).toEqual(['Sandbag', 'Rings', '7'])
    expect(knownKit({ equipProfiles: [profile(['Rings'])], customEx: [sandbag] })).toEqual(['Rings', 'Sandbag'])
  })
})
