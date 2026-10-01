// @vitest-environment happy-dom

/* Photos and videos of custom exercises that have not reached the server are owed exactly like a
   change that has not: a sign-out refuses while any are waiting, going ahead anyway keeps them in
   the stash with the state (and their files on this device), a different account signing in
   keeps them aside for the previous one, and the attempt before a sign-out includes them. The
   local media store is the in-memory one; lib/media-sync.js is not started, so settle() only
   reads what is pending — except in the test that registers a runner of its own. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { createMediaStore, memoryBackend, _setMediaStore } from '../lib/media-store.js'
import { _resetMediaOwed, registerMediaRunner } from '../lib/media-owed.js'
import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const A = 'a'.repeat(64)
const P = 'b'.repeat(64)
const ref = { kind: 'image', hash: A, mime: 'image/webp', size: 3, width: 8, height: 6, poster: { hash: P, mime: 'image/webp', size: 3, width: 8, height: 6 }, at: 1 }
const withPhoto = () => ({ ...clone(DEF), _ts: 100, customEx: [{ id: 'c1', n: 'sandbag carry', bp: 'back', custom: true, media: clone(ref) }] })
const tick = () => new Promise(r => setTimeout(r, 0))

let media
beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('gym_owner', USER.id)
  api.mockReset(); toast.mockReset()
  _resetMediaOwed()
  media = createMediaStore(memoryBackend())
  _setMediaStore(media)
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})
afterEach(() => {
  localStorage.clear()
  _setMediaStore(null)
  _resetMediaOwed()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})

// Signed in, with a copy the server already has (the push lands, nothing else is owed).
async function signedInWithPendingPhoto() {
  await media.put(A, new Blob(['abc']), { mime: 'image/webp', pending: true })
  await media.put(P, new Blob(['abc']), { mime: 'image/webp', pending: false })
  useStore.setState({ S: withPhoto(), user: USER, ready: true, sync: { ...fresh } })
  localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
  api.mockImplementation(async (path, o) => (o?.method === 'PUT' ? { ok: true, rev: 2 } : { ok: true }))
}

describe('owed photos and videos', () => {
  it('a sign-out refuses while one is waiting, and says it is one', async () => {
    await signedInWithPendingPhoto()
    expect(useStore.getState().unsyncedChanges()).toMatchObject({ owed: true, media: 1 })
    const r = await useStore.getState().signOut()
    expect(r).toMatchObject({ owed: true, media: 1 })
    expect(r.stashed).toBeUndefined()
    expect(useStore.getState().user).toEqual(USER)
    expect(await media.has(A)).toBe(true)
  })

  it('nothing is owed once the server has it', async () => {
    await signedInWithPendingPhoto()
    await media.markSynced(A)
    expect(useStore.getState().unsyncedChanges()).toEqual({ owed: false, count: 0 })
    expect(await useStore.getState().signOut()).toEqual({ owed: false })
  })

  it('going ahead anyway keeps the copy in the stash, and its files survive the sign-out', async () => {
    await signedInWithPendingPhoto()
    await media.put('c'.repeat(64), new Blob(['x']), { mime: 'image/png', pending: false })   // nobody's
    await new Promise(r => setTimeout(r, 5))   // put before the sign-out, not during it: a file put at or after its start is kept
    const r = await useStore.getState().signOut({ force: true })
    expect(r).toMatchObject({ owed: true, media: 1, stashed: true })
    expect(useStore.getState().S.customEx).toEqual([])
    const stash = JSON.parse(localStorage.getItem('gym_stash'))
    expect(Object.values(stash)[0].state.customEx[0].media.hash).toBe(A)
    expect(await useStore.getState().stashedMediaHashes()).toEqual(new Set([A, P]))
    // The purge runs after the wiped copy is written; waited for, not slept on, so a slow CI
    // runner cannot look before it has happened.
    await vi.waitFor(async () => expect(await media.has('c'.repeat(64))).toBe(false), { timeout: 3000 })
    expect(await media.has(A)).toBe(true)
    expect(await media.has(P)).toBe(true)
  })

  it('a sign-out takes the account\'s files even when its copy no longer refers to any (a photo removed a moment ago)', async () => {
    await media.put(A, new Blob(['abc']), { mime: 'image/webp', pending: false })
    await new Promise(r => setTimeout(r, 5))   // put before the sign-out, not during it
    useStore.setState({ S: { ...clone(DEF), _ts: 100 }, user: USER, ready: true, sync: { ...fresh } })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockImplementation(async (path, o) => (o?.method === 'PUT' ? { ok: true, rev: 2 } : { ok: true }))
    expect(await useStore.getState().signOut()).toEqual({ owed: false })
    await vi.waitFor(async () => expect(await media.has(A)).toBe(false), { timeout: 3000 })   // the purge runs after the wiped copy is written
  })

  it('a different account signing in keeps the previous one\'s waiting photo aside, even with no workouts', async () => {
    await media.put(A, new Blob(['abc']), { mime: 'image/webp', pending: true })
    // The copy owes nothing else: no workouts, no routines — only the custom exercise and its photo.
    useStore.setState({ S: withPhoto(), user: null, ready: true, sync: { ...fresh } })
    localStorage.setItem('gym_owner_name', 'One')
    useStore.getState().setUser({ id: 'user-2', name: 'Two' })
    const stash = JSON.parse(localStorage.getItem('gym_stash'))
    expect(Object.values(stash).map(e => e.uid)).toEqual([USER.id])
    expect(Object.values(stash)[0].state.customEx[0].media.hash).toBe(A)
    expect(useStore.getState().S.customEx).toEqual([])
  })

  it('the attempt before a sign-out includes the photos and videos waiting', async () => {
    await signedInWithPendingPhoto()
    const settle = vi.fn(async () => { await media.markSynced(A) })
    registerMediaRunner({ settle })
    const r = await useStore.getState().signOut()
    expect(settle).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ owed: false })
  })

  it('an edit stamps the custom exercise it changed, and only that one', async () => {
    useStore.setState({ S: { ...withPhoto(), customEx: [...withPhoto().customEx, { id: 'c2', n: 'other', bp: 'legs', custom: true, _ts: 5 }] }, user: null, ready: true })
    useStore.getState().update(s => { s.customEx[0].url = 'https://example.com/guide' })
    const [c1, c2] = useStore.getState().S.customEx
    expect(c1._ts).toBeGreaterThan(5)
    expect(c2._ts).toBe(5)
  })

  it('resetting the demo takes its photos and videos with it', async () => {
    await media.put(A, new Blob(['abc']), { mime: 'image/webp', pending: true })
    await useStore.getState().resetDemo()
    await tick()
    expect(await media.list()).toEqual([])
  })
})

// A workout's own photos and videos (workouts[].media) ride the very same rules: owed while the
// server lacks them, stashed with the copy on a forced sign-out, and their files kept for it.
describe('owed photos and videos of a logged workout', () => {
  const V = 'c'.repeat(64)
  const VP = 'd'.repeat(64)
  const clip = { kind: 'video', hash: V, mime: 'video/mp4', size: 3, width: 8, height: 6, dur: 7, poster: { hash: VP, mime: 'image/webp', size: 3, width: 8, height: 6 }, at: 2 }
  const withWorkoutMedia = () => ({ ...clone(DEF), _ts: 100, workouts: [{ id: 'w1', d: '2026-09-20', start: 1, end: 2, name: 'Push', entries: [], media: [clone(ref), clone(clip)] }] })
  async function signedIn() {
    await media.put(A, new Blob(['abc']), { mime: 'image/webp', pending: false })
    await media.put(P, new Blob(['abc']), { mime: 'image/webp', pending: false })
    await media.put(V, new Blob(['abc']), { mime: 'video/mp4', pending: true })
    await media.put(VP, new Blob(['abc']), { mime: 'image/webp', pending: true })
    useStore.setState({ S: withWorkoutMedia(), user: USER, ready: true, sync: { ...fresh } })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockImplementation(async (path, o) => (o?.method === 'PUT' ? { ok: true, rev: 2 } : { ok: true }))
  }

  it('a clip that has not reached the server is owed, counted once with its poster', async () => {
    await signedIn()
    expect(useStore.getState().unsyncedChanges()).toMatchObject({ owed: true, media: 1 })
    expect((await useStore.getState().signOut())).toMatchObject({ owed: true, media: 1 })
    expect(useStore.getState().user).toEqual(USER)
  })

  it('going ahead anyway stashes the workout with its media, and every one of its files stays', async () => {
    await signedIn()
    const r = await useStore.getState().signOut({ force: true })
    expect(r).toMatchObject({ owed: true, media: 1, stashed: true })
    expect(useStore.getState().S.workouts).toEqual([])
    expect(await useStore.getState().stashedMediaHashes()).toEqual(new Set([A, P, V, VP]))
    await new Promise(r => setTimeout(r, 20))
    for (const h of [A, P, V, VP]) expect(await media.has(h)).toBe(true)
  })

  it('once the server has it, nothing is owed', async () => {
    await signedIn()
    await media.markSynced(V)
    await media.markSynced(VP)
    expect(useStore.getState().unsyncedChanges()).toEqual({ owed: false, count: 0 })
  })
})
