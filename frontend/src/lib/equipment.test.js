import { describe, expect, test } from 'vitest'
import { exAvailable, ALL_EQUIPMENT } from './equipment.js'

// QA 1.3.11: an imported custom exercise is stored with eq "custom", which no profile can tick, so
// any active profile hid it from the Library, the picker and the muscle explorer for good.
describe('exAvailable', () => {
  const S = { equipFilterOn: true, activeEquipId: 'home', equipProfiles: [{ id: 'home', name: 'Home', equipment: ['dumbbell'] }] }

  test('the active profile decides for catalogue equipment', () => {
    expect(exAvailable(S, { eq: 'dumbbell' })).toBe(true)
    expect(exAvailable(S, { eq: 'barbell' })).toBe(false)
    expect(exAvailable(S, { eq: 'body weight' })).toBe(true)
  })

  test('equipment no profile can pick never hides an exercise', () => {
    expect(ALL_EQUIPMENT.includes('custom')).toBe(false)
    expect(exAvailable(S, { id: 'c1', n: 'trap bar deadlift', eq: 'custom', custom: true })).toBe(true)
  })

  test('a custom exercise with real equipment is still filtered like any other', () => {
    expect(exAvailable(S, { id: 'c2', n: 'my row', eq: 'barbell', custom: true })).toBe(false)
  })

  test('no profile, nothing hidden', () => {
    expect(exAvailable({ ...S, equipFilterOn: false }, { eq: 'barbell' })).toBe(true)
  })
})
