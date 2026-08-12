// Measurements have to survive every path that carries a profile off this device and back: the
// JSON backup in Settings, and the server sync. Both rebuild state by overlaying the stored blob
// on DEF, so a key missing from DEF — or a server that persists a whitelist instead of the blob —
// drops the history without erroring anywhere. That is the failure this file exists to catch:
// quiet at the time, and only visible a restore later, when the history is already gone.
//
// The store reaches for localStorage and document the moment it is imported, so both are stubbed
// before the dynamic import below. Everything under test is the real DEF and the real normalizer,
// not a restatement of them — a restatement would still pass with the key missing from DEF.
import { describe, it, expect } from 'vitest'
import {
  normalizeMeasurementsState, DEFAULT_MEASUREMENT_KEYS, measurementValue
} from '../lib/measurements.js'

const mem = {}
globalThis.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v) },
  removeItem: k => { delete mem[k] }
}
globalThis.document = { addEventListener: () => {}, visibilityState: 'visible' }

const { DEF, hasData } = await import('./useStore.js')

const clone = o => JSON.parse(JSON.stringify(o))

// The three writers, spelled as the code spells them.
// Settings.jsx `doExport`: the whole state object, nothing selected out of it.
const exportBackup = S => JSON.stringify(S, null, 2)
// Settings.jsx `doImport` → replaceState → persist, which normalizes on the way in.
const importBackup = json => normalizeMeasurementsState(Object.assign(clone(DEF), JSON.parse(json)))
// api/server.js `PUT /api/data` stores the blob verbatim, minus the in-progress workout.
const pushToServer = S => { const b = clone(S); delete b.active; return JSON.stringify({ state: b }) }
// useStore.js `pullState` → persist, same overlay-then-normalize as the import path.
const pullFromServer = wire => normalizeMeasurementsState(Object.assign(clone(DEF), JSON.parse(wire).state))

// A profile that uses all three keys: a non-default field set, a custom field, two check-ins,
// and a value recorded against that custom field.
const KNEE = 'knee-1'
const profile = () => normalizeMeasurementsState(Object.assign(clone(DEF), {
  unit: 'kg',
  measurementEnabled: ['neck', 'waist', 'chest', 'bodyFat'],
  customMeasurements: [{ id: KNEE, name: 'Around knees', enabled: true }],
  measurements: [
    { d: '2026-06-01', t: 1780000000000, neck: 39.5, waist: 88.2, chest: 103, bodyFat: 20.1, other: [{ id: KNEE, name: 'Around knees', value: 37.4 }] },
    { d: '2026-07-01', t: 1782600000000, neck: 39.1, waist: 84.6, chest: 102.4, bodyFat: 18.2, other: [{ id: KNEE, name: 'Around knees', value: 37.9 }] }
  ],
  workouts: [], routines: []
}))

const measurementState = S => ({
  measurements: S.measurements,
  measurementEnabled: S.measurementEnabled,
  customMeasurements: S.customMeasurements
})

describe('persistence — measurements survive the round trips', () => {
  it('declares all three keys in DEF, so the overlay has somewhere to land', () => {
    // Object.assign(clone(DEF), stored) only carries keys the stored blob has; DEF is what a
    // profile that predates the feature falls back to. A key missing here reads as undefined
    // everywhere downstream instead of as an empty history.
    expect(Object.keys(DEF)).toEqual(expect.arrayContaining(['measurements', 'measurementEnabled', 'customMeasurements']))
    expect(DEF.measurements).toEqual([])
    expect(DEF.customMeasurements).toEqual([])
    expect(DEF.measurementEnabled).toBeNull()   // null, not a list — see normalizeMeasurementsState
  })

  it('survives a backup export → import unchanged', () => {
    const before = profile()
    const after = importBackup(exportBackup(before))
    expect(measurementState(after)).toEqual(measurementState(before))
    // …including the reading recorded against the custom field, which lives in `other`, not on
    // the entry itself, and so travels by a different route than every built-in.
    expect(measurementValue(after.measurements[1], 'other:' + KNEE)).toBe(37.9)
  })

  it('survives a server push → pull unchanged, and still drops the in-progress workout', () => {
    const before = Object.assign(profile(), { active: { id: 'live', started: 1 } })
    const after = pullFromServer(pushToServer(before))
    expect(measurementState(after)).toEqual(measurementState(before))
    expect(after.active).toBeNull()
  })

  it('survives the two chained — export, import, sync up, sync back down', () => {
    const before = profile()
    const after = pullFromServer(pushToServer(importBackup(exportBackup(before))))
    expect(measurementState(after)).toEqual(measurementState(before))
  })

  it('counts a measurements-only profile as data worth keeping', () => {
    // pullState overwrites local state when hasData() is false. Someone who has logged tape
    // readings but never a workout has a profile that is entirely measurements — if that reads
    // as empty, their first sync from a fresh device replaces it with the server's blank.
    const S = profile()
    S.workouts = []; S.routines = []; S.bodyweight = []
    expect(hasData(S)).toBe(true)
    expect(hasData(clone(DEF))).toBe(false)
  })

  it('keeps recorded values when the backup carries no custom definitions', () => {
    // An older backup, or one written by a client that never knew about the custom field: the
    // definition list is gone but the readings are still in the entries. Dropping them would be
    // losing history to a schema detail.
    const before = profile()
    const stripped = JSON.parse(exportBackup(before))
    stripped.customMeasurements = []
    const after = importBackup(JSON.stringify(stripped))
    expect(measurementValue(after.measurements[0], 'other:' + KNEE)).toBe(37.4)
    expect(measurementValue(after.measurements[1], 'other:' + KNEE)).toBe(37.9)
  })

  it('falls back to the default field set for a profile that predates the feature', () => {
    // No measurement keys at all in the stored blob — the shape every existing user syncs up
    // until the first time they open the screen.
    const old = { unit: 'kg', workouts: [], routines: [], bodyweight: [] }
    const after = importBackup(JSON.stringify(old))
    expect(after.measurements).toEqual([])
    expect(after.customMeasurements).toEqual([])
    expect(after.measurementEnabled).toEqual(DEFAULT_MEASUREMENT_KEYS)
  })
})
