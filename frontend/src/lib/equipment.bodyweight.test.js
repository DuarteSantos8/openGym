// Body weight as a tick of its own in an equipment profile (#1159): ticked in a new profile, a
// profile saved before counts as ticked, and unticked it hides what needs nothing but you.
import { describe, expect, test } from 'vitest'
import { exAvailable, newProfile, bodyWeightOf, ACC_V, BW_V } from './equipment.js'

const ex = (n, eq) => ({ n, eq })
const PUSH_UP = ex('push-up', 'body weight')
const CHIN_UP = ex('chin-up', 'body weight')
const S = p => ({ equipFilterOn: true, activeEquipId: 'p', equipProfiles: [{ id: 'p', name: 'P', accV: ACC_V, ...p }] })

describe('body weight in an equipment profile', () => {
  test('a profile with no mark lets body-weight exercises through, as before', () => {
    expect(bodyWeightOf({ equipment: [] })).toBe(true)
    expect(exAvailable(S({ equipment: ['dumbbell'] }), PUSH_UP)).toBe(true)
    expect(exAvailable(S({ equipment: ['dumbbell'] }), CHIN_UP)).toBe(false)
    expect(exAvailable(S({ equipment: ['pull-up bar'] }), CHIN_UP)).toBe(true)
  })

  test('a new profile has it ticked', () => {
    const p = newProfile('Home')
    expect(p.bwV).toBe(BW_V)
    expect(p.equipment).toContain('body weight')
    expect(bodyWeightOf(p)).toBe(true)
  })

  test('saved unticked, pure body weight hides; a chin-up still follows the bar', () => {
    const off = equipment => S({ equipment, bwV: BW_V })
    expect(exAvailable(off(['dumbbell']), PUSH_UP)).toBe(false)
    expect(exAvailable(off(['pull-up bar']), CHIN_UP)).toBe(true)
    expect(exAvailable(off(['dumbbell']), CHIN_UP)).toBe(false)
    // other equipment is untouched
    expect(exAvailable(off(['dumbbell']), ex('dumbbell curl', 'dumbbell'))).toBe(true)
  })

  test('saved ticked, body-weight exercises show', () => {
    const on = S({ equipment: ['body weight'], bwV: BW_V })
    expect(exAvailable(on, PUSH_UP)).toBe(true)
    expect(exAvailable(on, CHIN_UP)).toBe(false)
  })

  test('with the filter off, nothing hides', () => {
    const st = { ...S({ equipment: [], bwV: BW_V }), equipFilterOn: false }
    expect(exAvailable(st, PUSH_UP)).toBe(true)
  })
})
