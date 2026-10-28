// @vitest-environment happy-dom
/* Equipment per gym (#808): each equipment profile keeps its own plates, dumbbells, bars and machine
   stacks; the top-level fields are the active gym's copy (lib/gym-inventory.js). */
import { describe, expect, it, beforeEach } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { EXDB } from './exercises-data.js'
import { syncGymInventory, switchGym, copyInventory, reRoundOpenSets, gymView, sessionGymView, activeGym, INV_KEYS } from './gym-inventory.js'
import { inventoryFor, rowLoad, baseWeightFor, loadKindFor } from './plates.js'
import { dumbbellsOf, ownsNoDumbbells, stackOf, ownedWeightsFor } from './dumbbells.js'
import { barTypeWeight } from './bar.js'
import { mergeStates, stampChange } from './sync-merge.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { buildSnapshot } from './watch-sync.js'
import * as coachPayload from '../../../api/coach/core/payload.js'

const BENCH = EXDB.find(e => e.eq === 'barbell' && /bench press/.test(e.n)).id
const CURL = EXDB.find(e => e.eq === 'dumbbell' && /curl/.test(e.n)).id
const MACHINE = EXDB.find(e => e.eq === 'leverage machine').id
const clone = o => JSON.parse(JSON.stringify(o))

// A profile as 1.4.3 left it: global inventories, two equipment profiles without any.
const before = () => ({
  ...clone(DEF), unit: 'kg', _ts: 100,
  plates: { kg: { 20: 2, 10: 1, 5: 1, 2.5: 1, _ts: 50 } },
  dumbbells: { kg: { weights: [5, 10, 15, 20], _ts: 51 } },
  barDefaults: { kg: { barbell: 15 } },
  stackWeights: { [MACHINE]: { unit: 'kg', weights: [5, 11.3, 18.1], _ts: 52 } },
  equipProfiles: [
    { id: 'home', name: 'Home gym', equipment: ['barbell', 'dumbbell'], accV: 2, _ts: 10 },
    { id: 'big', name: 'Big gym', equipment: ['barbell', 'dumbbell', 'leverage machine'], accV: 2, _ts: 11 },
  ],
  activeEquipId: 'home',
})
const migrated = () => syncGymInventory(before(), null, 1000)
const gym = (S, id) => S.equipProfiles.find(p => p.id === id)

describe('the migration', () => {
  it('copies the inventories into every profile and changes nothing anyone sees', () => {
    const old = before()
    const S = migrated()
    for (const k of INV_KEYS) {
      expect(S[k], k).toEqual(old[k])
      expect(gym(S, 'home')[k], k).toEqual(old[k])
      expect(gym(S, 'big')[k], k).toEqual(old[k])
    }
    expect(S.invGym).toBe('home')
    expect(inventoryFor(S)).toEqual(inventoryFor(old))
    expect(dumbbellsOf(S)).toEqual([5, 10, 15, 20])
    expect(barTypeWeight(S, 'barbell')).toBe(15)
  })

  it('does nothing at all without profiles', () => {
    const S = { ...before(), equipProfiles: [], activeEquipId: null }
    const copy = clone(S)
    syncGymInventory(S, null, 1000)
    expect(S).toEqual(copy)
  })

  it('absent bars stay absent (the built-in ones)', () => {
    const S = before()
    delete S.barDefaults
    syncGymInventory(S, null, 1000)
    expect('barDefaults' in S).toBe(false)
    expect(gym(S, 'big').barDefaults).toEqual({})
    switchGym(S, 'big', 2000)
    expect('barDefaults' in S).toBe(false)
    expect(barTypeWeight(S, 'barbell')).toBe(20)
  })
})

describe('switching gyms', () => {
  it('each gym keeps its own plates, dumbbells, bars and stacks', () => {
    const S = migrated()
    // Big gym: plenty of plates (the standard set), more bells, a 20 kg bar, its own machine.
    switchGym(S, 'big', 2000)
    S.plates = { kg: { _ts: 2001 } }
    S.dumbbells = { kg: { weights: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22.5, 25], _ts: 2001 } }
    S.barDefaults = {}
    S.stackWeights = { [MACHINE]: { unit: 'kg', weights: [10, 20, 30], _ts: 2001 } }
    syncGymInventory(S, migrated(), 2002)
    expect(gym(S, 'big').dumbbells.kg.weights).toHaveLength(12)

    switchGym(S, 'home', 3000)
    expect(S.activeEquipId).toBe('home')
    expect(dumbbellsOf(S)).toEqual([5, 10, 15, 20])
    expect(barTypeWeight(S, 'barbell')).toBe(15)
    expect(stackOf(S, MACHINE)).toEqual([5, 11.3, 18.1])
    // 60 kg on the 15 kg bar at home: 22.5 a side, made from what is there.
    expect(rowLoad('pairs', 60, baseWeightFor(S, BENCH), inventoryFor(S))).toMatchObject({ perSide: 22.5, plates: [20, 2.5], missing: 0 })
    expect(ownedWeightsFor(S, { id: CURL })).toEqual([5, 10, 15, 20])

    switchGym(S, 'big', 4000)
    expect(dumbbellsOf(S)).toHaveLength(12)
    expect(barTypeWeight(S, 'barbell')).toBe(20)
    expect(stackOf(S, MACHINE)).toEqual([10, 20, 30])
    expect(rowLoad('pairs', 60, baseWeightFor(S, BENCH), inventoryFor(S))).toMatchObject({ perSide: 20, plates: [20], missing: 0 })
    // the home gym's copy is untouched by all of it
    expect(gym(S, 'home').dumbbells.kg.weights).toEqual([5, 10, 15, 20])
  })

  it('a switch stamps what it loads, so it wins a sync with the other gym’s older copy', () => {
    const S = migrated()
    switchGym(S, 'big', 5000)
    expect(S.plates.kg._ts).toBe(5000)
    expect(S.dumbbells.kg._ts).toBe(5000)
    expect(S.stackWeights[MACHINE]._ts).toBe(5000)
  })

  it('an edit goes to the active gym only', () => {
    const prev = migrated()
    const S = clone(prev)
    S.dumbbells = { kg: { weights: [5, 10], _ts: 6000 } }
    syncGymInventory(S, prev, 6001)
    expect(gym(S, 'home').dumbbells).toEqual({ kg: { weights: [5, 10], _ts: 6000 } })
    expect(gym(S, 'big').dumbbells.kg.weights).toEqual([5, 10, 15, 20])
  })

  it('owning no dumbbells is per gym, and so is what the Coach is told', () => {
    const S = migrated()
    S.dumbbells = { ...S.dumbbells, none: { on: true, _ts: 7000 } }
    syncGymInventory(S, migrated(), 7001)
    expect(ownsNoDumbbells(S)).toBe(true)
    const at = () => coachPayload.build(clone(S), { handle: 'u', kind: 'create' })
    expect(at().noDumbbells).toBe(true)
    switchGym(S, 'big', 8000)
    expect(ownsNoDumbbells(S)).toBe(false)
    expect(at().noDumbbells).toBeUndefined()
  })

  it('copies one list from another gym', () => {
    const S = migrated()
    switchGym(S, 'big', 2000)
    S.plates = { kg: { 25: 4, _ts: 2001 } }
    S.stackWeights = { [MACHINE]: { unit: 'kg', weights: [7, 14], _ts: 2001 } }
    syncGymInventory(S, migrated(), 2002)
    switchGym(S, 'home', 3000)
    expect(copyInventory(S, 'big', 'plates', { now: 3100 })).toBe(true)
    expect(S.plates.kg).toEqual({ 25: 4, _ts: 3100 })
    // the dumbbells stayed the home gym's
    expect(dumbbellsOf(S)).toEqual([5, 10, 15, 20])
    copyInventory(S, 'big', 'stackWeights', { exId: MACHINE, now: 3200 })
    expect(stackOf(S, MACHINE)).toEqual([7, 14])
    syncGymInventory(S, null, 3300)
    expect(gym(S, 'home').plates.kg[25]).toBe(4)
  })

  it('reads another gym’s lists without switching (a saved workout from there)', () => {
    const S = migrated()
    switchGym(S, 'big', 2000)
    S.dumbbells = { kg: { weights: [30], _ts: 2001 } }
    syncGymInventory(S, migrated(), 2002)
    switchGym(S, 'home', 3000)
    expect(dumbbellsOf(gymView(S, 'big'))).toEqual([30])
    expect(gymView(S, 'home')).toBe(S)
    expect(gymView(S, 'gone')).toBe(S)
    const editing = { ...S, active: { editingWorkoutId: 'w1', gym: { id: 'big', name: 'Big gym' }, entries: [] } }
    expect(dumbbellsOf(sessionGymView(editing))).toEqual([30])
  })
})

describe('older apps', () => {
  it('a plate list an older app edited reaches the active gym, the other gym keeps its own', () => {
    const S = migrated()
    // 1.4.3 knows only the top-level list; it stamps its edit as usual.
    const fromOld = clone(S)
    fromOld.plates = { kg: { 20: 1, _ts: 9000 } }
    syncGymInventory(fromOld, null, 9001)
    expect(gym(fromOld, 'home').plates.kg).toEqual({ 20: 1, _ts: 9000 })
    expect(gym(fromOld, 'big').plates.kg[10]).toBe(1)
  })

  it('a profile an older app switched to gets its own lists back, and the old copy goes home', () => {
    const S = migrated()
    switchGym(S, 'big', 2000)
    S.dumbbells = { kg: { weights: [40], _ts: 2001 } }
    syncGymInventory(S, migrated(), 2002)
    switchGym(S, 'home', 3000)
    // the older app switches the profile back to "big" and leaves everything else as it was
    const old = clone(S)
    old.activeEquipId = 'big'
    syncGymInventory(old, null, 4000)
    expect(old.invGym).toBe('big')
    expect(dumbbellsOf(old)).toEqual([40])
    expect(gym(old, 'home').dumbbells.kg.weights).toEqual([5, 10, 15, 20])
  })

  it('the merge with an older copy keeps every gym’s lists', () => {
    const mine = migrated()
    switchGym(mine, 'big', 2000)
    mine.plates = { kg: { 25: 2, _ts: 2001 } }
    syncGymInventory(mine, migrated(), 2002)
    stampChange(migrated(), mine, 2003)
    // an older app renamed the home gym meanwhile; its copy of the entry carries the fields it read
    const theirs = migrated()
    theirs.equipProfiles[0] = { ...theirs.equipProfiles[0], name: 'Garage', _ts: 2500, _f: { name: 2500 } }
    theirs._ts = 2500
    const merged = mergeStates(mine, theirs)
    expect(gym(merged, 'home').name).toBe('Garage')
    expect(gym(merged, 'big').plates.kg).toEqual({ 25: 2, _ts: 2001 })
    for (const k of INV_KEYS) expect(k in gym(merged, 'home'), k).toBe(true)
    expect(merged.invGym).toBe('big')
  })
})

describe('mid-workout', () => {
  const session = S => ({
    ...S,
    active: {
      id: 'a1', d: '2026-10-28', start: 1, cur: 0, routineIds: [], name: 'Push', gym: { id: 'big', name: 'Big gym' },
      entries: [
        { id: BENCH, target: { sets: 3, reps: 5, weight: 70 }, sets: [{ w: 70, r: 5, done: true }, { w: 70, r: 5 }, { w: 72.5, r: 5 }] },
        { id: CURL, target: { sets: 2, reps: 10, weight: 12 }, sets: [{ w: 12, r: 10 }, { w: 13, r: 10 }] },
      ],
    },
  })

  it('moves the open sets onto the new gym’s plates and dumbbells, leaves the done ones', () => {
    let S = migrated()
    switchGym(S, 'big', 2000)
    S = session(S)
    switchGym(S, 'home', 3000)
    const moved = reRoundOpenSets(S)
    const [bench, curl] = S.active.entries
    expect(bench.sets[0].w).toBe(70)           // done: as logged
    // home: 15 kg bar, 20+10+5+2.5 a side at most = 90; 70 → 27.5 a side → 20+5+2.5 = exact
    expect(bench.sets[1].w).toBe(70)
    expect(bench.sets[2].w).toBe(70)           // 72.5 needs 28.75 a side: the closest under it
    expect(curl.sets.map(s => s.w)).toEqual([10, 10])   // bells at home: 5, 10, 15, 20
    expect(moved).toBe(3)
    expect(S.active.gym).toEqual({ id: 'home', name: 'Home gym' })
  })

  it('the watch is handed the moved weights', () => {
    let S = migrated()
    S = session(S)
    switchGym(S, 'home', 3000)
    reRoundOpenSets(S)
    const snap = buildSnapshot(S)
    const curl = snap.active.entries.find(e => e.id === CURL)
    expect(curl.sets.map(s => s.w)).toEqual([10, 10])
  })

  it('a finished workout names its gym; a session without gyms does not', () => {
    const S = session(migrated())
    expect(buildCompletedWorkout(S.active).gym).toEqual({ id: 'big', name: 'Big gym' })
    const { gym: _g, ...plain } = S.active
    expect('gym' in buildCompletedWorkout(plain)).toBe(false)
  })

  it('a new session is tagged with the active gym, a past one logged later is not', () => {
    const S = migrated()
    S.active = { id: 'a', entries: [] }
    syncGymInventory(S, null, 1)
    expect(S.active.gym).toEqual({ id: 'home', name: 'Home gym' })
    const B = migrated()
    B.active = { id: 'b', entries: [], backfill: { durationMin: 60 } }
    syncGymInventory(B, null, 1)
    expect('gym' in B.active).toBe(false)
  })
})

describe('through the store', () => {
  beforeEach(() => { useStore.setState({ S: before() }) })

  it('an edit made the usual way lands in the active gym, and the switch brings it back', () => {
    const { update } = useStore.getState()
    update(s => { s.plates = { kg: { 20: 1, _ts: Date.now() } } })
    let S = useStore.getState().S
    expect(activeGym(S).plates.kg[20]).toBe(1)
    expect(gym(S, 'big').plates.kg[20]).toBe(2)
    update(s => { switchGym(s, 'big') })
    S = useStore.getState().S
    expect(S.plates.kg[20]).toBe(2)
    expect(S.equipProfiles.find(p => p.id === 'big')._f.plates).toBeGreaterThan(0)
    update(s => { switchGym(s, 'home') })
    expect(useStore.getState().S.plates.kg[20]).toBe(1)
    expect(loadKindFor(useStore.getState().S, BENCH)).toBe('pairs')
  })
})
