import { describe, it, expect, vi } from 'vitest'
import { providerPictureDue, takeProviderPicture, startProviderPicture } from './oidc-picture.js'
import { MediaError } from './media-ingest.js'
import { keepAvatarMark } from './sync-merge.js'

const H = c => c.repeat(64)
const ref = (hash = H('a')) => ({ kind: 'image', hash, mime: 'image/webp', size: 9000, width: 256, height: 256, at: 5 })
const T1 = '2026-11-27T09:00:00.000Z'
const T2 = '2026-11-28T09:00:00.000Z'
const ON = { media: { imageMB: 2, avatar: true } }

const mark = (at, hash) => hash ? { at, hash } : { at }

describe('whether to fetch the provider\'s picture', () => {
  it('takes it for a profile without a picture, or with the provider\'s from an earlier sign-in', () => {
    expect(providerPictureDue({}, T1, ON)).toBe(true)
    expect(providerPictureDue({ avatar: { m: ref() }, avatarOidc: mark(T1, H('a')) }, T2, ON)).toBe(true)
    expect(providerPictureDue({ avatarOidc: mark(T1) }, T2, ON)).toBe(true)
    expect(providerPictureDue({ avatar: { m: 'broken' } }, T1, ON)).toBe(true)
  })
  it('once per sign-in: not again for the sign-in it came from, after it was removed, or for an older one', () => {
    expect(providerPictureDue({ avatar: { m: ref() }, avatarOidc: mark(T1, H('a')) }, T1, ON)).toBe(false)
    expect(providerPictureDue({ avatarOidc: mark(T1) }, T1, ON)).toBe(false)
    expect(providerPictureDue({ avatarOidc: mark(T2) }, T1, ON), 'a tab whose /api/me is older than the profile it pulled').toBe(false)
    expect(providerPictureDue({ avatar: { m: ref() }, avatarOidc: mark(T2, H('a')) }, T1, ON), 'a tab whose /api/me is older than the profile it pulled').toBe(false)
  })
  it('never over a photo or an icon chosen here', () => {
    expect(providerPictureDue({ avatar: { m: ref() } }, T1, ON)).toBe(false)
    expect(providerPictureDue({ avatar: { preset: 'moon' } }, T1, ON)).toBe(false)
    expect(providerPictureDue({ avatar: { preset: 'moon' }, avatarOidc: mark(T1, H('a')) }, T2, ON)).toBe(false)
    expect(providerPictureDue({ avatar: { m: ref(H('b')) }, avatarOidc: mark(T1, H('a')) }, T2, ON)).toBe(false)
  })
  it('only after a sign-in that named one, and only where the server keeps avatars', () => {
    expect(providerPictureDue({}, undefined, ON)).toBe(false)
    expect(providerPictureDue({}, '', ON)).toBe(false)
    expect(providerPictureDue({}, T1, { media: { imageMB: 2 } })).toBe(false)
    expect(providerPictureDue({}, T1, {})).toBe(false)
    expect(providerPictureDue({}, T1, null)).toBe(false)
  })
  it('holds against what an app from before it does to the picture', () => {
    const taken = () => ({ avatar: { m: ref() }, avatarOidc: mark(T1, H('a')) })
    const removed = taken(); delete removed.avatar
    expect(providerPictureDue(removed, T1, ON), 'removed on the older app').toBe(false)
    const photo = taken(); photo.avatar = { m: ref(H('b')) }
    expect(providerPictureDue(photo, T2, ON), 'replaced by a photo on the older app').toBe(false)
    const icon = taken(); icon.avatar = { preset: 'crown' }
    expect(providerPictureDue(icon, T2, ON), 'replaced by an icon on the older app').toBe(false)
  })
})

function fakeStore (init) {
  let state = { ready: true, sync: {}, config: ON, ...init }
  const subs = new Set()
  const api = {
    getState: () => state,
    set (patch) { state = { ...state, ...patch }; subs.forEach(f => f(state)) },
    subscribe: f => { subs.add(f); return () => subs.delete(f) }
  }
  state.update = mut => { const S = structuredClone(state.S); mut(S); api.set({ S }) }
  return api
}
const rendered = (hash = H('e')) => ({ blob: new Blob([new Uint8Array(10)], { type: 'image/webp' }), media: ref(hash) })
const deps = (over = {}) => ({
  apiBlob: vi.fn(async () => new Blob([new Uint8Array(3)])),
  render: vi.fn(async () => rendered()),
  media: { put: vi.fn(async () => true) },
  ...over
})
let n = 0
const user = (seen = T1) => ({ id: 'u' + ++n, name: 'Ana', oidcPicture: seen })

describe('taking the provider\'s picture', () => {
  it('fetches it for this account, makes it here, keeps the file pending and marks the sign-in', async () => {
    const u = user()
    const store = fakeStore({ user: u, S: {} })
    const d = deps()
    expect(await takeProviderPicture(store, d)).toBe(true)
    expect(d.apiBlob).toHaveBeenCalledWith('/api/oidc/picture', { expectSize: 2 * 1024 * 1024, headers: { 'X-OpenGym-Account': u.id } })
    expect(d.media.put).toHaveBeenCalledWith(H('e'), expect.any(Blob), { mime: 'image/webp', pending: true })
    expect(store.getState().S.avatar).toEqual({ m: ref(H('e')) })
    expect(store.getState().S.avatarOidc).toEqual({ at: T1, hash: H('e') })
    expect(await takeProviderPicture(store, d), 'the next start, here or on another device with the synced state').toBe(false)
    expect(d.apiBlob).toHaveBeenCalledTimes(1)
  })

  it('a newer sign-in replaces the provider\'s picture, never one chosen while it was fetched', async () => {
    const store = fakeStore({ user: user(T2), S: { avatar: { m: ref(H('a')) }, avatarOidc: mark(T1, H('a')) } })
    expect(await takeProviderPicture(store, deps())).toBe(true)
    expect(store.getState().S.avatar).toEqual({ m: ref(H('e')) })
    expect(store.getState().S.avatarOidc).toEqual({ at: T2, hash: H('e') })

    const busy = fakeStore({ user: user(), S: {} })
    const d = deps({ render: vi.fn(async () => { busy.getState().update(s => { s.avatar = { preset: 'crown' } }); return rendered() }) })
    expect(await takeProviderPicture(busy, d)).toBe(false)
    expect(busy.getState().S.avatar).toEqual({ preset: 'crown' })
    expect(d.media.put).not.toHaveBeenCalled()

    const saving = fakeStore({ user: user(), S: {} })
    const put = vi.fn(async () => { saving.getState().update(s => { s.avatar = { preset: 'moon' } }); return true })
    expect(await takeProviderPicture(saving, deps({ media: { put } }))).toBe(false)
    expect(saving.getState().S.avatar).toEqual({ preset: 'moon' })
    expect(saving.getState().S.avatarOidc).toBeUndefined()
  })

  it('a picture that cannot be had ends that sign-in with what the profile has', async () => {
    for (const fail of [Object.assign(new Error('x'), { status: 415 }), Object.assign(new Error('x'), { status: 413 }),
      Object.assign(new Error('x'), { status: 422 }), Object.assign(new Error('x'), { code: 'too-large' }), new MediaError('photo-too-big')]) {
      const store = fakeStore({ user: user(T2), S: { avatar: { m: ref(H('a')) }, avatarOidc: mark(T1, H('a')) } })
      const d = deps(fail instanceof MediaError ? { render: vi.fn(async () => { throw fail }) } : { apiBlob: vi.fn(async () => { throw fail }) })
      expect(await takeProviderPicture(store, d)).toBe(true)
      expect(store.getState().S.avatar).toEqual({ m: ref(H('a')) })
      expect(store.getState().S.avatarOidc).toEqual({ at: T2, hash: H('a') })
      expect(d.media.put).not.toHaveBeenCalled()
    }
    const empty = fakeStore({ user: user(), S: {} })
    await takeProviderPicture(empty, deps({ apiBlob: vi.fn(async () => { throw Object.assign(new Error('x'), { status: 404 }) }) }))
    expect(empty.getState().S.avatar).toBeUndefined()
    expect(empty.getState().S.avatarOidc).toEqual({ at: T1 })
  })

  it('a failure that can pass (no network, a server, proxy or provider that failed, a session that ended) is tried again next start, not in this one', async () => {
    for (const fail of [Object.assign(new Error('offline'), { code: 'timeout' }), Object.assign(new Error('x'), { status: 502 }),
      Object.assign(new Error('x'), { status: 503 }), Object.assign(new Error('x'), { status: 401 })]) {
      const store = fakeStore({ user: user(), S: {} })
      const d = deps({ apiBlob: vi.fn(async () => { throw fail }) })
      expect(await takeProviderPicture(store, d)).toBe(false)
      expect(store.getState().S).toEqual({})
      expect(await takeProviderPicture(store, d), 'not again in this run').toBe(false)
      expect(d.apiBlob).toHaveBeenCalledTimes(1)
    }
  })

  it('drops what it fetched when the account changed meanwhile', async () => {
    const store = fakeStore({ user: user(), S: {} })
    const d = deps({ apiBlob: vi.fn(async () => { store.set({ user: { id: 'other', oidcPicture: T1 } }); return new Blob([]) }) })
    expect(await takeProviderPicture(store, d)).toBe(false)
    expect(d.render).not.toHaveBeenCalled()
    expect(store.getState().S.avatar).toBeUndefined()
  })

  it('a sign-in that finds a photo or an icon chosen here is dealt with too where the server keeps avatars, without a fetch, so a backup\'s provider picture waits for the next one', async () => {
    vi.useFakeTimers()
    try {
      for (const S of [{ avatar: { m: ref(H('c')) }, avatarOidc: mark(T1, H('a')) }, { avatar: { preset: 'flame' } }]) {
        const store = fakeStore({ user: user(T2), S: structuredClone(S) })
        const d = deps()
        const stop = startProviderPicture(store, d)
        await vi.advanceTimersByTimeAsync(2500)
        expect(d.apiBlob).not.toHaveBeenCalled()
        expect(store.getState().S).toEqual({ ...S, avatarOidc: S.avatarOidc ? mark(T2, H('a')) : mark(T2) })
        const restored = keepAvatarMark(structuredClone(store.getState().S), { avatar: { m: ref(H('a')) }, avatarOidc: mark(T1, H('a')) })
        expect(providerPictureDue(restored, T2, ON)).toBe(false)
        store.getState().update(S => { delete S.avatarOidc })
        await vi.advanceTimersByTimeAsync(2500)
        expect(store.getState().S.avatarOidc, 'once per sign-in, also when the server drops the mark').toBeUndefined()
        stop()
      }
      const off = fakeStore({ user: user(T2), S: { avatar: { preset: 'flame' } }, config: { media: { imageMB: 2 } } })
      const stop = startProviderPicture(off, deps())
      await vi.advanceTimersByTimeAsync(2500)
      expect(off.getState().S).toEqual({ avatar: { preset: 'flame' } })
      stop()
    } finally { vi.useRealTimers() }
  })

  it('a sign-in question, an adoption still under way or a failed sync that comes up while it waits holds the fetch too', async () => {
    vi.useFakeTimers()
    try {
      for (const [blocked, open] of [[{ sync: { held: true } }, { sync: {} }], [{ sync: { adopting: true } }, { sync: {} }], [{ sync: { lastError: { status: 503, code: 'http' } } }, { sync: { lastError: null } }]]) {
        const store = fakeStore({ user: user(), S: {} })
        const d = deps()
        const stop = startProviderPicture(store, d)
        await vi.advanceTimersByTimeAsync(1000)
        store.set(blocked)
        await vi.advanceTimersByTimeAsync(2500)
        expect(d.apiBlob, JSON.stringify(blocked)).not.toHaveBeenCalled()
        store.set(open)
        await vi.advanceTimersByTimeAsync(2500)
        expect(d.apiBlob, JSON.stringify(blocked)).toHaveBeenCalledTimes(1)
        stop()
      }
    } finally { vi.useRealTimers() }
  })

  it('waits for boot, for an open sign-in question and for a sync that reached the server', async () => {
    vi.useFakeTimers()
    try {
      for (const [blocked, open] of [[{ ready: false }, { ready: true }], [{ sync: { held: true } }, { sync: {} }],
        [{ sync: { lastError: { status: 503, code: 'http' } } }, { sync: { lastError: null } }], [{ sync: { offline: true } }, { sync: { offline: false } }]]) {
        const store = fakeStore({ user: user(), S: {}, ...blocked })
        const d = deps()
        const stop = startProviderPicture(store, d)
        await vi.advanceTimersByTimeAsync(5000)
        expect(d.apiBlob, JSON.stringify(blocked)).not.toHaveBeenCalled()
        store.set(open)
        await vi.advanceTimersByTimeAsync(2500)
        expect(d.apiBlob, JSON.stringify(blocked)).toHaveBeenCalledTimes(1)
        expect(store.getState().S.avatarOidc.at).toBe(T1)
        stop()
      }
    } finally { vi.useRealTimers() }
  })
})
