// @vitest-environment happy-dom
// A set's own form video (lib/set-videos.js): attaching and removing it, what goes with a removed
// set or workout, the caps, the per-exercise timeline and its compare picker, where the files are
// kept and sent, and that nothing of it reaches a share card, Wrapped, a PDF or a CSV.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setVideosOf, setVideoOf, workoutSetVideos, setVideoCount, filmsLocally, filmSecCap, filmTarget,
  attachSetVideo, detachSetVideo, removeSavedSetVideo, formVideosFor, defaultComparePair, toggleCompare,
  SET_VIDEO_MAX, WORKOUT_SET_VIDEOS_MAX, PHONE_VIDEO_SEC
} from './set-videos.js'
import { normalizeMediaRef, referencedHashes, keptHashes, referencedFiles, uploadableFiles, stateMediaRefs } from './media-refs.js'
import { copyRowAt, removeRowAt } from './history.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { sanitizeCustomMedia } from './backup-media.js'
import { createMediaSync } from './media-sync.js'
import { createMediaStore, memoryBackend, _setMediaStore } from './media-store.js'
import { _resetMediaOwed, pendingRefCount, localOnlyRefCount } from './media-owed.js'
import { DEFAULT_LIMITS, limitsFrom } from './media-limits.js'
import { workoutCardModel } from './workout-card.js'
import { workoutPrintHTML, reportPrintHTML } from './report-print.js'
import { yearStats } from './wrapped.js'

const hex = c => c.repeat(64)
const A = hex('a'), B = hex('b'), C = hex('c'), P = hex('d'), Q = hex('e')
const video = (hash, over = {}) => ({ kind: 'video', hash, mime: 'video/mp4', size: 3_000_000, width: 720, height: 1280, dur: 8.4, poster: { hash: P, mime: 'image/webp', size: 9000, width: 270, height: 480 }, at: 5, ...over })
const photo = hash => ({ kind: 'image', hash, mime: 'image/webp', size: 1000, width: 800, height: 600, at: 1 })

const activeState = () => ({
  unit: 'kg',
  workouts: [],
  active: {
    id: 'live', d: '2026-10-28', start: 1, name: 'Legs', entries: [
      { id: '0043', target: { sets: 3, reps: 5 }, sets: [{ w: 60, r: 5, phase: 'warmup', done: true }, { w: 100, r: 5, done: true }, { w: 100, r: 5, done: false }] },
      { id: '0025', target: { sets: 2, reps: 8 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }
    ]
  }
})
const saved = (id, d, start, sets, exId = '0043') => ({ id, d, start, end: start + 3600e3, name: 'Legs', entries: [{ id: exId, target: { sets: sets.length, reps: 5 }, sets }] })

describe('a set video on the session in progress', () => {
  it('attaches to the set, replaces the one there, and comes off again', () => {
    const S = activeState()
    expect(attachSetVideo(S, { entry: 0, set: 1 }, video(A))).toBe('added')
    expect(S.active.entries[0].sets[1].media).toEqual([normalizeMediaRef(video(A))])
    expect(attachSetVideo(S, { entry: 0, set: 1 }, video(B))).toBe('replaced')
    expect(S.active.entries[0].sets[1].media.map(m => m.hash)).toEqual([B])
    expect(SET_VIDEO_MAX).toBe(1)
    expect(detachSetVideo(S, { entry: 0, set: 1 }, A)).toBe(false)
    expect(detachSetVideo(S, { entry: 0, set: 1 }, B)).toBe(true)
    expect('media' in S.active.entries[0].sets[1]).toBe(false)
  })
  it('refuses what is not a video, a set that is gone, and a session over its cap', () => {
    const S = activeState()
    expect(attachSetVideo(S, { entry: 0, set: 1 }, photo(A))).toBe('invalid')
    expect(attachSetVideo(S, { entry: 0, set: 1 }, { ...video(A), hash: 'nope' })).toBe('invalid')
    expect(attachSetVideo(S, { entry: 0, set: 9 }, video(A))).toBe('gone')
    expect(attachSetVideo({ active: null }, { entry: 0, set: 0 }, video(A))).toBe('gone')
    const big = { active: { entries: [{ id: 'x', sets: Array.from({ length: WORKOUT_SET_VIDEOS_MAX + 1 }, () => ({ w: 1, r: 1 })) }] } }
    for (let i = 0; i < WORKOUT_SET_VIDEOS_MAX; i++) expect(attachSetVideo(big, { entry: 0, set: i }, video(i.toString(16).padStart(64, '0')))).toBe('added')
    expect(attachSetVideo(big, { entry: 0, set: WORKOUT_SET_VIDEOS_MAX }, video(A))).toBe('full')
    // Replacing one is not a new one: the cap does not stop it.
    expect(attachSetVideo(big, { entry: 0, set: 0 }, video(A))).toBe('replaced')
  })
  it('marks a video kept on this phone, and only then', () => {
    const S = activeState()
    attachSetVideo(S, { entry: 0, set: 1 }, video(A), { local: true })
    expect(S.active.entries[0].sets[1].media[0].local).toBe(true)
    attachSetVideo(S, { entry: 0, set: 2 }, { ...video(B), local: true })
    expect('local' in S.active.entries[0].sets[2].media[0]).toBe(false)
  })
  it('reads only well-formed videos, each file once, one per set', () => {
    const set = { media: [photo(A), null, 'x', { ...video(B), size: -1 }, video(C), video(C), video(Q)] }
    expect(setVideosOf(set).map(m => m.hash)).toEqual([C])
    expect(setVideoOf({})).toBeNull()
    expect(setVideoOf({ media: 'x' })).toBeNull()
  })
  it('the camera of the ⋯ menu films the next open work set, else the last one', () => {
    const S = activeState()
    expect(filmTarget(S.active.entries[0])).toBe(2)
    expect(filmTarget(S.active.entries[1])).toBe(0)
    expect(filmTarget({ sets: [{ done: true }, { done: true }] })).toBe(1)
    expect(filmTarget({ sets: [{ phase: 'warmup', done: false }] })).toBe(0)
    expect(filmTarget({ sets: [] })).toBe(-1)
  })
})

describe('where a video is kept', () => {
  const cfg = sets => ({ media: { ...DEFAULT_LIMITS, workouts: true, days: true, ...(sets ? { sets: true } : {}) } })
  it('signed in, it goes to the server unless asked or unless the server keeps no set videos', () => {
    expect(filmsLocally({}, null, null)).toBe(false)                     // a guest or a phone in local mode: never uploaded anyway
    expect(filmsLocally({}, { id: 'u' }, cfg(true))).toBe(false)
    expect(filmsLocally({ formVideoLocal: true }, { id: 'u' }, cfg(true))).toBe(true)
    expect(filmsLocally({}, { id: 'u' }, cfg(false))).toBe(true)          // a server from before v1.4.4 would sweep it
    expect(filmsLocally({}, { id: 'u' }, {})).toBe(true)                  // a server without media at all
    expect(filmsLocally({}, { id: 'u' }, null)).toBe(false)               // not known yet: the sync asks again before it sends
  })
  it('a recording is held to the server\'s length cap, or a minute without one', () => {
    expect(filmSecCap(limitsFrom({ media: { videoSec: 30 } }))).toBe(30)
    expect(filmSecCap(limitsFrom(null))).toBe(PHONE_VIDEO_SEC)
    expect(PHONE_VIDEO_SEC).toBe(DEFAULT_LIMITS.videoSec)
  })
})

describe('saved workouts', () => {
  it('Finish keeps the video on its set; a copied set does not bring it along', () => {
    const S = activeState()
    attachSetVideo(S, { entry: 0, set: 1 }, video(A))
    const w = buildCompletedWorkout(S.active, { end: 99 })
    expect(setVideoOf(w.entries[0].sets[1]).hash).toBe(A)
    const copied = copyRowAt(S.active.entries[0].sets, 1)
    expect(copied).toHaveLength(4)
    expect('media' in copied[2]).toBe(false)
    expect(setVideoOf(copied[1]).hash).toBe(A)
  })
  it('is listed with the workout, counted, and taken off with a stamp', () => {
    const w = saved('w1', '2026-10-20', 1000, [{ w: 100, r: 5, done: true, media: [video(A)] }, { w: 100, r: 5, done: true }])
    const S = { workouts: [w] }
    expect(workoutSetVideos(w)).toEqual([{ entry: 0, set: 0, exId: '0043', m: normalizeMediaRef(video(A)) }])
    expect(setVideoCount(w)).toBe(1)
    expect(removeSavedSetVideo(S, { id: 'w1' }, B, 50)).toBe(false)
    expect(removeSavedSetVideo(S, { id: 'w1' }, A, 50)).toBe(true)
    expect('media' in S.workouts[0].entries[0].sets[0]).toBe(false)
    expect(S.workouts[0]._ts).toBe(50)
    expect(removeSavedSetVideo(S, { id: 'gone' }, A)).toBe(false)
  })
  it('a backup brings set videos back only where they pass the same checks', () => {
    const state = { workouts: [saved('w1', '2026-10-20', 1, [{ w: 1, r: 1, media: [{ hash: 'nope' }, video(A), video(B)] }, { w: 1, r: 1, media: [photo(C)] }])] }
    sanitizeCustomMedia(state)
    expect(state.workouts[0].entries[0].sets[0].media.map(m => m.hash)).toEqual([A])
    expect('media' in state.workouts[0].entries[0].sets[1]).toBe(false)
  })
})

describe('deleting a set or a workout lets its video go', () => {
  it('the files are no longer referenced, and the local clean-up deletes them', async () => {
    _resetMediaOwed()
    let clock = 10_000_000
    const media = createMediaStore(memoryBackend(), { now: () => clock })
    for (const h of [A, P]) await media.put(h, new Blob([new Uint8Array(10)]), { mime: h === A ? 'video/mp4' : 'image/webp', pending: true })
    const S = activeState()
    attachSetVideo(S, { entry: 0, set: 1 }, video(A))
    // The session in progress never syncs, but its files are kept while it runs.
    expect(referencedHashes(S).has(A)).toBe(false)
    expect(keptHashes(S)).toEqual(new Set([A, P]))
    let st = { ready: true, user: null, config: null, sync: { lastSynced: 0 }, S, stashedMediaHashes: async () => new Set() }
    const store = { getState: () => st, subscribe: () => () => {} }
    const sync = createMediaSync({ store, media, now: () => clock, locks: null, storage: null, nativeLoad: null, toast: vi.fn() })
    clock += 2 * 3600e3
    await sync.localMediaGc()
    expect(await media.has(A)).toBe(true)
    // Saved, then the set removed in the editor: nothing names the file any more.
    const w = buildCompletedWorkout(S.active, { end: 9 })
    st = { ...st, S: { workouts: [w], active: null } }
    expect(referencedHashes(st.S).has(A)).toBe(true)
    await sync.localMediaGc()
    expect(await media.has(A)).toBe(true)
    const rows = removeRowAt(w.entries[0].sets, 1)
    st = { ...st, S: { workouts: [{ ...w, entries: [{ ...w.entries[0], sets: rows }] }], active: null } }
    expect(referencedHashes(st.S).has(A)).toBe(false)
    await sync.localMediaGc()
    expect(await media.has(A)).toBe(false)
    expect(await media.has(P)).toBe(false)
  })
  it('a deleted workout takes its set videos out of the referenced files', () => {
    const w = saved('w1', '2026-10-20', 1, [{ w: 1, r: 1, media: [video(A)] }])
    expect(referencedFiles({ workouts: [w] }).map(f => f.hash)).toEqual([P, A])
    expect(referencedFiles({ workouts: [] })).toEqual([])
  })
})

describe('what the sync sends', () => {
  const state = () => ({ workouts: [saved('w1', '2026-10-20', 1, [
    { w: 1, r: 1, media: [video(A)] },
    { w: 1, r: 1, media: [video(B, { local: true, poster: { hash: Q, mime: 'image/webp', size: 10, width: 2, height: 2 } })] }
  ])] })
  it('never a video kept on its phone, and no set video to a server that does not keep them', () => {
    expect(stateMediaRefs(state())).toHaveLength(2)
    expect(uploadableFiles(state()).map(f => f.hash).sort()).toEqual([A, P].sort())
    expect(uploadableFiles(state(), { sets: false })).toEqual([])
    // The same file also on the workout's own list still goes: that ref has no reason to stay.
    const S = state(); S.workouts[0].media = [video(A)]
    expect(uploadableFiles(S, { sets: false }).map(f => f.hash).sort()).toEqual([A, P].sort())
  })
  it('asks the server about uploadable files only, and leaves the phone-only one pending', async () => {
    _resetMediaOwed()
    const media = createMediaStore(memoryBackend(), { now: () => 1 })
    _setMediaStore(media)   // the owed count reads the app's own store
    for (const h of [A, P, B, Q]) await media.put(h, new Blob([new Uint8Array(10)]), { mime: h === A || h === B ? 'video/mp4' : 'image/webp', pending: true })
    const api = vi.fn(async (path, { body }) => ({ missing: JSON.parse(body).hashes }))
    const apiUpload = vi.fn(async () => ({ existed: false }))
    const st = { ready: true, user: { id: 'u' }, config: { media: { ...DEFAULT_LIMITS, workouts: true, days: true, sets: true } }, sync: {}, S: state() }
    const sync = createMediaSync({ store: { getState: () => st, subscribe: () => () => {} }, media, api, apiUpload, apiBlob: vi.fn(), now: () => 1, locks: null, storage: null, toast: vi.fn(), allowed: () => true })
    await sync.syncMedia({ force: true })
    const asked = JSON.parse(api.mock.calls[0][1].body).hashes
    expect(asked.sort()).toEqual([A, P].sort())
    expect(apiUpload.mock.calls.map(c => c[0]).sort()).toEqual(['/api/media/' + A, '/api/media/' + P].sort())
    // Owed for a sign-out (kept aside, never wiped), but Settings calls it kept, not waiting.
    await media.ready()
    expect(pendingRefCount(st.S)).toBe(1)
    expect(localOnlyRefCount(st.S)).toBe(1)
    // A server from before v1.4.4: nothing of the set videos is sent.
    api.mockClear(); apiUpload.mockClear()
    st.config = { media: { ...DEFAULT_LIMITS, workouts: true } }
    await sync.syncMedia({ force: true })
    expect(api).not.toHaveBeenCalled()
    expect(apiUpload).not.toHaveBeenCalled()
    _setMediaStore(null)
  })
})

describe('Your form videos', () => {
  const S = { workouts: [
    saved('w1', '2026-09-01', 1, [{ w: 80, r: 5, done: true, media: [video(A)] }]),
    saved('w2', '2026-10-20', 5, [{ w: 100, r: 5, done: true, media: [video(B)] }, { w: 100, r: 5, done: true, media: [video(C)] }]),
    saved('w3', '2026-10-01', 3, [{ w: 90, r: 5, done: true, media: [video(Q)] }], '0025'),
    saved('w4', '2026-10-10', 4, [{ w: 95, r: 5, done: true }])
  ], active: { entries: [{ id: '0043', sets: [{ w: 1, r: 1, media: [video(hex('f'))] }] }] } }
  it('lists one exercise\'s saved videos newest first, never the session in progress', () => {
    const list = formVideosFor(S, '0043')
    expect(list.map(x => x.m.hash)).toEqual([C, B, A])
    expect(list.map(x => x.d)).toEqual(['2026-10-20', '2026-10-20', '2026-09-01'])
    expect(list[0].row.w).toBe(100)
    expect(new Set(list.map(x => x.key)).size).toBe(3)
    expect(formVideosFor(S, '0025').map(x => x.m.hash)).toEqual([Q])
    expect(formVideosFor(S, 'nope')).toEqual([])
  })
  it('compares the newest with the oldest to start, and a tap swaps out the first picked', () => {
    const list = formVideosFor(S, '0043')
    const [k0, k1, k2] = list.map(x => x.key)
    expect(defaultComparePair(list)).toEqual([k0, k2])
    expect(defaultComparePair(list.slice(0, 1))).toEqual([])
    expect(toggleCompare([k0, k2], k2, list)).toEqual([k0])         // unpick
    expect(toggleCompare([k0], k1, list)).toEqual([k0, k1])         // room for a second
    expect(toggleCompare([k2, k0], k1, list)).toEqual([k0, k1])     // full: the first picked goes, timeline order kept
    expect(toggleCompare([k0, 'gone'], 'also-gone', list)).toEqual([k0])
  })
})

describe('privacy: no share card, Wrapped, PDF or CSV reads a set video', () => {
  const S = () => ({
    unit: 'kg', bodyweight: [], workouts: [
      saved('w1', '2026-10-20', new Date('2026-10-20T08:00:00').getTime(), [{ w: 100, r: 5, done: true, media: [video(A)] }, { w: 100, r: 5, done: true, media: [video(B, { local: true })] }])
    ]
  })
  const leaks = text => [A, B, P, 'video/mp4', '"media"'].filter(x => String(text).includes(x))
  it('the share card', () => {
    expect(leaks(JSON.stringify(workoutCardModel(S().workouts[0], { unit: 'kg', nameOf: id => id })))).toEqual([])
  })
  it('the workout PDF and the report', () => {
    const st = S()
    expect(leaks(workoutPrintHTML(st, st.workouts[0], { owner: 'Ana' }))).toEqual([])
    expect(leaks(reportPrintHTML(st, { range: '4w', today: '2026-10-28' }))).toEqual([])
  })
  it('Wrapped', () => {
    expect(leaks(JSON.stringify(yearStats(S(), 2026)))).toEqual([])
  })
})
