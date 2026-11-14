// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { DEF, restoredStateFor } from '../store/useStore.js'
import { mergeStates } from './sync-merge.js'
import { exportBackupZip, readBackupFile } from './backup-media.js'
import { createMediaStore, memoryBackend } from './media-store.js'
import { sha256Hex } from './sha256.js'
import { png } from './media-samples.test-util.js'
import { parsePlan, buildPlanBundle } from './plan-share.js'

/* DATA SAFETY for the v1.4.2 small fixes ("don't fry our DB"). The new data is optional only:
   warmupRestOff and sideRestSec on a routine entry (rest for warm-ups and between sides), subs on
   a routine entry (planned backups) and S.dayPhotos (photos filed under a day). Nothing existing is
   renamed, removed or rewritten. A profile from before them goes through loading, sync merging and
   backups unchanged and gains none of them; one that has them keeps them through all of it. */
const H = n => String(n).repeat(64).slice(0, 64)
const photo = h => ({ kind: 'image', hash: h, mime: 'image/webp', size: 1000, width: 800, height: 600, at: 1 })
const OLD = () => ({
  ...structuredClone(DEF),
  _ts: 1760000000000, unit: 'kg', body: 'female',
  customEx: [{ id: 'cu1', n: 'grip trainer', bp: 'lower arms', eq: 'custom', custom: true, media: photo(H(9)), _ts: 5 }],
  routines: [{ id: 'r1', name: 'Upper', _ts: 7, ex: [
    { id: '0025', sets: 3, reps: 8, weight: 60, restSec: 150, warmupSets: 2, warmupRestSec: 45 },
    { id: '0098', sets: 3, reps: 10, weight: 20, side: true, sg: 'sg1' },
    { id: 'cu1', sets: 2, reps: 20, sg: 'sg1', note: 'slow' },
  ] }],
  week: { 1: ['r1'] },
  workouts: [{ id: 'w1', d: '2026-10-01', start: 1, end: 2, name: 'Upper', routineId: 'r1', _ts: 8,
    entries: [{ id: '0025', sets: [{ w: 40, r: 8, done: true, phase: 'warmup', warmup: true }, { w: 60, r: 8, done: true }] },
      { id: '0098', sets: [{ w: 20, r: 10, done: true, sides: { L: { w: 20, r: 5, done: true }, R: { w: 20, r: 5, done: true } } }] }],
    media: [photo(H(1))] }],
  bodyweight: [{ d: '2026-10-01', w: 63.4, t: 9 }],
  dayNotes: { '2026-10-02': { tag: 'sick', _ts: 10 } },
  exWeights: { '0025': 60 },
})
const NEW = () => {
  const S = OLD()
  S.routines[0].ex[0] = { ...S.routines[0].ex[0], warmupRestOff: true, subs: ['0047', '0289'] }
  S.routines[0].ex[1] = { ...S.routines[0].ex[1], sideRestSec: 20 }
  S.dayPhotos = { [H(2)]: { d: '2026-10-03', m: photo(H(2)), _ts: 11 } }
  return S
}
const NEW_KEYS = /"(dayPhotos|subs|warmupRestOff|sideRestSec)"/

describe('a profile from before the new fields', () => {
  it('loads as it was, and gains none of them', () => {
    const old = OLD()
    const loaded = restoredStateFor({}, structuredClone(old))
    for (const k of Object.keys(old)) expect(loaded[k], k).toEqual(old[k])
    expect(JSON.stringify(loaded)).not.toMatch(NEW_KEYS)
  })
  it('merges with itself and with a copy of itself unchanged', () => {
    const a = OLD(), b = OLD()
    const m = mergeStates(a, b)
    for (const k of ['customEx', 'routines', 'week', 'workouts', 'bodyweight', 'dayNotes', 'exWeights']) expect(m[k], k).toEqual(a[k])
    expect(JSON.stringify(m)).not.toMatch(NEW_KEYS)
    expect(a).toEqual(OLD())   // the inputs are never written to
  })
  it('goes through a backup with photos and comes back the same', async () => {
    const media = createMediaStore(memoryBackend())
    const old = OLD()
    for (const ref of [old.customEx[0].media, old.workouts[0].media[0]]) {
      const bytes = png(ref.hash.charCodeAt(0), 1)
      ref.hash = await sha256Hex(bytes); ref.mime = 'image/png'; ref.size = bytes.length
      await media.put(ref.hash, new Blob([bytes]), { mime: 'image/png' })
    }
    const out = await exportBackupZip(old, { media })
    const read = await readBackupFile(new File([out.blob], 'b.zip'))
    expect(read.state).toEqual(JSON.parse(JSON.stringify(old)))
  })
  it('a plan file of its routines carries nothing new', () => {
    const plan = parsePlan(JSON.stringify(buildPlanBundle(OLD(), 'Plan')))
    expect(JSON.stringify(plan)).not.toMatch(NEW_KEYS)
  })
})

describe('a profile with them', () => {
  it('loads with them', () => {
    const loaded = restoredStateFor({}, NEW())
    expect(loaded.routines).toEqual(NEW().routines)
    expect(loaded.dayPhotos).toEqual(NEW().dayPhotos)
  })
  it('keeps them through a merge with a copy from before them, either way round', () => {
    const fresh = NEW(), old = OLD()
    for (const m of [mergeStates(fresh, old), mergeStates(old, fresh)]) {
      expect(m.dayPhotos).toEqual(fresh.dayPhotos)
      // the same routine, the copy with the fields edited last
      fresh.routines[0]._ts = 99
    }
    const m = mergeStates({ ...NEW(), routines: [{ ...NEW().routines[0], _ts: 99 }] }, OLD())
    expect(m.routines[0].ex[0]).toMatchObject({ warmupRestOff: true, subs: ['0047', '0289'] })
    expect(m.routines[0].ex[1].sideRestSec).toBe(20)
  })
  it('keeps them through a backup', async () => {
    const S = NEW()
    S.customEx = []; S.workouts[0].media = []
    const out = await exportBackupZip(S, { media: createMediaStore(memoryBackend()) })
    const read = await readBackupFile(new File([out.blob], 'b.zip'))
    expect(read.state.dayPhotos).toEqual(S.dayPhotos)
    expect(read.state.routines).toEqual(S.routines)
    const json = JSON.parse(JSON.stringify(S, null, 2))
    expect(json.dayPhotos).toEqual(S.dayPhotos)
  })
})
