// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { restoredStateFor } from '../store/useStore.js'
import { mergeStates } from './sync-merge.js'
import { exportBackupZip, readBackupFile } from './backup-media.js'
import { createMediaStore, memoryBackend } from './media-store.js'
import { parsePlan, buildPlanBundle } from './plan-share.js'
import { restSecFor } from './supersetFlow.js'

/* DATA SAFETY for an exercise's own "No timer" (Discord lajawi): one optional `restOff: true` on a
   routine entry and a session target. Nothing existing changes meaning: a 0 or missing restSec
   still follows the default. A profile with it keeps it through loading, merging, backups and plan
   files; an app from before it reads such an exercise as following the default, as it always did. */
const OLD = () => ({
  _ts: 1760000000000, unit: 'kg',
  routines: [{ id: 'r1', name: 'Upper', _ts: 7, ex: [
    { id: '0025', sets: 3, reps: 8, weight: 60, restSec: 150 },
    { id: '0098', sets: 3, reps: 10, weight: 20 },
  ] }],
  week: { 1: ['r1'] }, workouts: [],
})
const NEW = () => {
  const S = OLD()
  S.routines[0].ex[1] = { ...S.routines[0].ex[1], restOff: true }
  return S
}

describe('an exercise on "No timer"', () => {
  it('a profile from before it gains nothing', () => {
    const loaded = restoredStateFor({}, OLD())
    expect(JSON.stringify(loaded.routines)).not.toMatch(/restOff/)
    expect(JSON.stringify(mergeStates(OLD(), OLD()).routines)).not.toMatch(/restOff/)
    expect(JSON.stringify(parsePlan(JSON.stringify(buildPlanBundle(OLD(), 'Plan'))))).not.toMatch(/restOff/)
  })
  it('loads with it and keeps it through a merge with a copy from before it', () => {
    expect(restoredStateFor({}, NEW()).routines).toEqual(NEW().routines)
    const m = mergeStates({ ...NEW(), routines: [{ ...NEW().routines[0], _ts: 99 }] }, OLD())
    expect(m.routines[0].ex[1].restOff).toBe(true)
  })
  it('keeps it through a backup and a shared plan', async () => {
    const S = NEW()
    const out = await exportBackupZip(S, { media: createMediaStore(memoryBackend()) })
    const read = await readBackupFile(new File([out.blob], 'b.zip'))
    expect(read.state.routines).toEqual(S.routines)
    expect(parsePlan(JSON.stringify(buildPlanBundle(S, 'Plan'))).routines[0].ex[1].restOff).toBe(true)
  })
  it('reads the way an older app would where restOff is unknown: like the default', () => {
    // What v1.4.2 resolved for an exercise without a rest of its own.
    const { restOff: _off, ...asOld } = NEW().routines[0].ex[1]
    expect(restSecFor([{ target: asOld, sets: [] }], [0], 90)).toBe(90)
    expect(restSecFor([{ target: NEW().routines[0].ex[1], sets: [] }], [0], 90)).toBe(0)
  })
})
