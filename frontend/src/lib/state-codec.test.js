import { describe, expect, it } from 'vitest'
import { migrateProfileV1ToV2 } from '../../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'
import { parseState, stringifyState } from './state-codec.js'

const v1 = {
  unit: 'kg', restSec: 90, routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear' }] }],
  workouts: [{ id: 'w1', d: '2026-01-05', start: 1, routineIds: ['r1'], entries: [{ id: '0025', rid: 'r1', target: { mode: 'reps', sets: 3, reps: 5, weight: 60 }, sets: [{ r: 5, w: 60, done: true }, { r: 5, w: 60, done: true }] }] }]
}

describe('state-codec', () => {
  it('stores a migrated profile compact and reads it back canonical', () => {
    const S = migrateProfileV1ToV2(structuredClone(v1), LIB_BY_ID).profile
    const raw = stringifyState(S)
    expect(JSON.parse(raw).packed).toBe(1)
    expect(raw.length).toBeLessThan(JSON.stringify(S).length)
    expect(parseState(raw)).toEqual(S)
  })

  it('leaves a v1 profile and a canonical unpacked one as they are', () => {
    expect(parseState(stringifyState(v1))).toEqual(v1)
    const S = migrateProfileV1ToV2(structuredClone(v1), LIB_BY_ID).profile
    expect(parseState(JSON.stringify(S))).toEqual(S)   // a copy written before the compact form
  })
})
