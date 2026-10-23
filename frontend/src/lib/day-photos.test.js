import { describe, expect, it } from 'vitest'
import { dayPhotosOf, readDayPhoto, addDayPhoto, removeDayPhoto, restoreDayPhoto, serverTakesDayPhotos, fileProgressPhoto, workoutOn } from './day-photos.js'
import { referencedHashes, referencedFiles, WORKOUT_MEDIA_MAX } from './media-refs.js'
import { mergeStates, STAMPED_MAPS } from './sync-merge.js'

/* Progress photos filed under a day (#557): an optional per-photo map beside the workouts, merged
   like day notes, its files kept like every other photo's. */
const H = n => String(n).repeat(64).slice(0, 64)
const photo = h => ({ kind: 'image', hash: h, mime: 'image/webp', size: 1000, width: 800, height: 600, at: 1 })
const state = (over = {}) => ({ unit: 'kg', workouts: [], routines: [], customEx: [], ...over })

describe('filing and removing', () => {
  it('adds under a day, refuses a bad date, a bad ref and the same file twice', () => {
    const S = state()
    expect(addDayPhoto(S, '2026-10-02', photo(H(1)), 5)).toBe('added')
    expect(S.dayPhotos[H(1)]).toEqual({ d: '2026-10-02', m: photo(H(1)), _ts: 5 })
    expect(addDayPhoto(S, '2026-10-02', photo(H(1)), 6)).toBe('dup')
    expect(addDayPhoto(S, 'yesterday', photo(H(2)), 6)).toBe('invalid')
    expect(addDayPhoto(S, '2026-10-02', { hash: 'x' }, 6)).toBe('invalid')
    expect(dayPhotosOf(S)).toEqual([{ hash: H(1), d: '2026-10-02', m: photo(H(1)) }])
  })
  it('a removal is a stamped empty entry, and Undo brings it back', () => {
    const S = state()
    addDayPhoto(S, '2026-10-02', photo(H(1)), 5)
    const entry = S.dayPhotos[H(1)]
    expect(removeDayPhoto(S, H(1), 9)).toBe(true)
    expect(S.dayPhotos[H(1)]).toEqual({ _ts: 9 })
    expect(dayPhotosOf(S)).toEqual([])
    expect(removeDayPhoto(S, H(1), 10)).toBe(false)
    expect(restoreDayPhoto(S, H(1), entry, 11)).toBe(true)
    expect(S.dayPhotos[H(1)]).toEqual({ d: '2026-10-02', m: photo(H(1)), _ts: 11 })
  })
  it('reads junk as nothing', () => {
    expect(dayPhotosOf({ dayPhotos: [1] })).toEqual([])
    expect(dayPhotosOf({ dayPhotos: { [H(1)]: { d: '2026-10-02', m: photo(H(2)) }, x: 3 } })).toEqual([])
    expect(readDayPhoto({ d: '2026-10-02' })).toBeNull()
  })
})

describe('where a new photo goes', () => {
  it('onto the day\'s workout while it has room, else under the day', () => {
    const w = { id: 'w', d: '2026-10-02', start: 1, entries: [] }
    const S = state({ workouts: [w] })
    expect(fileProgressPhoto(S, '2026-10-02', photo(H(1)), { now: 5 })).toBe('workout')
    expect(S.workouts[0].media).toHaveLength(1)
    expect(fileProgressPhoto(S, '2026-10-03', photo(H(2)), { now: 5 })).toBe('day')
    const full = state({ workouts: [{ ...w, media: Array.from({ length: WORKOUT_MEDIA_MAX }, (_, i) => photo(H(i + 3))) }] })
    expect(fileProgressPhoto(full, '2026-10-02', photo(H(1)), { now: 5 })).toBe('day')
  })
  it('a server that does not keep day photos: only onto workouts', () => {
    const S = state()
    expect(fileProgressPhoto(S, '2026-10-03', photo(H(2)), { canDay: false })).toBe('no-room')
    expect(S.dayPhotos).toBeUndefined()
  })
  it('picks the latest workout of a day', () => {
    const S = state({ workouts: [{ id: 'a', d: '2026-10-02', start: 1 }, { id: 'b', d: '2026-10-02', start: 9 }] })
    expect(workoutOn(S, '2026-10-02').id).toBe('b')
    expect(workoutOn(S, '2026-10-05')).toBeNull()
  })
  it('a server keeps them when it says so, or there is none', () => {
    expect(serverTakesDayPhotos(null, null)).toBe(true)
    expect(serverTakesDayPhotos({ id: 'u' }, { media: { workouts: true } })).toBe(false)
    expect(serverTakesDayPhotos({ id: 'u' }, { media: { workouts: true, days: true } })).toBe(true)
    expect(serverTakesDayPhotos({ id: 'u' }, null)).toBe(false)
  })
})

describe('kept, synced and merged like every other photo', () => {
  it('their files count for the uploads, the backups and the clean-ups', () => {
    const S = state()
    addDayPhoto(S, '2026-10-02', photo(H(1)), 5)
    expect([...referencedHashes(S)]).toEqual([H(1)])
    expect(referencedFiles(S).map(f => f.hash)).toEqual([H(1)])
    removeDayPhoto(S, H(1), 6)
    expect([...referencedHashes(S)]).toEqual([])
  })
  it('two devices each adding one keep both; a removal on one wins over the older add', () => {
    expect(STAMPED_MAPS).toContain('dayPhotos')
    const a = state({ _ts: 10 }), b = state({ _ts: 20 })
    addDayPhoto(a, '2026-10-02', photo(H(1)), 10)
    addDayPhoto(b, '2026-10-03', photo(H(2)), 20)
    const m = mergeStates(a, b)
    expect(dayPhotosOf(m).map(p => p.hash).sort()).toEqual([H(1), H(2)])
    const c = structuredClone(m); c._ts = 30
    removeDayPhoto(c, H(1), 30)
    expect(dayPhotosOf(mergeStates(c, a)).map(p => p.hash)).toEqual([H(2)])
    expect(dayPhotosOf(mergeStates(a, c)).map(p => p.hash)).toEqual([H(2)])
  })
  it('a profile without day photos merges exactly as before', () => {
    const a = state({ _ts: 10, workouts: [{ id: 'w', d: '2026-10-02', start: 1, entries: [], _ts: 10 }] })
    const b = state({ _ts: 20 })
    expect('dayPhotos' in mergeStates(a, b)).toBe(false)
  })
})
