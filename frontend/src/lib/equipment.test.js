import { describe, expect, test, it } from 'vitest'
import { exAvailable, eqAvailable, profileEquipment, newProfile, ACC_V, ALL_EQUIPMENT, ACCESSORIES, accessoriesOf } from './equipment.js'
import { EXIDX } from './exercises.js'

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

// "dumbbell bench press" is tagged `dumbbell` and "chin-up" `body weight`, so the catalogue's
// equipment value alone let a dumbbells-only profile see a bench and a bare one see a bar.
describe('bench and pull-up bar', () => {
  const ex = (n, eq) => ({ n, eq })
  const profile = equipment => ({ equipFilterOn: true, activeEquipId: 'p', equipProfiles: [{ id: 'p', name: 'P', equipment, accV: ACC_V }] })

  test('are read off the exercise name, whatever its equipment tag says', () => {
    expect(accessoriesOf(ex('dumbbell bench press', 'dumbbell'))).toEqual(['bench'])
    expect(accessoriesOf(ex('dumbbell incline curl', 'dumbbell'))).toEqual(['bench'])
    expect(accessoriesOf(ex('decline sit-up', 'body weight'))).toEqual(['bench'])
    expect(accessoriesOf(ex('chin-up', 'body weight'))).toEqual(['pull-up bar'])
    expect(accessoriesOf(ex('hanging leg raise', 'body weight'))).toEqual(['pull-up bar'])
  })

  test('exercises that name neither need neither', () => {
    expect(accessoriesOf(ex('dumbbell squat', 'dumbbell'))).toEqual([])
    expect(accessoriesOf(ex('push-up', 'body weight'))).toEqual([])
    expect(accessoriesOf({ eq: 'dumbbell' })).toEqual([])
  })

  test('machines with their own bench or bar are left alone', () => {
    expect(accessoriesOf(ex('lever incline chest press', 'leverage machine'))).toEqual([])
    expect(accessoriesOf(ex('assisted pull-up', 'assisted'))).toEqual([])
  })

  test('only ever name a listed accessory', () => {
    for (const e of Object.values(EXIDX)) for (const a of accessoriesOf(e)) expect(ACCESSORIES).toContain(a)
  })

  test('both are in the profile checklist', () => {
    for (const a of ACCESSORIES) expect(ALL_EQUIPMENT).toContain(a)
  })

  test('the dumbbell and the bench together unlock a bench press', () => {
    const press = ex('dumbbell bench press', 'dumbbell')
    expect(exAvailable(profile(['dumbbell']), press)).toBe(false)
    expect(exAvailable(profile(['bench']), press)).toBe(false)
    expect(exAvailable(profile(['dumbbell', 'bench']), press)).toBe(true)
  })

  test('an empty profile keeps plain body weight but loses what needs a bar', () => {
    expect(exAvailable(profile([]), ex('push-up', 'body weight'))).toBe(true)
    expect(exAvailable(profile([]), ex('chin-up', 'body weight'))).toBe(false)
    expect(exAvailable(profile(['pull-up bar']), ex('chin-up', 'body weight'))).toBe(true)
  })

  test('an imported custom exercise stays visible even if its name says bench', () => {
    expect(exAvailable(profile([]), { id: 'c', n: 'my bench thing', eq: 'custom', custom: true })).toBe(true)
  })
})

describe('profiles saved before the bench and the bar existed (#464)', () => {
  const bench = { n: 'dumbbell bench press', eq: 'dumbbell' }
  it('keep their bench and bar work until saved again', () => {
    expect(eqAvailable(profileEquipment({ equipment: ['dumbbell'] }), bench)).toBe(true)
    expect(eqAvailable(profileEquipment({ equipment: ['dumbbell'], accV: ACC_V }), bench)).toBe(false)
    expect(newProfile('Home').accV).toBe(ACC_V)
  })
})
