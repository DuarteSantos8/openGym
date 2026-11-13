import { describe, expect, it } from 'vitest'
import { mergeStates, stampChange, stampEntries } from './sync-merge.js'
import { syncGymInventory, switchGym } from './gym-inventory.js'

// The machine list (#923) is one more field of an equipment profile: it merges field by field
// like the profile's name and equipment (sync-merge.js mergeEntry), and the gym switching that
// copies inventories in and out of profiles (gym-inventory.js) carries it along untouched.
const clone = o => JSON.parse(JSON.stringify(o))
const base = (over = {}) => ({
  unit: 'kg', week: {}, dayPlan: {}, workouts: [], routines: [], bodyweight: [], customEx: [], favEx: [],
  exWeights: {}, exNotes: {}, barWeights: {}, gymCards: [], _ts: 100,
  equipProfiles: [{ id: 'gym', name: 'Gym', equipment: ['leverage machine', 'dumbbell'] }, { id: 'home', name: 'Home', equipment: ['dumbbell'] }],
  ...over,
})
const change = (prev, wall, mut) => {
  const n = clone(prev); mut(n)
  stampEntries(prev.equipProfiles, n.equipProfiles, wall)
  n._ts = stampChange(prev, n, wall)
  return n
}

describe('machine kinds across devices', () => {
  const S0 = base()
  it('machines picked on one device and a rename on the other both survive', () => {
    const A = change(S0, 1000, S => { S.equipProfiles[0].machines = ['leg-press', 'lat-pulldown'] })
    const B = change(S0, 2000, S => { S.equipProfiles[0].name = 'Big gym' })
    for (const m of [mergeStates(A, B), mergeStates(B, A)]) {
      expect(m.equipProfiles[0]).toMatchObject({ name: 'Big gym', machines: ['leg-press', 'lat-pulldown'] })
    }
  })
  it('of two machine lists, the one edited last wins, and a "Not at my gym" after a pick sticks', () => {
    const A = change(S0, 1000, S => { S.equipProfiles[0].machines = ['leg-press', 'leg-extension'] })
    const B = change(A, 3000, S => { S.equipProfiles[0].machines = ['leg-press'] })
    const C = change(S0, 2000, S => { S.equipProfiles[0].machines = ['smith'] })
    for (const m of [mergeStates(B, C), mergeStates(C, B)]) expect(m.equipProfiles[0].machines).toEqual(['leg-press'])
  })
  it('a profile that never had a list keeps not having one: no field appears out of a merge', () => {
    const A = change(S0, 1000, S => { S.equipProfiles[1].name = 'Garage' })
    const m = mergeStates(A, S0)
    expect('machines' in m.equipProfiles[0]).toBe(false)
    expect('machines' in m.equipProfiles[1]).toBe(false)
  })
  it('switching gyms carries each gym\'s machines along', () => {
    const S = base({ activeEquipId: 'gym' })
    S.equipProfiles[0].machines = ['leg-press']
    syncGymInventory(S)
    switchGym(S, 'home')
    syncGymInventory(S)
    expect(S.equipProfiles.find(p => p.id === 'gym').machines).toEqual(['leg-press'])
    expect('machines' in S.equipProfiles.find(p => p.id === 'home')).toBe(false)
  })
})
