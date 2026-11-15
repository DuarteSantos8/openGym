import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises-data.js'
import { EXIDX } from './exercises.js'
import { ALL_EQUIPMENT, eqAvailable, exAvailable, profileEquipment } from './equipment.js'
import { fitRoutines, buildStarterPlan } from './starter.js'
import {
  MACHINE_EQ, MACHINE_KINDS, MACHINE_GROUPS, KIND_IDS, KIND_COUNT, NO_MACHINE, machineKindOf, profileMachines, kindsForEquipment,
  machinesOf, machineFields, machinesSummary, searchKinds, withoutKind, removableKind,
} from './machine-kinds.js'
import { MACHINE_KINDS as CATALOGUE_KINDS, MACHINE_EQUIPMENT } from '../../../scripts/catalogue/validate.mjs'

const byName = n => EXDB.find(e => e.n === n)
const LEG_PRESS_45 = byName('sled 45° leg press')
const LEVER_LEG_PRESS = byName('lever seated leg press')
const LEG_EXTENSION = byName('lever leg extension')
const SMITH_SQUAT = byName('smith squat')
const PARTNER_STRETCH = byName('assisted lying hamstring stretch')

// The invariant asked for in #923: a machine exercise always says which machine it is on, so
// a gym that lists its machines can never lose one to a missing tag. "other" is a choice too.
describe('every machine exercise has its machine', () => {
  it('a catalogue row on a machine has a known kind, and no other row has one', () => {
    const missing = EXDB.filter(e => MACHINE_EQ.includes(e.eq) && !(KIND_IDS.includes(e.mk) || e.mk === NO_MACHINE))
    expect(missing.map(e => `${e.id} ${e.n}`)).toEqual([])
    const stray = EXDB.filter(e => !MACHINE_EQ.includes(e.eq) && e.mk != null)
    expect(stray.map(e => `${e.id} ${e.n}`)).toEqual([])
  })
  it('the cards and the catalogue check name the same kinds and the same machine equipment', () => {
    expect([...KIND_IDS, NO_MACHINE].sort()).toEqual([...CATALOGUE_KINDS].sort())
    expect([...MACHINE_EQ].sort()).toEqual([...MACHINE_EQUIPMENT].sort())
  })
  it('every card opens at least one exercise, every card has a group, and the counts add up', () => {
    for (const id of KIND_IDS) expect(KIND_COUNT[id], id).toBeGreaterThan(0)
    const groups = MACHINE_GROUPS.map(g => g.id)
    for (const k of MACHINE_KINDS) expect(groups).toContain(k.group)
    const machines = EXDB.filter(e => MACHINE_EQ.includes(e.eq))
    const none = machines.filter(e => e.mk === NO_MACHINE).length
    expect(Object.values(KIND_COUNT).reduce((a, b) => a + b, 0)).toBe(machines.length - none)
  })
  it('a kind spans equipment values: the leg press is lever and sled alike, a Smith leg press is the Smith', () => {
    expect(machineKindOf(LEG_PRESS_45)).toBe('leg-press')
    expect(machineKindOf(LEVER_LEG_PRESS)).toBe('leg-press')
    expect(machineKindOf(byName('smith leg press'))).toBe('smith')
    expect(machineKindOf(byName('dumbbell bench press'))).toBeNull()
    // a custom exercise on a machine carries no kind and is left to its equipment
    expect(machineKindOf({ id: 'c1', n: 'my press', eq: 'leverage machine', custom: true })).toBeNull()
  })
})

describe('filtering by machine', () => {
  const MACHINE_KIT = ['leverage machine', 'sled machine', 'smith machine', 'assisted', 'dumbbell', 'bench', 'pull-up bar']
  it('no kinds listed changes nothing: the whole catalogue answers as it did, for several kits', () => {
    for (const kit of [[], ['dumbbell'], ['leverage machine'], MACHINE_KIT, ALL_EQUIPMENT]) {
      for (const e of EXDB) {
        const before = eqAvailable(kit, e)
        expect(eqAvailable(kit, e, []), e.id).toBe(before)
        expect(eqAvailable(kit, e, undefined), e.id).toBe(before)
      }
    }
  })
  it('with kinds, they decide every catalogue machine exercise, whatever its equipment value', () => {
    const kit = ['dumbbell', 'leverage machine']
    expect(eqAvailable(kit, LEG_PRESS_45)).toBe(false) // sled not ticked: today's answer
    expect(eqAvailable(kit, LEG_PRESS_45, ['leg-press'])).toBe(true)
    expect(eqAvailable(kit, LEVER_LEG_PRESS, ['leg-press'])).toBe(true)
    expect(eqAvailable(kit, LEG_EXTENSION, ['leg-press'])).toBe(false)
    expect(eqAvailable(kit, SMITH_SQUAT, ['leg-press'])).toBe(false)
    expect(eqAvailable(kit, SMITH_SQUAT, ['leg-press', 'smith'])).toBe(true)
  })
  it('kinds never touch anything that is not a machine', () => {
    const kit = ['dumbbell', 'bench']
    expect(eqAvailable(kit, byName('dumbbell bench press'), ['leg-press'])).toBe(true)
    expect(eqAvailable(kit, byName('barbell bench press'), ['leg-press'])).toBe(false)
    // an "assisted" row that needs no machine (a partner) stays, like body weight
    expect(eqAvailable(kit, PARTNER_STRETCH, ['leg-press'])).toBe(true)
    // a custom machine exercise goes by its equipment value
    expect(eqAvailable(kit, { id: 'c1', n: 'my press', eq: 'leverage machine', custom: true }, ['leg-press'])).toBe(false)
  })
  it('the active profile\'s list reaches the library and the picker (exAvailable)', () => {
    const S = { equipFilterOn: true, activeEquipId: 'g', equipProfiles: [{ id: 'g', name: 'Gym', equipment: ['leverage machine', 'sled machine'], machines: ['leg-press'], accV: 2 }] }
    expect(exAvailable(S, LEG_PRESS_45)).toBe(true)
    expect(exAvailable(S, LEG_EXTENSION)).toBe(false)
    expect(exAvailable({ ...S, equipFilterOn: false }, LEG_EXTENSION)).toBe(true)
  })
  it('the starter plan is fitted around a missing leg extension', () => {
    const plan = [['legs', 'Leg Day', '', [[LEG_PRESS_45.id, 3, 10], [LEG_EXTENSION.id, 3, 12]]]]
    const kit = profileEquipment({ equipment: ['leverage machine', 'sled machine', 'dumbbell', 'barbell'], accV: 2 })
    const asWritten = fitRoutines(plan, kit)
    expect(asWritten.swapped + asWritten.dropped).toBe(0)
    const fitted = fitRoutines(plan, kit, ['leg-press'])
    const ids = fitted.routines[0][3].map(([id]) => id)
    expect(ids[0]).toBe(LEG_PRESS_45.id)
    expect(ids).not.toContain(LEG_EXTENSION.id)
    expect(ids.every(id => eqAvailable(kit, EXIDX[id], ['leg-press']))).toBe(true)
    const full = buildStarterPlan('ppl', kit, ['leg-press'])
    expect(full.routines.flatMap(r => r.ex.map(e => e.id))).not.toContain(LEG_EXTENSION.id)
  })
})

describe('a profile\'s machine fields', () => {
  it('a list from anywhere (a backup, another device) is cleaned to known kinds, each once, in card order', () => {
    expect(profileMachines({ machines: ['smith', 'nope', 7, null, 'leg-press', 'smith'] })).toEqual(['leg-press', 'smith'])
    expect(profileMachines({ machines: 'leg-press' })).toEqual([])
    expect(profileMachines(null)).toEqual([])
  })
  it('without a list, a profile has the machines its equipment reaches', () => {
    expect(kindsForEquipment(['smith machine'])).toEqual(['smith'])
    expect(kindsForEquipment(['sled machine'])).toEqual(expect.arrayContaining(['leg-press', 'hack-squat', 'calf-raise', 'push-sled']))
    expect(kindsForEquipment(['sled machine'])).not.toContain('leg-extension')
    expect(machinesOf({ equipment: [] })).toEqual([])
    expect(machinesOf({ equipment: MACHINE_EQ })).toEqual(KIND_IDS)
    expect(machinesOf({ equipment: MACHINE_EQ, machines: ['cardio'] })).toEqual(['cardio'])
  })
  it('the machine equipment values follow the kinds, so an older app still filters about right', () => {
    expect(machineFields(['dumbbell', 'smith machine'], ['leg-press'])).toEqual({ equipment: ['dumbbell', 'leverage machine', 'sled machine'], machines: ['leg-press'] })
    // none at all: no list (no refinement) and no machine values, which is "no machines"
    expect(machineFields(['dumbbell', 'leverage machine', 'assisted'], [])).toEqual({ equipment: ['dumbbell'], machines: [] })
  })
  it('"Not at my gym" takes one kind out, starting from what the equipment reached', () => {
    const p = { id: 'g', equipment: ['dumbbell', 'leverage machine'] }
    const next = withoutKind(p, 'leg-extension')
    expect(next.machines).not.toContain('leg-extension')
    expect(next.machines).toEqual(kindsForEquipment(p.equipment).filter(k => k !== 'leg-extension'))
    expect(next.equipment).toContain('dumbbell')
    expect(eqAvailable(next.equipment, LEG_EXTENSION, next.machines)).toBe(false)
    expect(eqAvailable(next.equipment, LEVER_LEG_PRESS, next.machines)).toBe(true)
    expect(withoutKind({ id: 'g', equipment: ['dumbbell'] }, 'leg-extension')).toBeNull()
    expect(withoutKind({ id: 'g', equipment: ['leverage machine'], machines: ['leg-press'] }, 'leg-press')).toEqual({ equipment: [], machines: [] })
  })
  it('the button is offered only for a real machine the profile still has, on a real profile', () => {
    const p = { id: 'g', equipment: ['leverage machine'] }
    expect(removableKind(p, LEG_EXTENSION)).toBe('leg-extension')
    expect(removableKind(p, SMITH_SQUAT)).toBeNull()
    expect(removableKind(p, PARTNER_STRETCH)).toBeNull()
    expect(removableKind({ ...p, id: '' }, LEG_EXTENSION)).toBeNull()
    expect(removableKind(null, LEG_EXTENSION)).toBeNull()
  })
  it('summarises in a few words', () => {
    expect(machinesSummary({ equipment: MACHINE_EQ })).toBe('All machines')
    expect(machinesSummary({ equipment: [] })).toBe('No machines')
    expect(machinesSummary({ equipment: [], machines: ['smith'] })).toBe('1 machine')
    expect(machinesSummary({ equipment: [], machines: ['smith', 'cardio', 'leg-press'] })).toBe('3 machines')
  })
})

describe('searching the cards', () => {
  const found = q => searchKinds(q).map(k => k.id)
  it('finds a machine by its name, its id or an alias people type', () => {
    expect(found('LP')).toContain('leg-press')
    expect(found('45 degree')).toContain('leg-press')
    expect(found('hack')).toContain('hack-squat')
    expect(found('pendulum')).toContain('squat-machine')
    expect(found('gravitron')).toEqual(['assisted-pullup'])
    expect(found('pec deck')).toContain('pec-deck')
    expect(found('')).toHaveLength(KIND_IDS.length)
    expect(found('zzz')).toEqual([])
  })
})
